import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {
  discoverHtmlEntryGraph,
  MAX_HTML_FILES,
  MAX_SCAN_BYTES,
  scanClientBundles,
} from '../src/core/detector.js';
import { protectProject } from '../src/core/protect.js';

describe('C16a: HTML & Relative-Import / Web Worker Entry Chunk Detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-c16a-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('selects HTML <script src> and Worker entry chunks while keeping alphabetically earlier non-entry chunks shield-free', async () => {
    const distDir = path.join(tmpDir, 'dist');
    const assetsDir = path.join(distDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    // Alphabetically earlier than assets/app.js (`aaa-chunk.js` and `chunk-aaa.js`)
    const aaaChunkPath = path.join(assetsDir, 'aaa-chunk.js');
    const chunkAaaPath = path.join(assetsDir, 'chunk-aaa.js');
    const appPath = path.join(assetsDir, 'app.js');
    const workerPath = path.join(assetsDir, 'worker.js');
    const sharedWorkerPath = path.join(assetsDir, 'shared-worker.js');

    fs.writeFileSync(
      path.join(distDir, 'index.html'),
      [
        '<!doctype html>',
        '<html><head>',
        '  <link rel="modulepreload" href="./assets/chunk-aaa.js">',
        '  <script type="module" src="./assets/app.js"></script>',
        '</head><body></body></html>',
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      aaaChunkPath,
      'export function getFirstAlpha() { return "NON_ENTRY_AAA_SECRET"; }',
      'utf8'
    );
    fs.writeFileSync(
      chunkAaaPath,
      [
        'import { getFirstAlpha } from "./aaa-chunk.js";',
        'export function getChunkAaa() { return getFirstAlpha() + "_CHUNK_AAA_SECRET"; }',
        'export function spawnShared() { return new SharedWorker(new URL("./shared-worker.js", import.meta.url)); }',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      appPath,
      [
        'import { getChunkAaa } from "./chunk-aaa.js";',
        'export function bootApp() {',
        '  const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });',
        '  return getChunkAaa() + "_APP_ENTRY_SECRET";',
        '}',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      workerPath,
      'function deriveWorkerToken(msg) { const secret = "WORKER_ENTRY_SECRET_TOKEN"; return secret + ":" + msg; } self.__runWorker = deriveWorkerToken;',
      'utf8'
    );
    fs.writeFileSync(
      sharedWorkerPath,
      'self.onconnect = function() { return "SHARED_WORKER_SECRET_TOKEN"; };',
      'utf8'
    );

    const graph = discoverHtmlEntryGraph(distDir);
    expect(graph.htmlEntryFiles.has('assets/app.js')).toBe(true);
    expect(graph.preloadedFiles.has('assets/chunk-aaa.js')).toBe(true);
    expect(graph.workerEntryFiles.has('assets/worker.js')).toBe(true);
    expect(graph.workerEntryFiles.has('assets/shared-worker.js')).toBe(true);
    expect(graph.entryFiles.has('assets/app.js')).toBe(true);
    expect(graph.entryFiles.has('assets/worker.js')).toBe(true);
    expect(graph.entryFiles.has('assets/shared-worker.js')).toBe(true);
    expect(graph.entryFiles.has('assets/aaa-chunk.js')).toBe(false);
    expect(graph.entryFiles.has('assets/chunk-aaa.js')).toBe(false);

    const summary = await protectProject({
      cwd: tmpDir,
      outDir: 'dist',
      seed: 0x2468ace0,
    });
    expect(summary.processedFiles).toBe(5);

    const aaaCode = fs.readFileSync(aaaChunkPath, 'utf8');
    const chunkAaaCode = fs.readFileSync(chunkAaaPath, 'utf8');
    const appCode = fs.readFileSync(appPath, 'utf8');
    const workerCode = fs.readFileSync(workerPath, 'utf8');
    const sharedWorkerCode = fs.readFileSync(sharedWorkerPath, 'utf8');

    // Entry chunks (HTML app.js + Worker / SharedWorker) receive the runtime shield
    expect(appCode).toContain('__unpeek_tampered');
    expect(workerCode).toContain('__unpeek_tampered');
    expect(sharedWorkerCode).toContain('__unpeek_tampered');

    // Non-entry chunks (including alphabetically first aaa-chunk.js & modulepreload chunk-aaa.js) do NOT
    expect(aaaCode).not.toContain('__unpeek_tampered');
    expect(chunkAaaCode).not.toContain('__unpeek_tampered');

    // Strings are still protected across all chunks
    expect(aaaCode).not.toContain('NON_ENTRY_AAA_SECRET');
    expect(chunkAaaCode).not.toContain('_CHUNK_AAA_SECRET');
    expect(workerCode).not.toContain('WORKER_ENTRY_SECRET_TOKEN');

    // Worker executes cleanly in an isolated WorkerGlobalScope using its own injected shield
    const workerSandbox: Record<string, any> = {
      Uint8Array,
      WebAssembly,
      Math,
      String,
      Promise,
      importScripts: () => {},
    };
    workerSandbox.self = workerSandbox;
    workerSandbox.globalThis = workerSandbox;
    vm.runInNewContext(workerCode, workerSandbox);
    expect(workerSandbox.self.__runWorker('ok')).toBe('WORKER_ENTRY_SECRET_TOKEN:ok');
  });

  it('works with Vite default outDir detection (dist/assets) when index.html lives in dist/', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'vite-html-app', devDependencies: { vite: '^6.0.0' } }),
      'utf8'
    );
    const distDir = path.join(tmpDir, 'dist');
    const assetsDir = path.join(distDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    fs.writeFileSync(
      path.join(distDir, 'index.html'),
      '<script type="module" src="./assets/z-entry.js"></script>',
      'utf8'
    );
    const nonEntry = path.join(assetsDir, 'a-vendor.js');
    const entry = path.join(assetsDir, 'z-entry.js');
    const worker = path.join(assetsDir, 'w-task.js');

    fs.writeFileSync(nonEntry, 'export const v = "VITE_VENDOR_SECRET";', 'utf8');
    fs.writeFileSync(
      entry,
      'const w = new Worker(new URL("./w-task.js", import.meta.url)); export const ok = "VITE_ENTRY_SECRET";',
      'utf8'
    );
    fs.writeFileSync(worker, 'self.onmessage = () => "VITE_WORKER_SECRET";', 'utf8');

    const summary = await protectProject({ cwd: tmpDir, seed: 0x11223344 });
    expect(summary.framework).toBe('vite');
    expect(summary.processedFiles).toBe(3);

    expect(fs.readFileSync(nonEntry, 'utf8')).not.toContain('__unpeek_tampered');
    expect(fs.readFileSync(entry, 'utf8')).toContain('__unpeek_tampered');
    expect(fs.readFileSync(worker, 'utf8')).toContain('__unpeek_tampered');
  });

  it('never scans or modifies .next/server, node_modules, or .git, and preserves fallback when no HTML/manifest exists', async () => {
    const nextRoot = path.join(tmpDir, '.next');
    const clientChunks = path.join(nextRoot, 'static', 'chunks');
    const serverApp = path.join(nextRoot, 'server', 'app');
    const nodeModulesDir = path.join(nextRoot, 'node_modules', 'pkg');
    const gitDir = path.join(nextRoot, '.git');
    fs.mkdirSync(clientChunks, { recursive: true });
    fs.mkdirSync(serverApp, { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.mkdirSync(gitDir, { recursive: true });

    const serverHtml = path.join(serverApp, 'page.html');
    const serverJs = path.join(serverApp, 'page.js');
    const serverOriginal = 'export const ssrSecret = "SSR_DO_NOT_TOUCH_VALUE";';
    fs.writeFileSync(serverHtml, '<script src="./page.js"></script>', 'utf8');
    fs.writeFileSync(serverJs, serverOriginal, 'utf8');
    fs.writeFileSync(
      path.join(nodeModulesDir, 'index.html'),
      '<script src="../../static/chunks/alpha.js"></script>',
      'utf8'
    );
    fs.writeFileSync(
      path.join(gitDir, 'preview.html'),
      '<script src="../static/chunks/alpha.js"></script>',
      'utf8'
    );

    const alphaPath = path.join(clientChunks, 'alpha.js');
    const zetaPath = path.join(clientChunks, 'zeta.js');
    fs.writeFileSync(alphaPath, 'export const a = "ALPHA_CLIENT_SECRET";', 'utf8');
    fs.writeFileSync(zetaPath, 'export const z = "ZETA_CLIENT_SECRET";', 'utf8');

    const graph = discoverHtmlEntryGraph(nextRoot);
    expect(graph.scannedHtmlFiles).toBe(0);
    expect(graph.entryFiles.size).toBe(0);
    expect(scanClientBundles(nextRoot)).toEqual([alphaPath, zetaPath].sort());

    // Without HTML or manifest, fallback preserves index === 0 (alpha.js) as entry
    const summary = await protectProject({ cwd: tmpDir, outDir: '.next/static/chunks', seed: 99 });
    expect(summary.processedFiles).toBe(2);
    expect(fs.readFileSync(alphaPath, 'utf8')).toContain('__unpeek_tampered');
    expect(fs.readFileSync(zetaPath, 'utf8')).not.toContain('__unpeek_tampered');
    expect(fs.readFileSync(serverJs, 'utf8')).toBe(serverOriginal);
  });

  it('enforces MAX_HTML_FILES (64) and MAX_SCAN_BYTES (512 KiB) upper bounds', () => {
    expect(MAX_HTML_FILES).toBe(64);
    expect(MAX_SCAN_BYTES).toBe(512 * 1024);

    // 1. MAX_HTML_FILES cap
    const manyHtmlDir = path.join(tmpDir, 'many-html');
    fs.mkdirSync(manyHtmlDir, { recursive: true });
    fs.writeFileSync(path.join(manyHtmlDir, 'entry-early.js'), 'export const e = 1;', 'utf8');
    fs.writeFileSync(path.join(manyHtmlDir, 'entry-late.js'), 'export const l = 2;', 'utf8');

    for (let i = 1; i <= MAX_HTML_FILES + 6; i++) {
      const name = `page-${String(i).padStart(3, '0')}.html`;
      const target = i <= MAX_HTML_FILES ? './entry-early.js' : './entry-late.js';
      fs.writeFileSync(
        path.join(manyHtmlDir, name),
        `<script src="${target}"></script>`,
        'utf8'
      );
    }

    const htmlBoundedGraph = discoverHtmlEntryGraph(manyHtmlDir);
    expect(htmlBoundedGraph.scannedHtmlFiles).toBe(MAX_HTML_FILES);
    expect(htmlBoundedGraph.htmlEntryFiles.has('entry-early.js')).toBe(true);
    expect(htmlBoundedGraph.htmlEntryFiles.has('entry-late.js')).toBe(false);

    // 2. MAX_SCAN_BYTES cap for both HTML and JS files
    const largeDir = path.join(tmpDir, 'large-files');
    fs.mkdirSync(largeDir, { recursive: true });
    const padding = ' '.repeat(MAX_SCAN_BYTES + 128);

    fs.writeFileSync(
      path.join(largeDir, 'index.html'),
      `<script type="module" src="./app.js"></script>\n${padding}\n<script src="./beyond-html.js"></script>`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(largeDir, 'app.js'),
      `const w1 = new Worker(new URL('./worker-ok.js', import.meta.url));\n${padding}\nconst w2 = new Worker(new URL('./worker-beyond.js', import.meta.url));`,
      'utf8'
    );
    fs.writeFileSync(path.join(largeDir, 'beyond-html.js'), 'export const x = 1;', 'utf8');
    fs.writeFileSync(path.join(largeDir, 'worker-ok.js'), 'self.postMessage(1);', 'utf8');
    fs.writeFileSync(path.join(largeDir, 'worker-beyond.js'), 'self.postMessage(2);', 'utf8');

    const byteBoundedGraph = discoverHtmlEntryGraph(largeDir);
    expect(byteBoundedGraph.htmlEntryFiles.has('app.js')).toBe(true);
    expect(byteBoundedGraph.htmlEntryFiles.has('beyond-html.js')).toBe(false);
    expect(byteBoundedGraph.workerEntryFiles.has('worker-ok.js')).toBe(true);
    expect(byteBoundedGraph.workerEntryFiles.has('worker-beyond.js')).toBe(false);
  });
});
