import type { BaseProtectionOptions, UnpeekFramework, UnpeekProfile } from '../config.js';

export interface ProtectOptions extends BaseProtectionOptions {
  /** Target project root directory (defaults to process.cwd()) */
  cwd?: string;
  /** Explicit client output directory override */
  outDir?: string;
  /** Move .map files to .unpeek-maps/ instead of permanently deleting (default: true) */
  keepPrivateMaps?: boolean;
  /** Private directory to store extracted source maps (default: '.unpeek-maps') */
  privateMapsDir?: string;
  /** Compute summary and Gzip delta in memory without writing files */
  dryRun?: boolean;
  /** Fail with ERR_BUDGET_EXCEEDED if gzipDeltaPercent exceeds this percentage */
  maxGzipDelta?: number;
  /** Scrub local filesystem paths and residual dev metadata (CWE-540) */
  scrubPaths?: boolean;
}

export type UnpeekDiagnosticSeverity = 'info' | 'warning';

export interface UnpeekDiagnostic {
  code: 'DOCKERIGNORE_MISSING' | 'PARSE_FALLBACK' | 'ALREADY_PROTECTED' | 'EMPTY_INPUT';
  severity: UnpeekDiagnosticSeverity;
  message: string;
  file?: string;
}

export interface SourceMapVaultResult {
  movedMapsCount: number;
  strippedFilesCount: number;
  vaultDir: string;
  movedFiles: string[];
  dockerIgnoreMissing?: boolean;
}

export interface ProtectSummary {
  framework: UnpeekFramework;
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
  seed?: number;
  tier?: 'Tier 1' | 'Tier 2';
  aggressive?: boolean;
  dockerIgnoreMissing?: boolean;
  dryRun?: boolean;
  profile?: UnpeekProfile;
  budgetExceeded?: boolean;
  debugIdsPreserved?: number;
  diagnostics?: readonly UnpeekDiagnostic[];
}

export interface InitOptions {
  dryRun?: boolean;
}

export interface InitResult {
  updatedPackageJson: boolean;
  updatedGitignore: boolean;
  updatedNextConfig?: boolean;
  framework?: UnpeekFramework;
  isNext162Plus?: boolean;
  message: string;
}

export interface CheckOptions {
  cwd?: string;
  outDir?: string;
  privateMapsDir?: string;
  maxGzipDelta?: number;
  requireZeroEval?: boolean;
  strictCsp?: boolean;
}

export interface CheckViolation {
  rule: 'public-map' | 'sourcemap-comment' | 'ignore-missing' | 'gzip-budget' | 'eval-csp';
  severity: 'error' | 'warning';
  message: string;
  file?: string;
}

export interface CheckResult {
  passed: boolean;
  outDir: string;
  checkedFiles: number;
  violations: CheckViolation[];
  warnings: CheckViolation[];
}

export interface SymbolicateOptions {
  stackTrace: string;
  mapsDir?: string;
  cwd?: string;
}

export interface SymbolicateFrame {
  raw: string;
  file?: string;
  line?: number;
  column?: number;
  originalSource?: string;
  originalLine?: number;
  originalColumn?: number;
  originalName?: string;
  resolved: boolean;
}

export interface SymbolicateResult {
  stackTrace: string;
  frames: SymbolicateFrame[];
  warnings: string[];
}
