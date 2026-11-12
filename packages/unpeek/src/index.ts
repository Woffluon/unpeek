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
  ShieldPayload,
  SourcemapsConfig,
  SourceMapVaultResult,
  TransformOptions,
  TransformResult,
  UnpeekConfig,
  VaultConfig,
  ViteConfigOptions,
} from './types.js';

export {
  DEFAULT_CONFIG,
  defineConfig,
  findConfigFile,
  loadUnpeekConfig,
  mergeUnpeekConfig,
  resolveUnpeekConfigSync,
} from './config.js';

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
export { detectTargetFramework, scanClientBundles, SUPPORTED_EXTENSIONS } from './bundler/detector.js';
export { relocateSourceMaps } from './bundler/sourcemap-vault.js';
export {
  unpeekPlugin,
  vitePlugin,
  webpackPlugin,
  rollupPlugin,
  esbuildPlugin,
} from './bundler/unplugin.js';
export { initProject } from './cli/init.js';
export { protectProject } from './cli/protect.js';
export { runCli } from './cli/index.js';
