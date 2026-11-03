import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { ProtectOptions, ProtectSummary } from '../types.js';
import { detectTargetFramework, scanClientBundles } from '../bundler/detector.js';
import { relocateSourceMaps } from '../bundler/sourcemap-vault.js';
import { transformJavaScript } from '../ast/index.js';
import { generateRuntimeShield } from '../runtime/index.js';

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
  const deterrentMode = options.deterrentMode ?? 'gradual';
  const injectRuntimeShield = options.injectRuntimeShield ?? true;
  const minStringLength = options.minStringLength ?? 4;

  const vaultResult = relocateSourceMaps(outDir, cwd, keepPrivateMaps, privateMapsDir);
  const clientFiles = scanClientBundles(outDir);

  let originalBytes = 0;
  let protectedBytes = 0;
  let originalGzipBytes = 0;
  let protectedGzipBytes = 0;
  let totalHotFunctionsSkipped = 0;
  let totalColdFunctionsProtected = 0;
  let totalEncryptedStrings = 0;
  let totalMangledSymbols = 0;
  let processedFiles = 0;

  for (let i = 0; i < clientFiles.length; i++) {
    const filePath = clientFiles[i];
    const originalCode = fs.readFileSync(filePath, 'utf8');
    const origBuf = Buffer.from(originalCode, 'utf8');
    originalBytes += origBuf.byteLength;
    originalGzipBytes += zlib.gzipSync(origBuf).byteLength;

    const fileSeed = (seed + i * 2654435761) >>> 0;
    const result = transformJavaScript(originalCode, {
      seed: fileSeed,
      minStringLength,
      filename: path.basename(filePath),
      injectRuntimeShield,
      deterrentMode,
    });

    let finalCode = result.code;
    if (injectRuntimeShield) {
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

    fs.writeFileSync(filePath, finalCode, 'utf8');

    const protBuf = Buffer.from(finalCode, 'utf8');
    protectedBytes += protBuf.byteLength;
    protectedGzipBytes += zlib.gzipSync(protBuf).byteLength;

    totalHotFunctionsSkipped += result.hotPathReport.hotFunctionsSkipped.length;
    totalColdFunctionsProtected += result.hotPathReport.coldFunctionsProtected.length;
    totalEncryptedStrings += result.encryptedStringsCount;
    totalMangledSymbols += result.mangledSymbolsCount;
    processedFiles++;
  }

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
