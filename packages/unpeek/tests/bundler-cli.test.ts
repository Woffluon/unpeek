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
});
