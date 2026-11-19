import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { loadUnpeekConfig, type UnpeekConfig } from '../src/config.js';
import { mergeUnpeekConfig, DEFAULT_CONFIG } from '../src/internal/config.js';
import { scanClientBundles } from '../src/core/detector.js';
import * as detectorMod from '../src/core/detector.js';
import { protectProject } from '../src/core/protect.js';
import { checkProject } from '../src/core/check.js';
import { generateRuntimeShield } from '../src/runtime/index.js';
import { unpeekPlugin } from '../src/plugins/unplugin.js';
import { runCli } from '../src/cli/index.js';
import { UnpeekError } from '../src/shared/errors.js';
import * as astMod from '../src/ast/index.js';

describe('Audit P2 Core, CLI, Config & Contracts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-audit-p2-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. Frozen Contracts & Runtime Shield expectedStateHash', () => {
    it('generateRuntimeShield returns expectedStateHash bit-identical to sym_s[1] at t=0', () => {
      const seed = 0x13572468;
      const payload = generateRuntimeShield({
        seed,
        deterrentMode: 'passive',
        detectHeadless: false,
      });

      expect(typeof payload.expectedStateHash).toBe('number');
      expect(payload.windowKeySymbol).toBeDefined();
      expect(payload.stateKeySymbol).toBe(`${payload.windowKeySymbol}_s`);

      const sandbox: Record<string, any> = {
        Object,
        Function,
        Reflect,
        String,
        Math,
        CustomEvent: class CustomEvent {
          type: string;
          constructor(type: string) {
            this.type = type;
          }
        },
        navigator: { userAgent: 'Mozilla/5.0', webdriver: false },
        dispatchEvent: () => true,
      };
      sandbox.window = sandbox;
      sandbox.self = sandbox;
      sandbox.globalThis = sandbox;

      vm.runInNewContext(payload.preambleCode, sandbox);
      const stateTuple = sandbox[payload.stateKeySymbol!];
      expect(Array.isArray(stateTuple)).toBe(true);
      expect(stateTuple[0]).toBe(1);
      expect(stateTuple[1] | 0).toBe(payload.expectedStateHash! | 0);
    });
  });

  describe('2. P1a Standard Glob Filtering (detector & unplugin)', () => {
    it('matchesGlobPattern supports POSIX normalization, **, *, ?, {a,b}, and basename fallback', () => {
      const matchesGlobPattern = (detectorMod as any).matchesGlobPattern as
        | ((relPath: string, pattern: string) => boolean)
        | undefined;
      expect(typeof matchesGlobPattern).toBe('function');

      expect(matchesGlobPattern!('chunks\\vendor\\lib.js', 'chunks/vendor/**')).toBe(true);
      expect(matchesGlobPattern!('app.test.js', '**/*.test.*')).toBe(true);
      expect(matchesGlobPattern!('nested/dir/app.test.js', '**/*.test.*')).toBe(true);
      expect(matchesGlobPattern!('chunks/app.js', 'chunks/*.js')).toBe(true);
      expect(matchesGlobPattern!('chunks/sub/app.js', 'chunks/*.js')).toBe(false);
      expect(matchesGlobPattern!('a/b/c.js', 'a/?/c.js')).toBe(true);
      expect(matchesGlobPattern!('a/bb/c.js', 'a/?/c.js')).toBe(false);
      expect(matchesGlobPattern!('sub/mod.spec.mjs', '**/*.{test,spec}.{js,mjs}')).toBe(true);
      expect(matchesGlobPattern!('sub/mod.spec.cjs', '**/*.{test,spec}.{js,mjs}')).toBe(false);
      expect(matchesGlobPattern!('chunks/legacy.vendor.js', '*.vendor.js')).toBe(true);
      expect(matchesGlobPattern!('chunks/legacy.vendor.js', 'legacy.vendor.js')).toBe(true);
      expect(matchesGlobPattern!('other/chunks/app.js', 'chunks/*.js')).toBe(false);
    });

    it('scanClientBundles applies config.filter.include and config.filter.exclude', () => {
      const outDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(path.join(outDir, 'chunks'), { recursive: true });
      fs.mkdirSync(path.join(outDir, 'vendor'), { recursive: true });

      fs.writeFileSync(path.join(outDir, 'main.js'), 'console.log("main");', 'utf8');
      fs.writeFileSync(path.join(outDir, 'chunks', 'app.js'), 'console.log("app");', 'utf8');
      fs.writeFileSync(path.join(outDir, 'chunks', 'app.spec.js'), 'console.log("spec");', 'utf8');
      fs.writeFileSync(path.join(outDir, 'vendor', 'lib.js'), 'console.log("lib");', 'utf8');

      const config: UnpeekConfig = {
        filter: {
          include: ['chunks/**', 'main.js'],
          exclude: ['**/*.spec.*'],
        },
      };

      const matched = scanClientBundles(outDir, config).map((f) =>
        path.relative(outDir, f).replace(/\\/g, '/')
      );
      expect(matched).toEqual(['chunks/app.js', 'main.js']);
    });

    it('unplugin respects config.filter.include and config.filter.exclude', () => {
      const rawInstance = unpeekPlugin.raw(
        {
          seed: 42,
          injectRuntimeShield: false,
          config: {
            filter: {
              include: ['chunks/*.js'],
              exclude: ['**/skip-*.js'],
            },
          },
        },
        { framework: 'vite' } as any
      );
      const pluginObj = Array.isArray(rawInstance) ? rawInstance[0] : rawInstance;
      const renderChunk = pluginObj.renderChunk as any;

      const sampleCode = 'function f() { return "secret_value_here"; }';
      expect(renderChunk(sampleCode, { fileName: 'vendor/other.js', isEntry: false })).toBeNull();
      expect(renderChunk(sampleCode, { fileName: 'chunks/skip-one.js', isEntry: false })).toBeNull();

      const kept = renderChunk(sampleCode, { fileName: 'chunks/keep.js', isEntry: false });
      expect(kept).not.toBeNull();
      expect(kept.code).not.toContain('secret_value_here');
    });
  });

  describe('3. P2b UnpeekConfig.seed Validation & Propagation', () => {
    it('validates and merges UnpeekConfig.seed in mergeUnpeekConfig and loadUnpeekConfig', async () => {
      const merged = mergeUnpeekConfig(DEFAULT_CONFIG, { seed: 424242 } as UnpeekConfig);
      expect((merged as any).seed).toBe(424242);

      const overridden = mergeUnpeekConfig(merged, { seed: 999 } as UnpeekConfig);
      expect((overridden as any).seed).toBe(999);

      expect(() =>
        mergeUnpeekConfig(DEFAULT_CONFIG, { seed: Number.NaN } as UnpeekConfig)
      ).toThrowError(UnpeekError);

      const validDir = path.join(tmpDir, 'valid-seed');
      fs.mkdirSync(validDir, { recursive: true });
      fs.writeFileSync(path.join(validDir, 'unpeek.config.json'), JSON.stringify({ seed: 777111 }));
      const loaded = await loadUnpeekConfig(validDir);
      expect((loaded as any).seed).toBe(777111);

      const invalidDir = path.join(tmpDir, 'invalid-seed');
      fs.mkdirSync(invalidDir, { recursive: true });
      fs.writeFileSync(
        path.join(invalidDir, 'unpeek.config.json'),
        JSON.stringify({ seed: 'not-a-number' })
      );
      await expect(loadUnpeekConfig(invalidDir)).rejects.toMatchObject({
        code: 'ERR_CONFIG_INVALID',
      });
    });

    it('protectProject and unplugin use options.seed ?? config.seed deterministically', async () => {
      const distA = path.join(tmpDir, 'proj-a', 'dist');
      const distB = path.join(tmpDir, 'proj-b', 'dist');
      fs.mkdirSync(distA, { recursive: true });
      fs.mkdirSync(distB, { recursive: true });

      const src = 'export function getApi() { return "secret_config_seed_value"; }';
      fs.writeFileSync(path.join(tmpDir, 'proj-a', 'unpeek.config.json'), JSON.stringify({ seed: 551122 }));
      fs.writeFileSync(path.join(tmpDir, 'proj-b', 'unpeek.config.json'), JSON.stringify({ seed: 551122 }));
      fs.writeFileSync(path.join(distA, 'main.js'), src, 'utf8');
      fs.writeFileSync(path.join(distB, 'main.js'), src, 'utf8');

      const sumA = await protectProject({ cwd: path.join(tmpDir, 'proj-a'), outDir: 'dist' });
      const sumB = await protectProject({ cwd: path.join(tmpDir, 'proj-b'), outDir: 'dist' });
      expect(sumA.seed).toBe(551122);
      expect(sumB.seed).toBe(551122);
      expect(fs.readFileSync(path.join(distA, 'main.js'), 'utf8')).toBe(
        fs.readFileSync(path.join(distB, 'main.js'), 'utf8')
      );

      const sumOverride = await protectProject({
        cwd: path.join(tmpDir, 'proj-a'),
        outDir: 'dist',
        seed: 888999,
      });
      expect(sumOverride.seed).toBe(888999);

      const p1 = unpeekPlugin.raw({ config: { seed: 314159 } as UnpeekConfig }, { framework: 'vite' } as any);
      const p2 = unpeekPlugin.raw({ config: { seed: 314159 } as UnpeekConfig }, { framework: 'vite' } as any);
      const rc1 = (Array.isArray(p1) ? p1[0] : p1).renderChunk as any;
      const rc2 = (Array.isArray(p2) ? p2[0] : p2).renderChunk as any;
      expect(rc1(src, { fileName: 'main.js', isEntry: true }).code).toBe(
        rc2(src, { fileName: 'main.js', isEntry: true }).code
      );
    });
  });

  describe('4. P0 Early originalMap & Auto Deterministic debugId', () => {
    it('passes originalSourceMap and expectedStateHash into transformJavaScript in protectProject and unplugin', async () => {
      const distDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.unpeek-maps/\n', 'utf8');
      fs.writeFileSync(
        path.join(distDir, 'main.js'),
        'function secretAction() { return "secret_token_early_map"; }\n//# sourceMappingURL=main.js.map\n',
        'utf8'
      );
      const rawMap = {
        version: 3,
        sources: ['src/secret.ts'],
        names: ['secretAction'],
        mappings: 'AAAA',
      };
      fs.writeFileSync(path.join(distDir, 'main.js.map'), JSON.stringify(rawMap), 'utf8');

      const spy = vi.spyOn(astMod, 'transformJavaScript');
      await protectProject({ cwd: tmpDir, outDir: 'dist', seed: 123456 });

      expect(spy).toHaveBeenCalled();
      const firstCallOpts = spy.mock.calls[0]?.[1] as any;
      expect(firstCallOpts.originalSourceMap).toMatchObject({
        sources: ['src/secret.ts'],
        names: ['secretAction'],
      });
      expect(typeof firstCallOpts.expectedStateHash).toBe('number');

      spy.mockClear();
      const rawPlugin = unpeekPlugin.raw({ seed: 123456 }, { framework: 'webpack' } as any);
      const pluginObj = Array.isArray(rawPlugin) ? rawPlugin[0] : rawPlugin;
      let processAssetsCb: any;
      const fakeCompiler = {
        webpack: { Compilation: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: 700 } },
        hooks: {
          thisCompilation: {
            tap: (_name: string, fn: any) =>
              fn({
                hooks: {
                  processAssets: {
                    tap: (_opts: any, cb: any) => {
                      processAssetsCb = cb;
                    },
                  },
                },
                entrypoints: new Map(),
                chunks: [],
              }),
          },
        },
      };
      (pluginObj.webpack as any)(fakeCompiler);
      processAssetsCb({
        'main.js': { source: () => 'function f() { return "wp_secret"; }' },
        'main.js.map': { source: () => JSON.stringify(rawMap) },
      });

      expect(spy).toHaveBeenCalled();
      const wpOpts = spy.mock.calls[0]?.[1] as any;
      expect(wpOpts.originalSourceMap).toMatchObject({
        sources: ['src/secret.ts'],
      });
      expect(typeof wpOpts.expectedStateHash).toBe('number');
    });

    it('auto-mints deterministic debugId when keepPrivateMaps is true even without pre-existing debugId or input .map', async () => {
      const distDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.unpeek-maps/\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, '.dockerignore'), '.unpeek-maps/\n', 'utf8');

      const bundlePath = path.join(distDir, 'app.js');
      fs.writeFileSync(
        bundlePath,
        'export function computePrice(n) { return "PRICE_KEY_" + n; }\n',
        'utf8'
      );

      const summary = await protectProject({
        cwd: tmpDir,
        outDir: 'dist',
        seed: 0x224466,
        keepPrivateMaps: true,
      });

      expect(summary.debugIdsPreserved).toBe(1);
      const protectedCode = fs.readFileSync(bundlePath, 'utf8');
      const match = protectedCode.match(/\/\/# debugId=([0-9a-f-]+)/i);
      expect(match).not.toBeNull();

      const vaultedMapPath = path.join(tmpDir, '.unpeek-maps', 'app.js.map');
      expect(fs.existsSync(vaultedMapPath)).toBe(true);
      const vaultedMap = JSON.parse(fs.readFileSync(vaultedMapPath, 'utf8'));
      expect(vaultedMap.debugId).toBe(match![1]);

      const checkRes = await checkProject({ cwd: tmpDir, outDir: 'dist' });
      expect(checkRes.passed).toBe(true);
      expect(checkRes.warnings.some((w) => w.rule === 'debugid-mismatch')).toBe(false);

      // unplugin also mints deterministic debugId when requestMap is true
      const rawInst = unpeekPlugin.raw({ seed: 0x224466 }, { framework: 'rollup' } as any);
      const pluginObj = Array.isArray(rawInst) ? rawInst[0] : rawInst;
      const chunkRes = (pluginObj.renderChunk as any)(
        'export function fn() { return "rollup_secret_value"; }',
        { fileName: 'app.js', isEntry: true }
      );
      const chunkMatch = chunkRes.code.match(/\/\/# debugId=([0-9a-f-]+)/i);
      expect(chunkMatch).not.toBeNull();
      expect(chunkRes.map?.debugId).toBe(chunkMatch![1]);
    });

    it('does not auto-mint debugId when keepPrivateMaps is false or file is empty/parse-error', async () => {
      const distDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, 'clean.js'), 'export function x() { return "secret_no_maps"; }', 'utf8');

      const noMapsSummary = await protectProject({
        cwd: tmpDir,
        outDir: 'dist',
        seed: 101,
        keepPrivateMaps: false,
      });
      expect(noMapsSummary.debugIdsPreserved).toBe(0);
      expect(fs.readFileSync(path.join(distDir, 'clean.js'), 'utf8')).not.toContain('debugId=');

      const brokenDir = path.join(tmpDir, 'broken');
      fs.mkdirSync(brokenDir, { recursive: true });
      fs.writeFileSync(path.join(brokenDir, 'empty.js'), '   ', 'utf8');
      fs.writeFileSync(path.join(brokenDir, 'bad.js'), 'function ( { broken syntax', 'utf8');

      const brokenSummary = await protectProject({
        cwd: tmpDir,
        outDir: 'broken',
        seed: 102,
        keepPrivateMaps: true,
      });
      expect(brokenSummary.debugIdsPreserved).toBe(0);
      expect(fs.readFileSync(path.join(brokenDir, 'empty.js'), 'utf8')).not.toContain('debugId=');
      expect(fs.readFileSync(path.join(brokenDir, 'bad.js'), 'utf8')).not.toContain('debugId=');
    });
  });

  describe('5. P2b CLI Tier 1-3 Labels, Help Alignment & Shield Summary', () => {
    it('prints Tier 1, Tier 2, Tier 3 accurately and shows effective deterrentMode + detectHeadless in shield row', async () => {
      const distDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'cli-tier-audit', scripts: { build: 'vite build' } }),
        'utf8'
      );
      const bundlePath = path.join(distDir, 'main.js');
      const origBundle = 'function verify() { return "cli_tier_secret_val"; }';

      const origLog = console.log;
      let logs: string[] = [];
      console.log = (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      };

      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);

        // Help lists Tier 1, Tier 2, and Tier 3
        logs = [];
        await runCli(['--help']);
        const helpOut = logs.join('\n');
        expect(helpOut).toContain('Tier 1');
        expect(helpOut).toContain('Tier 2');
        expect(helpOut).toContain('Tier 3');

        // Tier 1 (minimal)
        fs.writeFileSync(bundlePath, origBundle, 'utf8');
        logs = [];
        await runCli(['protect', '--out-dir', 'dist', '--profile', 'minimal', '--seed', '11']);
        const out1 = logs.join('\n');
        expect(out1).toContain('Tier 1 (minimal: <2% CPU, <15% Gzip)');
        expect(out1).toMatch(/shield\s+passive.*detectHeadless:\s*off/i);

        // Tier 2 (recommended / default)
        fs.writeFileSync(bundlePath, origBundle, 'utf8');
        logs = [];
        await runCli(['protect', '--out-dir', 'dist', '--seed', '22']);
        const out2 = logs.join('\n');
        expect(out2).toContain('Tier 2 (recommended: string vault & cold-flow)');
        expect(out2).toMatch(/shield\s+passive.*detectHeadless:\s*off/i);

        // Tier 3 (--aggressive + --gradual + --detect-headless)
        fs.writeFileSync(bundlePath, origBundle, 'utf8');
        logs = [];
        await runCli([
          'protect',
          '--out-dir',
          'dist',
          '--aggressive',
          '--gradual',
          '--detect-headless',
          '--seed',
          '33',
        ]);
        const out3 = logs.join('\n');
        expect(out3).toContain('Tier 3 (strict / --aggressive: Micro-VM & WASM KDF)');
        expect(out3).toMatch(/shield\s+gradual.*detectHeadless:\s*on/i);
      } finally {
        process.chdir(origCwd);
        console.log = origLog;
      }
    });
  });
});
