import fs from 'node:fs';
import path from 'node:path';
import type { UnpeekConfig, UnpeekFramework } from '../config.js';

export const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

export const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.unpeek-maps',
]);

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

  const nextChunksDir = path.join(rootDir, nextDist, 'static', 'chunks');
  const nextExportChunksDir = path.join(rootDir, 'out', '_next', 'static', 'chunks');
  const nextExportDir = path.join(rootDir, 'out');
  const nextDistDir = path.join(rootDir, nextDist);
  const distAssetsDir = path.join(rootDir, viteOut, viteAssets);
  const distDir = path.join(rootDir, viteOut);
  const buildDir = path.join(rootDir, 'build');
  const publicDir = path.join(rootDir, 'public');

  if (!framework) {
    if (
      fs.existsSync(nextChunksDir) ||
      fs.existsSync(nextDistDir) ||
      fs.existsSync(nextExportChunksDir) ||
      discoveredNextDist !== undefined
    ) {
      framework = 'nextjs';
    } else if (fs.existsSync(distAssetsDir) || discoveredViteOut !== undefined) {
      framework = 'vite';
    } else if (fs.existsSync(buildDir)) {
      framework = 'webpack';
    } else if (outDirOverride) {
      const normExplicit = outDirOverride.replace(/\\/g, '/');
      if (normExplicit.includes(nextDist) || normExplicit.includes('.next') || normExplicit.includes('out/_next')) {
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
    const candidates = [nextExportChunksDir, nextChunksDir, distAssetsDir, distDir, buildDir, publicDir];
    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    outDir = existing ?? distDir;
  }

  return { framework, outDir };
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
          results.push(fullPath);
        }
      }
    }
  }

  walk(resolvedOutDir);
  return results.sort();
}
