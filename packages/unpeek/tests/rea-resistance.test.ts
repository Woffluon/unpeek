import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { transformJavaScript } from '../src/ast/index.js';
import { generateRuntimeShield, verifyCodeIntegrity, computeIntegrityHash } from '../src/runtime/index.js';

describe('Reverse Engineering & Deobfuscation Resistance (Acceptance Thresholds)', () => {
  const sampleSource = `
    const STRIPE_INTERNAL_ENDPOINT = "https://billing.internal.corp/v1/charge";
    const LICENSE_SIGNING_SECRET = "unpeek_prod_key_998877665544";

    function validateLicensePayload(customerToken, planTier) {
      const targetUrl = STRIPE_INTERNAL_ENDPOINT;
      const signingSecret = LICENSE_SIGNING_SECRET;
      const combined = customerToken + ":" + planTier + ":" + signingSecret + "@" + targetUrl;
      return combined;
    }

    function renderFrameLoop(points) {
      let sum = 0;
      for (let idx = 0; idx < points.length; idx++) {
        sum += points[idx] * 2;
      }
      return sum;
    }
  `;

  it('eliminates 100% of sensitive string literals and local parameter/variable names from static plaintext inspection', () => {
    const result = transformJavaScript(sampleSource, {
      seed: 0x123456,
      minStringLength: 4,
    });

    // 1. Sensitive strings must not appear in plaintext
    expect(result.code).not.toContain('https://billing.internal.corp/v1/charge');
    expect(result.code).not.toContain('unpeek_prod_key_998877665544');

    // 2. Local variable and parameter identifiers inside functions must be mangled
    expect(result.code).not.toContain('customerToken');
    expect(result.code).not.toContain('planTier');
    expect(result.code).not.toContain('signingSecret');
    expect(result.mangledSymbolsCount).toBeGreaterThan(0);
    expect(result.encryptedStringsCount).toBeGreaterThanOrEqual(2);
  });

  it('preserves 100% semantic equivalence and automatically exempts hot-path loops', () => {
    const result = transformJavaScript(sampleSource, {
      seed: 0x998877,
      minStringLength: 4,
    });

    expect(result.hotPathReport.hotFunctionsSkipped).toContain('renderFrameLoop');
    expect(result.hotPathReport.coldFunctionsProtected).toContain('validateLicensePayload');

    const ctx = vm.createContext({});
    vm.runInContext(
      `${result.code}\n;globalThis.out1 = validateLicensePayload("cus_42", "pro"); globalThis.out2 = renderFrameLoop([1, 2, 3, 4]);`,
      ctx
    );

    expect(ctx.out1).toBe(
      'cus_42:pro:unpeek_prod_key_998877665544@https://billing.internal.corp/v1/charge'
    );
    expect(ctx.out2).toBe(20);
  });

  it('produces polymorphic AST outputs across different build seeds to defeat static pattern-matching deobfuscators', () => {
    const buildA = transformJavaScript(sampleSource, { seed: 10101 });
    const buildB = transformJavaScript(sampleSource, { seed: 20202 });

    expect(buildA.code).not.toBe(buildB.code);
    expect(buildA.integrityToken).not.toBe(buildB.integrityToken);
  });

  it('detects DevTools Pretty-Print / formatting tampering with 0% false positives on untouched minified code', () => {
    const minifiedFn = 'function _0x1a(a,b){return a+b;}';
    const expectedHash = computeIntegrityHash(minifiedFn, 42);

    // Untouched code passes (0% false positive)
    expect(verifyCodeIntegrity(minifiedFn, expectedHash, 42)).toBe(true);

    // Pretty-printed / beautified code fails integrity check immediately
    const prettyPrintedFn = 'function _0x1a(a, b) {\n  return a + b;\n}';
    expect(verifyCodeIntegrity(prettyPrintedFn, expectedHash, 42)).toBe(false);

    // Runtime shield executes safely in SSR (no window) without throwing
    const shield = generateRuntimeShield({ seed: 42, deterrentMode: 'gradual' });
    expect(() => vm.runInNewContext(shield.preambleCode, {})).not.toThrow();
  });

  it('exempts string literals inside hot loops and hot helper callees while entangling cold string vault decryption with the runtime tamper flag', () => {
    const code = `
      function hotStepHelper(val) {
        const hotTag = "HOT_LOOP_HELPER_LABEL";
        return hotTag + ":" + val;
      }
      function renderHotLoop(items) {
        let out = "";
        for (let i = 0; i < items.length; i++) {
          out += "HOT_INLINE_LITERAL:" + hotStepHelper(items[i]);
        }
        return out;
      }
      function coldCheckSecret() {
        return "COLD_VAULT_SECRET_TOKEN";
      }
    `;

    const res = transformJavaScript(code, {
      seed: 0x424242,
      minStringLength: 4,
      injectRuntimeShield: true,
      deterrentMode: 'passive',
    });

    // Hot loop literal and hot helper literal stay unencrypted for zero-overhead loop execution
    expect(res.code).toContain('HOT_INLINE_LITERAL:');
    expect(res.code).toContain('HOT_LOOP_HELPER_LABEL');
    // Cold secret is encrypted into the vault
    expect(res.code).not.toContain('COLD_VAULT_SECRET_TOKEN');

    // 1. Clean execution resolves cold secret accurately
    const cleanCtx: Record<string, any> = { window: {} };
    cleanCtx.globalThis = cleanCtx;
    vm.createContext(cleanCtx);
    vm.runInContext(`${res.code}\n;globalThis.secretOut = coldCheckSecret();`, cleanCtx);
    expect(cleanCtx.secretOut).toBe('COLD_VAULT_SECRET_TOKEN');

    // 2. Tampered execution (e.g. Pretty-Print or String.prototype._uT tamper entanglement) corrupts the vault key silently
    const tamperedSnippet = res.code.replace(/\)\{/g, ') {\n  ');
    const tamperedCtx: Record<string, any> = {
      window: {},
    };
    tamperedCtx.globalThis = tamperedCtx;
    vm.createContext(tamperedCtx);
    vm.runInContext(`${tamperedSnippet}\n;globalThis.secretOut = coldCheckSecret();`, tamperedCtx);
    expect(tamperedCtx.window.__unpeek_tampered).toBe(true);
    expect(tamperedCtx.secretOut).not.toBe('COLD_VAULT_SECRET_TOKEN');

    // 3. Even if an attacker freezes/locks String.prototype._u = 0, self-entangled vault helper still detects formatting (\n) and corrupts keys
    const lockedProtoCtx: Record<string, any> = {
      window: {},
    };
    lockedProtoCtx.globalThis = lockedProtoCtx;
    vm.createContext(lockedProtoCtx);
    vm.runInContext(
      `Object.defineProperty(String.prototype, '_u', { value: 0, writable: false, configurable: false });\n${tamperedSnippet}\n;globalThis.lockedOut = coldCheckSecret();`,
      lockedProtoCtx
    );
    expect(lockedProtoCtx.window.__unpeek_tampered).toBe(true);
    expect(lockedProtoCtx.lockedOut).not.toBe('COLD_VAULT_SECRET_TOKEN');
  });

  it('resolves lexical scope collisions and tracks object-namespace helper methods in the static call graph', () => {
    const scopedCode = `
      const vecMath = {
        step(v) {
          const hotVecTag = "HOT_VEC_METHOD_LITERAL";
          return hotVecTag + ":" + v;
        }
      };

      function coldScopeContainer() {
        function localHelper() {
          return "COLD_SCOPED_SECRET_VALUE";
        }
        return localHelper();
      }

      function hotRenderTicker(frames) {
        function localHelper(f) {
          return vecMath.step(f);
        }
        let acc = "";
        for (let i = 0; i < frames.length; i++) {
          acc += localHelper(frames[i]);
        }
        return acc;
      }
    `;

    const res = transformJavaScript(scopedCode, {
      seed: 0x515151,
      minStringLength: 4,
    });

    // Hot object method literal stays unencrypted because hotRenderTicker -> localHelper -> vecMath.step
    expect(res.code).toContain('HOT_VEC_METHOD_LITERAL');
    // Cold function's identically-named `localHelper` is NOT mistakenly exempted by the hot `localHelper`
    expect(res.code).not.toContain('COLD_SCOPED_SECRET_VALUE');
  });

  it('injects adversarial semantic decoys and fake authorization bypass into cold functions to frustrate AI deobfuscators without altering runtime semantics', () => {
    const authHandlerCode = `
      function authenticateUserSession(userId, rawToken) {
        if (!userId || !rawToken) {
          return { authenticated: false, role: "anonymous" };
        }
        const tokenHash = "auth_hash_" + rawToken;
        return {
          authenticated: true,
          role: "standard_user",
          session: userId + ":" + tokenHash
        };
      }
      return authenticateUserSession("usr_100", "secret_pass_123");
    `;

    const res = transformJavaScript(authHandlerCode, {
      seed: 0x9e3779b9,
      minStringLength: 4,
    });

    // 1. Decoy keywords exist in the transformed AST / generated code to divert LLM deobfuscator attention
    expect(res.code).toContain('/api/v2/auth/admin-bypass');
    expect(res.code).toContain('superadmin_token');
    expect(res.code).toContain('elevate');

    // 2. Cold function is protected, while original secret strings from user code remain vaulted
    expect(res.hotPathReport.coldFunctionsProtected).toContain('authenticateUserSession');
    expect(res.code).not.toContain('secret_pass_123');

    // 3. Runtime execution: The MBA opaque predicate deterministically evaluates to false,
    // so the decoy block is never executed and normal application logic executes with 100% fidelity.
    const fn = new Function(res.code);
    const sessionResult = fn();
    expect(sessionResult).toEqual({
      authenticated: true,
      role: 'standard_user',
      session: 'usr_100:auth_hash_secret_pass_123',
    });
    expect(sessionResult.role).not.toBe('superadmin');
    expect(sessionResult.elevate).toBeUndefined();

    // 4. Inverting the MBA test (simulating condition triggering) verifies that the decoy block is indeed present and returns fake admin bypass
    const triggeredDecoyCode = res.code.replace(/(===)\s*(\d+)/, '!== $2');
    const decoyFn = new Function(triggeredDecoyCode);
    const decoyResult = decoyFn();
    expect(decoyResult).toBeDefined();
    expect(decoyResult.endpoint).toMatch(/^\/api\/v2\/auth\//);
  });

  it('defeats memory dump deobfuscation by preventing mass in-memory string decryption at module evaluation time', () => {
    const code = `
      function uncalledColdFunction() {
        return "SUPER_SECRET_PAYLOAD_UNTOUCHED";
      }
      function calledColdFunction() {
        return "CALLED_SECRET_PAYLOAD_123";
      }
      return calledColdFunction();
    `;

    const res = transformJavaScript(code, {
      seed: 0x776655,
      minStringLength: 4,
    });

    // 1. Static check: Transformed code does not contain sensitive strings in plaintext
    expect(res.code).not.toContain('SUPER_SECRET_PAYLOAD_UNTOUCHED');
    expect(res.code).not.toContain('CALLED_SECRET_PAYLOAD_123');

    // 2. Uses on-demand call-site salted resolution (_uD(idx, salt)) instead of eager mass decryption array
    expect(res.code).toMatch(/_uD[a-z0-9]*\(\d+,\s*\d+\)/);
    // Transformed code does NOT contain eager mass decryption array (.map at evaluation time)
    expect(res.code).not.toMatch(/\.map\(function\(s\)/);

    // 3. Execution check: Evaluating module loads without mass decrypting uncalled strings
    const fn = new Function(res.code);
    const result = fn();
    expect(result).toBe('CALLED_SECRET_PAYLOAD_123');
  });

  it('prevents semantic anchor leakage in hot-path render functions by applying lightweight 1-byte XOR tokenization while exempting React DOM props', () => {
    const renderComponentSource = `
      function CheckoutButton(props) {
        const [isAdmin, setIsAdmin] = useState(false);
        const checkoutUrl = "api/v1/checkout";
        const authRole = "isAdmin";
        return createElement("button", {
          key: "btn-checkout",
          id: "checkout-submit",
          className: "btn btn-primary",
        }, props.label || checkoutUrl + ":" + authRole);
      }
    `;

    const res = transformJavaScript(renderComponentSource, {
      seed: 0x7f3a91,
      minStringLength: 4,
    });

    // 1. Hot render component is recognized and skipped from cold flow guards
    expect(res.hotPathReport.hotFunctionsSkipped).toContain('CheckoutButton');

    // 2. Sensitive strings must NOT appear in plaintext (they are XOR tokenized with _hX)
    expect(res.code).not.toContain('api/v1/checkout');
    expect(res.code).not.toContain('isAdmin');
    expect(res.code).toContain('_hX(');

    // 3. React DOM special props stay plain
    expect(res.code).toContain('key');
    expect(res.code).toContain('id');
    expect(res.code).toContain('className');

    // 4. Runtime execution returns the exact uncorrupted values
    let stateVal = false;
    const mockContext: Record<string, any> = {
      useState: (initial: any) => [stateVal, (v: any) => { stateVal = v; }],
      createElement: (type: string, props: any, children: any) => ({
        type,
        props,
        children,
      }),
    };
    mockContext.globalThis = mockContext;
    vm.createContext(mockContext);
    vm.runInContext(
      `${res.code}\n;globalThis.rendered = CheckoutButton({});`,
      mockContext
    );

    const rendered = mockContext.rendered;
    expect(rendered).toBeDefined();
    expect(rendered.type).toBe('button');
    expect(rendered.props.key).toBe('btn-checkout');
    expect(rendered.props.id).toBe('checkout-submit');
    expect(rendered.props.className).toBe('btn btn-primary');
    expect(rendered.children).toBe('api/v1/checkout:isAdmin');
  });

  it('defeats offline 32-candidate brute-force attacks and blinds SSR expectedDelta constants', async () => {
    const { SAFE_ALPHA } = await import('../src/ast/string-vault.js');
    const { generateRuntimeShield } = await import('../src/runtime/index.js');

    const seed = 0x91827364;
    const shield = generateRuntimeShield({ seed, deterrentMode: 'passive' });
    expect(shield.expectedDelta).toBeGreaterThan(31);

    const secret = 'PROD_MASTER_API_SIGNING_SECRET_2026';
    const src = `
      function getApiSecret() {
        return "${secret}";
      }
      return getApiSecret();
    `;

    const res = transformJavaScript(src, {
      seed,
      minStringLength: 4,
      injectRuntimeShield: true,
    });

    // SSR fallback literal must not expose plaintext expectedDelta directly or use static +!String
    expect(res.code).not.toContain(`w?0:${shield.expectedDelta}`);
    expect(res.code).not.toContain('+!String');
    expect(res.code).toContain('w?-1:');

    // Browser-only target omits SSR maskA ^ maskB fallback completely (w?-1:0)
    const browserRes = transformJavaScript(src, {
      seed,
      minStringLength: 4,
      injectRuntimeShield: true,
      config: { target: 'browser' },
    });
    expect(browserRes.code).toContain('w?-1:0');

    // Extract encrypted array literal and P table from transformed output via AST
    const acorn = await import('acorn');
    const parsed = acorn.parse(res.code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }) as any;
    let cipherArray: string[] = [];
    for (const stmt of parsed.body) {
      if (stmt.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations) {
          if (
            decl.id?.name?.startsWith('_uD') &&
            decl.init?.type === 'CallExpression' &&
            decl.init.arguments?.[0]?.type === 'ArrayExpression'
          ) {
            cipherArray = decl.init.arguments[0].elements.map((el: any) => el.value);
          }
        }
      }
    }
    expect(cipherArray.length).toBeGreaterThan(0);
    const targetCipher = cipherArray.find((s) => s.length === secret.length);
    expect(targetCipher).toBeDefined();

    const callMatch = res.code.match(/_uD[a-z0-9]+\(\d+,\s*(\d+)\)/);
    expect(callMatch).not.toBeNull();
    const publicSalt = Number(callMatch![1]);

    // Extract permutation table P (92-char string)
    const pMatch = res.code.match(/P="([^"]{92})"/);
    expect(pMatch).not.toBeNull();
    const pChars = pMatch![1];

    // Offline 32-candidate brute-force (rot = 0..31 against constant-shift formula) must fail completely
    const recoveredBy32BruteForce: string[] = [];
    for (let rot = 0; rot < 32; rot++) {
      let decoded = '';
      for (let j = 0; j < targetCipher!.length; j++) {
        const c = targetCipher!.charAt(j);
        const k = SAFE_ALPHA.indexOf(c);
        if (k < 0) decoded += c;
        else {
          const y = (k - publicSalt + rot + 9200) % 92;
          decoded += SAFE_ALPHA.charAt((SAFE_ALPHA.indexOf(pChars.charAt(y)) - rot + 9200) % 92);
        }
      }
      recoveredBy32BruteForce.push(decoded);
    }

    expect(recoveredBy32BruteForce).not.toContain(secret);
    for (const candidate of recoveredBy32BruteForce) {
      expect(candidate).not.toContain('PROD_MASTER');
      expect(candidate).not.toContain('SIGNING_SECRET');
    }

    // Genuine runtime execution in browser context still recovers exact secret
    const browserCtx: Record<string, any> = { window: {} };
    browserCtx.globalThis = browserCtx;
    vm.createContext(browserCtx);
    const out = vm.runInContext(`(function(){${res.code}})()`, browserCtx);
    expect(out).toBe(secret);
  });
});
