import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import type { CheckOptions, CheckResult, CheckViolation } from './types.js';
import { loadUnpeekConfig } from '../config.js';
import { detectTargetFramework, hasNextServerSegment, scanClientBundles } from './detector.js';
import { findMonorepoRoots, SOURCE_MAP_COMMENT_REGEX } from './sourcemap-vault.js';

function walkPublicMaps(
  currentDir: string,
  rootOutDir: string,
  found: string[]
): void {
  if (hasNextServerSegment(currentDir, rootOutDir)) {
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
      if (entry.name === 'node_modules' || entry.name === '.unpeek-maps') {
        continue;
      }
      if (hasNextServerSegment(fullPath, rootOutDir)) {
        continue;
      }
      walkPublicMaps(fullPath, rootOutDir, found);
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      found.push(fullPath);
    }
  }
}

function hasIgnoreEntry(filePath: string, ignoreEntry: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const normalizedEntry = ignoreEntry.endsWith('/') ? ignoreEntry : `${ignoreEntry}/`;
    const bareEntry = normalizedEntry.slice(0, -1);
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    return (
      lines.includes(normalizedEntry) ||
      lines.includes(bareEntry) ||
      lines.includes('.unpeek-maps') ||
      lines.includes('.unpeek-maps/')
    );
  } catch {
    return false;
  }
}

function findEvalOrFunctionCalls(code: string): string[] {
  const hits: string[] = [];
  let ast: acorn.Program;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
    });
  } catch {
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowReturnOutsideFunction: true,
      });
    } catch {
      return hits;
    }
  }

  walkSimple(ast, {
    CallExpression(node) {
      if (node.callee.type === 'Identifier') {
        if (node.callee.name === 'eval') {
          hits.push('eval(...)');
        } else if (node.callee.name === 'Function') {
          hits.push('Function(...)');
        }
      }
    },
    NewExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'Function') {
        hits.push('new Function(...)');
      }
    },
  });

  return Array.from(new Set(hits));
}

export async function checkProject(options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const config = await loadUnpeekConfig(cwd);
  const { outDir } = detectTargetFramework(cwd, options.outDir, config);
  const resolvedOutDir = path.resolve(outDir);
  const privateMapsDir = options.privateMapsDir ?? config.sourcemaps?.vaultDir ?? '.unpeek-maps';
  const maxGzipDelta = options.maxGzipDelta ?? 15;
  const requireZeroEval = Boolean(options.requireZeroEval || options.strictCsp);

  const violations: CheckViolation[] = [];
  const warnings: CheckViolation[] = [];

  // 1. Public .map files & SOURCE_MAP_COMMENT_REGEX leaks in client dirs (never .next/server)
  const publicMaps: string[] = [];
  if (fs.existsSync(resolvedOutDir)) {
    walkPublicMaps(resolvedOutDir, resolvedOutDir, publicMaps);
  }
  for (const mapFile of publicMaps) {
    const rel = path.relative(resolvedOutDir, mapFile).replace(/\\/g, '/');
    violations.push({
      rule: 'public-map',
      severity: 'error',
      message: `Public source map exposed in client output: "${rel}".`,
      file: rel,
    });
  }

  const clientFiles = scanClientBundles(resolvedOutDir, config);
  for (const filePath of clientFiles) {
    const rel = path.relative(resolvedOutDir, filePath).replace(/\\/g, '/');
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    SOURCE_MAP_COMMENT_REGEX.lastIndex = 0;
    if (SOURCE_MAP_COMMENT_REGEX.test(content)) {
      violations.push({
        rule: 'sourcemap-comment',
        severity: 'error',
        message: `Residual sourceMappingURL comment found in "${rel}".`,
        file: rel,
      });
    }

    // 4. Zero-eval CSP check via Acorn AST
    const evalHits = findEvalOrFunctionCalls(content);
    if (evalHits.length > 0) {
      const violation: CheckViolation = {
        rule: 'eval-csp',
        severity: requireZeroEval ? 'error' : 'warning',
        message: `Dynamic code evaluation (${evalHits.join(', ')}) detected in "${rel}".`,
        file: rel,
      };
      if (requireZeroEval) {
        violations.push(violation);
      } else {
        warnings.push(violation);
      }
    }
  }

  // 2. .gitignore & .dockerignore check across findMonorepoRoots
  const vaultDir = path.resolve(cwd, privateMapsDir);
  const relVault = path.relative(cwd, vaultDir).replace(/\\/g, '/');
  const ignoreEntry = relVault && !relVault.startsWith('..') ? `${relVault}/` : '.unpeek-maps/';
  const roots = findMonorepoRoots(cwd);

  let foundGitignore = false;
  let gitignoreProtected = false;
  let foundDockerignore = false;
  let dockerignoreProtected = false;

  for (const root of roots) {
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      foundGitignore = true;
      if (hasIgnoreEntry(gitignorePath, ignoreEntry)) {
        gitignoreProtected = true;
      }
    }
    const dockerignorePath = path.join(root, '.dockerignore');
    if (fs.existsSync(dockerignorePath)) {
      foundDockerignore = true;
      if (hasIgnoreEntry(dockerignorePath, ignoreEntry)) {
        dockerignoreProtected = true;
      }
    }
  }

  if (!foundGitignore || !gitignoreProtected) {
    violations.push({
      rule: 'ignore-missing',
      severity: 'error',
      message: `.gitignore is missing "${ignoreEntry}". Private source maps may be committed to Git.`,
    });
  }

  if (!foundDockerignore) {
    warnings.push({
      rule: 'ignore-missing',
      severity: 'warning',
      message: `.dockerignore not found. If using Docker, ensure "${ignoreEntry}" is excluded.`,
    });
  } else if (!dockerignoreProtected) {
    violations.push({
      rule: 'ignore-missing',
      severity: 'error',
      message: `.dockerignore is missing "${ignoreEntry}". Private source maps may leak into Docker images.`,
    });
  }

  // 3. Gzip budget check if baseline/manifest available
  const manifestPath = path.join(vaultDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        gzipDeltaPercent?: number;
      };
      if (
        typeof manifest.gzipDeltaPercent === 'number' &&
        manifest.gzipDeltaPercent > maxGzipDelta
      ) {
        violations.push({
          rule: 'gzip-budget',
          severity: 'error',
          message: `Bundle Gzip delta (${manifest.gzipDeltaPercent}%) exceeds maxGzipDelta (${maxGzipDelta}%).`,
        });
      }
    } catch {
      // ignore malformed manifest
    }
  }

  return {
    passed: violations.length === 0,
    outDir: resolvedOutDir,
    checkedFiles: clientFiles.length,
    violations,
    warnings,
  };
}
