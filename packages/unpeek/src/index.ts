export type {
  BaseProtectionOptions,
  ConfigTarget,
  FilterConfig,
  HotPathConfig,
  ManglerConfig,
  NextConfigOptions,
  PatternInput,
  SemanticAnchorsConfig,
  ShieldOptionsConfig,
  SourcemapsConfig,
  UnpeekConfig,
  UnpeekFramework,
  UnpeekPluginOptions,
  UnpeekProfile,
  VaultConfig,
  ViteConfigOptions,
} from './config.js';

export type {
  HotPathReport,
  ScrubberOptions,
  TransformOptions,
  TransformResult,
  TransformSkippedReason,
} from './ast/types.js';

export type {
  DeterrentMode,
  ShieldConfig,
  ShieldPayload,
} from './runtime/types.js';

export type {
  CheckOptions,
  CheckResult,
  CheckViolation,
  InitOptions,
  InitResult,
  ProtectOptions,
  ProtectSummary,
  SourceMapVaultResult,
  SymbolicateFrame,
  SymbolicateOptions,
  SymbolicateResult,
  UnpeekDiagnostic,
  UnpeekDiagnosticSeverity,
} from './core/types.js';

export { defineConfig, loadUnpeekConfig } from './config.js';
export { PRESETS } from './presets.js';
export { transformJavaScript } from './ast/index.js';
export { initProject } from './core/init.js';
export { protectProject } from './core/protect.js';
export { checkProject } from './core/check.js';
export { symbolicateStackTrace } from './core/vlq.js';
export { UnpeekError, isUnpeekError, type UnpeekErrorCode } from './shared/errors.js';
