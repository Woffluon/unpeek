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

export { PRESETS } from './presets.js';
export { UnpeekError, isUnpeekError, type UnpeekErrorCode } from './shared/errors.js';

export {
  transformJavaScript,
  detectHotPaths,
  computeFnv1aHash,
} from './ast/index.js';

export {
  generateRuntimeShield,
  computeIntegrityHash,
  verifyCodeIntegrity,
  createDeterrentSnippet,
} from './runtime/index.js';
