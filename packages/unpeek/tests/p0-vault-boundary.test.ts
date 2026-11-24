import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { parseJavaScriptAst } from '../src/ast/hot-path-detector.js';
import { transformJavaScript } from '../src/ast/index.js';
import { applyStringVault, type LatchCouplingConfig } from '../src/ast/string-vault.js';
import { applySaltedStringVault } from '../src/ast/salted-vault.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import { classifyChunkBoundary } from '../src/ast/boundary-classifier.js';
import { scrubResidualPaths } from '../src/ast/scrubber.js';

function runInSandbox<T = unknown>(
  code: string,
  extraGlobals: Record<string, unknown> = {}
): T {
  const ctx = vm.createContext({
    Math,
    String,
    RegExp,
    ArrayBuffer,
    Uint8Array,
    Int32Array,
    TextDecoder,
    Function,
    Array,
    Object,
    Number,
    Boolean,
    atob: globalThis.atob,
    Buffer,
    ...extraGlobals,
  });
  return vm.runInContext(code, ctx) as T;
}

describe('P0 Vault & Boundary Hardening (C7, C2, C3)', () => {
  describe('C2: __proto__ preservation and computed-key secret parity', () => {
    const profiles = [
      { name: 'recommended', opts: { profile: 'recommended' as const, aggressive: false } },
      { name: 'strict', opts: { profile: 'strict' as const, aggressive: true } },
    ];

    for (const { name, opts } of profiles) {
      it(`${name}: preserves {"__proto__": protoObj} prototype chain semantics`, () => {
        const source = `
          const protoObj = { inheritedTag: "proto_inherited_value_9001" };
          const child = { "__proto__": protoObj, ownFlag: true };
          function readDerived() {
            return {
              hasOwnProto: Object.prototype.hasOwnProperty.call(child, "__proto__"),
              protoMatches: Object.getPrototypeOf(child) === protoObj,
              inherited: child.inheritedTag,
              ownFlag: child.ownFlag
            };
          }
          return readDerived();
        `;

        const res = transformJavaScript(source, {
          seed: 0x314159,
          minStringLength: 4,
          ...opts,
        });

        expect(res.code).toContain('"__proto__":');
        expect(res.code).not.toMatch(/\["__proto__"\]/);

        const out = runInSandbox<{
          hasOwnProto: boolean;
          protoMatches: boolean;
          inherited: string;
          ownFlag: boolean;
        }>(`(function(){${res.code}})()`);

        expect(out.hasOwnProto).toBe(false);
        expect(out.protoMatches).toBe(true);
        expect(out.inherited).toBe('proto_inherited_value_9001');
        expect(out.ownFlag).toBe(true);
      });

      it(`${name}: keeps ordinary object literal keys non-computed while vaulting secret keys as computed`, () => {
        const secretPrefix = 'sk_' + 'live_';
        const secretKey = `${secretPrefix}51N9x8K2abc123def456`;
        const highEntropyKey = 'v9$K2#mQ8!pL4@wR7&zT1*xY5~nB6';

        const source = `
          const cfg = {
            endpointName: "https://api.example.invalid/v1",
            "content-type": "application/json",
            ${JSON.stringify(secretKey)}: "secret_role_admin",
            ${JSON.stringify(highEntropyKey)}: "entropy_role_root"
          };
          function buildConfig() {
            return {
              endpoint: cfg.endpointName,
              ct: cfg["content-type"],
              s1: cfg[${JSON.stringify(secretKey)}],
              s2: cfg[${JSON.stringify(highEntropyKey)}]
            };
          }
          return buildConfig();
        `;

        const res = transformJavaScript(source, {
          seed: 0x271828,
          minStringLength: 4,
          ...opts,
        });

        // Ordinary keys stay literal / non-computed
        expect(res.code).toContain('endpointName:');
        expect(res.code).toContain('"content-type":');

        // Secret keys must not remain in plaintext and must become computed properties
        expect(res.code).not.toContain(secretKey);
        expect(res.code).not.toContain(highEntropyKey);
        expect(res.code).toMatch(/\[_uD[a-z0-9]+\(\d+,\d+\)\]:/);

        const out = runInSandbox<{
          endpoint: string;
          ct: string;
          s1: string;
          s2: string;
        }>(`(function(){${res.code}})()`);

        expect(out).toEqual({
          endpoint: 'https://api.example.invalid/v1',
          ct: 'application/json',
          s1: 'secret_role_admin',
          s2: 'entropy_role_root',
        });
      });

      it(`${name}: exempts ObjectPattern destructuring, accessors, class members, and CJS exports keys`, () => {
        const highEntropyKey = 'v9$K2#mQ8!pL4@wR7&zT1*xY5~nB6';
        const source = `
          const { ${JSON.stringify(highEntropyKey)}: extractedVal } = {
            [${JSON.stringify(highEntropyKey)}]: "ok"
          };
          const holder = {
            get ${JSON.stringify(highEntropyKey)}() { return "getter_ok"; }
          };
          class VaultedClass {
            ${JSON.stringify(highEntropyKey)} = "field_ok";
          }
          function runCjs(module, exports) {
            module.exports = {
              ${JSON.stringify(highEntropyKey)}: "cjs_export_ok"
            };
            return {
              extractedVal,
              getterVal: holder[${JSON.stringify(highEntropyKey)}],
              fieldVal: new VaultedClass()[${JSON.stringify(highEntropyKey)}],
              cjsVal: module.exports[${JSON.stringify(highEntropyKey)}]
            };
          }
        `;

        const res = transformJavaScript(source, {
          seed: 0x445566,
          minStringLength: 4,
          ...opts,
        });

        // Non-computed key declarations in destructuring, getter, class field, and module.exports must remain valid
        expect(res.code).toContain(`get ${JSON.stringify(highEntropyKey)}()`);
        expect(res.code).toMatch(
          new RegExp(
            `${JSON.stringify(highEntropyKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`
          )
        );

        const mod = { exports: {} as Record<string, unknown> };
        const out = runInSandbox<Record<string, unknown>>(
          `(function(){${res.code};return runCjs(mod, mod.exports);})()`,
          { mod }
        );
        expect(out).toEqual({
          extractedVal: 'ok',
          getterVal: 'getter_ok',
          fieldVal: 'field_ok',
          cjsVal: 'cjs_export_ok',
        });
      });
    }

    it('standalone applyStringVault and applySaltedStringVault share identical computed-key secret parity', () => {
      const secretKey = `${'ghp' + '_'}A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6`;
      const source = `
        function inspectObj() {
          const o = {
            "content-type": "text/plain",
            ${JSON.stringify(secretKey)}: "token_bound_value"
          };
          return {
            ct: o["content-type"],
            tok: o[${JSON.stringify(secretKey)}]
          };
        }
      `;

      const ast1 = parseJavaScriptAst(source)!;
      applyStringVault(ast1, 0x112233, 4, undefined, undefined, undefined, undefined, undefined, false);
      const code1 = generateCompactJs(ast1);
      expect(code1).toContain('"content-type":');
      expect(code1).not.toContain(secretKey);
      expect(code1).toMatch(/\[_uD[a-z0-9]+\(\d+,\d+\)\]:/);
      expect(runInSandbox(`(function(){${code1};return inspectObj();})()`)).toEqual({
        ct: 'text/plain',
        tok: 'token_bound_value',
      });

      const ast2 = parseJavaScriptAst(source)!;
      applySaltedStringVault(ast2, 0x112233, 4, undefined, undefined, undefined, undefined, undefined, false);
      const code2 = generateCompactJs(ast2);
      expect(code2).toContain('"content-type":');
      expect(code2).not.toContain(secretKey);
      expect(code2).toMatch(/\[_uD[a-z0-9]+\(\d+,\d+\)\]:/);
      expect(runInSandbox(`(function(){${code2};return inspectObj();})()`)).toEqual({
        ct: 'text/plain',
        tok: 'token_bound_value',
      });
    });
  });

  describe('C3: Static module, bundler, and worker asset URL exemptions', () => {
    const configs = [
      { name: 'recommended + scrubPaths', opts: { profile: 'recommended' as const, aggressive: false, scrubPaths: true, rootDir: '/Users/alice/app' } },
      { name: 'strict + scrubPaths', opts: { profile: 'strict' as const, aggressive: true, scrubPaths: true, rootDir: '/Users/alice/app' } },
    ];

    for (const { name, opts } of configs) {
      it(`${name}: preserves URL(import.meta.url), import.meta.resolve, require/require.resolve, and ES2022 module string specifiers`, () => {
        const source = `
          import { "my-long-import-name" as importedHelper } from "/Users/alice/app/imported-mod.js";
          const a = 1;
          export { a as "my-long-export-name" };
          export * as "my-long-namespace-export" from "/Users/alice/app/reexport-mod.js";

          function loadBundlerAssets(id, name) {
            const workerUrl = new URL("./worker.js", import.meta.url);
            const wasmUrl = new URL(\`./assets/\${id}.wasm\`, import.meta.url);
            const resolvedMod = import.meta.resolve("./mod.js");
            const resolvedTpl = import.meta.resolve(\`./locales/\${name}.json\`);
            const reqPkg = require.resolve("./pkg");
            const reqTplPkg = require.resolve(\`./plugins/\${name}.js\`);
            const dynReqLit = require("./cjs-helper.cjs");
            const dynReqTpl = require(\`./cjs-\${name}.cjs\`);
            const coldSecret = "CONFIDENTIAL_API_SECRET_STRING_01";
            return {
              workerUrl,
              wasmUrl,
              resolvedMod,
              resolvedTpl,
              reqPkg,
              reqTplPkg,
              dynReqLit,
              dynReqTpl,
              coldSecret,
              importedHelper
            };
          }
        `;

        const res = transformJavaScript(source, {
          seed: 0x556677,
          minStringLength: 4,
          ...opts,
        });

        expect(res.code).toContain('"./worker.js"');
        expect(res.code).toMatch(
          /new URL\(`\.\/assets\/\$\{[A-Za-z0-9_$]+\}\.wasm`,\s*import\.meta\.url\)/
        );
        expect(res.code).toContain('"./mod.js"');
        expect(res.code).toMatch(
          /import\.meta\.resolve\(`\.\/locales\/\$\{[A-Za-z0-9_$]+\}\.json`\)/
        );
        expect(res.code).toContain('"./pkg"');
        expect(res.code).toMatch(
          /require\.resolve\(`\.\/plugins\/\$\{[A-Za-z0-9_$]+\}\.js`\)/
        );
        expect(res.code).toContain('"./cjs-helper.cjs"');
        expect(res.code).toMatch(/require\(`\.\/cjs-\$\{[A-Za-z0-9_$]+\}\.cjs`\)/);
        expect(res.code).toContain('"my-long-export-name"');
        expect(res.code).toContain('"my-long-import-name"');
        expect(res.code).toContain('"my-long-namespace-export"');
        expect(res.code).toContain('"/Users/alice/app/imported-mod.js"');
        expect(res.code).toContain('"/Users/alice/app/reexport-mod.js"');

        // Normal cold secret string is still vaulted
        expect(res.code).not.toContain('CONFIDENTIAL_API_SECRET_STRING_01');
      });
    }

    it('standalone scrubber, boundary-classifier, string-vault, and salted-vault consistently exempt C3 positions', () => {
      const source = `
        const a = 1;
        export { a as "my-long-export-name" };
        function load(id) {
          const u1 = new URL("/Users/dev/project/worker.js", import.meta.url);
          const u2 = new URL(\`/Users/dev/project/assets/\${id}.wasm\`, import.meta.url);
          const r1 = import.meta.resolve("/Users/dev/project/mod.js");
          const r2 = require.resolve("/Users/dev/project/pkg");
          const r3 = require(\`/Users/dev/project/dyn-\${id}.js\`);
          const leaked = "/Users/dev/project/src/secret.ts";
          return [u1, u2, r1, r2, r3, leaked];
        }
      `;

      const ast = parseJavaScriptAst(source)!;
      const boundary = classifyChunkBoundary(ast);
      const scrubbed = scrubResidualPaths(
        ast,
        { scrubPaths: true, rootDir: '/Users/dev/project' },
        undefined,
        boundary.exemptSubtreeRoots
      );
      expect(scrubbed).toBe(1);

      const codeAfterScrub = generateCompactJs(ast);
      expect(codeAfterScrub).toContain('"/Users/dev/project/worker.js"');
      expect(codeAfterScrub).toContain('`/Users/dev/project/assets/${id}.wasm`');
      expect(codeAfterScrub).toContain('"/Users/dev/project/mod.js"');
      expect(codeAfterScrub).toContain('"/Users/dev/project/pkg"');
      expect(codeAfterScrub).toContain('`/Users/dev/project/dyn-${id}.js`');
      expect(codeAfterScrub).toContain('"[src]/src/secret.ts"');
    });
  });

  describe('C7: Standalone applyStringVault & applySaltedStringVault latchCoupling', () => {
    const sampleSource = `
      function getSecretValue() {
        return "LATCH_PROTECTED_TOKEN_98765";
      }
    `;

    for (const mode of ['string-vault', 'salted-vault'] as const) {
      it(`${mode}: emits 0 extra latch bytes when latchCoupling is omitted`, () => {
        const astWithout = parseJavaScriptAst(sampleSource)!;
        if (mode === 'string-vault') {
          applyStringVault(astWithout, 0xabcdef, 4, undefined, undefined, undefined, undefined, undefined, false);
        } else {
          applySaltedStringVault(astWithout, 0xabcdef, 4, undefined, undefined, undefined, undefined, undefined, false);
        }
        const codeWithout = generateCompactJs(astWithout);
        expect(codeWithout).not.toContain('_ld');
        expect(codeWithout).not.toContain('LATCH_PROTECTED_TOKEN_98765');
        expect(runInSandbox(`(function(){${codeWithout};return getSecretValue();})()`)).toBe(
          'LATCH_PROTECTED_TOKEN_98765'
        );
      });

      it(`${mode}: decodes losslessly when latch is intact, skips latch on cache-hit, and corrupts silently when latch is missing or tampered`, () => {
        const latchCoupling: LatchCouplingConfig = {
          latchFnName: '_uLrTestLatch',
          expectedLatchByte: 0xa7,
        };
        const astWith = parseJavaScriptAst(sampleSource)!;
        if (mode === 'string-vault') {
          applyStringVault(
            astWith,
            0xabcdef,
            4,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            false,
            undefined,
            latchCoupling
          );
        } else {
          applySaltedStringVault(
            astWith,
            0xabcdef,
            4,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            false,
            undefined,
            latchCoupling
          );
        }
        const codeWith = generateCompactJs(astWith);
        expect(codeWith).toContain('_ld');
        expect(codeWith).toContain('_uLrTestLatch');
        expect(codeWith).not.toContain('LATCH_PROTECTED_TOKEN_98765');

        // 1. Intact latch: lossless decode, and cache-hit does NOT call latch again
        let calls = 0;
        const intactOut = runInSandbox<string[]>(
          `var _uLrTestLatch = function() { __count(); return 0xa7; };` +
            `(function(){${codeWith};return [getSecretValue(), getSecretValue()];})()`,
          {
            __count: () => {
              calls++;
            },
          }
        );
        expect(intactOut).toEqual([
          'LATCH_PROTECTED_TOKEN_98765',
          'LATCH_PROTECTED_TOKEN_98765',
        ]);
        expect(calls).toBe(1);

        // 2. Deleted/missing latch: no ReferenceError, silently produces garbage string
        const missingOut = runInSandbox<string>(
          `(function(){${codeWith};return getSecretValue();})()`
        );
        expect(typeof missingOut).toBe('string');
        expect(missingOut).not.toBe('LATCH_PROTECTED_TOKEN_98765');
        expect(missingOut.length).toBe('LATCH_PROTECTED_TOKEN_98765'.length);

        // 3. Tampered latch returning wrong byte: silently produces garbage string
        const tamperedOut = runInSandbox<string>(
          `function _uLrTestLatch() { return 0x11; } (function(){${codeWith};return getSecretValue();})()`
        );
        expect(typeof tamperedOut).toBe('string');
        expect(tamperedOut).not.toBe('LATCH_PROTECTED_TOKEN_98765');
        expect(tamperedOut.length).toBe('LATCH_PROTECTED_TOKEN_98765'.length);
      });
    }
  });
});
