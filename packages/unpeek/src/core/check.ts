import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import type { CheckOptions, CheckResult, CheckViolation } from './types.js';
import { loadUnpeekConfig } from '../config.js';
import { detectTargetFramework, hasNextServerSegment, scanClientBundles } from './detector.js';
import { extractDebugId, findMonorepoRoots, SOURCE_MAP_COMMENT_REGEX } from './sourcemap-vault.js';
import {
  type AnySourceMap,
  flattenSourceMapSections,
  resolvePosition,
  safeDecodeURIComponent,
} from './vlq.js';

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

interface EvalCallHit {
  kind: 'eval(...)' | 'Function(...)' | 'new Function(...)';
  line: number;
  column: number;
  calleeLine: number;
  calleeColumn: number;
  vendorIdiom: boolean;
}

interface CheckManifestPayload {
  outDir?: string;
  originalGzipBytes?: number;
  gzipDeltaPercent?: number;
  preExistingEvalFiles?: Record<string, string[]>;
}

function isEs5GlobalThisIdiom(
  args: Array<acorn.Expression | acorn.SpreadElement>
): boolean {
  if (args.length !== 1) return false;
  const arg = args[0];
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    const trimmed = arg.value.trim().replace(/;+$/, '').trim();
    return trimmed === 'return this';
  }
  return false;
}

function isNodeModulesSource(sourcePath: string | undefined): boolean {
  if (!sourcePath) return false;
  const normalized = sourcePath.replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)node_modules\//.test(normalized);
}

function mapHasOnlyNodeModulesSources(map: AnySourceMap | undefined): boolean {
  if (!map) return false;
  const flat = Array.isArray(map.sections) ? flattenSourceMapSections(map) : map;
  const sources = Array.isArray(flat.sources) ? flat.sources : [];
  if (sources.length === 0) return false;
  const root = flat.sourceRoot;
  return sources.every((src) => {
    const combined =
      root && src && !src.startsWith(root)
        ? `${root.replace(/\/$/, '')}/${src.replace(/^\//, '')}`
        : src;
    return isNodeModulesSource(combined);
  });
}

function isHitFromNodeModules(
  hit: EvalCallHit,
  map: AnySourceMap | undefined,
  allSourcesNodeModules: boolean
): boolean {
  if (!map) return false;
  const pos = resolvePosition(map, hit.line, hit.column);
  if (pos.source) {
    return isNodeModulesSource(pos.source);
  }
  if (hit.calleeLine !== hit.line || hit.calleeColumn !== hit.column) {
    const calleePos = resolvePosition(map, hit.calleeLine, hit.calleeColumn);
    if (calleePos.source) {
      return isNodeModulesSource(calleePos.source);
    }
  }
  return allSourcesNodeModules;
}

function findEvalOrFunctionCalls(code: string): EvalCallHit[] {
  const hits: EvalCallHit[] = [];
  let ast: acorn.Program;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch {
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowReturnOutsideFunction: true,
        locations: true,
      });
    } catch {
      return hits;
    }
  }

  walkSimple(ast, {
    CallExpression(node) {
      if (node.callee.type === 'Identifier') {
        const line = node.loc ? node.loc.start.line : 1;
        const column = node.loc ? node.loc.start.column + 1 : 1;
        const calleeLine = node.callee.loc ? node.callee.loc.start.line : line;
        const calleeColumn = node.callee.loc ? node.callee.loc.start.column + 1 : column;
        if (node.callee.name === 'eval') {
          hits.push({
            kind: 'eval(...)',
            line,
            column,
            calleeLine,
            calleeColumn,
            vendorIdiom: false,
          });
        } else if (node.callee.name === 'Function') {
          hits.push({
            kind: 'Function(...)',
            line,
            column,
            calleeLine,
            calleeColumn,
            vendorIdiom: isEs5GlobalThisIdiom(node.arguments),
          });
        }
      }
    },
    NewExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'Function') {
        const line = node.loc ? node.loc.start.line : 1;
        const column = node.loc ? node.loc.start.column + 1 : 1;
        const calleeLine = node.callee.loc ? node.callee.loc.start.line : line;
        const calleeColumn = node.callee.loc ? node.callee.loc.start.column + 1 : column;
        hits.push({
          kind: 'new Function(...)',
          line,
          column,
          calleeLine,
          calleeColumn,
          vendorIdiom: isEs5GlobalThisIdiom(node.arguments),
        });
      }
    },
  });

  return hits;
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

  const vaultDir = path.resolve(cwd, privateMapsDir);
  const manifestPath = path.join(vaultDir, 'manifest.json');
  let manifest: CheckManifestPayload | undefined;
  if (fs.existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        manifest = parsed as CheckManifestPayload;
      }
    } catch {
      // ignore malformed manifest
    }
  }

  const clientFiles = scanClientBundles(resolvedOutDir, config);
  for (const filePath of clientFiles) {
    const rel = path.relative(resolvedOutDir, filePath).replace(/\\/g, '/');
    const relFromManifest =
      typeof manifest?.outDir === 'string'
        ? path.relative(path.resolve(cwd, manifest.outDir), filePath).replace(/\\/g, '/')
        : undefined;
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

    const jsDebugId = extractDebugId(content);
    const decodedRel = safeDecodeURIComponent(rel);
    const decodedManifestRel = relFromManifest ? safeDecodeURIComponent(relFromManifest) : undefined;
    const mapCandidates = [
      path.join(vaultDir, `${rel}.map`),
      ...(decodedRel !== rel ? [path.join(vaultDir, `${decodedRel}.map`)] : []),
      ...(relFromManifest && relFromManifest !== rel
        ? [path.join(vaultDir, `${relFromManifest}.map`)]
        : []),
      ...(decodedManifestRel && decodedManifestRel !== relFromManifest
        ? [path.join(vaultDir, `${decodedManifestRel}.map`)]
        : []),
    ];
    const vaultedMapPath = mapCandidates.find((p) => fs.existsSync(p));
    let vaultedMap: AnySourceMap | undefined;
    if (vaultedMapPath) {
      try {
        const mapJson = JSON.parse(fs.readFileSync(vaultedMapPath, 'utf8')) as AnySourceMap & {
          debugId?: unknown;
          debug_id?: unknown;
        };
        vaultedMap = mapJson;
        const rawMapDebugId =
          typeof mapJson.debugId === 'string'
            ? mapJson.debugId
            : typeof mapJson.debug_id === 'string'
              ? mapJson.debug_id
              : undefined;
        if (jsDebugId && rawMapDebugId && jsDebugId !== rawMapDebugId) {
          violations.push({
            rule: 'debugid-mismatch',
            severity: 'error',
            message: `debugId mismatch for "${rel}": JS has "${jsDebugId}" while vaulted map has "${rawMapDebugId}".`,
            file: rel,
          });
        } else if (jsDebugId && !rawMapDebugId) {
          warnings.push({
            rule: 'debugid-mismatch',
            severity: 'warning',
            message: `JS bundle "${rel}" has debugId "${jsDebugId}" but vaulted source map is missing debugId.`,
            file: rel,
          });
        } else if (!jsDebugId && rawMapDebugId) {
          warnings.push({
            rule: 'debugid-mismatch',
            severity: 'warning',
            message: `Vaulted source map for "${rel}" has debugId "${rawMapDebugId}" but JS bundle is missing //# debugId=.`,
            file: rel,
          });
        }
      } catch {
        // ignore malformed vaulted map JSON
      }
    } else if (jsDebugId) {
      warnings.push({
        rule: 'debugid-mismatch',
        severity: 'warning',
        message: `JS bundle "${rel}" has debugId "${jsDebugId}" but no vaulted source map found at "${rel}.map".`,
        file: rel,
      });
    }

    // 4. Zero-eval CSP check via Acorn AST + vendor idiom / SourceMap provenance / baseline delta
    const evalHits = findEvalOrFunctionCalls(content);
    if (evalHits.length > 0) {
      if (!requireZeroEval) {
        const kinds = Array.from(new Set(evalHits.map((h) => h.kind)));
        warnings.push({
          rule: 'eval-csp',
          severity: 'warning',
          message: `Dynamic code evaluation (${kinds.join(', ')}) detected in "${rel}".`,
          file: rel,
        });
      } else {
        const allNodeModules = mapHasOnlyNodeModulesSources(vaultedMap);
        const baselineList =
          manifest?.preExistingEvalFiles?.[rel] ??
          (relFromManifest ? manifest?.preExistingEvalFiles?.[relFromManifest] : undefined);
        const remainingBaseline = new Map<string, number>();
        if (Array.isArray(baselineList)) {
          for (const entry of baselineList) {
            remainingBaseline.set(entry, (remainingBaseline.get(entry) ?? 0) + 1);
          }
        }

        const warningHits: EvalCallHit[] = [];
        const unattributedHits: EvalCallHit[] = [];

        // Pass 1: Exempt ES5 globalThis idioms and node_modules source map hits first,
        // consuming baseline slots so injected calls cannot hide behind exempt vendor hits.
        for (const hit of evalHits) {
          if (hit.vendorIdiom || isHitFromNodeModules(hit, vaultedMap, allNodeModules)) {
            warningHits.push(hit);
            const rem = remainingBaseline.get(hit.kind) ?? 0;
            if (rem > 0) {
              remainingBaseline.set(hit.kind, rem - 1);
            }
          } else {
            unattributedHits.push(hit);
          }
        }

        // Pass 2: Attribute remaining hits against pre-protection baseline budget.
        const errorHits: EvalCallHit[] = [];
        for (const hit of unattributedHits) {
          const rem = remainingBaseline.get(hit.kind) ?? 0;
          if (rem > 0) {
            remainingBaseline.set(hit.kind, rem - 1);
            warningHits.push(hit);
          } else {
            errorHits.push(hit);
          }
        }

        if (warningHits.length > 0) {
          const warningKinds = Array.from(new Set(warningHits.map((h) => h.kind)));
          warnings.push({
            rule: 'eval-csp',
            severity: 'warning',
            message: `Pre-existing or vendor dynamic code evaluation (${warningKinds.join(', ')}) detected in "${rel}".`,
            file: rel,
          });
        }
        if (errorHits.length > 0) {
          const errorKinds = Array.from(new Set(errorHits.map((h) => h.kind)));
          violations.push({
            rule: 'eval-csp',
            severity: 'error',
            message: `Dynamic code evaluation (${errorKinds.join(', ')}) detected in "${rel}".`,
            file: rel,
          });
        }
      }
    }
  }

  // 2. .gitignore & .dockerignore check across findMonorepoRoots
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
  if (
    manifest &&
    typeof manifest.gzipDeltaPercent === 'number' &&
    manifest.gzipDeltaPercent > maxGzipDelta
  ) {
    const isTinyBundleBaseline =
      options.maxGzipDelta === undefined &&
      typeof manifest.originalGzipBytes === 'number' &&
      manifest.originalGzipBytes < 16_384;
    if (isTinyBundleBaseline) {
      warnings.push({
        rule: 'gzip-budget',
        severity: 'warning',
        message: `Bundle Gzip delta (${manifest.gzipDeltaPercent}%) exceeds default ${maxGzipDelta}% threshold on small bundle (${manifest.originalGzipBytes} B original gzip).`,
      });
    } else {
      violations.push({
        rule: 'gzip-budget',
        severity: 'error',
        message: `Bundle Gzip delta (${manifest.gzipDeltaPercent}%) exceeds maxGzipDelta (${maxGzipDelta}%).`,
      });
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
