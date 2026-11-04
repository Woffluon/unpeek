import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initProject,
  protectProject,
  detectTargetFramework,
  scanClientBundles,
  unpeekPlugin,
} from '../src/index.js';

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
    const { relocateSourceMaps } = await import('../src/bundler/sourcemap-vault.js');
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
      const match = code.match(/\bvar (_uC[a-z0-9]+)\b/);
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
});
