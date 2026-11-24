import fs from 'node:fs';
import path from 'node:path';
import type { UnpeekConfig, UnpeekFramework } from '../config.js';

export const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

export const MAX_HTML_FILES = 64;
export const MAX_SCAN_BYTES = 512 * 1024;
const MAX_JS_GRAPH_FILES = 1024;

export const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.unpeek-maps',
]);

const HTML_WALK_EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.unpeek-maps',
  '.git',
]);

const WORKER_OR_SW_BASENAME_REGEX =
  /^(?:sw|service-worker|workbox-[^/]+)\.(?:js|mjs|cjs)$|\.worker(?:[.-][^/]+)*\.(?:js|mjs|cjs)$/i;

export function isWorkerOrServiceWorkerFile(filePath: string, rootDir?: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').split('?')[0];
  const baseName = path.posix.basename(normalized);
  if (WORKER_OR_SW_BASENAME_REGEX.test(baseName)) {
    return true;
  }
  if (rootDir) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const relBase = path.posix.basename(rel);
    if (WORKER_OR_SW_BASENAME_REGEX.test(relBase)) {
      return true;
    }
  }
  return false;
}

const NEXT_CONFIG_FILES = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.cjs'];
const VITE_CONFIG_FILES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractConfigValue(rootDir: string, filenames: string[], pattern: RegExp): string | undefined {
  for (const filename of filenames) {
    const filePath = path.join(rootDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      } catch {
        // Ignore unreadable config
      }
    }
  }
  return undefined;
}

export function hasNextServerSegment(
  fullPath: string,
  rootDir?: string,
  serverDirPrefixes?: string[]
): boolean {
  const normalized = fullPath.replace(/\\/g, '/');

  // Hard exclusions
  if (
    normalized.includes('/node_modules/') ||
    normalized.endsWith('/node_modules') ||
    normalized.includes('/.unpeek-maps/') ||
    normalized.endsWith('/.unpeek-maps')
  ) {
    return true;
  }

  // Server directory prefixes (e.g. .next/server, <distDir>/server, ssr output)
  if (/(?:^|\/)\.next\/(?:server|ssr)(?:\/|$)/i.test(normalized)) {
    return true;
  }

  // Check custom serverDirPrefixes if provided
  if (serverDirPrefixes && serverDirPrefixes.length > 0) {
    for (const prefix of serverDirPrefixes) {
      const normPrefix = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (normPrefix) {
        const regex = new RegExp(`(?:^|\\/)${escapeRegex(normPrefix)}(?:\\/|$)`, 'i');
        if (regex.test(normalized)) {
          return true;
        }
      }
    }
  }

  // Check relative path from rootDir if rootDir is provided
  if (rootDir) {
    const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    const segments = rel.split('/').filter(Boolean);
    // Only exclude if the top-level segment relative to rootDir is 'server' or 'ssr'
    if (segments.length > 0 && (segments[0].toLowerCase() === 'server' || segments[0].toLowerCase() === 'ssr')) {
      return true;
    }
  }

  return false;
}

export function hasJsBundleFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name.toLowerCase())) {
        continue;
      }
      if (hasJsBundleFiles(path.join(dir, entry.name))) {
        return true;
      }
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function detectTargetFramework(
  cwd: string,
  explicitOutDir?: string,
  explicitConfig?: UnpeekConfig
): { framework: UnpeekFramework; outDir: string };
/**
 * @deprecated Passing `UnpeekConfig` as the second argument (`explicitOutDir`) is deprecated.
 * Pass `explicitOutDir?: string` as the second argument and `explicitConfig?: UnpeekConfig` as the third.
 */
export function detectTargetFramework(
  cwd: string,
  explicitOutDir?: string | UnpeekConfig,
  explicitConfig?: UnpeekConfig
): { framework: UnpeekFramework; outDir: string };
export function detectTargetFramework(
  cwd: string,
  explicitOutDir?: string | UnpeekConfig,
  explicitConfig?: UnpeekConfig
): { framework: UnpeekFramework; outDir: string } {
  let config: UnpeekConfig | undefined = explicitConfig;
  let outDirOverride: string | undefined;

  if (typeof explicitOutDir === 'object' && explicitOutDir !== null) {
    config = explicitOutDir;
    outDirOverride = config.outDir;
  } else if (typeof explicitOutDir === 'string') {
    outDirOverride = explicitOutDir;
  }

  const rootDir = path.resolve(cwd);
  let framework: UnpeekFramework | undefined = config?.framework;

  // Auto-discover Next distDir & Vite outDir/assetsDir
  const discoveredNextDist = extractConfigValue(
    rootDir,
    NEXT_CONFIG_FILES,
    /(?:["']?distDir["']?\s*:\s*["']([^"']+)["'])/
  );
  const discoveredViteOut = extractConfigValue(
    rootDir,
    VITE_CONFIG_FILES,
    /(?:["']?outDir["']?\s*:\s*["']([^"']+)["'])/
  );
  const discoveredViteAssets = extractConfigValue(
    rootDir,
    VITE_CONFIG_FILES,
    /(?:["']?assetsDir["']?\s*:\s*["']([^"']+)["'])/
  );

  const nextDist = config?.next?.distDir ?? discoveredNextDist ?? '.next';
  const viteOut = config?.vite?.outDir ?? discoveredViteOut ?? 'dist';
  const viteAssets = config?.vite?.assetsDir ?? discoveredViteAssets ?? 'assets';

  if (!framework) {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgRaw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const allDeps = {
          ...(pkg.dependencies ?? {}),
          ...(pkg.devDependencies ?? {}),
        };

        if ('next' in allDeps) {
          framework = 'nextjs';
        } else if ('vite' in allDeps) {
          framework = 'vite';
        } else if ('webpack' in allDeps || 'react-scripts' in allDeps || '@rspack/core' in allDeps) {
          framework = 'webpack';
        }
      } catch {
        // Ignore malformed package.json and fall back to directory heuristics
      }
    }
  }

  const nextStaticDir = path.join(rootDir, nextDist, 'static');
  const nextChunksDir = path.join(nextStaticDir, 'chunks');
  const nextExportChunksDir = path.join(rootDir, 'out', '_next', 'static', 'chunks');
  const nextExportDir = path.join(rootDir, 'out');
  const nextDistDir = path.join(rootDir, nextDist);
  const vercelNextStaticDir = path.join(rootDir, '.vercel', 'output', 'static', '_next', 'static');
  const distAssetsDir = path.join(rootDir, viteOut, viteAssets);
  const distDir = path.join(rootDir, viteOut);
  const buildDir = path.join(rootDir, 'build');
  const publicDir = path.join(rootDir, 'public');

  if (!framework) {
    if (
      fs.existsSync(nextChunksDir) ||
      fs.existsSync(nextDistDir) ||
      fs.existsSync(nextExportChunksDir) ||
      fs.existsSync(vercelNextStaticDir) ||
      discoveredNextDist !== undefined
    ) {
      framework = 'nextjs';
    } else if (fs.existsSync(distAssetsDir) || discoveredViteOut !== undefined) {
      framework = 'vite';
    } else if (fs.existsSync(buildDir)) {
      framework = 'webpack';
    } else if (outDirOverride) {
      const normExplicit = outDirOverride.replace(/\\/g, '/');
      if (
        normExplicit.includes(nextDist) ||
        normExplicit.includes('.next') ||
        normExplicit.includes('out/_next') ||
        normExplicit.includes('_next/static')
      ) {
        framework = 'nextjs';
      } else if (normExplicit.includes(`${viteOut}/${viteAssets}`) || normExplicit.includes('dist/assets')) {
        framework = 'vite';
      } else if (normExplicit.includes('build')) {
        framework = 'webpack';
      } else {
        framework = 'vanilla';
      }
    } else {
      framework = 'vanilla';
    }
  }

  if (outDirOverride) {
    return {
      framework,
      outDir: path.resolve(rootDir, outDirOverride),
    };
  }

  let outDir: string;
  if (framework === 'nextjs') {
    if (fs.existsSync(nextExportChunksDir)) {
      outDir = nextExportChunksDir;
    } else if (fs.existsSync(nextChunksDir) && hasJsBundleFiles(nextChunksDir)) {
      outDir = nextChunksDir;
    } else if (fs.existsSync(nextStaticDir) && hasJsBundleFiles(nextStaticDir)) {
      outDir = nextStaticDir;
    } else if (fs.existsSync(vercelNextStaticDir)) {
      outDir = vercelNextStaticDir;
    } else if (fs.existsSync(nextChunksDir)) {
      outDir = nextChunksDir;
    } else if (fs.existsSync(nextExportDir)) {
      outDir = nextExportDir;
    } else if (fs.existsSync(nextDistDir)) {
      outDir = nextChunksDir;
    } else {
      outDir = nextChunksDir;
    }
  } else if (framework === 'vite') {
    outDir = fs.existsSync(distAssetsDir) ? distAssetsDir : distDir;
  } else if (framework === 'webpack') {
    if (fs.existsSync(distDir)) {
      outDir = distDir;
    } else if (fs.existsSync(buildDir)) {
      outDir = buildDir;
    } else {
      outDir = distDir;
    }
  } else {
    const candidates = [
      nextExportChunksDir,
      nextChunksDir,
      vercelNextStaticDir,
      distAssetsDir,
      distDir,
      buildDir,
      publicDir,
    ];
    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    outDir = existing ?? distDir;
  }

  return { framework, outDir };
}

function globBodyToRegex(pat: string): string {
  let out = '';
  let i = 0;
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === '/' && pat.slice(i, i + 4) === '/**/') {
      out += '(?:/.+/|/)';
      i += 4;
      continue;
    }
    if (ch === '/' && pat.slice(i) === '/**') {
      out += '/.*';
      i = pat.length;
      continue;
    }
    if (ch === '*' && pat[i + 1] === '*') {
      if ((i === 0 || pat[i - 1] === '/') && pat[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (ch === '{') {
      let depth = 1;
      let j = i + 1;
      const alts: string[] = [];
      let segStart = j;
      while (j < pat.length && depth > 0) {
        if (pat[j] === '{') depth++;
        else if (pat[j] === '}') {
          depth--;
          if (depth === 0) {
            alts.push(pat.slice(segStart, j));
            break;
          }
        } else if (pat[j] === ',' && depth === 1) {
          alts.push(pat.slice(segStart, j));
          segStart = j + 1;
        }
        j++;
      }
      if (depth === 0 && alts.length > 0) {
        out += `(?:${alts.map(globBodyToRegex).join('|')})`;
        i = j + 1;
        continue;
      }
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return out;
}

export function matchesGlobPattern(relPath: string, pattern: string): boolean {
  const normPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
  if (!normPattern) return false;
  const normPath = relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const regex = new RegExp(`^${globBodyToRegex(normPattern)}$`);
  if (regex.test(normPath)) {
    return true;
  }
  if (!normPattern.includes('/')) {
    return regex.test(path.posix.basename(normPath));
  }
  return false;
}

export function scanClientBundles(outDir: string, config?: UnpeekConfig): string[] {
  const resolvedOutDir = path.resolve(outDir);
  if (!fs.existsSync(resolvedOutDir)) {
    return [];
  }

  const results: string[] = [];
  const serverDirPrefixes: string[] = [];

  if (config?.next?.distDir) {
    serverDirPrefixes.push(
      path.join(config.next.distDir, 'server'),
      path.join(config.next.distDir, 'ssr')
    );
  }
  if (config?.vite?.outDir) {
    serverDirPrefixes.push(path.join(config.vite.outDir, 'server'));
  }

  const allowedExtensions =
    config?.extensions && config.extensions.length > 0
      ? new Set(config.extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
      : SUPPORTED_EXTENSIONS;

  function walk(currentDir: string): void {
    if (hasNextServerSegment(currentDir, resolvedOutDir, serverDirPrefixes)) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name.toLowerCase())) {
          continue;
        }
        if (hasNextServerSegment(fullPath, resolvedOutDir, serverDirPrefixes)) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (hasNextServerSegment(fullPath, resolvedOutDir, serverDirPrefixes)) {
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (allowedExtensions.has(ext)) {
          if (
            config?.target !== 'worker' &&
            isWorkerOrServiceWorkerFile(fullPath, resolvedOutDir)
          ) {
            continue;
          }
          const relPath = path.relative(resolvedOutDir, fullPath).replace(/\\/g, '/');
          if (config?.filter?.include && config.filter.include.length > 0) {
            if (!config.filter.include.some((pattern) => matchesGlobPattern(relPath, pattern))) {
              continue;
            }
          }
          if (config?.filter?.exclude && config.filter.exclude.length > 0) {
            if (config.filter.exclude.some((pattern) => matchesGlobPattern(relPath, pattern))) {
              continue;
            }
          }
          results.push(fullPath);
        }
      }
    }
  }

  walk(resolvedOutDir);
  return results.sort();
}

export interface HtmlEntryGraph {
  /** Relative POSIX paths (from outDir) of JS files referenced by <script src> or inline module entry imports */
  htmlEntryFiles: Set<string>;
  /** Relative POSIX paths (from outDir) of JS files referenced by <link rel="modulepreload|preload" href> */
  preloadedFiles: Set<string>;
  /** Relative POSIX paths (from outDir) of JS files registered as Worker / SharedWorker entries */
  workerEntryFiles: Set<string>;
  /** Relative POSIX paths (from outDir) of all reachable JS files (entries, preloads, imports, workers) */
  reachableFiles: Set<string>;
  /** Effective entry chunk paths (HTML entry scripts + Worker entries, or preloaded entries if no <script src>) */
  entryFiles: Set<string>;
  /** Number of HTML files read (bounded by MAX_HTML_FILES) */
  scannedHtmlFiles: number;
  /** Number of JS files read during import/worker traversal (each bounded by MAX_SCAN_BYTES) */
  scannedJsFiles: number;
}

const SCRIPT_TAG_REGEX = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const LINK_TAG_REGEX = /<link\b([^>]*)>/gi;
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const ATTR_SRC_REGEX = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ATTR_HREF_REGEX = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ATTR_REL_REGEX = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ATTR_AS_REGEX = /\bas\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ATTR_TYPE_REGEX = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const STATIC_FROM_IMPORT_REGEX = /\bfrom\s*(['"`])([^'"`\r\n${}]+)\1/g;
const SIDE_EFFECT_IMPORT_REGEX = /(?:^|[;}\n])\s*import\s*(['"`])([^'"`\r\n${}]+)\1/g;
const DYNAMIC_IMPORT_REGEX =
  /\bimport\s*\(\s*(?:\/\*[^*]{0,120}\*\/\s*)?(['"`])([^'"`\r\n${}]+)\1/g;
const WORKER_META_URL_REGEX =
  /\bnew\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:Shared)?Worker\s*\(\s*new\s+URL\s*\(\s*(['"`])([^'"`\r\n${}]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const WORKER_DIRECT_URL_REGEX =
  /\bnew\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:Shared)?Worker\s*\(\s*(['"`])([^'"`\r\n${}]+)\1/g;

function getHtmlAttr(attrs: string, regex: RegExp): string | undefined {
  const match = attrs.match(regex);
  if (!match) return undefined;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

function readBoundedText(filePath: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const toRead = Math.min(stat.size, maxBytes);
    if (toRead <= 0) return '';
    const buf = Buffer.allocUnsafe(toRead);
    let offset = 0;
    while (offset < toRead) {
      const bytesRead = fs.readSync(fd, buf, offset, toRead - offset, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
    }
    return buf.subarray(0, offset).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

function buildServerDirPrefixes(config?: UnpeekConfig): string[] {
  const prefixes: string[] = [];
  if (config?.next?.distDir) {
    prefixes.push(
      path.join(config.next.distDir, 'server'),
      path.join(config.next.distDir, 'ssr')
    );
  }
  if (config?.vite?.outDir) {
    prefixes.push(path.join(config.vite.outDir, 'server'));
  }
  return prefixes;
}

function getAllowedExtensions(config?: UnpeekConfig): Set<string> {
  return config?.extensions && config.extensions.length > 0
    ? new Set(
        config.extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
      )
    : SUPPORTED_EXTENSIONS;
}

function isExcludedPathSegment(fullPath: string): boolean {
  const normalized = fullPath.replace(/\\/g, '/');
  return (
    normalized.includes('/.git/') ||
    normalized.endsWith('/.git') ||
    normalized.includes('/node_modules/') ||
    normalized.endsWith('/node_modules') ||
    normalized.includes('/.unpeek-maps/') ||
    normalized.endsWith('/.unpeek-maps')
  );
}

function resolveOutDirJsTarget(
  rawSpecifier: string,
  baseDir: string,
  resolvedOutDir: string,
  allowedExtensions: Set<string>,
  serverDirPrefixes: string[],
  fallbackRootDir?: string
): { absPath: string; relPath: string } | undefined {
  const trimmed = rawSpecifier.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    /^(?:https?:|data:|blob:|javascript:|mailto:|\/\/)/i.test(trimmed)
  ) {
    return undefined;
  }

  const withoutQuery = trimmed.split('?')[0].split('#')[0];
  let cleanSpec = withoutQuery;
  try {
    cleanSpec = decodeURIComponent(withoutQuery);
  } catch {
    // keep raw if malformed percent encoding
  }
  if (!cleanSpec) return undefined;

  const candidates: string[] = [];
  if (cleanSpec.startsWith('/')) {
    const stripped = cleanSpec.replace(/^\/+/, '');
    candidates.push(path.resolve(resolvedOutDir, stripped));
    if (fallbackRootDir && fallbackRootDir !== resolvedOutDir) {
      candidates.push(path.resolve(fallbackRootDir, stripped));
    }
  } else {
    candidates.push(path.resolve(baseDir, cleanSpec));
  }

  for (const baseCandidate of candidates) {
    const ext = path.extname(baseCandidate).toLowerCase();
    const withExts = ext
      ? [baseCandidate]
      : Array.from(allowedExtensions).map((e) => `${baseCandidate}${e}`);

    for (const candidate of withExts) {
      const candExt = path.extname(candidate).toLowerCase();
      if (!allowedExtensions.has(candExt)) continue;
      if (isExcludedPathSegment(candidate)) continue;
      if (hasNextServerSegment(candidate, resolvedOutDir, serverDirPrefixes)) continue;

      const rel = path.relative(resolvedOutDir, candidate).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;

      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { absPath: candidate, relPath: rel };
        }
      } catch {
        // ignore stat errors
      }
    }
  }

  return undefined;
}

function extractRelativeSpecifiers(
  jsText: string,
  allowBareRelativeFromRoot: boolean
): { imports: string[]; workers: string[] } {
  const imports: string[] = [];
  const workers: string[] = [];

  const collectMatches = (regex: RegExp, target: string[], requireDotPrefix: boolean) => {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(jsText)) !== null) {
      const spec = m[2];
      if (!spec) continue;
      if (
        spec.startsWith('./') ||
        spec.startsWith('../') ||
        (!requireDotPrefix && !/^(?:https?:|data:|blob:)/i.test(spec))
      ) {
        target.push(spec);
      }
    }
  };

  collectMatches(STATIC_FROM_IMPORT_REGEX, imports, true);
  collectMatches(SIDE_EFFECT_IMPORT_REGEX, imports, true);
  collectMatches(DYNAMIC_IMPORT_REGEX, imports, true);
  collectMatches(WORKER_META_URL_REGEX, workers, !allowBareRelativeFromRoot);
  collectMatches(WORKER_DIRECT_URL_REGEX, workers, true);

  return { imports, workers };
}

/**
 * Bounded build-time scanner that discovers real HTML entry scripts (<script src>),
 * preload hints (<link rel="modulepreload|preload">), reachable relative imports,
 * and Web Worker / SharedWorker entries inside `outDir`.
 */
export function discoverHtmlEntryGraph(
  outDir: string,
  config?: UnpeekConfig,
  extraHtmlDirs: string[] = []
): HtmlEntryGraph {
  const htmlEntryFiles = new Set<string>();
  const preloadedFiles = new Set<string>();
  const workerEntryFiles = new Set<string>();
  const reachableFiles = new Set<string>();

  const emptyResult = (): HtmlEntryGraph => ({
    htmlEntryFiles,
    preloadedFiles,
    workerEntryFiles,
    reachableFiles,
    entryFiles: new Set<string>(),
    scannedHtmlFiles: 0,
    scannedJsFiles: 0,
  });

  const resolvedOutDir = path.resolve(outDir);
  if (!fs.existsSync(resolvedOutDir)) {
    return emptyResult();
  }

  const serverDirPrefixes = buildServerDirPrefixes(config);
  const allowedExtensions = getAllowedExtensions(config);
  const htmlFiles: Array<{ filePath: string; rootDir: string }> = [];

  function walkHtml(currentDir: string): void {
    if (htmlFiles.length >= MAX_HTML_FILES) return;
    if (hasNextServerSegment(currentDir, resolvedOutDir, serverDirPrefixes)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (htmlFiles.length >= MAX_HTML_FILES) break;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (HTML_WALK_EXCLUDED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
        if (hasNextServerSegment(fullPath, resolvedOutDir, serverDirPrefixes)) continue;
        walkHtml(fullPath);
      } else if (entry.isFile()) {
        if (hasNextServerSegment(fullPath, resolvedOutDir, serverDirPrefixes)) continue;
        if (path.extname(entry.name).toLowerCase() === '.html') {
          htmlFiles.push({ filePath: fullPath, rootDir: resolvedOutDir });
        }
      }
    }
  }

  walkHtml(resolvedOutDir);

  if (htmlFiles.length === 0 && extraHtmlDirs.length > 0) {
    for (const extraDir of extraHtmlDirs) {
      if (htmlFiles.length >= MAX_HTML_FILES) break;
      const resolvedExtra = path.resolve(extraDir);
      if (
        !fs.existsSync(resolvedExtra) ||
        isExcludedPathSegment(resolvedExtra) ||
        hasNextServerSegment(resolvedExtra, resolvedExtra, serverDirPrefixes)
      ) {
        continue;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(resolvedExtra, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (htmlFiles.length >= MAX_HTML_FILES) break;
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.html') {
          htmlFiles.push({ filePath: path.join(resolvedExtra, entry.name), rootDir: resolvedExtra });
        }
      }
    }
  }

  const jsQueue: Array<{ absPath: string; relPath: string }> = [];
  const queuedOrVisitedJs = new Set<string>();

  const enqueueJs = (resolved: { absPath: string; relPath: string } | undefined) => {
    if (!resolved) return;
    reachableFiles.add(resolved.relPath);
    if (!queuedOrVisitedJs.has(resolved.relPath) && queuedOrVisitedJs.size < MAX_JS_GRAPH_FILES) {
      queuedOrVisitedJs.add(resolved.relPath);
      jsQueue.push(resolved);
    }
  };

  for (const { filePath: htmlPath, rootDir: htmlRootDir } of htmlFiles) {
    const rawHtml = readBoundedText(htmlPath, MAX_SCAN_BYTES);
    if (!rawHtml) continue;
    const htmlText = rawHtml.replace(HTML_COMMENT_REGEX, '');
    const htmlDir = path.dirname(htmlPath);

    SCRIPT_TAG_REGEX.lastIndex = 0;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = SCRIPT_TAG_REGEX.exec(htmlText)) !== null) {
      const attrs = scriptMatch[1] ?? '';
      const body = scriptMatch[2] ?? '';
      const scriptType = (getHtmlAttr(attrs, ATTR_TYPE_REGEX) ?? '').toLowerCase();
      const isJsScript =
        !scriptType ||
        scriptType === 'module' ||
        scriptType.includes('javascript') ||
        scriptType.includes('ecmascript');
      if (!isJsScript) continue;

      const src = getHtmlAttr(attrs, ATTR_SRC_REGEX);
      if (src) {
        const resolved = resolveOutDirJsTarget(
          src,
          htmlDir,
          resolvedOutDir,
          allowedExtensions,
          serverDirPrefixes,
          htmlRootDir
        );
        if (resolved) {
          htmlEntryFiles.add(resolved.relPath);
          enqueueJs(resolved);
        }
      } else if (body.trim()) {
        const { imports, workers } = extractRelativeSpecifiers(body, false);
        for (const imp of imports) {
          const resolved = resolveOutDirJsTarget(
            imp,
            htmlDir,
            resolvedOutDir,
            allowedExtensions,
            serverDirPrefixes,
            htmlRootDir
          );
          if (resolved) {
            htmlEntryFiles.add(resolved.relPath);
            enqueueJs(resolved);
          }
        }
        for (const workerSpec of workers) {
          const resolved = resolveOutDirJsTarget(
            workerSpec,
            htmlDir,
            resolvedOutDir,
            allowedExtensions,
            serverDirPrefixes,
            htmlRootDir
          );
          if (resolved) {
            workerEntryFiles.add(resolved.relPath);
            enqueueJs(resolved);
          }
        }
      }
    }

    LINK_TAG_REGEX.lastIndex = 0;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = LINK_TAG_REGEX.exec(htmlText)) !== null) {
      const attrs = linkMatch[1] ?? '';
      const relAttr = (getHtmlAttr(attrs, ATTR_REL_REGEX) ?? '').toLowerCase();
      if (!relAttr) continue;
      const relTokens = relAttr.split(/\s+/);
      const isModulePreload = relTokens.includes('modulepreload');
      const isPreload = relTokens.includes('preload');
      if (!isModulePreload && !isPreload) continue;

      if (isPreload && !isModulePreload) {
        const asAttr = (getHtmlAttr(attrs, ATTR_AS_REGEX) ?? '').toLowerCase();
        if (asAttr && asAttr !== 'script' && asAttr !== 'worker') {
          continue;
        }
      }

      const href = getHtmlAttr(attrs, ATTR_HREF_REGEX);
      if (!href) continue;
      const resolved = resolveOutDirJsTarget(
        href,
        htmlDir,
        resolvedOutDir,
        allowedExtensions,
        serverDirPrefixes,
        htmlRootDir
      );
      if (resolved) {
        preloadedFiles.add(resolved.relPath);
        enqueueJs(resolved);
      }
    }
  }

  let scannedJsFiles = 0;
  let head = 0;
  while (head < jsQueue.length && scannedJsFiles < MAX_JS_GRAPH_FILES) {
    const current = jsQueue[head++];
    const jsText = readBoundedText(current.absPath, MAX_SCAN_BYTES);
    scannedJsFiles++;
    if (!jsText) continue;

    const currentDir = path.dirname(current.absPath);
    const { imports, workers } = extractRelativeSpecifiers(jsText, true);

    for (const imp of imports) {
      const resolved = resolveOutDirJsTarget(
        imp,
        currentDir,
        resolvedOutDir,
        allowedExtensions,
        serverDirPrefixes
      );
      if (resolved) {
        enqueueJs(resolved);
      }
    }

    for (const workerSpec of workers) {
      const resolved = resolveOutDirJsTarget(
        workerSpec,
        currentDir,
        resolvedOutDir,
        allowedExtensions,
        serverDirPrefixes
      );
      if (resolved) {
        workerEntryFiles.add(resolved.relPath);
        enqueueJs(resolved);
      }
    }
  }

  const entryFiles = new Set<string>([...htmlEntryFiles, ...workerEntryFiles]);
  if (htmlEntryFiles.size === 0 && preloadedFiles.size > 0) {
    for (const preloaded of preloadedFiles) {
      entryFiles.add(preloaded);
    }
  }

  return {
    htmlEntryFiles,
    preloadedFiles,
    workerEntryFiles,
    reachableFiles,
    entryFiles,
    scannedHtmlFiles: htmlFiles.length,
    scannedJsFiles,
  };
}
