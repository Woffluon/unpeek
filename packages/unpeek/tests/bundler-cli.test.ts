import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initProject,
  protectProject,
  UnpeekError,
} from '../src/index.js';
import {
  detectTargetFramework,
  scanClientBundles,
} from '../src/core/detector.js';
import { unpeekPlugin } from '../src/plugins/unplugin.js';

describe('Bundler Detection, Zero-Code-Change CLI (init & protect), and Unplugin', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('unpeek init injects postbuild hook into package.json and adds .unpeek-maps/ to .gitignore', () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({
        name: 'sample-vite-app',
        scripts: {
          build: 'vite build',
        },
        devDependencies: {
          vite: '^6.0.0',
        },
      }),
      'utf8'
    );

    const res = initProject(tmpDir);
    expect(res.updatedPackageJson).toBe(true);
    expect(res.updatedGitignore).toBe(true);

    const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(updatedPkg.scripts.postbuild).toBe('unpeek protect');

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.unpeek-maps/');
  });

  it('protects Next.js client chunks (.next/static/chunks), leaves SSR (.next/server) untouched, and vaults .map files', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-next-app',
        dependencies: { next: '15.2.0', react: '19.0.0' },
      }),
      'utf8'
    );

    const clientChunksDir = path.join(tmpDir, '.next', 'static', 'chunks');
    const serverAppDir = path.join(tmpDir, '.next', 'server', 'app');
    fs.mkdirSync(clientChunksDir, { recursive: true });
    fs.mkdirSync(serverAppDir, { recursive: true });

    const clientFile = path.join(clientChunksDir, 'app-client.js');
    const clientMapFile = path.join(clientChunksDir, 'app-client.js.map');
    const serverFile = path.join(serverAppDir, 'page-ssr.js');

    const originalClientCode = `
      const SECRET_API_ENDPOINT = "https://api.secret-saas.io/v1/checkout";
      export function submitCheckout(orderToken) {
        return SECRET_API_ENDPOINT + "?token=" + orderToken;
      }
      ` + '//#' + ' sourceMappingURL=app-client.js.map\n';
    const originalServerCode = `
      export async function getServerSideData() {
        return { dbSecret: "postgres://internal:5432/prod" };
      }
    `;

    fs.writeFileSync(clientFile, originalClientCode, 'utf8');
    fs.writeFileSync(clientMapFile, '{"version":3,"sources":["app-client.ts"]}', 'utf8');
    fs.writeFileSync(serverFile, originalServerCode, 'utf8');

    const detected = detectTargetFramework(tmpDir);
    expect(detected.framework).toBe('nextjs');

    const summary = await protectProject({
      cwd: tmpDir,
      seed: 0x55aa11,
      keepPrivateMaps: true,
    });

    expect(summary.framework).toBe('nextjs');
    expect(summary.processedFiles).toBe(1);
    expect(summary.movedSourceMaps).toBe(1);

    // 1. Public source map must be removed from .next/static/chunks and vaulted in .unpeek-maps
    expect(fs.existsSync(clientMapFile)).toBe(false);
    const vaultedFiles = fs.readdirSync(path.join(tmpDir, '.unpeek-maps'));
    expect(vaultedFiles.length).toBeGreaterThanOrEqual(1);

    // 2. Client bundle must have sourceMappingURL stripped and secret string encrypted
    const protectedClientCode = fs.readFileSync(clientFile, 'utf8');
    expect(protectedClientCode).not.toContain('sourceMappingURL');
    expect(protectedClientCode).not.toContain('https://api.secret-saas.io/v1/checkout');

    // 3. Server / SSR bundle must remain 100% untouched
    const afterServerCode = fs.readFileSync(serverFile, 'utf8');
    expect(afterServerCode).toBe(originalServerCode);
  });

  it('protects Vite and Vanilla projects automatically without configuration', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'sample-vite-app',
        devDependencies: { vite: '^6.0.0' },
      }),
      'utf8'
    );

    const assetsDir = path.join(tmpDir, 'dist', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const entryJs = path.join(assetsDir, 'index-abc123.js');
    fs.writeFileSync(
      entryJs,
      `function initAuth(tokenValue) { const key = "vite_private_token_key"; return key + tokenValue; }`,
      'utf8'
    );

    const summary = await protectProject({ cwd: tmpDir, seed: 999 });
    expect(summary.framework).toBe('vite');
    expect(summary.processedFiles).toBe(1);

    const outCode = fs.readFileSync(entryJs, 'utf8');
    expect(outCode).not.toContain('vite_private_token_key');
    expect(scanClientBundles(path.join(tmpDir, 'dist')).length).toBe(1);
  });

  it('exposes universal bundler plugin via unplugin (vite, webpack, rollup, esbuild)', () => {
    expect(typeof unpeekPlugin.vite).toBe('function');
    expect(typeof unpeekPlugin.webpack).toBe('function');
    expect(typeof unpeekPlugin.rollup).toBe('function');
    expect(typeof unpeekPlugin.esbuild).toBe('function');

    const rawInstance = unpeekPlugin.raw({ seed: 12345, deterrentMode: 'passive' }, { framework: 'vite' } as any);
    const pluginObj = Array.isArray(rawInstance) ? rawInstance[0] : rawInstance;
    expect(pluginObj.name).toBe('unpeek');
    if (pluginObj.renderChunk) {
      const chunkRes = (pluginObj.renderChunk as any)(
        'function checkSecret(tokenArg) { const s = "top_secret_val"; return s + tokenArg; }',
        { fileName: 'assets/main.js', isEntry: true }
      );
      expect(chunkRes?.code).toBeDefined();
      expect(chunkRes.code).not.toContain('top_secret_val');
    }
  });

  it('executes CLI commands (--help, --version, init, protect) cleanly', async () => {
    const { runCli } = await import('../src/cli/index.js');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'cli-test-app', scripts: { build: 'vite build' } }),
      'utf8'
    );
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'bundle.js'),
      'function authFlow(userKey) { return "secret_prefix_" + userKey; }',
      'utf8'
    );

    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      await runCli(['--help']);
      await runCli(['--version']);
      await runCli(['init']);
      await runCli(['protect', '--out-dir', 'dist', '--seed', '777', '--passive']);
    } finally {
      process.chdir(origCwd);
    }

    const updatedBundle = fs.readFileSync(path.join(distDir, 'bundle.js'), 'utf8');
    expect(updatedBundle).not.toContain('secret_prefix_');
  });

  it('initProject preserves tab indentation and supports dryRun without modifying files', () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    const tabIndentedPkg = '{\n\t"name": "tab-app",\n\t"devDependencies": {\n\t\t"vite": "^6.0.0"\n\t},\n\t"scripts": {\n\t\t"build": "vite"\n\t}\n}\n';
    fs.writeFileSync(pkgPath, tabIndentedPkg, 'utf8');

    // Dry run first
    const dryRes = initProject(tmpDir, { dryRun: true });
    expect(dryRes.updatedPackageJson).toBe(true);
    expect(dryRes.message).toContain('dry-run');
    expect(dryRes.message).toContain('vite');
    // package.json should remain unchanged after dry-run
    expect(fs.readFileSync(pkgPath, 'utf8')).toBe(tabIndentedPkg);
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);

    // Actual run
    const actualRes = initProject(tmpDir);
    expect(actualRes.updatedPackageJson).toBe(true);
    expect(actualRes.message).toContain('vite');
    const writtenContent = fs.readFileSync(pkgPath, 'utf8');
    expect(writtenContent).toContain('\t"scripts": {');
    expect(writtenContent).toContain('\t\t"postbuild": "unpeek protect"');
  });

  it('sourcemap vault updates .dockerignore and .npmignore if present, and blocks placing private maps in outDir or publicDir', async () => {
    const { relocateSourceMaps } = await import('../src/core/sourcemap-vault.js');
    const outDir = path.join(tmpDir, 'dist');
    const publicDir = path.join(tmpDir, 'public');
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });

    // 1. Should throw security error if privateMapsDir is inside outDir
    expect(() => {
      relocateSourceMaps(outDir, tmpDir, true, 'dist/maps');
    }).toThrow(/privateMapsDir cannot be located inside outDir/i);

    // 2. Should throw security error if privateMapsDir is inside publicDir
    expect(() => {
      relocateSourceMaps(outDir, tmpDir, true, 'public/maps');
    }).toThrow(/privateMapsDir cannot be located inside publicDir/i);

    // 3. Should update .dockerignore and .npmignore if present
    const dockerignorePath = path.join(tmpDir, '.dockerignore');
    const npmignorePath = path.join(tmpDir, '.npmignore');
    fs.writeFileSync(dockerignorePath, 'node_modules\n', 'utf8');
    fs.writeFileSync(npmignorePath, 'tests\n', 'utf8');

    // Create a dummy map file in outDir
    fs.writeFileSync(path.join(outDir, 'app.js.map'), '{}', 'utf8');
    relocateSourceMaps(outDir, tmpDir, true, '.unpeek-maps');

    expect(fs.readFileSync(dockerignorePath, 'utf8')).toContain('.unpeek-maps/');
    expect(fs.readFileSync(npmignorePath, 'utf8')).toContain('.unpeek-maps/');
  });

  it('protectProject writes atomically with .unpeek.tmp and cleans up on failure', async () => {
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const file1 = path.join(distDir, 'a.js');
    fs.writeFileSync(file1, 'console.log("valid bundle a");', 'utf8');

    // Test successful atomic write
    const summary = await protectProject({ cwd: tmpDir, outDir: distDir });
    expect(summary.processedFiles).toBe(1);
    expect(fs.existsSync(file1)).toBe(true);
    expect(fs.existsSync(`${file1}.unpeek.tmp`)).toBe(false);
  });

  it('runCli defaults to help when called without arguments and parses new flags', async () => {
    const { runCli } = await import('../src/cli/index.js');
    let output = '';
    const originalLog = console.log;
    console.log = (msg: string) => {
      output += msg + '\n';
    };

    try {
      // Calling without args should print help and NOT run protect
      await runCli([]);
      expect(output).toContain('Usage:');
      expect(output).toContain('unpeek protect');
      expect(output).toContain('--min-string-length');
      expect(output).toContain('--private-maps-dir');
      expect(output).toContain('--no-shield');
    } finally {
      console.log = originalLog;
    }
  });

  it('produces collision-free vault identifiers across 30+ multi-chunk Next.js classic scripts loaded in the same global VM context and supports idempotent re-runs', async () => {
    const vm = await import('node:vm');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'multi-chunk-next-app',
        dependencies: { next: '15.5.0', react: '19.0.0' },
      }),
      'utf8'
    );

    const chunksDir = path.join(tmpDir, '.next', 'static', 'chunks');
    const appDir = path.join(chunksDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    const chunkNames = [
      'polyfills-42372ed130431b0a.js',
      'webpack-677160c2d1ce62f5.js',
      'framework-f0a2efa2019b01a7.js',
      'main-c013b02ac2717da0.js',
      '13-dacea0f379bbc545.js',
      '139.2966eb18406f1320.js',
      '151-c4986517955e6d80.js',
      '188.da98216831c78842.js',
      '1be152e0-6b8fbcb99441011b.js',
      '339-0b6f060c02420ff0.js',
      '417-2f19c74cf18f5409.js',
      '523-f9be729b7b26fc29.js',
      '627-d3096e5d9caec66f.js',
      '70f66c45.bf8882ef10687667.js',
      '743-67f5f7b6fce883be.js',
      '774.5f1484a4770e64d9.js',
      '789-fe85c4dde55d938f.js',
      '7f2e7b14-70e9d0b062716050.js',
      'app/layout-180463917d21f4bf.js',
      'app/error-995d9a5e5fd7dc5b.js',
      'app/not-found-43ea21ec77027ff2.js',
      'app/page-38cada3719695704.js',
    ];

    for (let i = 0; i < chunkNames.length; i++) {
      const fullPath = path.join(chunksDir, chunkNames[i]);
      const chunkCode = `
        (self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([
          [${i}],
          {
            ${i}: function(module, exports) {
              function getChunkSecret(prefix) {
                const secret = "CHUNK_SECRET_PAYLOAD_${i}_" + "${chunkNames[i]}";
                return prefix + ":" + secret;
              }
              exports.run = getChunkSecret;
            }
          }
        ]);
      `;
      fs.writeFileSync(fullPath, chunkCode, 'utf8');
    }

    // First protect run
    const summary1 = await protectProject({
      cwd: tmpDir,
      seed: 1597463007,
    });
    expect(summary1.processedFiles).toBe(chunkNames.length);

    // Second protect run (idempotency check)
    const summary2 = await protectProject({
      cwd: tmpDir,
      seed: 987654321,
    });
    expect(summary2.totalEncryptedStrings).toBe(0);

    // Evaluate all protected chunks in a single shared browser-like global context
    const sharedWindow: Record<string, any> = { webpackChunk_N_E: [] };
    sharedWindow.self = sharedWindow;
    sharedWindow.window = sharedWindow;
    const browserCtx = vm.createContext(sharedWindow);

    const vaultVarNames = new Set<string>();
    for (const relName of chunkNames) {
      const fullPath = path.join(chunksDir, relName);
      const code = fs.readFileSync(fullPath, 'utf8');
      const match = code.match(/\bvar (_a[a-z0-9]+|_uC[a-z0-9]+|_uD[a-z0-9]+)\b/);
      expect(match).not.toBeNull();
      vaultVarNames.add(match![1]);

      // Must execute in shared global scope without SyntaxError: Identifier has already been declared
      expect(() => vm.runInContext(code, browserCtx)).not.toThrow();
    }

    // All chunks must have unique vault variable names
    expect(vaultVarNames.size).toBe(chunkNames.length);
    expect(sharedWindow.webpackChunk_N_E.length).toBe(chunkNames.length);

    // Verify each chunk's module still decrypts its own exact string
    for (let i = 0; i < chunkNames.length; i++) {
      const entry = sharedWindow.webpackChunk_N_E[i];
      const modExports: Record<string, any> = {};
      entry[1][i]({}, modExports);
      expect(modExports.run('OK')).toBe(`OK:CHUNK_SECRET_PAYLOAD_${i}_${chunkNames[i]}`);
    }
  });

  it('CLI help and summary display Tier 1 (<%2 CPU, <%15 Gzip) vs Tier 2 / --aggressive (Micro-VM & WASM KDF)', async () => {
    const { runCli } = await import('../src/cli/index.js');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'tier-test-app', scripts: { build: 'vite build' } }),
      'utf8'
    );
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'bundle.js'),
      'function testSecret() { return "super_secret_token"; }',
      'utf8'
    );

    let logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    };

    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);

      // 1. Verify --help output contains Tier 1 and Tier 2 descriptions
      logs = [];
      await runCli(['--help']);
      const helpOutput = logs.join('\n');
      expect(helpOutput).toMatch(/Tier 1/i);
      expect(helpOutput).toMatch(/Tier 2/i);
      expect(helpOutput).toMatch(/--aggressive/);
      expect(helpOutput).toMatch(/Micro-VM & WASM KDF/i);
      expect(helpOutput).toMatch(/(?:<2%|<%2)\s*CPU/i);
      expect(helpOutput).toMatch(/(?:<15%|<%15)\s*Gzip/i);

      // 2. Verify summary for Tier 1 default
      logs = [];
      await runCli(['protect', '--out-dir', 'dist']);
      const tier1Summary = logs.join('\n');
      expect(tier1Summary).toContain('Tier 1');
      expect(tier1Summary).toMatch(/default/i);

      // 3. Verify summary for Tier 2 --aggressive
      logs = [];
      await runCli(['protect', '--out-dir', 'dist', '--aggressive']);
      const tier2Summary = logs.join('\n');
      expect(tier2Summary).toContain('Tier 2');
      expect(tier2Summary).toMatch(/--aggressive/);
      expect(tier2Summary).toMatch(/Micro-VM & WASM KDF/i);
    } finally {
      process.chdir(origCwd);
      console.log = origLog;
    }
  });

  it('issues Dockerignore advisory warning when .dockerignore does not exist or lacks .unpeek-maps/', async () => {
    const { runCli } = await import('../src/cli/index.js');
    const { relocateSourceMaps } = await import('../src/core/sourcemap-vault.js');

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'docker-advisory-app', scripts: { build: 'vite build' } }),
      'utf8'
    );
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'bundle.js'), 'console.log("hello");', 'utf8');

    // 1. When .dockerignore does NOT exist, relocateSourceMaps reports dockerIgnoreMissing: true
    const resNoDocker = relocateSourceMaps(distDir, tmpDir, true, '.unpeek-maps');
    expect(resNoDocker.dockerIgnoreMissing).toBe(true);

    // And CLI protect outputs advisory warning
    let logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    };

    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      await runCli(['protect', '--out-dir', 'dist']);
      const output = logs.join('\n');
      expect(output).toContain(
        "[unpeek:advisory] .dockerignore is missing .unpeek-maps/. Private maps may leak into Docker image during 'COPY . .'."
      );
    } finally {
      process.chdir(origCwd);
      console.log = origLog;
    }

    // 2. When .dockerignore exists but lacks .unpeek-maps/
    const dockerignorePath = path.join(tmpDir, '.dockerignore');
    fs.writeFileSync(dockerignorePath, 'node_modules\n', 'utf8');
    const resMissingEntry = relocateSourceMaps(distDir, tmpDir, true, '.unpeek-maps');
    expect(resMissingEntry.dockerIgnoreMissing).toBe(true);

    // 3. When .dockerignore exists and already contains .unpeek-maps/
    fs.writeFileSync(dockerignorePath, '.unpeek-maps/\nnode_modules\n', 'utf8');
    const resWithEntry = relocateSourceMaps(distDir, tmpDir, true, '.unpeek-maps');
    expect(resWithEntry.dockerIgnoreMissing).toBe(false);
  });

  it('hardens WASM fallback function in wasm-vault and prevents raw unshielded JS arithmetic exposure', async () => {
    const acorn = await import('acorn');
    const vm = await import('node:vm');
    const { injectWasmVault, fallbackKdf } = await import('../src/ast/wasm-vault.js');
    const { generateCompactJs } = await import('../src/ast/codegen.js');

    const dummyAst = acorn.parse('function main() {}', {
      ecmaVersion: 'latest',
      sourceType: 'script',
    }) as any;

    const seed = 0x12345678;
    const { kdfFnName } = injectWasmVault(dummyAst, seed);
    const injectedCode = generateCompactJs(dummyAst);

    // 1. WASM fallback in catch (e) must NOT contain raw unshielded Math.imul or plaintext constants
    expect(injectedCode).not.toContain('Math.imul((f ^');
    expect(injectedCode).not.toContain('16777619');
    expect(injectedCode).not.toContain('73244475');

    // 2. Simulate strict CSP where WebAssembly is undefined or disabled
    const cspSandbox: Record<string, any> = {
      WebAssembly: undefined,
      Math,
      String,
      Uint8Array,
    };
    cspSandbox.window = cspSandbox;
    const ctx = vm.createContext(cspSandbox);

    expect(() => vm.runInContext(injectedCode, ctx)).not.toThrow();

    const fallbackFn = ctx[kdfFnName];
    expect(typeof fallbackFn).toBe('function');

    // 3. Fallback must produce 100% mathematically identical results to fallbackKdf across test vectors
    const testVectors = [
      { fnId: 1, salt: 7, hash: 0x5a5a5a5a },
      { fnId: 42, salt: 19, hash: 0x1234abcd },
      { fnId: 100, salt: 0, hash: 0 },
      { fnId: 9999, salt: 31, hash: -123456 },
    ];

    for (const v of testVectors) {
      const expected = fallbackKdf(v.fnId, v.salt, v.hash, seed);
      const actual = fallbackFn(v.fnId, v.salt, v.hash);
      expect(actual).toBe(expected);
    }
  });

  it('scans client route with "server" in path name, supports .cjs and .mjs, and excludes server bundles', () => {
    const nextStaticChunks = path.join(tmpDir, '.next', 'static', 'chunks');
    const clientServerRouteDir = path.join(nextStaticChunks, 'app', 'server', 'dashboard');
    const nextServerDir = path.join(tmpDir, '.next', 'server', 'app');

    fs.mkdirSync(clientServerRouteDir, { recursive: true });
    fs.mkdirSync(nextServerDir, { recursive: true });

    const clientPageJs = path.join(clientServerRouteDir, 'page.js');
    const clientWidgetCjs = path.join(clientServerRouteDir, 'widget.cjs');
    const clientMainMjs = path.join(nextStaticChunks, 'main.mjs');
    const serverPageJs = path.join(nextServerDir, 'page.js');

    fs.writeFileSync(clientPageJs, 'export default function Dashboard() { return "client"; }', 'utf8');
    fs.writeFileSync(clientWidgetCjs, 'module.exports = { widget: "active" };', 'utf8');
    fs.writeFileSync(clientMainMjs, 'export const version = 1;', 'utf8');
    fs.writeFileSync(serverPageJs, 'export async function getServerSideProps() { return {}; }', 'utf8');

    // 1. Scanning .next/static/chunks should include client routes that have 'server' in their name
    const clientFiles = scanClientBundles(nextStaticChunks);
    expect(clientFiles).toContain(clientPageJs);
    expect(clientFiles).toContain(clientWidgetCjs);
    expect(clientFiles).toContain(clientMainMjs);
    expect(clientFiles).not.toContain(serverPageJs);

    // 2. Scanning .next directory directly should exclude .next/server but include static chunks
    const allNextFiles = scanClientBundles(path.join(tmpDir, '.next'));
    expect(allNextFiles).toContain(clientPageJs);
    expect(allNextFiles).toContain(clientWidgetCjs);
    expect(allNextFiles).not.toContain(serverPageJs);
  });

  it('auto-discovers next.config distDir and vite.config outDir, and respects explicit config overrides', () => {
    // Next.js auto-discovery
    fs.writeFileSync(
      path.join(tmpDir, 'next.config.js'),
      'module.exports = { distDir: "custom-next-dist" };',
      'utf8'
    );
    const customNextChunks = path.join(tmpDir, 'custom-next-dist', 'static', 'chunks');
    fs.mkdirSync(customNextChunks, { recursive: true });

    const detectedNext = detectTargetFramework(tmpDir);
    expect(detectedNext.framework).toBe('nextjs');
    expect(detectedNext.outDir).toBe(customNextChunks);

    // Override with explicit config
    const overriddenNext = detectTargetFramework(tmpDir, undefined, {
      next: { distDir: 'configured-next-dist' },
    });
    expect(overriddenNext.outDir).toBe(path.join(tmpDir, 'configured-next-dist', 'static', 'chunks'));

    // Vite auto-discovery
    const viteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-vite-'));
    try {
      fs.writeFileSync(
        path.join(viteDir, 'vite.config.ts'),
        'export default defineConfig({ build: { outDir: "custom-vite-out", assetsDir: "bundle-assets" } });',
        'utf8'
      );
      const customViteAssets = path.join(viteDir, 'custom-vite-out', 'bundle-assets');
      fs.mkdirSync(customViteAssets, { recursive: true });

      const detectedVite = detectTargetFramework(viteDir);
      expect(detectedVite.framework).toBe('vite');
      expect(detectedVite.outDir).toBe(customViteAssets);
    } finally {
      fs.rmSync(viteDir, { recursive: true, force: true });
    }
  });

  it('unplugin normalizes Windows backslashes and processes .cjs chunks while skipping server and node_modules', () => {
    const rawInstance = unpeekPlugin.raw({ seed: 42, deterrentMode: 'passive' }, { framework: 'vite' } as any);
    const pluginObj = Array.isArray(rawInstance) ? rawInstance[0] : rawInstance;
    const renderChunk = pluginObj.renderChunk as any;

    // 1. Client route with Windows backslashes (.cjs) must be protected
    const clientChunkRes = renderChunk(
      'function testSecret(x) { const s = "client_secret"; return s + x; }',
      { fileName: 'chunks\\app\\dashboard.cjs', isEntry: false }
    );
    expect(clientChunkRes).not.toBeNull();
    expect(clientChunkRes.code).toBeDefined();
    expect(clientChunkRes.code).not.toContain('client_secret');

    // 2. Server chunk with Windows backslashes must be skipped
    const serverChunkRes = renderChunk(
      'function ssrCode() { return "ssr"; }',
      { fileName: 'server\\chunks\\page.js', isEntry: false }
    );
    expect(serverChunkRes).toBeNull();

    // 3. node_modules chunk with Windows backslashes must be skipped
    const vendorChunkRes = renderChunk(
      'function vendorCode() { return "vendor"; }',
      { fileName: 'node_modules\\dep\\index.mjs', isEntry: false }
    );
    expect(vendorChunkRes).toBeNull();
  });

  it('sourcemap-vault dynamically validates static/assets publicDirs and discovers monorepo root ignore files', async () => {
    const { relocateSourceMaps } = await import('../src/core/sourcemap-vault.js');
    const outDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(outDir, { recursive: true });

    // 1. Dynamic public dir checking (e.g. 'static' and 'assets')
    expect(() => {
      relocateSourceMaps(outDir, tmpDir, true, 'static/maps');
    }).toThrow(/privateMapsDir cannot be located inside publicDir/i);

    expect(() => {
      relocateSourceMaps(outDir, tmpDir, true, 'assets/maps');
    }).toThrow(/privateMapsDir cannot be located inside publicDir/i);

    // Custom config.publicDirs
    expect(() => {
      relocateSourceMaps(outDir, tmpDir, true, 'custom-public/maps', true, {
        publicDirs: ['custom-public'],
      });
    }).toThrow(/privateMapsDir cannot be located inside publicDir/i);

    // 2. Monorepo root ignore discovery
    const monorepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-mono-'));
    try {
      fs.mkdirSync(path.join(monorepoRoot, '.git'), { recursive: true });
      const rootGitignore = path.join(monorepoRoot, '.gitignore');
      const rootDockerignore = path.join(monorepoRoot, '.dockerignore');
      fs.writeFileSync(rootGitignore, 'node_modules\n', 'utf8');
      fs.writeFileSync(rootDockerignore, 'node_modules\n', 'utf8');

      const pkgSubDir = path.join(monorepoRoot, 'packages', 'web-app');
      const pkgOutDir = path.join(pkgSubDir, 'dist');
      fs.mkdirSync(pkgOutDir, { recursive: true });
      fs.writeFileSync(path.join(pkgOutDir, 'bundle.js.map'), '{}', 'utf8');

      relocateSourceMaps(pkgOutDir, pkgSubDir, true, '.unpeek-maps');

      expect(fs.readFileSync(rootGitignore, 'utf8')).toContain('.unpeek-maps/');
      expect(fs.readFileSync(rootDockerignore, 'utf8')).toContain('.unpeek-maps/');
    } finally {
      fs.rmSync(monorepoRoot, { recursive: true, force: true });
    }
  });

  it('UNP-04: injects runtime shield only into entry chunks while sharing masterSym across all chunks regardless of load order', async () => {
    const vm = await import('node:vm');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'entry-only-shield-app',
        dependencies: { next: '15.2.0', react: '19.0.0' },
      }),
      'utf8'
    );

    const chunksDir = path.join(tmpDir, '.next', 'static', 'chunks');
    const appDir = path.join(chunksDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    const polyfillsPath = path.join(chunksDir, 'polyfills-11111111.js');
    const webpackPath = path.join(chunksDir, 'webpack-22222222.js');
    const mainPath = path.join(chunksDir, 'main-33333333.js');
    const lazyZeroPath = path.join(chunksDir, '13-zero-strings.js');
    const pagePath = path.join(appDir, 'page-44444444.js');

    fs.writeFileSync(
      polyfillsPath,
      'self.__poly = function(){ return "POLYFILL_SECRET_VALUE"; };',
      'utf8'
    );
    fs.writeFileSync(
      webpackPath,
      'self.__webpackBootstrap = function(){ return "WEBPACK_ENTRY_SECRET"; };',
      'utf8'
    );
    fs.writeFileSync(
      mainPath,
      'self.__mainBoot = function(){ return "MAIN_ENTRY_SECRET"; };',
      'utf8'
    );
    fs.writeFileSync(
      lazyZeroPath,
      'self.__pureMath = function(a, b){ return a + b; };',
      'utf8'
    );
    fs.writeFileSync(
      pagePath,
      'self.__pageRender = function(){ return "PAGE_CHUNK_SECRET"; };',
      'utf8'
    );

    const summary = await protectProject({
      cwd: tmpDir,
      seed: 0x13572468,
      aggressive: true,
    });
    expect(summary.processedFiles).toBe(5);

    const polyCode = fs.readFileSync(polyfillsPath, 'utf8');
    const webpackCode = fs.readFileSync(webpackPath, 'utf8');
    const mainCode = fs.readFileSync(mainPath, 'utf8');
    const zeroCode = fs.readFileSync(lazyZeroPath, 'utf8');
    const pageCode = fs.readFileSync(pagePath, 'utf8');

    // Entry chunks (webpack-*, main-*) receive shield preamble; non-entry chunks do NOT
    expect(webpackCode).toContain('__unpeek_tampered');
    expect(mainCode).toContain('__unpeek_tampered');
    expect(polyCode).not.toContain('__unpeek_tampered');
    expect(zeroCode).not.toContain('__unpeek_tampered');
    expect(pageCode).not.toContain('__unpeek_tampered');

    // 0-string chunk receives zero WASM bloat even in --aggressive
    expect(zeroCode).not.toContain('_wKdf');
    expect(zeroCode).not.toContain('WebAssembly');

    // Execute polyfills BEFORE webpack/main (matching Next.js runtime order!) and verify lazy G[sym] works
    const sharedWindow: Record<string, any> = {
      Uint8Array,
      WebAssembly,
      Math,
      String,
      Promise,
    };
    sharedWindow.self = sharedWindow;
    sharedWindow.window = sharedWindow;
    sharedWindow.globalThis = sharedWindow;
    const ctx = vm.createContext(sharedWindow);

    vm.runInContext(polyCode, ctx);
    vm.runInContext(webpackCode, ctx);
    vm.runInContext(mainCode, ctx);
    vm.runInContext(zeroCode, ctx);
    vm.runInContext(pageCode, ctx);

    expect(sharedWindow.__poly()).toBe('POLYFILL_SECRET_VALUE');
    expect(sharedWindow.__webpackBootstrap()).toBe('WEBPACK_ENTRY_SECRET');
    expect(sharedWindow.__mainBoot()).toBe('MAIN_ENTRY_SECRET');
    expect(sharedWindow.__pureMath(4, 9)).toBe(13);
    expect(sharedWindow.__pageRender()).toBe('PAGE_CHUNK_SECRET');
  });

  it('UNP-06: supports shield.detectHeadless in config and --detect-headless / --gradual CLI flags', async () => {
    const vm = await import('node:vm');
    const { runCli } = await import('../src/cli/index.js');

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'headless-cfg-app', scripts: { build: 'vite build' } }),
      'utf8'
    );
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const entryFile = path.join(distDir, 'index.js');
    fs.writeFileSync(
      entryFile,
      'function getApiKey() { return "HEADLESS_OPTIN_TEST_KEY"; } self.__k = getApiKey;',
      'utf8'
    );

    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      await runCli(['protect', '--out-dir', 'dist', '--seed', '4242', '--detect-headless', '--gradual']);
    } finally {
      process.chdir(origCwd);
    }

    const protectedCode = fs.readFileSync(entryFile, 'utf8');
    expect(protectedCode).toContain('webdriver');
    expect(protectedCode).toContain('console[k]');

    const win: Record<string, any> = {
      navigator: { webdriver: true, userAgent: 'Mozilla/5.0' },
      console: { log: () => 'real' },
    };
    win.self = win;
    win.window = win;
    win.globalThis = win;
    vm.runInContext(protectedCode, vm.createContext(win));
    expect(win.__unpeek_tampered).toBe(true);
    expect(win.console.log()).toBe(0);
  });

  it('initProject throws ERR_INIT_INVALID_PACKAGE_JSON on malformed package.json without overwriting it', () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    const malformed = '{ "name": "broken-app", ';
    fs.writeFileSync(pkgPath, malformed, 'utf8');

    let caught: unknown;
    try {
      initProject(tmpDir);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UnpeekError);
    expect((caught as UnpeekError).code).toBe('ERR_INIT_INVALID_PACKAGE_JSON');
    expect(fs.readFileSync(pkgPath, 'utf8')).toBe(malformed);
  });

  it('M-08: supports profile presets, dryRun (no disk writes), maxGzipDelta budget guard, and ProtectSummary fields', async () => {
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const bundlePath = path.join(distDir, 'app.js');
    const mapPath = path.join(distDir, 'app.js.map');
    const originalCode = 'function greet() { return "secret-api-token-value"; }\n//# debugId=uuid-123\n//# sourceMappingURL=app.js.map\n';
    fs.writeFileSync(bundlePath, originalCode, 'utf8');
    fs.writeFileSync(mapPath, '{"version":3,"sources":[],"names":[],"mappings":""}', 'utf8');

    // 1. dryRun leaves all files untouched and returns seed, tier, diagnostics, profile, debugIdsPreserved
    const drySummary = await protectProject({
      cwd: tmpDir,
      outDir: 'dist',
      profile: 'minimal',
      dryRun: true,
      seed: 9001,
    });

    expect(drySummary.dryRun).toBe(true);
    expect(drySummary.profile).toBe('minimal');
    expect(drySummary.seed).toBe(9001);
    expect(drySummary.tier).toBe('Tier 1');
    expect(drySummary.debugIdsPreserved).toBe(1);
    expect(drySummary.diagnostics?.some((d) => d.code === 'DOCKERIGNORE_MISSING')).toBe(true);
    expect(fs.readFileSync(bundlePath, 'utf8')).toBe(originalCode);
    expect(fs.existsSync(mapPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.unpeek-maps'))).toBe(false);

    // 2. maxGzipDelta throws ERR_BUDGET_EXCEEDED before modifying bundle.js
    let budgetErr: unknown;
    try {
      await protectProject({
        cwd: tmpDir,
        outDir: 'dist',
        profile: 'recommended',
        maxGzipDelta: 0.01,
      });
    } catch (err) {
      budgetErr = err;
    }
    expect(budgetErr).toBeInstanceOf(UnpeekError);
    expect((budgetErr as UnpeekError).code).toBe('ERR_BUDGET_EXCEEDED');
    expect(fs.readFileSync(bundlePath, 'utf8')).toBe(originalCode);
  });

  it('M-09: checkProject enforces read-only CI gate (maps, comments, ignores, .next/server exemption, AST eval)', async () => {
    const { checkProject } = await import('../src/core/check.js');

    const nextDir = path.join(tmpDir, '.next');
    const clientDir = path.join(nextDir, 'static', 'chunks');
    const serverDir = path.join(nextDir, 'server');
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(serverDir, { recursive: true });

    // Server .map and sourceMappingURL must NEVER be flagged
    fs.writeFileSync(path.join(serverDir, 'page.js'), 'console.log("server");\n//# sourceMappingURL=page.js.map\n', 'utf8');
    fs.writeFileSync(path.join(serverDir, 'page.js.map'), '{}', 'utf8');

    // Client chunk with string literal "eval('ok')" (should NOT trigger eval-csp) and leaked .map
    fs.writeFileSync(path.join(clientDir, 'main.js'), 'const s = "eval(\'ok\') new Function(\'x\')";\n', 'utf8');
    fs.writeFileSync(path.join(clientDir, 'main.js.map'), '{}', 'utf8');

    const res1 = await checkProject({ cwd: tmpDir, outDir: '.next/static/chunks', requireZeroEval: true });
    expect(res1.passed).toBe(false);
    expect(res1.violations.some((v) => v.rule === 'public-map' && v.file === 'main.js.map')).toBe(true);
    expect(res1.violations.some((v) => v.rule === 'ignore-missing')).toBe(true);
    expect(res1.violations.some((v) => v.rule === 'eval-csp')).toBe(false);

    // Fix map leak & .gitignore, add real eval() call
    fs.unlinkSync(path.join(clientDir, 'main.js.map'));
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.unpeek-maps/\n', 'utf8');
    fs.writeFileSync(path.join(clientDir, 'main.js'), 'eval("1+1");\n', 'utf8');

    const res2 = await checkProject({ cwd: tmpDir, outDir: '.next/static/chunks', requireZeroEval: true });
    expect(res2.passed).toBe(false);
    expect(res2.violations.some((v) => v.rule === 'eval-csp')).toBe(true);

    // Clean client bundle -> passes
    fs.writeFileSync(path.join(clientDir, 'main.js'), 'console.log("clean");\n', 'utf8');
    const res3 = await checkProject({ cwd: tmpDir, outDir: '.next/static/chunks', requireZeroEval: true });
    expect(res3.passed).toBe(true);
    expect(res3.violations).toHaveLength(0);
  });
});
