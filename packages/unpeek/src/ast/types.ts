import type { BaseProtectionOptions, CriticalConfig } from '../config.js';

export interface HotPathReport {
  totalFunctions: number;
  hotFunctionsSkipped: string[];
  coldFunctionsProtected: string[];
}

export type TransformSkippedReason = 'empty' | 'already-protected' | 'parse-error';

export interface ScrubberOptions {
  scrubPaths?: boolean;
  rootDir?: string;
  exemptStrings?: string[];
}

export interface TransformOptions extends BaseProtectionOptions {
  filename?: string;
  /** Project root directory stripped by the CWE-540 path scrubber */
  rootDir?: string;
  /** Tier 3 critical enclave targeting overrides */
  critical?: CriticalConfig;
  /** Generate an M2 Source Map v3 alongside the transformed output */
  map?: boolean;
  /** Throw UnpeekError on JavaScript parse failures instead of returning input unchanged */
  strict?: boolean;
  /** Scrub local filesystem paths and residual dev metadata (CWE-540) */
  scrubPaths?: boolean;
}

export interface TransformResult {
  code: string;
  encryptedStringsCount: number;
  mangledSymbolsCount: number;
  hotPathReport: HotPathReport;
  integrityToken: number;
  virtualizedFunctionsCount?: number;
  skippedReason?: TransformSkippedReason;
  debugId?: string;
}
