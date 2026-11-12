export type DetectedFramework = 'nextjs' | 'vite' | 'webpack' | 'vanilla';

export type DeterrentMode = 'gradual' | 'passive';

export type ConfigFramework = 'nextjs' | 'vite' | 'webpack' | 'vanilla';

export type ConfigTarget = 'browser' | 'worker' | 'universal';

export interface FilterConfig {
  include?: string[];
  exclude?: string[];
}

export interface HotPathConfig {
  customAnimationCalls?: string[];
  importSources?: Record<string, string[]>;
  hookPattern?: RegExp;
  customHooks?: string[];
  arrayHofMethods?: string[];
  eventHandlerRegex?: RegExp;
  maxPipelineCallers?: number;
  hocWrappers?: string[];
  excludeComponents?: string[];
}

export interface SemanticAnchorsConfig {
  patterns?: RegExp[];
  excludeUiClasses?: boolean;
}

export interface VaultConfig {
  minStringLength?: number;
  customDirectives?: string[];
  reservedProps?: string[];
  cssFramework?: 'tailwind' | 'unocss' | 'none';
  semanticAnchors?: SemanticAnchorsConfig;
  polymorphicDecoys?: boolean;
}

export interface ManglerConfig {
  reservedIdentifiers?: string[];
  excludePrefixes?: string[];
  excludePatterns?: RegExp[];
}

export interface SourcemapsConfig {
  keepPrivate?: boolean;
  vaultDir?: string;
  stripComments?: boolean;
}

export interface NextConfigOptions {
  distDir?: string;
}

export interface ViteConfigOptions {
  outDir?: string;
  assetsDir?: string;
}

export interface UnpeekConfig {
  framework?: ConfigFramework;
  target?: ConfigTarget;
  outDir?: string;
  extensions?: string[];
  publicDirs?: string[];
  filter?: FilterConfig;
  hotPath?: HotPathConfig;
  vault?: VaultConfig;
  mangler?: ManglerConfig;
  sourcemaps?: SourcemapsConfig;
  next?: NextConfigOptions;
  vite?: ViteConfigOptions;
}

export interface ProtectOptions {
  /** Target project root directory (defaults to process.cwd()) */
  cwd?: string;
  /** Explicit client output directory override */
  outDir?: string;
  /** Polymorphic deterministic seed (defaults to random per build) */
  seed?: number;
  /** Move .map files to .unpeek-maps/ instead of permanently deleting (default: true) */
  keepPrivateMaps?: boolean;
  /** Private directory to store extracted source maps (default: '.unpeek-maps') */
  privateMapsDir?: string;
  /** Runtime anti-tamper deterrent mode (default: 'passive') */
  deterrentMode?: DeterrentMode;
  /** Inject runtime integrity and DevTools shield into entry chunks (default: true) */
  injectRuntimeShield?: boolean;
  /** Minimum string length to encrypt in the O(1) kConst string vault (default: 4) */
  minStringLength?: number;
  /** Enable Layer 2 aggressive protection (Bytecode Micro-VM, Inline WASM KDF, Call-Site Salted Vault) */
  aggressive?: boolean;
  /** Optional Unpeek configuration */
  config?: UnpeekConfig;
}

export interface HotPathReport {
  totalFunctions: number;
  hotFunctionsSkipped: string[];
  coldFunctionsProtected: string[];
}

export interface TransformOptions {
  seed?: number;
  minStringLength?: number;
  filename?: string;
  injectRuntimeShield?: boolean;
  deterrentMode?: DeterrentMode;
  /** Enable Layer 2 aggressive protection */
  aggressive?: boolean;
  /** Optional Unpeek configuration */
  config?: UnpeekConfig;
}

export interface TransformResult {
  code: string;
  encryptedStringsCount: number;
  mangledSymbolsCount: number;
  hotPathReport: HotPathReport;
  integrityToken: number;
  virtualizedFunctionsCount?: number;
  shaderBuffersCount?: number;
}

export interface ShieldConfig {
  seed: number;
  deterrentMode?: DeterrentMode;
  expectedIntegrityHash?: number;
  windowKeySymbol?: string;
  expectedDelta?: number;
}

export interface ShieldPayload {
  preambleCode: string;
  integrityCheckFnName: string;
  expectedHash: number;
  windowKeySymbol?: string;
  expectedDelta?: number;
}

export interface SourceMapVaultResult {
  movedMapsCount: number;
  strippedFilesCount: number;
  vaultDir: string;
  movedFiles: string[];
  dockerIgnoreMissing?: boolean;
}

export interface ProtectSummary {
  framework: DetectedFramework;
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
  tier?: string;
  aggressive?: boolean;
  dockerIgnoreMissing?: boolean;
}
