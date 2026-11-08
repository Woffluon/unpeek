import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { ProtectOptions, ProtectSummary } from '../types.js';
import { detectTargetFramework, scanClientBundles } from '../bundler/detector.js';
import { relocateSourceMaps, SOURCE_MAP_COMMENT_REGEX } from '../bundler/sourcemap-vault.js';
import { computeFnv1aHash, transformJavaScript } from '../ast/index.js';
import { generateRuntimeShield } from '../runtime/index.js';

const ENTRY_PATTERN = /^(?:main|index|turbopack|webpack|runtime|app\/layout|app\/page|pages\/_app|pages\/index)[-._/]/i;

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
  const { framework, outDir } = detectTargetFramework(cwd, options.outDir);

  const seed =
    typeof options.seed === 'number'
      ? options.seed
      : Math.floor(Math.random() * 0x7fffffff) || 0x5f3759df;
  const keepPrivateMaps = options.keepPrivateMaps ?? true;
  const privateMapsDir = options.privateMapsDir ?? '.unpeek-maps';
  const deterrentMode = options.deterrentMode ?? 'passive';
  const injectRuntimeShield = options.injectRuntimeShield ?? true;
  const minStringLength = options.minStringLength ?? 4;
  const aggressive = options.aggressive ?? false;

  const vaultResult = relocateSourceMaps(outDir, cwd, keepPrivateMaps, privateMapsDir, false);
  const clientFiles = scanClientBundles(outDir);
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
        deterrentMode,
        aggressive,
      });

      let finalCode = result.code;
      if (shouldInjectShield && !finalCode.includes('__unpeek_tampered')) {
        const shield = generateRuntimeShield({
          seed: fileSeed,
          deterrentMode,
          expectedIntegrityHash: result.integrityToken,
        });
        if (
          shield.preambleCode &&
          !finalCode.includes(shield.integrityCheckFnName) &&
          !finalCode.startsWith(shield.preambleCode)
        ) {
          finalCode = `${shield.preambleCode}\n${finalCode}`;
        }
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
  };
}
