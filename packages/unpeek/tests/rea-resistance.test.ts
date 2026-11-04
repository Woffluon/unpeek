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
    const tamperedSnippet = res.code.replace(/\{/g, '{\n  ');
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
});
