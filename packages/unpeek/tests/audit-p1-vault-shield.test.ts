import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import * as acorn from 'acorn';
import {
  transformJavaScript,
} from '../src/ast/index.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import {
  isBinaryOrBase64Payload,
  isShaderPayload,
  createShaderVaultAst,
  applyStringVault,
} from '../src/ast/string-vault.js';
import {
  generateWasmKdfBinary,
  createWasmHostEnv,
  fallbackKdf,
  injectWasmVault,
} from '../src/ast/wasm-vault.js';
import {
  createDeterrentSnippet,
  generateRuntimeShield,
  isNativeDescriptorIntact,
} from '../src/runtime/index.js';

describe('Audit P1: Binary/Base64 Exemption, Stack-Trap Hardening, Narrowed Async Tolerance, InPlaceVault Coupling & WASM Host Masking', () => {
  // =========================================================================
  // P1a: Universal Binary / WASM / Base64 Exemption & _unpeekIsComponent
  // =========================================================================
  describe('P1a: Binary/WASM/Base64 exemption & _unpeekIsComponent hot-literal rule', () => {
    it('detects WASM base64 headers, binary data URIs, and >=4096 pure base64 blobs without false positives', () => {
      const wasmB64 = 'AGFzbQEAAAABBwFgAn9/AX8DAgEABQMBAAEHEAIDbWVtAgADa2RmAAAKCAEAIAAgAGoL';
      expect(isBinaryOrBase64Payload(wasmB64)).toBe(true);

      expect(isBinaryOrBase64Payload('data:application/wasm;base64,AGFzbQEAAAA=')).toBe(true);
      expect(isBinaryOrBase64Payload('data:application/octet-stream;base64,AAAA')).toBe(true);
      expect(isBinaryOrBase64Payload('data:application/pdf;base64,JVBERi0=')).toBe(true);
      expect(isBinaryOrBase64Payload('data:application/zip;base64,UEsDBAo=')).toBe(true);
      expect(isBinaryOrBase64Payload('data:application/gzip;base64,H4sI')).toBe(true);
      expect(isBinaryOrBase64Payload('data:application/font-woff2;base64,d09GMg==')).toBe(true);
      expect(isBinaryOrBase64Payload('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
      expect(isBinaryOrBase64Payload('data:font/woff2;base64,d09GMg==')).toBe(true);
      expect(isBinaryOrBase64Payload('data:audio/mpeg;base64,//uQxAAAA')).toBe(true);
      expect(isBinaryOrBase64Payload('data:video/mp4;base64,AAAAIGZ0eXA=')).toBe(true);

      const largePureB64 = Buffer.from('A'.repeat(3200)).toString('base64');
      expect(largePureB64.length).toBeGreaterThanOrEqual(4096);
      expect(isBinaryOrBase64Payload(largePureB64)).toBe(true);

      // Non-binary strings must return false
      expect(isBinaryOrBase64Payload('AGFzbQ_NOT_WASM_HEADER')).toBe(false);
      expect(isBinaryOrBase64Payload('data:text/plain;charset=utf-8,hello')).toBe(false);
      expect(isBinaryOrBase64Payload('A'.repeat(4096) + ' with space')).toBe(false);
      expect(isBinaryOrBase64Payload('A'.repeat(512))).toBe(false);
      expect(
        isBinaryOrBase64Payload(
          '@group(0) @binding(0) var<uniform> u: vec4f; @vertex fn vs_main() -> @builtin(position) vec4f { return u; }'
        )
      ).toBe(false);
    });

    it('exempts embedded WASM Base64 and binary data URIs from ShaderVault and StringVault in Tier 2 & Tier 3', () => {
      const wasmB64 = 'AGFzbQEAAAABBwFgAn9/AX8DAgEABQMBAAEHEAIDbWVtAgADa2RmAAAKCAEAIAAgAGoL' + 'A'.repeat(500);
      const imageUri = 'data:image/png;base64,' + 'iVBORw0KGgo='.repeat(40);
      const blobB64 = Buffer.from('HelloWorld1234567890'.repeat(160)).toString('base64');
      const source = `
        export function getAssets() {
          const wasm = "${wasmB64}";
          const img = "${imageUri}";
          const blob = "${blobB64}";
          const secret = "APP_SECRET_TOKEN_XYZ";
          return { wasm, img, blob, secret };
        }
      `;

      for (const opts of [
        { profile: 'recommended' as const, aggressive: false },
        { profile: 'strict' as const, aggressive: true },
      ]) {
        const res = transformJavaScript(source, {
          ...opts,
          seed: 0x11223344,
          minStringLength: 4,
          injectRuntimeShield: false,
        });

        expect(res.shaderBuffersCount).toBe(0);
        expect(res.code).toContain(wasmB64);
        expect(res.code).toContain(imageUri);
        expect(res.code).toContain(blobB64);
        expect(res.code).not.toContain('APP_SECRET_TOKEN_XYZ');
        expect(
          isShaderPayload(wasmB64, {}, {}, [], 0x11223344, false)
        ).toBe(false);
      }
    });

    it('uses _unpeekIsComponent instead of /^[A-Z]/ inside isEligibleHotLiteral so minified PascalCase business functions are not treated as UI components', () => {
      const source = `
        function Xo() {
          return "MINIFIED_BIZ_SECRET";
        }
        function Yc() {
          return "VERIFIED_COMPONENT_TEXT";
        }
      `;
      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
      const fnXo = ast.body[0];
      const fnYc = ast.body[1];
      fnYc._unpeekIsComponent = true;

      // Simulate both functions sitting in hotExemptNodes
      const hotExempt = new WeakSet<acorn.Node>([fnXo, fnYc]);
      applyStringVault(ast, 0x22334455, 4, hotExempt, undefined, undefined, undefined, undefined, false);
      const out = generateCompactJs(ast);

      // Xo lacks _unpeekIsComponent so its non-semantic string is NOT wrapped with _hX
      expect(out).toContain('"MINIFIED_BIZ_SECRET"');
      // Yc has _unpeekIsComponent = true so its render string IS wrapped with _hX
      expect(out).not.toContain('"VERIFIED_COMPONENT_TEXT"');
      expect(out).toContain('_hX(');
    });
  });

  // =========================================================================
  // P1c Attack 3D & 3C: Error.prepareStackTrace & Error.prototype.stack / e.stack
  // =========================================================================
  describe('P1c Attacks 3D & 3C: Stack-Trap Hardening in devtools-deterrent & integrity-guard', () => {
    it('Attack 3D: detects Error.prepareStackTrace hooking and strips prepareStackTrace during E() to expose Proxy(Reflect.apply)', () => {
      const seed = 0x51525354;
      const sym = '_z3D';
      const snippet = createDeterrentSnippet({ seed, windowKeySymbol: sym });

      const cleanWin: Record<string, unknown> = {};
      vm.runInContext(snippet, vm.createContext({ window: cleanWin }));
      const cleanDelta = cleanWin[sym];
      expect(cleanWin.__unpeek_tampered).toBeUndefined();

      // Case 1: Plain Error.prepareStackTrace hook in browser / bare node:vm (process undefined)
      const w1: Record<string, unknown> = {};
      const ctx1 = vm.createContext({ window: w1 });
      vm.runInContext(
        `Error.prepareStackTrace = function(err, frames) { return 'TypeError\\n    at E (<anonymous>)'; };`,
        ctx1
      );
      vm.runInContext(snippet, ctx1);
      expect(w1.__unpeek_tampered).toBe(true);
      expect((w1[`${sym}_s`] as number[])[0]).toBe(2);
      expect(w1[sym]).not.toBe(cleanDelta);

      // Case 2: Proxy(Reflect.apply) + Error.prepareStackTrace stripping Object.apply frames (even if process exists)
      const w2: Record<string, unknown> = {};
      const ctx2 = vm.createContext({ window: w2, process: { env: {} } });
      vm.runInContext(
        `
          const origApply = Reflect.apply;
          const origToString = Function.prototype.toString;
          const proxyApply = new Proxy(origApply, {
            apply(target, thisArg, args) {
              if (args && args[0] === origToString && args[1] === proxyApply) {
                return 'function apply() { [native code] }';
              }
              return origApply(target, thisArg, args);
            }
          });
          Reflect.apply = proxyApply;
          Error.prepareStackTrace = function(err, frames) {
            return err.name + ': ' + err.message + '\\n    at E (<anonymous>)';
          };
        `,
        ctx2
      );
      vm.runInContext(snippet, ctx2);
      expect(w2.__unpeek_tampered).toBe(true);
      expect((w2[`${sym}_s`] as number[])[0]).toBe(2);
      expect(w2[sym]).not.toBe(cleanDelta);

      // Case 3: Non-writable Error.prepareStackTrace descriptor trap
      const w3: Record<string, unknown> = {};
      const ctx3 = vm.createContext({ window: w3 });
      vm.runInContext(
        `Object.defineProperty(Error, 'prepareStackTrace', { value: undefined, writable: false, configurable: true });`,
        ctx3
      );
      vm.runInContext(snippet, ctx3);
      expect(w3.__unpeek_tampered).toBe(true);
      expect((w3[`${sym}_s`] as number[])[0]).toBe(2);
    });

    it('Attack 3C: detects Error.prototype.stack tampering, own e.stack injection, and empty/missing-frame stack strings', () => {
      const seed = 0x61626364;
      const sym = '_z3C';
      const snippet = createDeterrentSnippet({ seed, windowKeySymbol: sym });

      const cleanWin: Record<string, unknown> = {};
      vm.runInContext(snippet, vm.createContext({ window: cleanWin }));
      const cleanDelta = cleanWin[sym];
      expect(cleanWin.__unpeek_tampered).toBeUndefined();

      const attackScripts: Array<{ label: string; setup: string }> = [
        {
          label: 'Error.prototype.stack getter override',
          setup: `
            Object.defineProperty(Error.prototype, 'stack', {
              get() { return 'TypeError\\n    at E (<anonymous>)'; },
              configurable: true,
            });
          `,
        },
        {
          label: 'Error.prototype.stack writable string value override',
          setup: `
            Object.defineProperty(Error.prototype, 'stack', {
              value: 'TypeError\\n    at E (<anonymous>)',
              writable: true,
              configurable: true,
            });
          `,
        },
        {
          label: 'Proxy(Reflect.apply) injecting own e.stack value',
          setup: `
            const origApply = Reflect.apply;
            Reflect.apply = new Proxy(origApply, {
              apply(t, thisArg, args) {
                try {
                  return origApply(t, thisArg, args);
                } catch (err) {
                  Object.defineProperty(err, 'stack', {
                    value: 'TypeError\\n    at E (<anonymous>)',
                    configurable: true,
                  });
                  throw err;
                }
              }
            });
          `,
        },
        {
          label: 'Proxy(Reflect.apply) injecting empty e.stack getter',
          setup: `
            const origApply = Reflect.apply;
            Reflect.apply = new Proxy(origApply, {
              apply(t, thisArg, args) {
                try {
                  return origApply(t, thisArg, args);
                } catch (err) {
                  Object.defineProperty(err, 'stack', {
                    get() { return ''; },
                    configurable: true,
                  });
                  throw err;
                }
              }
            });
          `,
        },
        {
          label: 'Proxy(Reflect.apply) injecting bound e.stack getter',
          setup: `
            const origApply = Reflect.apply;
            Reflect.apply = new Proxy(origApply, {
              apply(t, thisArg, args) {
                try {
                  return origApply(t, thisArg, args);
                } catch (err) {
                  Object.defineProperty(err, 'stack', {
                    get: (() => 'TypeError\\n    at E (<anonymous>)').bind(null),
                    configurable: true,
                  });
                  throw err;
                }
              }
            });
          `,
        },
        {
          label: 'Proxy(Reflect.apply) throwing synthetic { name: "TypeError", stack: "TypeError" } without at frame',
          setup: `
            const origApply = Reflect.apply;
            Reflect.apply = new Proxy(origApply, {
              apply() {
                throw { name: 'TypeError', stack: 'TypeError' };
              }
            });
          `,
        },
      ];

      for (const { label, setup } of attackScripts) {
        const w: Record<string, unknown> = {};
        const ctx = vm.createContext({ window: w });
        vm.runInContext(setup, ctx);
        vm.runInContext(snippet, ctx);
        expect(w.__unpeek_tampered, `Failed to detect ${label}`).toBe(true);
        expect((w[`${sym}_s`] as number[])[0], `Expected s[0]=2 for ${label}`).toBe(2);
        expect(w[sym], `Expected poisoned delta for ${label}`).not.toBe(cleanDelta);
      }
    });

    it('integrity-guard.ts mirrors 3C/3D checks without false positives on Vitest Node host', () => {
      // Must not false-positive in Vitest host (even if Vitest installs Error.prepareStackTrace)
      expect(isNativeDescriptorIntact()).toBe(true);

      const origPrepare = (Error as any).prepareStackTrace;
      const origProtoDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
      const origApply = Reflect.apply;
      try {
        // 3D: Proxy(Reflect.apply) + Error.prepareStackTrace trying to hide Object.apply
        (Error as any).prepareStackTrace = (err: Error) =>
          `${err.name}: ${err.message}\n    at probeThrowsCleanTypeError (<anonymous>)`;
        Reflect.apply = new Proxy(origApply, {
          apply(t, thisArg, args) {
            return origApply(t, thisArg, args);
          },
        });
        expect(isNativeDescriptorIntact()).toBe(false);
        Reflect.apply = origApply;
        (Error as any).prepareStackTrace = origPrepare;
        expect(isNativeDescriptorIntact()).toBe(true);

        // 3C: Error.prototype.stack spoofed getter
        Object.defineProperty(Error.prototype, 'stack', {
          get() {
            return 'TypeError\n    at probeThrowsCleanTypeError (<anonymous>)';
          },
          configurable: true,
        });
        expect(isNativeDescriptorIntact()).toBe(false);
      } finally {
        Reflect.apply = origApply;
        (Error as any).prepareStackTrace = origPrepare;
        if (origProtoDesc) {
          Object.defineProperty(Error.prototype, 'stack', origProtoDesc);
        } else {
          delete (Error.prototype as any).stack;
        }
      }
    });
  });

  // =========================================================================
  // P1c Vector B: Narrowed sv === void 0 Async Tolerance
  // =========================================================================
  describe('P1c Vector B: Narrowed sv === void 0 async tolerance in string-vault and salted-vault', () => {
    it('fails closed in bare node:vm (window={}) and readyState==="complete", while allowing legitimate loading DOM and Worker contexts', () => {
      const source = `
        function getToken() {
          return "SECRET_ASYNC_GATE_TOKEN_42";
        }
        globalThis.__out = getToken();
      `;

      for (const aggressive of [false, true]) {
        const res = transformJavaScript(source, {
          seed: 0x778899aa,
          minStringLength: 4,
          aggressive,
          injectRuntimeShield: true,
        });

        const lines = res.code.split('\n');
        const shieldLine = lines[0];
        const strippedCode = lines.slice(1).join('\n');

        // 1. Bare node:vm with window = {} (no real DOM) -> MUST FAIL CLOSED
        const bareWin: Record<string, unknown> = {};
        const bareCtx = vm.createContext({
          window: bareWin,
          Math,
          String,
          Uint8Array,
          WebAssembly,
        });
        bareCtx.globalThis = bareCtx;
        vm.runInContext(strippedCode, bareCtx);
        expect(bareCtx.__out).not.toBe('SECRET_ASYNC_GATE_TOKEN_42');

        // 2. Post-load DOM (readyState === 'complete') without shield -> MUST FAIL CLOSED
        const completeDoc: any = {
          nodeType: 9,
          scripts: [{}],
          readyState: 'complete',
        };
        const completeWin: Record<string, unknown> = { document: completeDoc };
        const completeCtx = vm.createContext({
          window: completeWin,
          document: completeDoc,
          Math,
          String,
          Uint8Array,
          WebAssembly,
        });
        completeCtx.globalThis = completeCtx;
        vm.runInContext(strippedCode, completeCtx);
        expect(completeCtx.__out).not.toBe('SECRET_ASYNC_GATE_TOKEN_42');

        // 3. Spoofed DOM (nodeType !== 9 or scripts empty) -> MUST FAIL CLOSED
        const fakeDoc: any = { nodeType: 1, scripts: [], readyState: 'loading' };
        const fakeWin: Record<string, unknown> = { document: fakeDoc };
        const fakeCtx = vm.createContext({
          window: fakeWin,
          document: fakeDoc,
          Math,
          String,
          Uint8Array,
          WebAssembly,
        });
        fakeCtx.globalThis = fakeCtx;
        vm.runInContext(strippedCode, fakeCtx);
        expect(fakeCtx.__out).not.toBe('SECRET_ASYNC_GATE_TOKEN_42');

        // 4. Genuine loading DOM (window.document === document && nodeType === 9 && scripts.length > 0 && readyState !== 'complete') -> resolves & later shield loads cleanly
        const loadingDoc: any = {
          nodeType: 9,
          scripts: [{}],
          readyState: 'loading',
        };
        const loadingWin: Record<string, unknown> = { document: loadingDoc };
        const loadingCtx = vm.createContext({
          window: loadingWin,
          document: loadingDoc,
          Math,
          String,
          Uint8Array,
          WebAssembly,
        });
        loadingCtx.globalThis = loadingCtx;
        vm.runInContext(strippedCode, loadingCtx);
        expect(loadingCtx.__out).toBe('SECRET_ASYNC_GATE_TOKEN_42');
        vm.runInContext(shieldLine, loadingCtx);
        loadingCtx.__out = undefined;
        vm.runInContext('globalThis.__out = getToken();', loadingCtx);
        expect(loadingCtx.__out).toBe('SECRET_ASYNC_GATE_TOKEN_42');

        // 5. Web Worker context (self.importScripts === function) -> resolves cleanly
        const workerCtx: Record<string, unknown> = {
          importScripts: () => {},
          Math,
          String,
          Uint8Array,
          WebAssembly,
        };
        workerCtx.self = workerCtx;
        workerCtx.globalThis = workerCtx;
        vm.createContext(workerCtx);
        vm.runInContext(strippedCode, workerCtx);
        expect(workerCtx.__out).toBe('SECRET_ASYNC_GATE_TOKEN_42');
      }
    });
  });

  // =========================================================================
  // P1c Vector D2: InPlaceVault (createShaderVaultAst) Shield Coupling
  // =========================================================================
  describe('P1c Vector D2: InPlaceVault runtime shield coupling', () => {
    it('poisons shader decryption in bare node:vm, readyState==="complete", and tampered states while working cleanly with shield or loading DOM', () => {
      const wgsl =
        '@group(0) @binding(0) var<uniform> cam: mat4x4f; @vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0,0.0,0.0,1.0); }';
      const source = `
        function getShader() {
          return ${JSON.stringify(wgsl)};
        }
        globalThis.__shader = getShader();
      `;

      for (const aggressive of [false, true]) {
        const seed = 0x44556677;
        const res = transformJavaScript(source, {
          seed,
          minStringLength: 4,
          aggressive,
          injectRuntimeShield: true,
        });
        expect(res.shaderBuffersCount).toBe(1);

        const shield = generateRuntimeShield({ seed, deterrentMode: 'passive' });
        const lines = res.code.split('\n');
        const shieldLine = lines[0];
        const strippedCode = lines.slice(1).join('\n');

        // 1. With shield -> exact shader
        const cleanDoc: any = { nodeType: 9, scripts: [{}], readyState: 'complete' };
        const cleanWin: Record<string, unknown> = { document: cleanDoc };
        const cleanCtx = vm.createContext({
          window: cleanWin,
          document: cleanDoc,
          Uint8Array,
          TextDecoder,
          Math,
          String,
          atob: (b: string) => Buffer.from(b, 'base64').toString('binary'),
        });
        cleanCtx.globalThis = cleanCtx;
        vm.runInContext(res.code, cleanCtx);
        expect(cleanCtx.__shader).toBe(wgsl);

        // 2. Bare node:vm (shield stripped, window={}) -> 0% recovery
        const bareCtx = vm.createContext({
          window: {},
          Uint8Array,
          TextDecoder,
          Math,
          String,
          atob: (b: string) => Buffer.from(b, 'base64').toString('binary'),
        });
        bareCtx.globalThis = bareCtx;
        vm.runInContext(strippedCode, bareCtx);
        expect(bareCtx.__shader).not.toBe(wgsl);
        expect(bareCtx.__shader).not.toContain('@group(0)');

        // 3. readyState === 'complete' without shield -> 0% recovery
        const completeDoc: any = { nodeType: 9, scripts: [{}], readyState: 'complete' };
        const completeCtx = vm.createContext({
          window: { document: completeDoc },
          document: completeDoc,
          Uint8Array,
          TextDecoder,
          Math,
          String,
          atob: (b: string) => Buffer.from(b, 'base64').toString('binary'),
        });
        completeCtx.globalThis = completeCtx;
        vm.runInContext(strippedCode, completeCtx);
        expect(completeCtx.__shader).not.toBe(wgsl);

        // 4. Tampered signals (sym_s[0] === 2, sym_t === true, __unpeek_tampered === true, String.prototype._u = 14) -> 0% recovery
        const tamperConfigs: Array<Record<string, unknown>> = [
          { [shield.windowKeySymbol]: shield.expectedDelta, __unpeek_tampered: true },
          { [shield.windowKeySymbol]: shield.expectedDelta, [`${shield.windowKeySymbol}_t`]: true },
          { [shield.windowKeySymbol]: shield.expectedDelta, [`${shield.windowKeySymbol}_s`]: [2, 0, 0, 1, 0] },
          { [shield.windowKeySymbol]: ((shield.expectedDelta ?? 0) ^ 0x1234) & 0xffff },
        ];
        for (const tProps of tamperConfigs) {
          const tCtx = vm.createContext({
            window: { ...tProps },
            Uint8Array,
            TextDecoder,
            Math,
            String,
            atob: (b: string) => Buffer.from(b, 'base64').toString('binary'),
            ...tProps,
          });
          tCtx.globalThis = tCtx;
          vm.runInContext(strippedCode, tCtx);
          expect(tCtx.__shader).not.toBe(wgsl);
        }

        // String.prototype._u poisoning
        const protoPoisonCtx = vm.createContext({
          window: { [shield.windowKeySymbol]: shield.expectedDelta },
          [shield.windowKeySymbol]: shield.expectedDelta,
          Uint8Array,
          TextDecoder,
          Math,
          atob: (b: string) => Buffer.from(b, 'base64').toString('binary'),
        });
        protoPoisonCtx.globalThis = protoPoisonCtx;
        vm.runInContext('String.prototype._u = 14;', protoPoisonCtx);
        vm.runInContext(strippedCode, protoPoisonCtx);
        expect(protoPoisonCtx.__shader).not.toBe(wgsl);

        // 5. Genuine loading DOM before shield -> decrypts without caching; once shield loads, works cleanly and rejects late tamper
        const loadingDoc: any = { nodeType: 9, scripts: [{}], readyState: 'loading' };
        const loadingWin: Record<string, unknown> = { document: loadingDoc };
        const loadingCtx = vm.createContext({
          window: loadingWin,
          document: loadingDoc,
          Uint8Array,
          TextDecoder,
          Math,
          String,
          atob: (b: string) => Buffer.from(b, 'base64').toString('binary'),
        });
        loadingCtx.globalThis = loadingCtx;
        vm.runInContext(strippedCode, loadingCtx);
        expect(loadingCtx.__shader).toBe(wgsl);
        vm.runInContext(shieldLine, loadingCtx);
        expect(vm.runInContext('getShader()', loadingCtx)).toBe(wgsl);
        // Late tamper must not return cached clean shader
        vm.runInContext('globalThis.__unpeek_tampered = true;', loadingCtx);
        expect(vm.runInContext('getShader()', loadingCtx)).not.toBe(wgsl);
      }

      // 6. Direct createShaderVaultAst with shieldCoupled = false stays uncoupled
      const uncoupledAst = createShaderVaultAst('_sUncoupled', [wgsl], 0x12345678, undefined, undefined, false);
      const uncoupledCode = `${generateCompactJs(uncoupledAst)}; return _sUncoupled(0);`;
      expect(new Function(uncoupledCode)()).toBe(wgsl);
    });
  });

  // =========================================================================
  // P1c Vector D4: WASM KDF env.g / env.m Masking & 50/50 Parity
  // =========================================================================
  describe('P1c Vector D4: WASM KDF env.g/env.m masking & 50/50 WASM<->JS bit parity', () => {
    it('masks env.g return values and env.m pc argument in WASM bytecode and maintains 50/50 bit-identical parity with fallbackKdf and JS CSP fallback', () => {
      const seeds = [0x12345678, 0x9e3779b9, 0xdeadbeef];

      for (const seed of seeds) {
        const wasmBytes = generateWasmKdfBinary(seed);
        expect(wasmBytes.byteLength).toBeLessThan(1200);
        expect(wasmBytes.byteLength).toBeLessThan(512);

        const mod = new WebAssembly.Module(wasmBytes as BufferSource);
        const hostEnv = createWasmHostEnv(seed);

        const observedGOutputs: number[] = [];
        const observedMPcs: number[] = [];
        const spyEnv = {
          env: {
            g(slot: number) {
              const v = hostEnv.env.g(slot);
              observedGOutputs.push(v);
              return v;
            },
            m(acc: number, pc: number) {
              observedMPcs.push(pc);
              return hostEnv.env.m(acc, pc);
            },
          },
        };

        const inst = new WebAssembly.Instance(mod, spyEnv);
        const wasmKdf = inst.exports.kdf as (f: number, s: number, h: number) => number;

        // Also test injected JS CSP fallback
        const ast = acorn.parse('function noop(){}', { ecmaVersion: 'latest', sourceType: 'script' }) as any;
        const { kdfFnName } = injectWasmVault(ast, seed);
        const injectedCode = generateCompactJs(ast);
        const cspCtx = vm.createContext({
          WebAssembly: undefined,
          Uint8Array,
          Math,
          String,
        });
        vm.runInContext(injectedCode, cspCtx);
        const jsFallback = cspCtx[kdfFnName] as (f: number, s: number, h: number) => number;

        // Verify 50 test vectors for bit-identical parity and masked env.m pc
        for (let i = 0; i < 50; i++) {
          const fnId = (i * 17 - 11) | 0;
          const salt = ((i * 0x45d9f3b) ^ seed) | 0;
          const shieldHash = ((i * 0x9e3779b1) ^ 0x13572468) | 0;

          observedMPcs.length = 0;
          const wasmOut = wasmKdf(fnId, salt, shieldHash);
          const jsOut = jsFallback(fnId, salt, shieldHash);
          const expected = fallbackKdf(fnId, salt, shieldHash, seed);

          expect(wasmOut).toBe(expected);
          expect(jsOut).toBe(expected);
          expect(observedMPcs.length).toBe(1);
          // env.m must receive masked pc (shieldHash ^ pcMask), never raw shieldHash
          expect(observedMPcs[0]).not.toBe(shieldHash);
        }

        // Verify env.g does not expose raw internal gArr values directly (unmasked env.g breaks kdf)
        expect(observedGOutputs.length).toBeGreaterThan(0);
        // Verify injected JS _eG(sl) xor-masks with gMask (not returning raw _g[sl & 3])
        expect(injectedCode).toMatch(/_g\[sl\s*&\s*3\]\s*\^/);
      }
    });
  });
});
