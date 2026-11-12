import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { ProtectOptions, ProtectSummary } from '../types.js';
import { loadUnpeekConfig } from '../config.js';
import { detectTargetFramework, scanClientBundles } from '../bundler/detector.js';
import { relocateSourceMaps, SOURCE_MAP_COMMENT_REGEX } from '../bundler/sourcemap-vault.js';
import { computeFnv1aHash, transformJavaScript } from '../ast/index.js';
import { deriveWindowKeySymbol, generateRuntimeShield } from '../runtime/index.js';

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
  const config = await loadUnpeekConfig(cwd, options.config);
  const { framework, outDir } = detectTargetFramework(cwd, options.outDir, config);

  const seed =
    typeof options.seed === 'number'
      ? options.seed
      : Math.floor(Math.random() * 0x7fffffff) || 0x5f3759df;
  const keepPrivateMaps = options.keepPrivateMaps ?? config.sourcemaps?.keepPrivate ?? true;
  const privateMapsDir = options.privateMapsDir ?? config.sourcemaps?.vaultDir ?? '.unpeek-maps';
  const deterrentMode = options.deterrentMode ?? config.shield?.deterrentMode ?? 'passive';
  const detectHeadless = options.detectHeadless ?? config.shield?.detectHeadless ?? false;
  const injectRuntimeShield = options.injectRuntimeShield ?? true;
  const minStringLength = options.minStringLength ?? config.vault?.minStringLength ?? 4;
  const aggressive = options.aggressive ?? false;

  const masterSym = deriveWindowKeySymbol(seed);
  const masterShield = injectRuntimeShield
    ? generateRuntimeShield({
        seed,
        deterrentMode,
        detectHeadless,
        windowKeySymbol: masterSym,
      })
    : undefined;

  const vaultResult = relocateSourceMaps(outDir, cwd, keepPrivateMaps, privateMapsDir, false, config);
  const clientFiles = scanClientBundles(outDir, config);
  const allRelPaths = clientFiles.map((f) => path.relative(outDir, f).replace(/\\/g, '/'));

  let originalBytes = 0;
  let protectedBytes = 0;
  let totalHotFunctionsSkipped = 0;
  let totalColdFunctionsProtected = 0;
  let totalEncryptedStrings = 0;
  let totalMangledSymbols = 0;
  let processedFiles = 0;

  const allOrigBufs: Buffer[] = [];
  const allProtBufs: Buffer[] = [];
  const stagedFiles: Array<{ tmpPath: string; finalPath: string }> = [];

  try {
    for (let i = 0; i < clientFiles.length; i++) {
      const filePath = clientFiles[i];
      let codeToTransform = fs.readFileSync(filePath, 'utf8');

      if (codeToTransform.includes('sourceMappingURL=')) {
        codeToTransform = codeToTransform.replace(SOURCE_MAP_COMMENT_REGEX, '');
        vaultResult.strippedFilesCount++;
      }

      const origBuf = Buffer.from(codeToTransform, 'utf8');
      originalBytes += origBuf.byteLength;
      allOrigBufs.push(origBuf);

      const relPath = allRelPaths[i];
      const isEntry = isEntryChunk(relPath, i, allRelPaths);
      const shouldInjectShield = injectRuntimeShield && isEntry;
      const fileSeed = computeFnv1aHash(`${relPath}:${i}`, seed);
      const result = transformJavaScript(codeToTransform, {
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
        config,
      });

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

      const tmpPath = `${filePath}.unpeek.tmp`;
      fs.writeFileSync(tmpPath, finalCode, 'utf8');
      stagedFiles.push({ tmpPath, finalPath: filePath });

      const protBuf = Buffer.from(finalCode, 'utf8');
      protectedBytes += protBuf.byteLength;
      allProtBufs.push(protBuf);

      totalHotFunctionsSkipped += result.hotPathReport.hotFunctionsSkipped.length;
      totalColdFunctionsProtected += result.hotPathReport.coldFunctionsProtected.length;
      totalEncryptedStrings += result.encryptedStringsCount;
      totalMangledSymbols += result.mangledSymbolsCount;
      processedFiles++;
    }

    for (const { tmpPath, finalPath } of stagedFiles) {
      fs.renameSync(tmpPath, finalPath);
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

  const originalGzipBytes =
    allOrigBufs.length > 0 ? zlib.gzipSync(Buffer.concat(allOrigBufs)).byteLength : 0;
  const protectedGzipBytes =
    allProtBufs.length > 0 ? zlib.gzipSync(Buffer.concat(allProtBufs)).byteLength : 0;

  const gzipDeltaPercent =
    originalGzipBytes > 0
      ? Number((((protectedGzipBytes - originalGzipBytes) / originalGzipBytes) * 100).toFixed(2))
      : 0;

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
    tier: aggressive ? 'Tier 2' : 'Tier 1',
    aggressive,
    dockerIgnoreMissing: vaultResult.dockerIgnoreMissing,
  };
}
