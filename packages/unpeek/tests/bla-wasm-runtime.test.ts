import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import * as acorn from 'acorn';
import {
  deriveWasmAbiNames,
  generateWasmKdfBinary,
  createWasmHostEnv,
  fallbackKdf,
  injectWasmVault,
} from '../src/ast/wasm-vault.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import { createDeterrentSnippet, generateRuntimeShield } from '../src/runtime/index.js';

function containsSubseq(haystack: Uint8Array, needle: number[]): boolean {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

describe('BLA-adapted Polymorphic WASM ABI & Runtime Automation Deterrents', () => {
  describe('Polymorphic WASM ABI & Shuffled Export Order (wasm-vault.ts)', () => {
    const testSeeds = [0, 1, 0x12345678, 0x9e3779b9, 0xdeadbeef, 0x55aa77cc, 0xffffffff];
    const vectors: [number, number, number][] = [
      [0, 0, 0],
      [1, 0x55aa, 0x7f3a],
      [-1, -999, 0x12345678],
      [0x7fffffff, -0x80000000, 0x42424242],
    ];

    it('derives deterministic, compact (2-3 char), unique ABI identifiers and shuffled exportOrder without fixed ABI literals', () => {
      const fixedAbiSet = new Set(['env', 'g', 'm', 'kdf', 'bulkMix', 'mem']);
      const observedExportNames = new Set<string>();
      const observedOrders = new Set<string>();

      for (const seed of testSeeds) {
        const a = deriveWasmAbiNames(seed);
        const b = deriveWasmAbiNames(seed);
        expect(a).toEqual(b);

        const names = [a.envMod, a.gImport, a.mImport, a.kdfExport, a.bulkMixExport, a.memExport];
        for (const name of names) {
          expect(name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]{1,2}$/);
          expect(fixedAbiSet.has(name)).toBe(false);
        }

        expect(a.gImport).not.toBe(a.mImport);
        expect(new Set([a.kdfExport, a.bulkMixExport, a.memExport]).size).toBe(3);
        expect(new Set(names).size).toBe(6);

        expect([...a.exportOrder].sort((x, y) => x - y)).toEqual([0, 1, 2]);
        observedExportNames.add(`${a.kdfExport}:${a.bulkMixExport}:${a.memExport}`);
        observedOrders.add(a.exportOrder.join(','));
      }

      expect(observedExportNames.size).toBeGreaterThan(3);
      expect(observedOrders.size).toBeGreaterThan(1);
    });

    it('preserves default ABI contract when polymorphicAbi is omitted/false, and applies polymorphic ABI + shuffled export order under <512 B when enabled', () => {
      const kdfAscii = [0x6b, 0x64, 0x66];
      const bulkMixAscii = [0x62, 0x75, 0x6c, 0x6b, 0x4d, 0x69, 0x78];

      for (const seed of testSeeds) {
        // Default ABI remains backward-compatible
        const legacyBytes = generateWasmKdfBinary(seed);
        expect(legacyBytes.byteLength).toBeLessThan(512);
        expect(WebAssembly.validate(legacyBytes as BufferSource)).toBe(true);
        const legacyMod = new WebAssembly.Module(legacyBytes as BufferSource);
        expect(WebAssembly.Module.exports(legacyMod).map((e) => e.name)).toEqual([
          'kdf',
          'bulkMix',
          'mem',
        ]);
        const legacyInst = new WebAssembly.Instance(legacyMod, createWasmHostEnv(seed));
        expect(typeof legacyInst.exports.kdf).toBe('function');

        // Polymorphic ABI mode
        const abi = deriveWasmAbiNames(seed);
        const polyBytes = generateWasmKdfBinary(seed, { polymorphicAbi: true });
        expect(polyBytes.byteLength).toBeLessThan(512);
        expect(WebAssembly.validate(polyBytes as BufferSource)).toBe(true);

        expect(containsSubseq(polyBytes, kdfAscii)).toBe(false);
        expect(containsSubseq(polyBytes, bulkMixAscii)).toBe(false);

        const polyMod = new WebAssembly.Module(polyBytes as BufferSource);
        const imports = WebAssembly.Module.imports(polyMod);
        expect(imports.map((imp) => `${imp.module}.${imp.name}`)).toEqual([
          `${abi.envMod}.${abi.gImport}`,
          `${abi.envMod}.${abi.mImport}`,
        ]);

        const canonicalExports = [abi.kdfExport, abi.bulkMixExport, abi.memExport];
        const expectedExportOrder = abi.exportOrder.map((idx) => canonicalExports[idx]);
        expect(WebAssembly.Module.exports(polyMod).map((e) => e.name)).toEqual(
          expectedExportOrder
        );

        // Wrong legacy env must fail LinkError / TypeError
        expect(() => new WebAssembly.Instance(polyMod, createWasmHostEnv(seed))).toThrow();

        // Polymorphic host env instantiates cleanly and matches fallbackKdf bit-for-bit
        const polyInst = new WebAssembly.Instance(
          polyMod,
          createWasmHostEnv(seed, { polymorphicAbi: true })
        );
        const polyKdf = polyInst.exports[abi.kdfExport] as (f: number, s: number, h: number) => number;
        const polyBulkMix = polyInst.exports[abi.bulkMixExport] as (
          ptr: number,
          len: number,
          key: number
        ) => number;
        const polyMem = polyInst.exports[abi.memExport] as WebAssembly.Memory;

        expect(typeof polyKdf).toBe('function');
        expect(typeof polyBulkMix).toBe('function');
        expect(polyMem).toBeInstanceOf(WebAssembly.Memory);

        for (const [f, s, h] of vectors) {
          expect(polyKdf(f, s, h)).toBe(fallbackKdf(f, s, h, seed));
        }

        const view = new Int32Array(polyMem.buffer, 256, 4);
        view.set([10, 20, 30, 40]);
        expect(typeof polyBulkMix(256, 4, 0x1357)).toBe('number');
      }
    });

    it('injectWasmVault emits zero plaintext ABI strings and works end-to-end in both WASM and CSP fallback modes', () => {
      const seed = 0x55aa77cc;
      const abi = deriveWasmAbiNames(seed);
      const ast = acorn.parse('function noop(){}', {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as acorn.Program;

      const res = injectWasmVault(ast, seed);
      expect(res.kdfParityVerified).toBe(true);
      expect(res.wasmBytes.byteLength).toBeLessThan(512);

      // Idempotent second call keeps polymorphic <512 B contract
      const second = injectWasmVault(ast, seed);
      expect(second.kdfFnName).toBe(res.kdfFnName);
      expect(second.kdfParityVerified).toBe(true);
      expect(second.wasmBytes.byteLength).toBeLessThan(512);

      const code = generateCompactJs(ast);
      expect(code).not.toContain('"kdf"');
      expect(code).not.toContain("'kdf'");
      expect(code).not.toContain('.kdf');
      expect(code).not.toContain('bulkMix');
      expect(code).not.toContain('"mem"');
      expect(code).not.toContain('"env"');
      expect(code).toContain(abi.envMod);
      expect(code).toContain(abi.kdfExport);

      // 1. Live WebAssembly execution
      let compiledBytes: Uint8Array | null = null;
      const SpyModule = function (bytes: Uint8Array) {
        compiledBytes = bytes;
        return new WebAssembly.Module(bytes as BufferSource);
      } as unknown as typeof WebAssembly.Module;

      const wasmCtx: Record<string, any> = {
        WebAssembly: { Module: SpyModule, Instance: WebAssembly.Instance },
        Uint8Array,
        Math,
        String,
      };
      wasmCtx.globalThis = wasmCtx;
      vm.createContext(wasmCtx);
      vm.runInContext(code, wasmCtx);

      expect(compiledBytes).not.toBeNull();
      expect(compiledBytes!.byteLength).toBeLessThan(512);
      for (const [f, s, h] of vectors) {
        expect(wasmCtx[res.kdfFnName](f, s, h)).toBe(fallbackKdf(f, s, h, seed));
      }

      // 2. CSP fallback (WebAssembly disabled)
      const cspCtx: Record<string, any> = {
        WebAssembly: undefined,
        Uint8Array,
        Math,
        String,
      };
      cspCtx.globalThis = cspCtx;
      vm.createContext(cspCtx);
      vm.runInContext(code, cspCtx);

      for (const [f, s, h] of vectors) {
        expect(cspCtx[res.kdfFnName](f, s, h)).toBe(fallbackKdf(f, s, h, seed));
      }
    });
  });

  describe('Synchronous Automation & Instrumentation Markers (devtools-deterrent.ts)', () => {
    const markers = [
      '__playwright',
      '__puppeteer_evaluation_script__',
      '__nightmare',
      'frida',
      '_frida_',
    ] as const;

    it('stays single-line, SSR/Worker-safe, FTO-compliant, and respects updated byte budgets (<2048 B default, <2300 B detectHeadless: true)', () => {
      for (const deterrentMode of ['passive', 'gradual'] as const) {
        const defaultSnippet = createDeterrentSnippet({
          seed: 0xffffffff,
          deterrentMode,
          detectHeadless: false,
        });
        expect(defaultSnippet.includes('\n')).toBe(false);
        expect(Buffer.byteLength(defaultSnippet, 'utf8')).toBeLessThan(2048);

        const headlessSnippet = createDeterrentSnippet({
          seed: 0xffffffff,
          deterrentMode,
          detectHeadless: true,
        });
        expect(headlessSnippet.includes('\n')).toBe(false);
        expect(Buffer.byteLength(headlessSnippet, 'utf8')).toBeLessThan(2300);

        // FTO: no periodic polling or DOM sweeping
        expect(headlessSnippet).not.toContain('setInterval');
        expect(headlessSnippet).not.toContain('setTimeout');
        expect(headlessSnippet).not.toContain('querySelector');

        // SSR-safe execution without window
        const ssrCtx = vm.createContext({ console: { log: () => {} } });
        expect(() => vm.runInContext(headlessSnippet, ssrCtx)).not.toThrow();

        // Worker-safe execution with self only
        const workerCtx: Record<string, unknown> = {};
        workerCtx.self = workerCtx;
        workerCtx.globalThis = workerCtx;
        vm.createContext(workerCtx);
        expect(() => vm.runInContext(headlessSnippet, workerCtx)).not.toThrow();
        expect(workerCtx.__unpeek_tampered).toBeUndefined();
      }
    });

    it('leaves automation markers unflagged when detectHeadless is false, and triggers tamper + key poisoning synchronously when detectHeadless is true', () => {
      const seed = 0x31415926;
      const sym = '_zAuto';
      const defaultSnippet = createDeterrentSnippet({
        seed,
        windowKeySymbol: sym,
        detectHeadless: false,
      });
      const optInShield = generateRuntimeShield({
        seed,
        windowKeySymbol: sym,
        detectHeadless: true,
      });

      // Clean baseline for detectHeadless: true
      const cleanWin: Record<string, unknown> = {
        navigator: { webdriver: false, userAgent: 'Mozilla/5.0' },
      };
      const cleanCtx = vm.createContext({ window: cleanWin });
      cleanCtx.globalThis = cleanCtx;
      vm.runInContext(optInShield.preambleCode, cleanCtx);
      expect(cleanWin.__unpeek_tampered).toBeUndefined();
      expect((cleanWin[`${sym}_s`] as number[])[0]).toBe(1);
      const cleanDelta = cleanWin[sym];
      expect(cleanDelta).toBe(optInShield.expectedDelta);

      for (const marker of markers) {
        // 1. detectHeadless: false must NOT trigger on marker
        const safeWin: Record<string, unknown> = {
          [marker]: { attached: true },
          navigator: { webdriver: false, userAgent: 'Mozilla/5.0' },
        };
        const safeCtx = vm.createContext({ window: safeWin });
        safeCtx.globalThis = safeCtx;
        vm.runInContext(defaultSnippet, safeCtx);
        expect(safeWin.__unpeek_tampered, `default mode should ignore ${marker}`).toBeUndefined();
        expect((safeWin[`${sym}_s`] as number[])[0]).toBe(1);
        expect(safeWin.__unpeek_seed).toBeUndefined();

        // 2. detectHeadless: true triggers when marker is on window (object or boolean)
        for (const val of [true, { hooked: 1 }]) {
          const winTarget: Record<string, unknown> = {
            [marker]: val,
            navigator: { webdriver: false, userAgent: 'Mozilla/5.0' },
          };
          const winCtx = vm.createContext({ window: winTarget });
          winCtx.globalThis = winCtx;
          vm.runInContext(optInShield.preambleCode, winCtx);
          expect(winTarget.__unpeek_tampered, `expected tamper for window.${marker}`).toBe(true);
          expect((winTarget[`${sym}_s`] as number[])[0]).toBe(2);
          expect(winTarget[sym]).not.toBe(cleanDelta);
          expect(winTarget.__unpeek_seed).toBe((seed ^ 1) >>> 0);
        }

        // 3. detectHeadless: true triggers when marker is on globalThis (separate from window)
        const bareWin: Record<string, unknown> = {
          navigator: { webdriver: false, userAgent: 'Mozilla/5.0' },
        };
        const globalCtx: Record<string, unknown> = {
          window: bareWin,
          [marker]: true,
        };
        globalCtx.globalThis = globalCtx;
        vm.createContext(globalCtx);
        vm.runInContext(optInShield.preambleCode, globalCtx);
        expect(globalCtx.__unpeek_tampered, `expected tamper for globalThis.${marker}`).toBe(true);
        expect((globalCtx[`${sym}_s`] as number[])[0]).toBe(2);
        expect(globalCtx[sym]).not.toBe(cleanDelta);
        expect(globalCtx.__unpeek_seed).toBe((seed ^ 1) >>> 0);
      }
    });
  });
});
