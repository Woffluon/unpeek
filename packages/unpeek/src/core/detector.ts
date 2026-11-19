import fs from 'node:fs';
import path from 'node:path';
import type { UnpeekConfig, UnpeekFramework } from '../config.js';

export const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

export const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.unpeek-maps',
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
