import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as acorn from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import type { ProtectOptions, ProtectSummary, UnpeekDiagnostic } from './types.js';
import type { InternalShieldPayload, InternalTransformOptions } from '../internal/types.js';
import type { UnpeekProfile } from '../config.js';
import { loadUnpeekConfig } from '../config.js';
import {
  detectTargetFramework,
  discoverHtmlEntryGraph,
  hasNextServerSegment,
  type HtmlEntryGraph,
  isWorkerOrServiceWorkerFile,
  scanClientBundles,
} from './detector.js';
import {
  extractDebugId,
  relocateSourceMaps,
  replaceOrAppendDebugId,
  stripDebugIdComments,
  stripSourceMapComments,
} from './sourcemap-vault.js';
import {
  type AnySourceMap,
  type RawSourceMap,
  chainSourceMaps,
  computeDeterministicDebugId,
  flattenSourceMapSections,
  safeDecodeURIComponent,
  shiftSourceMapLines,
} from './vlq.js';
import { computeFnv1aHash, transformJavaScript } from '../ast/index.js';
import { generateRuntimeShield } from '../runtime/index.js';
import { deriveWindowKeySymbol } from '../internal/runtime.js';
import { UnpeekError } from '../shared/errors.js';

const ENTRY_PATTERN = /^(?:webpack|main|index|runtime|turbopack|pages\/_app|pages\/index)(?:[-._/]|$)/i;

function normalizeManifestRel(fileRef: string): string[] {
  const clean = fileRef
    .replace(/\\/g, '/')
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/+/, '');
  const stripped = clean.replace(
    /^(?:_next\/static\/chunks\/|_next\/static\/|_next\/|static\/chunks\/|static\/|assets\/)/,
    ''
  );
  return stripped && stripped !== clean ? [clean, stripped] : [clean];
}

function addManifestEntryCandidates(
  outDir: string,
  manifestRootDir: string,
  fileRef: string,
  target: Set<string>
): void {
  const clean = fileRef.replace(/\\/g, '/').split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (!clean) return;
  const absFromRoot = path.resolve(manifestRootDir, clean);
  const relFromOut = path.relative(outDir, absFromRoot).replace(/\\/g, '/');
  if (relFromOut && !relFromOut.startsWith('..') && !path.isAbsolute(relFromOut)) {
    target.add(relFromOut);
  }
  for (const variant of normalizeManifestRel(clean)) {
    target.add(variant);
  }
}

function collectManifestEntryFiles(
  outDir: string,
  cwd: string,
  config?: { next?: { distDir?: string }; vite?: { outDir?: string } }
): Set<string> {
  const entries = new Set<string>();
  const nextDist = config?.next?.distDir ?? '.next';
  const viteOut = config?.vite?.outDir ?? 'dist';

  const nextManifestCandidates = Array.from(
    new Set([
      path.join(outDir, 'build-manifest.json'),
      path.join(outDir, '..', 'build-manifest.json'),
      path.join(outDir, '..', '..', 'build-manifest.json'),
      path.join(cwd, nextDist, 'build-manifest.json'),
    ])
  );

  for (const manifestPath of nextManifestCandidates) {
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        rootMainFiles?: unknown;
        pages?: Record<string, unknown>;
      };
      const manifestDir = path.dirname(manifestPath);
      const hasRootMain = Array.isArray(parsed.rootMainFiles) && parsed.rootMainFiles.length > 0;
      if (Array.isArray(parsed.rootMainFiles)) {
        for (const item of parsed.rootMainFiles) {
          if (typeof item === 'string') {
            addManifestEntryCandidates(outDir, manifestDir, item, entries);
          }
        }
      }
      if (parsed.pages && typeof parsed.pages === 'object') {
        const priorityKeys = ['/_app', '/', '/index'].filter((k) =>
          Array.isArray(parsed.pages?.[k])
        );
        const pageLists =
          priorityKeys.length > 0
            ? priorityKeys.map((k) => parsed.pages![k])
            : !hasRootMain
              ? Object.values(parsed.pages)
              : [];
        for (const list of pageLists) {
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            if (typeof item === 'string') {
              addManifestEntryCandidates(outDir, manifestDir, item, entries);
            }
          }
        }
      }
      break;
    } catch {
      // ignore malformed build-manifest.json
    }
  }

  const viteManifestCandidates = Array.from(
    new Set([
      path.join(outDir, '.vite', 'manifest.json'),
      path.join(outDir, '..', '.vite', 'manifest.json'),
      path.join(cwd, viteOut, '.vite', 'manifest.json'),
      path.join(outDir, 'manifest.json'),
      path.join(outDir, '..', 'manifest.json'),
    ])
  );

  for (const manifestPath of viteManifestCandidates) {
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;
      // Avoid confusing Next.js or unpeek vault manifests with Vite manifests
      const manifestDir =
        path.basename(path.dirname(manifestPath)) === '.vite'
          ? path.dirname(path.dirname(manifestPath))
          : path.dirname(manifestPath);
      let matchedViteShape = false;
      for (const val of Object.values(parsed)) {
        if (
          val &&
          typeof val === 'object' &&
          'file' in val &&
          typeof (val as { file?: unknown }).file === 'string'
        ) {
          matchedViteShape = true;
          if ((val as { isEntry?: boolean }).isEntry) {
            addManifestEntryCandidates(
              outDir,
              manifestDir,
              (val as { file: string }).file,
              entries
            );
          }
        }
      }
      if (matchedViteShape) break;
    } catch {
      // ignore malformed Vite manifest
    }
  }

  return entries;
}

function matchesManifestEntry(relPath: string, manifestEntries: Set<string>): boolean {
  if (manifestEntries.size === 0) return false;
  for (const candidate of normalizeManifestRel(relPath)) {
    if (manifestEntries.has(candidate)) {
      return true;
    }
  }
  return false;
}

function isEntryChunk(
  relPath: string,
  index: number,
  allRelPaths: string[],
  manifestEntries: Set<string>,
  isWorkerTarget: boolean,
  htmlGraph?: HtmlEntryGraph
): boolean {
  const norm = relPath.replace(/\\/g, '/');
  const base = path.basename(norm);
  if (isWorkerTarget && isWorkerOrServiceWorkerFile(norm)) {
    return true;
  }
  if (htmlGraph?.workerEntryFiles.has(norm)) {
    return true;
  }
  if (matchesManifestEntry(norm, manifestEntries)) {
    return true;
  }

  const hasKnownManifestEntry =
    manifestEntries.size > 0 &&
    allRelPaths.some((p) => matchesManifestEntry(p.replace(/\\/g, '/'), manifestEntries));
  const hasKnownHtmlEntry =
    manifestEntries.size === 0 &&
    Boolean(htmlGraph && allRelPaths.some((p) => htmlGraph.entryFiles.has(p.replace(/\\/g, '/'))));

  if (hasKnownHtmlEntry) {
    return htmlGraph!.entryFiles.has(norm);
  }

  if (ENTRY_PATTERN.test(norm) || ENTRY_PATTERN.test(base)) {
    return true;
  }
  const hasAnyKnownEntry =
    hasKnownManifestEntry ||
    allRelPaths.some((p) => {
      const n = p.replace(/\\/g, '/');
      return ENTRY_PATTERN.test(n) || ENTRY_PATTERN.test(path.basename(n));
    });
  if (!hasAnyKnownEntry && index === 0) {
    return true;
  }
  return false;
}

function readOriginalSourceMapForFile(
  filePath: string,
  relPath: string,
  vaultDir: string,
  deferVaultWrites: boolean
): AnySourceMap | undefined {
  const candidates: string[] = [];
  if (deferVaultWrites) {
    candidates.push(`${filePath}.map`);
  }
  candidates.push(path.join(vaultDir, `${relPath}.map`));
  const decodedRel = safeDecodeURIComponent(relPath);
  if (decodedRel !== relPath) {
    candidates.push(path.join(vaultDir, `${decodedRel}.map`));
  }
  for (const cand of candidates) {
    if (!fs.existsSync(cand)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(cand, 'utf8')) as AnySourceMap;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // ignore malformed .map JSON
    }
  }
  return undefined;
}

function countPreExistingEvalCalls(code: string): string[] {
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

  return hits;
}

interface ProtectManifestPayload {
  version: number;
  outDir?: string;
  originalGzipBytes?: number;
  protectedGzipBytes?: number;
  gzipDeltaPercent?: number;
  preExistingEvalFiles?: Record<string, string[]>;
}

export async function protectProject(options: ProtectOptions = {}): Promise<ProtectSummary> {
  const startTime = performance.now();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const effectiveConfigInput = options.profile
    ? { ...(options.config ?? {}), profile: options.profile }
    : options.config;
  const config = await loadUnpeekConfig(cwd, effectiveConfigInput);
  const effectiveProfile: UnpeekProfile = options.profile ?? config.profile ?? 'recommended';
  const { framework, outDir } = detectTargetFramework(cwd, options.outDir, config);

  const seed =
    typeof options.seed === 'number' && Number.isFinite(options.seed)
      ? options.seed
      : typeof config.seed === 'number' && Number.isFinite(config.seed)
        ? config.seed
        : Math.floor(Math.random() * 0x7fffffff) || 0x5f3759df;
  const dryRun = Boolean(options.dryRun);
  const keepPrivateMaps = options.keepPrivateMaps ?? config.sourcemaps?.keepPrivate ?? true;
  const privateMapsDir = options.privateMapsDir ?? config.sourcemaps?.vaultDir ?? '.unpeek-maps';
  const deterrentMode = options.deterrentMode ?? config.shield?.deterrentMode ?? 'passive';
  const detectHeadless = options.detectHeadless ?? config.shield?.detectHeadless ?? false;
  const injectRuntimeShield =
    options.injectRuntimeShield ?? (effectiveProfile === 'minimal' ? false : true);
  const minStringLength = options.minStringLength ?? config.vault?.minStringLength ?? 4;
  const aggressive = options.aggressive ?? (effectiveProfile === 'strict' ? true : false);
  const scrubPaths = options.scrubPaths ?? config.scrubPaths ?? (effectiveProfile === 'strict' ? true : false);

  const masterSym = deriveWindowKeySymbol(seed);
  const masterShield = injectRuntimeShield
    ? (generateRuntimeShield({
        seed,
        deterrentMode,
        detectHeadless,
        windowKeySymbol: masterSym,
      }) as InternalShieldPayload)
    : undefined;

  const deferVaultWrites = dryRun || typeof options.maxGzipDelta === 'number';
  const vaultResult = relocateSourceMaps(outDir, cwd, keepPrivateMaps, privateMapsDir, false, config, {
    dryRun: deferVaultWrites,
  });
  const clientFiles = scanClientBundles(outDir, config);
  const allRelPaths = clientFiles.map((f) => path.relative(outDir, f).replace(/\\/g, '/'));
  const manifestEntries = collectManifestEntryFiles(outDir, cwd, config);
  const isWorkerTarget = config.target === 'worker';
  const extraHtmlDirs: string[] = [];
  const parentOutDir = path.dirname(outDir);
  const relParent = path.relative(cwd, parentOutDir);
  if (
    relParent &&
    !relParent.startsWith('..') &&
    !path.isAbsolute(relParent) &&
    !hasNextServerSegment(parentOutDir, cwd)
  ) {
    extraHtmlDirs.push(parentOutDir);
  }
  const htmlGraph = discoverHtmlEntryGraph(outDir, config, extraHtmlDirs);

  let originalBytes = 0;
  let protectedBytes = 0;
  let totalHotFunctionsSkipped = 0;
  let totalColdFunctionsProtected = 0;
  let totalEncryptedStrings = 0;
  let totalMangledSymbols = 0;
  let processedFiles = 0;
  let debugIdsPreserved = 0;
  const diagnostics: UnpeekDiagnostic[] = [];

  if (vaultResult.dockerIgnoreMissing) {
    diagnostics.push({
      code: 'DOCKERIGNORE_MISSING',
      severity: 'warning',
      message:
        ".dockerignore is missing .unpeek-maps/. Private maps may leak into Docker image during 'COPY . .'.",
    });
  }

  const allOrigBufs: Buffer[] = [];
  const allProtBufs: Buffer[] = [];
  const stagedFiles: Array<{ tmpPath: string; finalPath: string }> = [];
  const pendingVaultMaps: Array<{ relPath: string; map?: RawSourceMap; debugId?: string }> = [];
  const preExistingEvalFiles: Record<string, string[]> = {};
  let alreadyProtectedCount = 0;

  const manifestPath = path.join(vaultResult.vaultDir, 'manifest.json');
  let existingManifest: ProtectManifestPayload | undefined;
  if (!dryRun && fs.existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existingManifest = parsed as ProtectManifestPayload;
      }
    } catch {
      // ignore malformed manifest
    }
  }

  let originalGzipBytes = 0;
  let protectedGzipBytes = 0;
  let gzipDeltaPercent = 0;
  let budgetExceeded = false;

  try {
    for (let i = 0; i < clientFiles.length; i++) {
      const filePath = clientFiles[i];
      let codeToTransform = fs.readFileSync(filePath, 'utf8');
      const fileDebugId = extractDebugId(codeToTransform);

      if (codeToTransform.includes('sourceMappingURL=')) {
        const strippedRes = stripSourceMapComments(codeToTransform);
        codeToTransform = strippedRes.code;
        if (strippedRes.stripped) {
          vaultResult.strippedFilesCount++;
        }
      }

      const origBuf = Buffer.from(codeToTransform, 'utf8');
      originalBytes += origBuf.byteLength;
      allOrigBufs.push(origBuf);

      const relPath = allRelPaths[i];
      const originalMap = keepPrivateMaps
        ? readOriginalSourceMapForFile(filePath, relPath, vaultResult.vaultDir, deferVaultWrites)
        : undefined;
      const preExistingHits = countPreExistingEvalCalls(codeToTransform);
      const isEntry = isEntryChunk(
        relPath,
        i,
        allRelPaths,
        manifestEntries,
        isWorkerTarget,
        htmlGraph
      );
      const shouldInjectShield = injectRuntimeShield && isEntry;
      const fileSeed = computeFnv1aHash(`${relPath}:${i}`, seed);
      const transformOptions: InternalTransformOptions = {
        seed: fileSeed,
        minStringLength,
        filename: path.basename(filePath),
        injectRuntimeShield: shouldInjectShield,
        skipShieldPreamble: true,
        shieldCoupled: injectRuntimeShield,
        windowKeySymbol: masterSym,
        expectedDelta: masterShield?.expectedDelta,
        expectedStateHash: masterShield?.expectedStateHash,
        originalSourceMap: originalMap,
        deterrentMode,
        detectHeadless,
        aggressive,
        scrubPaths,
        config,
        generateMap: keepPrivateMaps,
        rootDir: cwd,
      };
      const result = transformJavaScript(codeToTransform, transformOptions);

      if (result.skippedReason === 'parse-error') {
        diagnostics.push({
          code: 'PARSE_FALLBACK',
          severity: 'warning',
          message: `Skipped AST transform due to parse error in "${relPath}".`,
          file: relPath,
        });
      } else if (result.skippedReason === 'already-protected') {
        alreadyProtectedCount++;
        const prevHits = existingManifest?.preExistingEvalFiles?.[relPath];
        if (Array.isArray(prevHits) && prevHits.length > 0) {
          preExistingEvalFiles[relPath] = prevHits;
        } else if (preExistingHits.length > 0) {
          preExistingEvalFiles[relPath] = preExistingHits;
        }
        diagnostics.push({
          code: 'ALREADY_PROTECTED',
          severity: 'info',
          message: `File "${relPath}" is already protected.`,
          file: relPath,
        });
      } else if (result.skippedReason === 'empty') {
        diagnostics.push({
          code: 'EMPTY_INPUT',
          severity: 'info',
          message: `File "${relPath}" is empty.`,
          file: relPath,
        });
      } else if (preExistingHits.length > 0) {
        preExistingEvalFiles[relPath] = preExistingHits;
      }

      let finalCode = result.code;
      let preambleLineOffset = 0;
      if (
        shouldInjectShield &&
        masterShield?.preambleCode &&
        !finalCode.includes(masterShield.integrityCheckFnName) &&
        !finalCode.startsWith(masterShield.preambleCode)
      ) {
        const prefix = `${masterShield.preambleCode}\n`;
        preambleLineOffset = (prefix.match(/\n/g) ?? []).length;
        finalCode = `${prefix}${finalCode}`;
      }

      const rawTransformMap = (result as { sourceMap?: RawSourceMap }).sourceMap;
      const shiftedTransformMap = rawTransformMap
        ? shiftSourceMapLines(rawTransformMap, preambleLineOffset)
        : undefined;

      let composedMap: RawSourceMap | undefined;
      if (shiftedTransformMap && originalMap) {
        composedMap = chainSourceMaps(shiftedTransformMap, originalMap);
      } else if (originalMap) {
        composedMap = flattenSourceMapSections(originalMap);
      } else if (shiftedTransformMap) {
        composedMap = shiftedTransformMap;
      }

      const originalMapDebugId = originalMap?.debugId ?? originalMap?.debug_id;
      const hadDebugId = Boolean(fileDebugId || originalMapDebugId || result.debugId);
      const shouldMintDebugId =
        hadDebugId ||
        (keepPrivateMaps && !result.skippedReason && Boolean(composedMap || originalMap));
      let mintedDebugId: string | undefined;

      if (shouldMintDebugId) {
        const codeWithoutDebugId = stripDebugIdComments(finalCode);
        mintedDebugId = computeDeterministicDebugId(
          codeWithoutDebugId,
          composedMap?.mappings ?? ''
        );
        finalCode = replaceOrAppendDebugId(codeWithoutDebugId, mintedDebugId);
        if (composedMap) {
          composedMap.debugId = mintedDebugId;
          delete composedMap.debug_id;
        }
        debugIdsPreserved++;
      }

      if (!dryRun && keepPrivateMaps && (composedMap || mintedDebugId)) {
        pendingVaultMaps.push({ relPath, map: composedMap, debugId: mintedDebugId });
      }

      if (!dryRun) {
        const tmpPath = `${filePath}.unpeek.tmp`;
        fs.writeFileSync(tmpPath, finalCode, 'utf8');
        stagedFiles.push({ tmpPath, finalPath: filePath });
      }

      const protBuf = Buffer.from(finalCode, 'utf8');
      protectedBytes += protBuf.byteLength;
      allProtBufs.push(protBuf);

      totalHotFunctionsSkipped += result.hotPathReport.hotFunctionsSkipped.length;
      totalColdFunctionsProtected += result.hotPathReport.coldFunctionsProtected.length;
      totalEncryptedStrings += result.encryptedStringsCount;
      totalMangledSymbols += result.mangledSymbolsCount;
      processedFiles++;
    }

    originalGzipBytes =
      allOrigBufs.length > 0 ? zlib.gzipSync(Buffer.concat(allOrigBufs)).byteLength : 0;
    protectedGzipBytes =
      allProtBufs.length > 0 ? zlib.gzipSync(Buffer.concat(allProtBufs)).byteLength : 0;

    gzipDeltaPercent =
      originalGzipBytes > 0
        ? Number((((protectedGzipBytes - originalGzipBytes) / originalGzipBytes) * 100).toFixed(2))
        : 0;

    budgetExceeded =
      typeof options.maxGzipDelta === 'number' && gzipDeltaPercent > options.maxGzipDelta;

    if (budgetExceeded && !dryRun) {
      throw new UnpeekError(
        'ERR_BUDGET_EXCEEDED',
        `Protected bundle Gzip delta (${gzipDeltaPercent}%) exceeded maxGzipDelta (${options.maxGzipDelta}%).`
      );
    }

    if (!dryRun) {
      if (deferVaultWrites) {
        const finalVaultResult = relocateSourceMaps(
          outDir,
          cwd,
          keepPrivateMaps,
          privateMapsDir,
          false,
          config,
          { dryRun: false }
        );
        vaultResult.movedMapsCount = finalVaultResult.movedMapsCount;
        vaultResult.vaultDir = finalVaultResult.vaultDir;
        vaultResult.movedFiles = finalVaultResult.movedFiles;
        vaultResult.dockerIgnoreMissing = finalVaultResult.dockerIgnoreMissing;
      }
      for (const { relPath, map, debugId } of pendingVaultMaps) {
        const vaultedMapPath = path.join(vaultResult.vaultDir, `${relPath}.map`);
        const decodedMapPath = path.join(
          vaultResult.vaultDir,
          `${safeDecodeURIComponent(relPath)}.map`
        );
        const targetMapPath = fs.existsSync(vaultedMapPath)
          ? vaultedMapPath
          : fs.existsSync(decodedMapPath)
            ? decodedMapPath
            : vaultedMapPath;
        if (map) {
          try {
            fs.mkdirSync(path.dirname(targetMapPath), { recursive: true });
            fs.writeFileSync(targetMapPath, JSON.stringify(map), 'utf8');
          } catch {
            // ignore write error on vaulted map
          }
        } else if (debugId && fs.existsSync(targetMapPath)) {
          try {
            const mapJson = JSON.parse(fs.readFileSync(targetMapPath, 'utf8')) as Record<
              string,
              unknown
            >;
            mapJson.debugId = debugId;
            delete mapJson.debug_id;
            fs.writeFileSync(targetMapPath, JSON.stringify(mapJson), 'utf8');
          } catch {
            // ignore malformed map JSON
          }
        }
      }
      for (const { tmpPath, finalPath } of stagedFiles) {
        fs.renameSync(tmpPath, finalPath);
      }

      const relVault = path.relative(cwd, vaultResult.vaultDir);
      const isSafeVaultDir =
        relVault === '' || (!relVault.startsWith('..') && !path.isAbsolute(relVault));
      if (isSafeVaultDir) {
        const relOutDir = path.relative(cwd, outDir).replace(/\\/g, '/') || '.';
        const manifestPayload: ProtectManifestPayload =
          processedFiles > 0 && alreadyProtectedCount === processedFiles && existingManifest
            ? {
                version: 1,
                outDir: existingManifest.outDir ?? relOutDir,
                originalGzipBytes: existingManifest.originalGzipBytes ?? originalGzipBytes,
                protectedGzipBytes: existingManifest.protectedGzipBytes ?? protectedGzipBytes,
                gzipDeltaPercent: existingManifest.gzipDeltaPercent ?? gzipDeltaPercent,
                preExistingEvalFiles: {
                  ...(existingManifest.preExistingEvalFiles ?? {}),
                  ...preExistingEvalFiles,
                },
              }
            : {
                version: 1,
                outDir: relOutDir,
                originalGzipBytes,
                protectedGzipBytes,
                gzipDeltaPercent,
                preExistingEvalFiles,
              };
        try {
          fs.mkdirSync(vaultResult.vaultDir, { recursive: true });
          fs.writeFileSync(manifestPath, JSON.stringify(manifestPayload, null, 2), 'utf8');
        } catch {
          // ignore non-fatal manifest write errors
        }
      }
    }
  } catch (error) {
    for (const { tmpPath } of stagedFiles) {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore cleanup failures
        }
      }
    }
    throw error;
  }

  const elapsedMs = Math.max(1, Math.round(performance.now() - startTime));
  const resolvedTier =
    options.tier ??
    (effectiveProfile === 'strict' || aggressive
      ? 'Tier 3'
      : effectiveProfile === 'minimal'
        ? 'Tier 1'
        : config.tier ?? 'Tier 2');

  return {
    framework,
    outDir,
    processedFiles,
    movedSourceMaps: vaultResult.movedMapsCount,
    originalBytes,
    protectedBytes,
    originalGzipBytes,
    protectedGzipBytes,
    gzipDeltaPercent,
    totalHotFunctionsSkipped,
    totalColdFunctionsProtected,
    totalEncryptedStrings,
    totalMangledSymbols,
    elapsedMs,
    seed,
    tier: resolvedTier,
    aggressive,
    deterrentMode,
    detectHeadless,
    dockerIgnoreMissing: vaultResult.dockerIgnoreMissing,
    dryRun,
    profile: effectiveProfile,
    budgetExceeded,
    debugIdsPreserved,
    diagnostics,
  };
}
