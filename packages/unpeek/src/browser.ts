export type {
  DetectedFramework,
  DeterrentMode,
  HotPathReport,
  ProtectOptions,
  ProtectSummary,
  ShieldConfig,
  ShieldPayload,
  SourceMapVaultResult,
  TransformOptions,
  TransformResult,
} from './types.js';

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
