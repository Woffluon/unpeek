import type { BaseProtectionOptions } from '../config.js';

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
