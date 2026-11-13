export type {
  ConfigFramework,
  ConfigTarget,
  DetectedFramework,
  DeterrentMode,
  FilterConfig,
  HotPathConfig,
  HotPathReport,
  ManglerConfig,
  NextConfigOptions,
  SemanticAnchorsConfig,
  ShieldConfig,
  ShieldOptionsConfig,
  ShieldPayload,
  SourcemapsConfig,
  TransformOptions,
  TransformResult,
  UnpeekConfig,
  VaultConfig,
  ViteConfigOptions,
} from './types.js';

export { UnpeekError } from './errors.js';
export type { UnpeekErrorCode } from './errors.js';

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
