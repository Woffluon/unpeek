import fs from 'node:fs';
import path from 'node:path';
import type { DetectedFramework } from '../types.js';

const EXCLUDED_DIR_NAMES = new Set([
  'server',
  'ssr',
  'node_modules',
  '.unpeek-maps',
]);

function hasNextServerSegment(fullPath: string): boolean {
  const normalized = fullPath.replace(/\\/g, '/');
  return (
    normalized.includes('/.next/server/') ||
    normalized.endsWith('/.next/server') ||
    normalized.includes('/server/') ||
    normalized.includes('/ssr/') ||
    normalized.includes('/node_modules/') ||
    normalized.includes('/.unpeek-maps/')
  );
}

export function detectTargetFramework(
  cwd: string,
  explicitOutDir?: string
): { framework: DetectedFramework; outDir: string } {
  const rootDir = path.resolve(cwd);
  let framework: DetectedFramework | undefined;

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

  const nextChunksDir = path.join(rootDir, '.next', 'static', 'chunks');
  const distAssetsDir = path.join(rootDir, 'dist', 'assets');
  const distDir = path.join(rootDir, 'dist');
  const buildDir = path.join(rootDir, 'build');
  const publicDir = path.join(rootDir, 'public');

  if (!framework) {
    if (fs.existsSync(nextChunksDir) || fs.existsSync(path.join(rootDir, '.next'))) {
      framework = 'nextjs';
    } else if (fs.existsSync(distAssetsDir)) {
      framework = 'vite';
    } else if (fs.existsSync(buildDir)) {
      framework = 'webpack';
    } else if (explicitOutDir) {
      const normExplicit = explicitOutDir.replace(/\\/g, '/');
      if (normExplicit.includes('.next')) {
        framework = 'nextjs';
      } else if (normExplicit.includes('dist/assets')) {
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

  if (explicitOutDir) {
    return {
      framework,
      outDir: path.resolve(rootDir, explicitOutDir),
    };
  }

  let outDir: string;
  if (framework === 'nextjs') {
    outDir = nextChunksDir;
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
    const candidates = [nextChunksDir, distAssetsDir, distDir, buildDir, publicDir];
    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    outDir = existing ?? distDir;
  }

  return { framework, outDir };
}

export function scanClientBundles(outDir: string): string[] {
  const resolvedOutDir = path.resolve(outDir);
  if (!fs.existsSync(resolvedOutDir)) {
    return [];
  }

  const results: string[] = [];

  function walk(currentDir: string): void {
    if (hasNextServerSegment(currentDir)) {
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
        if (hasNextServerSegment(fullPath)) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (hasNextServerSegment(fullPath)) {
          continue;
        }
        if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(resolvedOutDir);
  return results.sort();
}
