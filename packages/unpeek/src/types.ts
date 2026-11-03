export type DetectedFramework = 'nextjs' | 'vite' | 'webpack' | 'vanilla';

export type DeterrentMode = 'gradual' | 'passive';

export interface ProtectOptions {
  /** Target project root directory (defaults to process.cwd()) */
  cwd?: string;
  /** Explicit client output directory override */
  outDir?: string;
  /** Polymorphic deterministic seed (defaults to random per build) */
  seed?: number;
  /** Move .map files to .unpeek-maps/ instead of permanently deleting (default: true) */
  keepPrivateMaps?: boolean;
  /** Private directory to store extracted source maps (default: '.unpeek-maps') */
  privateMapsDir?: string;
  /** Runtime anti-tamper deterrent mode (default: 'gradual') */
  deterrentMode?: DeterrentMode;
  /** Inject runtime integrity and DevTools shield into entry chunks (default: true) */
  injectRuntimeShield?: boolean;
  /** Minimum string length to encrypt in the O(1) lazy string vault (default: 4) */
  minStringLength?: number;
}

export interface HotPathReport {
  totalFunctions: number;
  hotFunctionsSkipped: string[];
  coldFunctionsProtected: string[];
}

export interface TransformOptions {
  seed?: number;
  minStringLength?: number;
  filename?: string;
  injectRuntimeShield?: boolean;
  deterrentMode?: DeterrentMode;
}

export interface TransformResult {
  code: string;
  encryptedStringsCount: number;
  mangledSymbolsCount: number;
  hotPathReport: HotPathReport;
  integrityToken: number;
}

export interface ShieldConfig {
  seed: number;
  deterrentMode: DeterrentMode;
  expectedIntegrityHash?: number;
}

export interface ShieldPayload {
  preambleCode: string;
  integrityCheckFnName: string;
  expectedHash: number;
}

export interface SourceMapVaultResult {
  movedMapsCount: number;
  strippedFilesCount: number;
  vaultDir: string;
  movedFiles: string[];
}

export interface ProtectSummary {
  framework: DetectedFramework;
  outDir: string;
  processedFiles: number;
  movedSourceMaps: number;
  originalBytes: number;
  protectedBytes: number;
  originalGzipBytes: number;
  protectedGzipBytes: number;
  gzipDeltaPercent: number;
  totalHotFunctionsSkipped: number;
  totalColdFunctionsProtected: number;
  totalEncryptedStrings: number;
  totalMangledSymbols: number;
  elapsedMs: number;
}
