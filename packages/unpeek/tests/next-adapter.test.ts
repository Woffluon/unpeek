import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  createUnpeekNextAdapter,
  withUnpeek,
  getUnpeekAdapterPath,
} from '../src/next/index.js';
import { initProject, isNext16OrAbove } from '../src/cli/init.js';

describe('Next.js 16+ Build Adapter & onBuildComplete Lifecycle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-next16-'));
  });

  afterEach(() => {
    delete process.env.UNPEEK_UPSTREAM_ADAPTER_PATH;
    delete process.env.NEXT_ADAPTER_PATH;
    delete (globalThis as any).__unpeekNextOptions;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('correctly identifies Next.js 16.2+ versions and excludes < 16.2', () => {
    expect(isNext16OrAbove('16.4.6')).toBe(true);
    expect(isNext16OrAbove('^16.2.0')).toBe(true);
    expect(isNext16OrAbove('~16.3.1')).toBe(true);
    expect(isNext16OrAbove('17.0.0')).toBe(true);
    expect(isNext16OrAbove('^16.1.9')).toBe(false);
    expect(isNext16OrAbove('15.5.28')).toBe(false);
    expect(isNext16OrAbove('^15.2.0')).toBe(false);
    expect(isNext16OrAbove(undefined)).toBe(false);
  });

  it('unpeek init on Next.js 16.2+ injects withUnpeek into next.config, ignores postbuild, and vaults gitignore', () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({
        name: 'next16-app',
        dependencies: {
          next: '16.4.6',
          react: '19.0.0',
        },
        scripts: {
          build: 'next build',
        },
      }),
      'utf8'
    );

    const nextConfigPath = path.join(tmpDir, 'next.config.mjs');
    fs.writeFileSync(
      nextConfigPath,
      'const nextConfig = { reactStrictMode: true };\nexport default nextConfig;\n',
      'utf8'
    );

    // 1. Dry run
    const dryRes = initProject(tmpDir, { dryRun: true });
    expect(dryRes.isNext162Plus).toBe(true);
    expect(dryRes.updatedNextConfig).toBe(true);
    expect(dryRes.updatedPackageJson).toBe(false);
    expect(fs.readFileSync(nextConfigPath, 'utf8')).not.toContain('withUnpeek');

    // 2. Real run
    const res = initProject(tmpDir);
    expect(res.isNext162Plus).toBe(true);
    expect(res.updatedNextConfig).toBe(true);
    expect(res.updatedPackageJson).toBe(false); // No postbuild script needed for Next.js 16 Build Adapter!
    expect(res.updatedGitignore).toBe(true);

    const updatedConfig = fs.readFileSync(nextConfigPath, 'utf8');
    expect(updatedConfig).toContain("import { withUnpeek } from 'unpeek/next';");
    expect(updatedConfig).toContain('export default withUnpeek(nextConfig);');

    const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(updatedPkg.scripts.postbuild).toBeUndefined();

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.unpeek-maps/');

    // 3. Idempotent re-run
    const reRes = initProject(tmpDir);
    expect(reRes.updatedNextConfig).toBe(false);
    expect(reRes.updatedPackageJson).toBe(false);
    expect(reRes.updatedGitignore).toBe(false);
  });

  it('unpeek init on Next.js 16.2+ CJS next.config.js injects require and wraps module.exports', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'next16-cjs-app',
        dependencies: { next: '^16.2.0' },
      }),
      'utf8'
    );
    const nextConfigPath = path.join(tmpDir, 'next.config.js');
    fs.writeFileSync(nextConfigPath, 'const nextConfig = {};\nmodule.exports = nextConfig;\n', 'utf8');

    initProject(tmpDir);

    const updated = fs.readFileSync(nextConfigPath, 'utf8');
    expect(updated).toContain("const { withUnpeek } = require('unpeek/next');");
    expect(updated).toContain('module.exports = withUnpeek(nextConfig);');
  });

  it('unpeek init on Next.js 15 uses traditional postbuild script', () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({
        name: 'next15-app',
        dependencies: { next: '^15.2.0' },
        scripts: { build: 'next build' },
      }),
      'utf8'
    );
    const nextConfigPath = path.join(tmpDir, 'next.config.mjs');
    fs.writeFileSync(nextConfigPath, 'export default {};\n', 'utf8');

    const res = initProject(tmpDir);
    expect(res.isNext162Plus).toBe(false);
    expect(res.updatedPackageJson).toBe(true);
    expect(res.updatedNextConfig).toBe(false);

    const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(updatedPkg.scripts.postbuild).toBe('unpeek protect');
    expect(fs.readFileSync(nextConfigPath, 'utf8')).not.toContain('withUnpeek');
  });

  it('withUnpeek attaches adapterPath and chains existing adapterPath or NEXT_ADAPTER_PATH', async () => {
    // 1. Basic config object
    const cfg = withUnpeek({ reactStrictMode: true });
    expect(cfg.reactStrictMode).toBe(true);
    expect(typeof cfg.adapterPath).toBe('string');
    expect(cfg.adapterPath).toContain('adapter');

    // 2. Chaining user adapterPath
    const cfgWithExisting = withUnpeek({
      reactStrictMode: true,
      adapterPath: './custom-adapter.js',
    });
    expect(process.env.UNPEEK_UPSTREAM_ADAPTER_PATH).toBe('./custom-adapter.js');
    expect(typeof cfgWithExisting.adapterPath).toBe('string');

    // 3. Functional next.config
    delete process.env.UNPEEK_UPSTREAM_ADAPTER_PATH;
    process.env.NEXT_ADAPTER_PATH = '/vercel/adapter.js';
    const fnConfig = withUnpeek(async (phase: string) => ({ phase, poweredByHeader: false }));
    const resolved = await fnConfig('phase-production-build');
    expect(resolved.poweredByHeader).toBe(false);
    expect(typeof resolved.adapterPath).toBe('string');
    expect(process.env.UNPEEK_UPSTREAM_ADAPTER_PATH).toBe('/vercel/adapter.js');
  });

  it('onBuildComplete protects static chunks under /_next/static, leaves /_next/server untouched, vaults sourcemaps, updates immutableHash, and delegates to upstream adapter', async () => {
    const distDir = path.join(tmpDir, '.next');
    const staticChunksDir = path.join(distDir, 'static', 'chunks');
    const staticImmutableDir = path.join(distDir, 'static', 'immutable');
    const serverAppDir = path.join(distDir, 'server', 'app');

    fs.mkdirSync(staticChunksDir, { recursive: true });
    fs.mkdirSync(staticImmutableDir, { recursive: true });
    fs.mkdirSync(serverAppDir, { recursive: true });

    // Client static chunk with sourcemap comment
    const clientChunkFile = path.join(staticChunksDir, 'main-client-xyz.js');
    const clientMapFile = path.join(staticChunksDir, 'main-client-xyz.js.map');
    const originalClientCode =
      'const API_KEY = "SECRET_SUPER_TOKEN_12345"; export function fetchProfile() { return API_KEY; }\n' +
      '//# sourceMappingURL=main-client-xyz.js.map\n';
    fs.writeFileSync(clientChunkFile, originalClientCode, 'utf8');
    fs.writeFileSync(clientMapFile, '{"version":3,"sources":["main-client.ts"]}', 'utf8');

    // Immutable static asset under static/immutable/
    const immutableChunkFile = path.join(staticImmutableDir, 'framework-abc.js');
    const originalImmutableCode = 'export const FRAMEWORK_TOKEN = "IMMUTABLE_ASSET_SECRET_KEY";';
    fs.writeFileSync(immutableChunkFile, originalImmutableCode, 'utf8');

    // Server-side SSR route (must be untouched)
    const serverFile = path.join(serverAppDir, 'page.js');
    const originalServerCode = 'export async function GET() { return { db: "secret_db_uri" }; }';
    fs.writeFileSync(serverFile, originalServerCode, 'utf8');

    // Mock upstream adapter to verify delegation
    const upstreamAdapterPath = path.join(tmpDir, 'mock-upstream-adapter.mjs');
    let upstreamCalled = false;
    fs.writeFileSync(
      upstreamAdapterPath,
      `export default {
        name: 'mock-platform',
        async onBuildComplete(ctx) {
          globalThis.__mockUpstreamCalled = true;
        }
      };`,
      'utf8'
    );

    // Initial dummy immutableHash for the immutable chunk
    const initialHash = crypto.createHash('sha256').update(Buffer.from(originalImmutableCode)).digest('hex');

    const mockOutputs = {
      staticFiles: [
        {
          filePath: path.join('.next', 'static', 'immutable', 'framework-abc.js'),
          immutableHash: initialHash,
          size: Buffer.byteLength(originalImmutableCode),
        },
      ],
    };

    const adapter = createUnpeekNextAdapter({
      cwd: tmpDir,
      upstreamAdapterPath,
      keepPrivateMaps: true,
    });

    const summary = await adapter.onBuildComplete({
      distDir: '.next',
      buildId: 'build-id-deterministic-test-999',
      outputs: mockOutputs,
    });

    expect(summary.processedFiles).toBe(2);
    expect(summary.movedSourceMaps).toBe(1);

    // 1. Client chunk modified, sourcemap comment stripped, secret encrypted
    const protectedClientCode = fs.readFileSync(clientChunkFile, 'utf8');
    expect(protectedClientCode).not.toContain('SECRET_SUPER_TOKEN_12345');
    expect(protectedClientCode).not.toContain('sourceMappingURL=');
    expect(fs.existsSync(clientMapFile)).toBe(false);

    // Vault contains the relocated map
    const vaultedMaps = fs.readdirSync(path.join(tmpDir, '.unpeek-maps'));
    expect(vaultedMaps.length).toBeGreaterThanOrEqual(1);

    // 2. Immutable static chunk under static/immutable/ is protected
    const protectedImmutableCode = fs.readFileSync(immutableChunkFile, 'utf8');
    expect(protectedImmutableCode).not.toContain('IMMUTABLE_ASSET_SECRET_KEY');

    // 3. outputs.staticFiles immutableHash and size are updated
    const updatedStaticEntry = mockOutputs.staticFiles[0];
    expect(updatedStaticEntry.immutableHash).not.toBe(initialHash);
    const expectedNewHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(immutableChunkFile))
      .digest('hex');
    expect(updatedStaticEntry.immutableHash).toBe(expectedNewHash);
    expect(updatedStaticEntry.size).toBe(fs.readFileSync(immutableChunkFile).byteLength);

    // 4. Server bundle is 100% untouched
    expect(fs.readFileSync(serverFile, 'utf8')).toBe(originalServerCode);

    // 5. Upstream platform adapter onBuildComplete was invoked
    expect((globalThis as any).__mockUpstreamCalled).toBe(true);
    delete (globalThis as any).__mockUpstreamCalled;
  });

  it('adapter entry module exports default adapter and named lifecycle methods', async () => {
    const adapterMod = await import('../src/next/adapter.js');
    expect(adapterMod.name).toBe('unpeek');
    expect(typeof adapterMod.onBuildComplete).toBe('function');
    expect(typeof adapterMod.modifyConfig).toBe('function');
    expect(typeof adapterMod.default.onBuildComplete).toBe('function');

    const withUnpeekMod = await import('../src/next/with-unpeek.js');
    expect(typeof withUnpeekMod.withUnpeek).toBe('function');
    expect(typeof withUnpeekMod.createUnpeekNextAdapter).toBe('function');
  });
});
