import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as acorn from 'acorn';
import {
  computeFnv1aHash,
  evalRivestPoly32,
  invertRivestPoly32,
} from '../src/shared/hash.js';
import {
  computeMba4Constants,
  evaluateMba4Formula,
  evaluateMba4Target,
  createSotaMbaPredicate,
} from '../src/ast/cold-flow-guard.js';
import {
  generateWasmKdfBinary,
  createWasmHostEnv,
  fallbackKdf,
  injectWasmVault,
} from '../src/ast/wasm-vault.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import { applyMicroVm } from '../src/ast/micro-vm.js';
import { transformJavaScript } from '../src/ast/index.js';
import { generateRuntimeShield } from '../src/runtime/index.js';
import {
  flattenSourceMapSections,
  decodeMappings,
  encodeMappings,
  chainSourceMaps,
  resolvePosition,
  computeDeterministicDebugId,
  symbolicateStackTrace,
} from '../src/core/vlq.js';
import { protectProject } from '../src/core/protect.js';
import { checkProject } from '../src/core/check.js';
import { scanClientBundles } from '../src/core/detector.js';
import { unpeekVite } from '../src/adapters/vite.js';
import { unpeekRollup } from '../src/adapters/rollup.js';
import { unpeekWebpack } from '../src/adapters/webpack.js';
import { unpeekRspack } from '../src/adapters/rspack.js';
import { unpeekEsbuild } from '../src/adapters/esbuild.js';

function xorshift32(state: number): number {
  let x = state | 0;
  if (x === 0) x = 0x9e3779b9 | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}

describe('unpeek v4 Architecture & Verification Suite', () => {
  const tempDirs: string[] = [];

  function makeTmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 1. Mathematical Oracles
  // =========================================================================
  describe('1. Mathematical Oracles (Rivest Z_{2^32}, >=4-var MBA, QNR, Host-Coupled WASM KDF)', () => {
    it('verifies 10,000-vector bijection invertRivestPoly32(evalRivestPoly32(x)) === x mod 2^32', () => {
      const boundaryInputs = [0, 1, 2, -1, 0x7fffffff, 0x80000000, 0xffffffff, 0xdeadbeef];
      let rng = 0x13579bdf | 0;

      for (let i = 0; i < 10_000; i++) {
        rng = xorshift32(rng);
        const x = i < boundaryInputs.length ? boundaryInputs[i] >>> 0 : rng >>> 0;
        const a0 = xorshift32(rng ^ 0x11111111) | 0;
        const a1Odd = xorshift32(rng ^ 0x22222222) | 1;
        const a2Even = xorshift32(rng ^ 0x33333333) & ~1;
        const a3Even = xorshift32(rng ^ 0x44444444) & ~1;
        rng = a3Even;

        const y = evalRivestPoly32(x, a0, a1Odd, a2Even, a3Even);
        const recovered = invertRivestPoly32(y, a0, a1Odd, a2Even, a3Even);
        expect(recovered).toBe(x);
      }
    });

    it('verifies 5,000-vector >=4-variable semi-linear MBA equivalence across all 4 families', () => {
      let rng = 0x2468ace1 | 0;
      const constsByFamily = [0, 1, 2, 3].map((f) =>
        computeMba4Constants(0x9e3779b9, f + 3, f)
      );

      for (let i = 0; i < 5_000; i++) {
        rng = xorshift32(rng);
        const x1 = rng;
        rng = xorshift32(rng);
        const x2 = rng;
        rng = xorshift32(rng);
        const x3 = rng;
        rng = xorshift32(rng);
        const x4 = rng;

        for (let f = 0; f < 4; f++) {
          const consts = constsByFamily[f];
          const lhs = evaluateMba4Formula(f, x1, x2, x3, x4, consts);
          const rhs = evaluateMba4Target(f, x1, x2, x3, x4, consts.k);
          expect(lhs).toBe(rhs);
        }
      }
    });

    it('verifies 100,000-vector QNR ((Math.imul(z, z) + 1) & 3) === 3 is strictly false (LHS in {1, 2})', () => {
      let rng = 0xcafebabe | 0;
      const edgeZ = [0, 1, -1, 2, -2, 3, -3, 0x7fffffff, -0x80000000];
      for (let i = 0; i < 100_000; i++) {
        rng = xorshift32(rng);
        const z = i < edgeZ.length ? edgeZ[i] : rng;
        const lhs = (Math.imul(z, z) + 1) & 3;
        expect(lhs === 1 || lhs === 2).toBe(true);
        expect(lhs === 3).toBe(false);
      }
    });

    it('verifies host-coupled WASM KDF (<1.2 KB, zero-import failure, bulkMix, singleton reuse, CSP JS parity)', () => {
      const seeds = [0x12345678, 0x9e3779b9, 0xdeadbeef];
      const vectors: [number, number, number][] = [
        [0, 0, 0],
        [1, 0x55aa, 0x7f3a],
        [-1, -999, 0x12345678],
        [0x7fffffff, -0x80000000, 0x42424242],
      ];

      for (const seed of seeds) {
        const wasmBytes = generateWasmKdfBinary(seed);
        expect(wasmBytes.byteLength).toBeLessThan(1200);

        const mod = new WebAssembly.Module(wasmBytes as BufferSource);
        expect(() => new WebAssembly.Instance(mod)).toThrow(TypeError);
        expect(() => new WebAssembly.Instance(mod, {})).toThrow(TypeError);
        expect(() => new WebAssembly.Instance(mod, { env: {} })).toThrow(WebAssembly.LinkError);

        const inst = new WebAssembly.Instance(mod, createWasmHostEnv(seed));
        const wasmKdf = inst.exports.kdf as (f: number, s: number, h: number) => number;
        const bulkMix = inst.exports.bulkMix as (ptr: number, len: number, key: number) => number;
        const mem = inst.exports.mem as WebAssembly.Memory;

        expect(typeof bulkMix).toBe('function');
        expect(mem).toBeInstanceOf(WebAssembly.Memory);

        const view = new Int32Array(mem.buffer, 256, 4);
        view.set([11, 22, 33, 44]);
        expect(typeof bulkMix(256, 4, 0x1234)).toBe('number');

        for (const [f, s, h] of vectors) {
          expect(wasmKdf(f, s, h)).toBe(fallbackKdf(f, s, h, seed));
        }
      }

      // Singleton reuse across multiple split chunks in the same globalThis
      const seed = 0x55aa77cc;
      const chunkA = acorn.parse('function chunkA(){return 1;}', { ecmaVersion: 'latest' }) as any;
      const chunkB = acorn.parse('function chunkB(){return 2;}', { ecmaVersion: 'latest' }) as any;
      const injA = injectWasmVault(chunkA, seed);
      const injB = injectWasmVault(chunkB, seed);
      const codeA = generateCompactJs(chunkA);
      const codeB = generateCompactJs(chunkB);

      let moduleCompileCount = 0;
      const SpyModule = function (bytes: BufferSource) {
        moduleCompileCount++;
        return new WebAssembly.Module(bytes);
      } as unknown as typeof WebAssembly.Module;

      const sharedCtx: Record<string, any> = {
        WebAssembly: { Module: SpyModule, Instance: WebAssembly.Instance },
        Uint8Array,
        Math,
        String,
      };
      sharedCtx.globalThis = sharedCtx;
      vm.createContext(sharedCtx);
      vm.runInContext(codeA, sharedCtx);
      vm.runInContext(codeB, sharedCtx);

      expect(moduleCompileCount).toBe(1);
      expect(sharedCtx.__unpeek_wasm_kdf).toBeDefined();
      expect(sharedCtx[injA.kdfFnName]).toBe(sharedCtx[injB.kdfFnName]);
      for (const [f, s, h] of vectors) {
        expect(sharedCtx[injA.kdfFnName](f, s, h)).toBe(fallbackKdf(f, s, h, seed));
      }

      // CSP fallback when WebAssembly is disabled
      const cspCtx: Record<string, any> = {
        WebAssembly: undefined,
        Uint8Array,
        Math,
        String,
      };
      cspCtx.globalThis = cspCtx;
      vm.createContext(cspCtx);
      vm.runInContext(codeA, cspCtx);
      for (const [f, s, h] of vectors) {
        expect(cspCtx[injA.kdfFnName](f, s, h)).toBe(fallbackKdf(f, s, h, seed));
      }
    });
  });

  // =========================================================================
  // 2. Issue #1 Order-Independence, Turbopack Boundary & WorkerGlobalScope
  // =========================================================================
  describe('2. Issue #1 Order-Independent Shield Loading & WorkerGlobalScope', () => {
    it('exempts Next.js 16 Turbopack .push([typeof document==="object", ...]) boundary headers while protecting user logic', () => {
      const turboChunk = `
        function readSecret() {
          return "TURBOPACK_PROTECTED_SECRET_VALUE";
        }
        (globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([
          typeof document === "object" ? document.currentScript : undefined,
          "static/chunks/page-abc.js",
          function(t) {
            t.s(["readSecret", () => readSecret]);
          }
        ]);
      `;
      const res = transformJavaScript(turboChunk, { seed: 0x33445566, minStringLength: 4 });
      expect(res.code).toContain('typeof document==="object"');
      expect(res.code).toContain('static/chunks/page-abc.js');
      expect(res.code).not.toContain('TURBOPACK_PROTECTED_SECRET_VALUE');

      const pushed: any[] = [];
      const ctx: Record<string, any> = {
        document: { currentScript: { id: 'script-1' } },
        TURBOPACK: pushed,
      };
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(res.code, ctx);
      expect(pushed).toHaveLength(1);
      expect(pushed[0][0]).toEqual({ id: 'script-1' });
      expect(pushed[0][1]).toBe('static/chunks/page-abc.js');

      const exportsMap: Record<string, any> = {};
      pushed[0][2]({
        s(pairs: any[]) {
          exportsMap[pairs[0]] = pairs[1]();
        },
      });
      expect(exportsMap.readSecret()).toBe('TURBOPACK_PROTECTED_SECRET_VALUE');
    });

    it('resolves page chunks BEFORE turbopack-*.js entry shield without -1 cache poisoning, works in WorkerGlobalScope, and fails closed on tamper', () => {
      const seed = 0x88776655;
      const shield = generateRuntimeShield({ seed, deterrentMode: 'passive' });

      const pageSource = `
        function getTelemetrySecret(flag) {
          var token = "ISSUE1_ORDER_INDEPENDENT_SECRET";
          if (flag) {
            return token + "_ACTIVE";
          }
          return token + "_IDLE";
        }
        self.__getTelemetrySecret = getTelemetrySecret;
      `;

      // Tier 2 + Tier 3 (Micro-VM + Salted Vault) coupled to entry shield without injecting shield preamble into page chunk
      const pageTransformed = transformJavaScript(pageSource, {
        seed,
        aggressive: true,
        minStringLength: 4,
        injectRuntimeShield: false,
        // Internal shieldCoupled options passed by protectProject for non-entry chunks
        ...( {
          shieldCoupled: true,
          windowKeySymbol: shield.windowKeySymbol,
          expectedDelta: shield.expectedDelta,
        } as Record<string, unknown> ),
      });

      const entrySource = `self.__entryReady = true;`;
      const entryTransformed = transformJavaScript(entrySource, {
        seed,
        minStringLength: 4,
        injectRuntimeShield: true,
        ...( {
          windowKeySymbol: shield.windowKeySymbol,
          expectedDelta: shield.expectedDelta,
        } as Record<string, unknown> ),
      });

      // 1. Async race: page chunk runs FIRST (globalThis[sym] === undefined) -> 100% valid, no -1 cache poisoning!
      const raceCtx: Record<string, any> = {
        Uint8Array,
        WebAssembly,
        Math,
        String,
        Promise,
      };
      raceCtx.self = raceCtx;
      raceCtx.window = raceCtx;
      raceCtx.globalThis = raceCtx;
      vm.createContext(raceCtx);

      vm.runInContext(pageTransformed.code, raceCtx);
      expect(raceCtx[shield.windowKeySymbol]).toBeUndefined();
      expect(raceCtx.__getTelemetrySecret(true)).toBe('ISSUE1_ORDER_INDEPENDENT_SECRET_ACTIVE');
      expect(raceCtx.__getTelemetrySecret(false)).toBe('ISSUE1_ORDER_INDEPENDENT_SECRET_IDLE');

      // Now entry shield loads later -> still 100% valid!
      vm.runInContext(entryTransformed.code, raceCtx);
      expect(raceCtx[shield.windowKeySymbol]).toBe(shield.expectedDelta);
      expect(raceCtx.__getTelemetrySecret(true)).toBe('ISSUE1_ORDER_INDEPENDENT_SECRET_ACTIVE');
      expect(raceCtx.__getTelemetrySecret(false)).toBe('ISSUE1_ORDER_INDEPENDENT_SECRET_IDLE');

      // 2. WorkerGlobalScope (window === undefined, self === globalThis) -> shield + page chunk run with 0 errors
      const workerCtx: Record<string, any> = {
        Uint8Array,
        WebAssembly,
        Math,
        String,
        Promise,
      };
      workerCtx.self = workerCtx;
      workerCtx.globalThis = workerCtx;
      vm.createContext(workerCtx);
      vm.runInContext(pageTransformed.code, workerCtx);
      expect(workerCtx.__getTelemetrySecret(true)).toBe('ISSUE1_ORDER_INDEPENDENT_SECRET_ACTIVE');
      vm.runInContext(entryTransformed.code, workerCtx);
      expect(workerCtx.__getTelemetrySecret(false)).toBe('ISSUE1_ORDER_INDEPENDENT_SECRET_IDLE');

      // 3. Active tamper (status === 2 or __unpeek_tampered = true or mismatched delta) -> fails closed
      const tamperCtx: Record<string, any> = {
        Uint8Array,
        WebAssembly,
        Math,
        String,
        Promise,
        __unpeek_tampered: true,
        [shield.windowKeySymbol]: (shield.expectedDelta ^ 0x1337) & 0xffff,
        [`${shield.windowKeySymbol}_s`]: [2, 0, 0, 1, 0],
      };
      tamperCtx.self = tamperCtx;
      tamperCtx.window = tamperCtx;
      tamperCtx.globalThis = tamperCtx;
      vm.createContext(tamperCtx);
      vm.runInContext(pageTransformed.code, tamperCtx);
      expect(tamperCtx.__getTelemetrySecret(true)).not.toBe(
        'ISSUE1_ORDER_INDEPENDENT_SECRET_ACTIVE'
      );
    });

    it('excludes public worker/SW files by default in scanClientBundles and includes them when target is worker', () => {
      const tmp = makeTmpDir('unpeek-worker-scan-');
      const chunksDir = path.join(tmp, 'dist');
      const publicDir = path.join(chunksDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(path.join(chunksDir, 'app.js'), 'console.log(1);', 'utf8');
      fs.writeFileSync(path.join(publicDir, 'sw.js'), 'self.addEventListener("fetch",()=>{});', 'utf8');
      fs.writeFileSync(path.join(publicDir, 'pdf.worker.min.mjs'), 'export const w=1;', 'utf8');
      fs.writeFileSync(path.join(publicDir, 'workbox-abc123.js'), 'self.__WB=1;', 'utf8');

      const browserFiles = scanClientBundles(chunksDir, { target: 'browser' }).map((f) =>
        path.basename(f)
      );
      expect(browserFiles).toContain('app.js');
      expect(browserFiles).not.toContain('sw.js');
      expect(browserFiles).not.toContain('pdf.worker.min.mjs');
      expect(browserFiles).not.toContain('workbox-abc123.js');

      const workerFiles = scanClientBundles(chunksDir, { target: 'worker' }).map((f) =>
        path.basename(f)
      );
      expect(workerFiles).toContain('sw.js');
      expect(workerFiles).toContain('pdf.worker.min.mjs');
      expect(workerFiles).toContain('workbox-abc123.js');
    });
  });

  // =========================================================================
  // 3. Multi-Pass VLQ (M1 o M2), ECMA-426 .sections, URL Paths & Sentry debugId
  // =========================================================================
  describe('3. Multi-Pass Source Maps, ECMA-426 .sections, URL Normalization & Sentry debugId', () => {
    it('flattens ECMA-426 indexed .sections maps, composes M1 o M2, and symbolicates %28public%29 / %5Bsayi%5D / Windows paths', async () => {
      // Sectioned upstream map M1 (original TS -> compiled JS)
      const sec0Mappings = encodeMappings([
        {
          generatedLine: 0,
          generatedColumn: 9,
          sourceIndex: 0,
          originalLine: 41,
          originalColumn: 4,
          nameIndex: 0,
        },
      ]);
      const sec1Mappings = encodeMappings([
        {
          generatedLine: 0,
          generatedColumn: 4,
          sourceIndex: 0,
          originalLine: 9,
          originalColumn: 2,
          nameIndex: 0,
        },
      ]);
      const indexedM1 = {
        version: 3,
        file: 'bundle.js',
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ['app/(public)/[sayi]/page.tsx'],
              names: ['renderMagazineIssue'],
              mappings: sec0Mappings,
            },
          },
          {
            offset: { line: 10, column: 0 },
            map: {
              version: 3,
              sources: ['C:\\Users\\dev\\src\\checkout.ts'],
              names: ['submitOrder'],
              mappings: sec1Mappings,
            },
          },
        ],
      };

      const flatM1 = flattenSourceMapSections(indexedM1);
      expect(flatM1.sources).toEqual([
        'app/(public)/[sayi]/page.tsx',
        'C:\\Users\\dev\\src\\checkout.ts',
      ]);
      const decodedM1 = decodeMappings(indexedM1);
      expect(decodedM1.malformedCount).toBe(0);
      expect(decodedM1.mappings.length).toBe(2);

      // Verify M1 resolution directly
      const pos1 = resolvePosition(indexedM1, 1, 10);
      expect(pos1.source).toBe('app/(public)/[sayi]/page.tsx');
      expect(pos1.line).toBe(42);
      expect(pos1.name).toBe('renderMagazineIssue');

      // Second pass map M2 (shifted/transformed JS -> M1 generated JS)
      const m2Mappings = encodeMappings([
        {
          generatedLine: 2,
          generatedColumn: 15,
          sourceIndex: 0,
          originalLine: 0,
          originalColumn: 9,
        },
        {
          generatedLine: 15,
          generatedColumn: 8,
          sourceIndex: 0,
          originalLine: 10,
          originalColumn: 4,
        },
      ]);

      const chained = chainSourceMaps(
        {
          version: 3,
          sources: ['bundle.js'],
          names: [],
          mappings: m2Mappings,
        },
        indexedM1
      );

      const resolvedChained = resolvePosition(chained, 3, 16);
      expect(resolvedChained.source).toBe('app/(public)/[sayi]/page.tsx');
      expect(resolvedChained.line).toBe(42);
      expect(resolvedChained.name).toBe('renderMagazineIssue');

      const resolvedChained2 = resolvePosition(chained, 16, 9);
      expect(resolvedChained2.source).toBe('C:\\Users\\dev\\src\\checkout.ts');
      expect(resolvedChained2.line).toBe(10);
      expect(resolvedChained2.name).toBe('submitOrder');

      // symbolicateStackTrace with URL-encoded %28public%29, %5Bsayi%5D, _next/static/chunks/, and Windows backslashes
      const tmp = makeTmpDir('unpeek-sym-');
      const mapsDir = path.join(tmp, '.unpeek-maps', 'static', 'chunks', 'app', '(public)', '[sayi]');
      fs.mkdirSync(mapsDir, { recursive: true });
      fs.writeFileSync(
        path.join(mapsDir, 'page-123.js.map'),
        JSON.stringify(chained),
        'utf8'
      );

      const stack =
        `Error: Boom\n` +
        `    at renderMagazineIssue (https://example.com/_next/static/chunks/app/%28public%29/%5Bsayi%5D/page-123.js:3:16)\n` +
        `    at submitOrder (C:\\app\\static\\chunks\\app\\(public)\\[sayi]\\page-123.js:16:9)`;
      const symRes = await symbolicateStackTrace({
        stackTrace: stack,
        mapsDir: path.join(tmp, '.unpeek-maps'),
      });
      const resolvedFrames = symRes.frames.filter((f) => f.resolved);
      expect(resolvedFrames).toHaveLength(2);
      expect(resolvedFrames[0].originalSource).toBe('app/(public)/[sayi]/page.tsx');
      expect(resolvedFrames[0].originalLine).toBe(42);
      expect(resolvedFrames[0].originalName).toBe('renderMagazineIssue');
      expect(resolvedFrames[1].originalSource).toBe('C:\\Users\\dev\\src\\checkout.ts');
      expect(resolvedFrames[1].originalLine).toBe(10);
      expect(resolvedFrames[1].originalName).toBe('submitOrder');
    });

    it('chains M1 o M2 and stamps identical fresh SHA-256 debugId on JS and vaulted .map during protectProject, and checkProject catches debugid-mismatch', async () => {
      const tmp = makeTmpDir('unpeek-debugid-');
      const distDir = path.join(tmp, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'debugid-test', scripts: { build: 'vite build' } }),
        'utf8'
      );
      fs.writeFileSync(path.join(tmp, '.gitignore'), '.unpeek-maps/\n', 'utf8');

      const origSource = 'function loadBillingPortal() {\n  return "BILLING_PORTAL_KEY_2026";\n}\nexport { loadBillingPortal };\n';
      // Build an upstream M1 map pointing to src/billing.ts line 10
      const upstreamMap = {
        version: 3,
        file: 'app.js',
        sources: ['src/billing.ts'],
        names: ['loadBillingPortal'],
        // Line 0 col 9 -> src/billing.ts line 10 col 2, name 0
        mappings: 'SAAUAA',
        debugId: '00000000-0000-4000-8000-000000000001',
      };

      const chunkPath = path.join(distDir, 'app.js');
      const mapPath = path.join(distDir, 'app.js.map');
      fs.writeFileSync(
        chunkPath,
        `${origSource}//# debugId=00000000-0000-4000-8000-000000000001\n//# sourceMappingURL=app.js.map\n`,
        'utf8'
      );
      fs.writeFileSync(mapPath, JSON.stringify(upstreamMap), 'utf8');

      const summary = await protectProject({ cwd: tmp, outDir: 'dist', seed: 0x11223344 });
      expect(summary.processedFiles).toBe(1);
      expect(summary.movedSourceMaps).toBe(1);

      const protectedJs = fs.readFileSync(chunkPath, 'utf8');
      const vaultedMapPath = path.join(tmp, '.unpeek-maps', 'app.js.map');
      expect(fs.existsSync(vaultedMapPath)).toBe(true);
      const vaultedMap = JSON.parse(fs.readFileSync(vaultedMapPath, 'utf8'));

      // Old stale debugId must be replaced by a single matching fresh SHA-256 debugId
      expect(protectedJs).not.toContain('00000000-0000-4000-8000-000000000001');
      expect(vaultedMap.debugId).not.toBe('00000000-0000-4000-8000-000000000001');
      const jsDebugMatch = protectedJs.match(/\/\/# debugId=([0-9a-f-]+)/i);
      expect(jsDebugMatch).not.toBeNull();
      expect(jsDebugMatch![1]).toBe(vaultedMap.debugId);
      expect(vaultedMap.sources).toContain('src/billing.ts');

      // deterministic debugId check
      expect(computeDeterministicDebugId('abc', 'AAA')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );

      // checkProject passes cleanly when JS & .map debugIds match
      const cleanCheck = await checkProject({ cwd: tmp, outDir: 'dist' });
      expect(cleanCheck.passed).toBe(true);
      expect(cleanCheck.violations.some((v) => v.rule === 'debugid-mismatch')).toBe(false);

      // Corrupt vaulted map debugId -> checkProject must report debugid-mismatch violation
      vaultedMap.debugId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      fs.writeFileSync(vaultedMapPath, JSON.stringify(vaultedMap), 'utf8');
      const mismatchCheck = await checkProject({ cwd: tmp, outDir: 'dist' });
      expect(mismatchCheck.passed).toBe(false);
      expect(mismatchCheck.violations.some((v) => v.rule === 'debugid-mismatch')).toBe(true);
    });
  });

  // =========================================================================
  // 4. Micro-VM v2 + AST Hygiene + Real Bundler E2E (0 no-op)
  // =========================================================================
  describe('4. Micro-VM v2, AST Hygiene & Real Bundler E2E', () => {
    it('Micro-VM v2 executes obj.arguments, while/for, &&/||/??, ?:, try/throw, and @unpeek-critical Tier 3 selection', () => {
      // 1. Direct applyMicroVm v2 on loop + control-flow + obj.arguments + try/throw
      const loopVmSource = `
        function computeCriticalWorkflow(obj, limit, fallback) {
          var acc = obj.arguments ?? fallback;
          var i = 0;
          while (i < limit) {
            acc += (i % 2 === 0) ? i : (i * 2);
            i++;
          }
          for (var j = 0; j < 2; j++) {
            acc = (acc > 0 && obj.ok) ? acc + 1 : acc || 10;
          }
          try {
            if (obj.fail) {
              throw new Error("CRITICAL_ERR:" + acc);
            }
          } catch (err) {
            return err.message;
          }
          return acc;
        }
      `;
      const ast = acorn.parse(loopVmSource, { ecmaVersion: 'latest' }) as any;
      const vmRes = applyMicroVm(ast, undefined, undefined, 0x112233);
      expect(vmRes.virtualizedCount).toBe(1);
      const out = generateCompactJs(ast);
      const vmCtx: Record<string, any> = { Error };
      vmCtx.globalThis = vmCtx;
      vm.createContext(vmCtx);
      vm.runInContext(out, vmCtx);

      const origCtx: Record<string, any> = { Error };
      origCtx.globalThis = origCtx;
      vm.createContext(origCtx);
      vm.runInContext(loopVmSource, origCtx);

      expect(vmCtx.computeCriticalWorkflow({ arguments: 5, ok: true, fail: false }, 3, 1)).toBe(
        origCtx.computeCriticalWorkflow({ arguments: 5, ok: true, fail: false }, 3, 1)
      );
      expect(vmCtx.computeCriticalWorkflow({ ok: true, fail: true }, 3, 4)).toBe(
        origCtx.computeCriticalWorkflow({ ok: true, fail: true }, 3, 4)
      );
      expect(vmCtx.computeCriticalWorkflow({ arguments: 0, ok: false, fail: false }, 0, 7)).toBe(
        origCtx.computeCriticalWorkflow({ arguments: 0, ok: false, fail: false }, 0, 7)
      );

      // 2. @unpeek-critical annotation prioritizes cold function for Tier 3 Micro-VM v2 when maxFunctionsPerChunk = 1
      const criticalSource = `
        function regularColdHelper(x) {
          var s = "REGULAR_HELPER_PLAIN";
          return x > 0 ? s + x : s;
        }
        // @unpeek-critical
        function criticalGate(obj, fallback) {
          var val = obj.arguments ?? fallback;
          var score = (val > 0 && obj.ok) ? val + 10 : val || 5;
          try {
            if (obj.fail) {
              throw new Error("CRITICAL_ERR:" + score);
            }
          } catch (err) {
            return err.message;
          }
          return score;
        }
      `;
      const res = transformJavaScript(criticalSource, {
        seed: 0xabcdef12,
        aggressive: true,
        critical: { annotation: '@unpeek-critical', maxFunctionsPerChunk: 1 },
      });
      expect(res.virtualizedFunctionsCount).toBe(1);
      expect(res.code).not.toContain('CRITICAL_ERR:');

      const ctx: Record<string, any> = { Error };
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(res.code, ctx);

      expect(ctx.regularColdHelper(3)).toBe('REGULAR_HELPER_PLAIN3');
      expect(ctx.criticalGate({ arguments: 5, ok: true, fail: false }, 1)).toBe(15);
      expect(ctx.criticalGate({ ok: true, fail: true }, 4)).toBe('CRITICAL_ERR:14');
      expect(ctx.criticalGate({ arguments: 0, ok: false, fail: false }, 7)).toBe(5);
    });

    it('AST hygiene: safe consecutive unary/update spacing (y + +!T * P), scrubber rootDir/[project]/Windows paths, and minimal Tier 1', () => {
      // 1. Unary/update operator spacing (Recharts pattern y + +!T * P)
      const unarySrc = `
        function calcChart(y, T, P, x) {
          var a = y + +!T * P;
          var b = x++ + +!T;
          var c = y - -P;
          return a + b + c;
        }
        return calcChart(10, 0, 5, 3);
      `;
      const unaryRes = transformJavaScript(unarySrc, { seed: 0x445566 });
      // Must parse with 0 SyntaxErrors and evaluate identically to original
      expect(() => acorn.parse(unaryRes.code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true })).not.toThrow();
      expect(new Function(unaryRes.code)()).toBe(new Function(unarySrc)());

      // 2. Scrubber rootDir + [project]/ + Windows C:\ paths
      const rootDir = 'C:\\Users\\developer\\Desktop\\secret-app';
      const pathSrc = `
        function getDiagnostics() {
          var a = "C:\\\\Users\\\\developer\\\\Desktop\\\\secret-app\\\\src\\\\auth.ts";
          var b = "[project]/src/billing/keys.ts";
          var c = "/Users/alice/projects/web/index.ts";
          var publicUrl = "https://cdn.example.com/assets/logo.png";
          return [a, b, c, publicUrl];
        }
        return getDiagnostics();
      `;
      const scrubbed = transformJavaScript(pathSrc, {
        seed: 0x778899,
        scrubPaths: true,
        rootDir,
        minStringLength: 1000, // Keep strings out of vault so scrubber result is directly inspectable
      });
      expect(scrubbed.code).not.toContain('C:\\\\Users\\\\developer');
      expect(scrubbed.code).not.toContain('[project]/src/billing');
      expect(scrubbed.code).not.toContain('/Users/alice');
      expect(scrubbed.code).toContain('https://cdn.example.com/assets/logo.png');

      // 3. minimal profile = Tier 1 (coldFlow: false, 0 cold-flow guards, minLength: 1)
      const minRes = transformJavaScript(
        `function secretCalc(a, b) { var c = a + b; return c * 2; } return secretCalc(3, 4);`,
        { seed: 0x1234, profile: 'minimal' }
      );
      expect(minRes.code).not.toContain('_uSb');
      expect(minRes.code).not.toContain('_uZt');
      expect(minRes.mangledSymbolsCount).toBeGreaterThanOrEqual(3);
      expect(new Function(minRes.code)()).toBe(14);
    });

    it('E2E Bundlers: Vite (minify:true/false + worker.plugins), Rollup, Webpack 5, Rspack, and esbuild transform client bundles with 0 no-ops', async () => {
      const secretToken = 'BUNDLER_E2E_SECRET_TOKEN_9999';

      // 1. esbuild (write: false & write: true)
      {
        const esbuild = await import('esbuild');
        const tmp = makeTmpDir('unpeek-esbuild-');
        const entry = path.join(tmp, 'index.js');
        fs.writeFileSync(
          entry,
          `export function getSecret() { return "${secretToken}"; }\nglobalThis.__esb = getSecret();\n`,
          'utf8'
        );

        const memOut = await esbuild.build({
          entryPoints: [entry],
          bundle: true,
          write: false,
          outfile: path.join(tmp, 'mem-bundle.js'),
          format: 'iife',
          plugins: [unpeekEsbuild({ seed: 0x101010, minStringLength: 4 }) as any],
        });
        const memJs = memOut.outputFiles[0].text;
        expect(memJs).not.toContain(secretToken);
        const esbCtx: Record<string, any> = {};
        esbCtx.globalThis = esbCtx;
        vm.createContext(esbCtx);
        vm.runInContext(memJs, esbCtx);
        expect(esbCtx.__esb).toBe(secretToken);

        const outFile = path.join(tmp, 'out', 'bundle.js');
        await esbuild.build({
          entryPoints: [entry],
          bundle: true,
          write: true,
          outfile: outFile,
          sourcemap: true,
          format: 'iife',
          plugins: [unpeekEsbuild({ seed: 0x101010, minStringLength: 4 }) as any],
        });
        const diskJs = fs.readFileSync(outFile, 'utf8');
        expect(diskJs).not.toContain(secretToken);
        expect(diskJs).not.toContain('sourceMappingURL=');
      }

      // 2. Rollup 4 (with [name]-[hash].js placeholder & { code, map })
      {
        const { rollup } = await import('rollup');
        const tmp = makeTmpDir('unpeek-rollup-');
        const entry = path.join(tmp, 'main.js');
        fs.writeFileSync(
          entry,
          `export function readVal() { return "${secretToken}"; }\nglobalThis.__rol = readVal();\n`,
          'utf8'
        );
        const bundle = await rollup({
          input: entry,
          plugins: [unpeekRollup({ seed: 0x202020, minStringLength: 4 }) as any],
        });
        const { output } = await bundle.generate({
          format: 'iife',
          entryFileNames: '[name]-[hash].js',
          sourcemap: true,
        });
        await bundle.close();
        const jsOut = output.find((o) => o.type === 'chunk')!;
        expect(jsOut.code).not.toContain(secretToken);
        expect(jsOut.map).toBeTruthy();
        const rolCtx: Record<string, any> = {};
        rolCtx.globalThis = rolCtx;
        vm.createContext(rolCtx);
        vm.runInContext(jsOut.code, rolCtx);
        expect(rolCtx.__rol).toBe(secretToken);
      }

      // 3. Vite 7 (minify: 'esbuild' and minify: false + worker.plugins)
      {
        const vite = await import('vite');
        for (const minifyMode of ['esbuild', false] as const) {
          const tmp = makeTmpDir(`unpeek-vite-${String(minifyMode)}-`);
          fs.writeFileSync(
            path.join(tmp, 'worker.js'),
            `self.onmessage = function() { return "${secretToken}_WORKER"; };`,
            'utf8'
          );
          fs.writeFileSync(
            path.join(tmp, 'main.js'),
            `import WorkerUrl from './worker.js?worker';
             export function getViteSecret() { return "${secretToken}"; }
             globalThis.__viteOut = getViteSecret();
             globalThis.__viteWorker = WorkerUrl;`,
            'utf8'
          );
          const buildRes = (await vite.build({
            root: tmp,
            logLevel: 'silent',
            plugins: [unpeekVite({ seed: 0x303030, minStringLength: 4 }) as any],
            build: {
              outDir: 'dist',
              minify: minifyMode,
              lib: { entry: path.join(tmp, 'main.js'), formats: ['iife'], name: 'App' },
            },
          })) as any;
          const outputs = Array.isArray(buildRes) ? buildRes[0].output : buildRes.output;
          const mainAsset = outputs.find((o: any) => o.type === 'chunk');
          expect(mainAsset.code).not.toContain(secretToken);
          const viteCtx: Record<string, any> = {
            Blob: class {},
            URL: { createObjectURL: () => '' },
            Worker: class {},
          };
          viteCtx.globalThis = viteCtx;
          viteCtx.window = viteCtx;
          viteCtx.self = viteCtx;
          vm.createContext(viteCtx);
          vm.runInContext(mainAsset.code, viteCtx);
          expect(viteCtx.__viteOut).toBe(secretToken);
        }
      }

      // 4. Webpack 5 (processAssets hook, 0 no-op)
      {
        const webpack = (await import('webpack')).default;
        const tmp = makeTmpDir('unpeek-webpack-');
        const entry = path.join(tmp, 'index.js');
        const outDir = path.join(tmp, 'dist');
        fs.writeFileSync(
          entry,
          `function wpSecret() { return "${secretToken}"; }\nglobalThis.__wpOut = wpSecret();\n`,
          'utf8'
        );
        await new Promise<void>((resolve, reject) => {
          const compiler = webpack({
            mode: 'production',
            entry,
            output: { path: outDir, filename: 'main.js' },
            devtool: 'source-map',
            plugins: [unpeekWebpack({ seed: 0x404040, minStringLength: 4 }) as any],
          });
          compiler.run((err, stats) => {
            compiler.close(() => {
              if (err) reject(err);
              else if (stats?.hasErrors()) reject(new Error(stats.toString()));
              else resolve();
            });
          });
        });
        const wpJs = fs.readFileSync(path.join(outDir, 'main.js'), 'utf8');
        expect(wpJs).not.toContain(secretToken);
        expect(wpJs).not.toContain('sourceMappingURL=');
        const wpCtx: Record<string, any> = {};
        wpCtx.globalThis = wpCtx;
        wpCtx.window = wpCtx;
        wpCtx.self = wpCtx;
        vm.createContext(wpCtx);
        vm.runInContext(wpJs, wpCtx);
        expect(wpCtx.__wpOut).toBe(secretToken);
      }

      // 5. Rspack 1.7 (processAssets hook, 0 no-op)
      {
        const { rspack } = await import('@rspack/core');
        const tmp = makeTmpDir('unpeek-rspack-');
        const entry = path.join(tmp, 'index.js');
        const outDir = path.join(tmp, 'dist');
        fs.writeFileSync(
          entry,
          `function rspSecret() { return "${secretToken}"; }\nglobalThis.__rspOut = rspSecret();\n`,
          'utf8'
        );
        await new Promise<void>((resolve, reject) => {
          const compiler = rspack({
            mode: 'production',
            entry,
            output: { path: outDir, filename: 'main.js' },
            devtool: 'source-map',
            plugins: [unpeekRspack({ seed: 0x505050, minStringLength: 4 }) as any],
          });
          compiler.run((err, stats) => {
            compiler.close(() => {
              if (err) reject(err);
              else if (stats?.hasErrors()) reject(new Error(stats.toString()));
              else resolve();
            });
          });
        });
        const rspJs = fs.readFileSync(path.join(outDir, 'main.js'), 'utf8');
        expect(rspJs).not.toContain(secretToken);
        expect(rspJs).not.toContain('sourceMappingURL=');
        const rspCtx: Record<string, any> = {};
        rspCtx.globalThis = rspCtx;
        rspCtx.window = rspCtx;
        rspCtx.self = rspCtx;
        vm.createContext(rspCtx);
        vm.runInContext(rspJs, rspCtx);
        expect(rspCtx.__rspOut).toBe(secretToken);
      }
    }, 30_000);
  });
});
