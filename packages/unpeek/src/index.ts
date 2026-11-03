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
export { detectTargetFramework, scanClientBundles } from './bundler/detector.js';
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
