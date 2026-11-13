import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { ProtectOptions, ProtectSummary, UnpeekDiagnostic } from './types.js';
import type { InternalShieldPayload, InternalTransformOptions } from '../internal/types.js';
import type { UnpeekProfile } from '../config.js';
import { loadUnpeekConfig } from '../config.js';
import { detectTargetFramework, scanClientBundles } from './detector.js';
import {
  DEBUG_ID_COMMENT_REGEX,
  extractDebugId,
  relocateSourceMaps,
  stripSourceMapComments,
} from './sourcemap-vault.js';
import { computeFnv1aHash, transformJavaScript } from '../ast/index.js';
import { generateRuntimeShield } from '../runtime/index.js';
import { deriveWindowKeySymbol } from '../internal/runtime.js';
import { UnpeekError } from '../shared/errors.js';

const ENTRY_PATTERN = /^(?:webpack|main|index|runtime|turbopack|pages\/_app|pages\/index)(?:[-._/]|$)/i;

function isEntryChunk(relPath: string, index: number, allRelPaths: string[]): boolean {
  const norm = relPath.replace(/\\/g, '/');
  const base = path.basename(norm);
  if (ENTRY_PATTERN.test(norm) || ENTRY_PATTERN.test(base)) {
    return true;
  }
  const hasAnyPatternMatch = allRelPaths.some((p) => {
    const n = p.replace(/\\/g, '/');
    return ENTRY_PATTERN.test(n) || ENTRY_PATTERN.test(path.basename(n));
  });
  if (!hasAnyPatternMatch && index === 0) {
    return true;
  }
  return false;
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
    typeof options.seed === 'number'
      ? options.seed
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
  const pendingDebugIds: Array<{ relPath: string; debugId: string }> = [];

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
      const isEntry = isEntryChunk(relPath, i, allRelPaths);
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
        deterrentMode,
        detectHeadless,
        aggressive,
        scrubPaths,
        config,
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
      }

      let finalCode = result.code;
      if (
        shouldInjectShield &&
        masterShield?.preambleCode &&
        !finalCode.includes('__unpeek_tampered') &&
        !finalCode.includes(masterShield.integrityCheckFnName) &&
        !finalCode.startsWith(masterShield.preambleCode)
      ) {
        finalCode = `${masterShield.preambleCode}\n${finalCode}`;
      }

      const effectiveDebugId = result.debugId ?? fileDebugId;
      if (effectiveDebugId) {
        if (!DEBUG_ID_COMMENT_REGEX.test(finalCode)) {
          const suffix = finalCode.length > 0 && !finalCode.endsWith('\n') ? '\n' : '';
          finalCode = `${finalCode}${suffix}//# debugId=${effectiveDebugId}\n`;
        }
        debugIdsPreserved++;

        if (!dryRun && keepPrivateMaps) {
          pendingDebugIds.push({ relPath, debugId: effectiveDebugId });
        }
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
      for (const { relPath, debugId } of pendingDebugIds) {
        const vaultedMapPath = path.join(vaultResult.vaultDir, `${relPath}.map`);
        if (fs.existsSync(vaultedMapPath)) {
          try {
            const mapJson = JSON.parse(fs.readFileSync(vaultedMapPath, 'utf8')) as Record<
              string,
              unknown
            >;
            if (!mapJson.debugId) {
              mapJson.debugId = debugId;
              fs.writeFileSync(vaultedMapPath, JSON.stringify(mapJson), 'utf8');
            }
          } catch {
            // ignore malformed map JSON
          }
        }
      }
      for (const { tmpPath, finalPath } of stagedFiles) {
        fs.renameSync(tmpPath, finalPath);
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
    tier: aggressive ? 'Tier 2' : 'Tier 1',
    aggressive,
    dockerIgnoreMissing: vaultResult.dockerIgnoreMissing,
    dryRun,
    profile: effectiveProfile,
    budgetExceeded,
    debugIdsPreserved,
    diagnostics,
  };
}
