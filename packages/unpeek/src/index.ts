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
  ProtectOptions,
  ProtectSummary,
  SemanticAnchorsConfig,
  ShieldConfig,
  ShieldOptionsConfig,
  ShieldPayload,
  SourcemapsConfig,
  SourceMapVaultResult,
  TransformOptions,
  TransformResult,
  UnpeekConfig,
  VaultConfig,
  ViteConfigOptions,
} from './types.js';

export { defineConfig, loadUnpeekConfig } from './config.js';
export { transformJavaScript } from './ast/index.js';
export { initProject, type InitOptions, type InitResult } from './core/init.js';
export { protectProject } from './core/protect.js';
export { UnpeekError, type UnpeekErrorCode } from './errors.js';
