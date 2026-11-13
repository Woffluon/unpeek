import type { DeterrentMode } from './runtime/types.js';
import type { UnpeekProfile } from './presets.js';

export type UnpeekFramework = 'nextjs' | 'vite' | 'webpack' | 'vanilla';

export type ConfigTarget = 'browser' | 'worker' | 'universal';

export type PatternInput = RegExp | string;

export type { UnpeekProfile };

export interface FilterConfig {
  include?: string[];
  exclude?: string[];
}

export interface HotPathConfig {
  customAnimationCalls?: string[];
  importSources?: Record<string, string[]>;
  hookPattern?: PatternInput;
  customHooks?: string[];
  arrayHofMethods?: string[];
  eventHandlerRegex?: PatternInput;
  maxPipelineCallers?: number;
  hocWrappers?: string[];
  excludeComponents?: string[];
}

export interface SemanticAnchorsConfig {
  patterns?: PatternInput[];
  excludeUiClasses?: boolean;
}

export interface VaultConfig {
  minStringLength?: number;
  customDirectives?: string[];
  reservedProps?: string[];
  cssFramework?: 'tailwind' | 'unocss' | 'none';
  semanticAnchors?: SemanticAnchorsConfig;
  polymorphicDecoys?: boolean;
  fragmented?: boolean;
  fragmentCount?: number;
}

export interface ManglerConfig {
  minLength?: number;
  reservedIdentifiers?: string[];
  excludePrefixes?: string[];
  excludePatterns?: PatternInput[];
}

export interface ShieldOptionsConfig {
  detectHeadless?: boolean;
  deterrentMode?: DeterrentMode;
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
  framework?: UnpeekFramework;
  target?: ConfigTarget;
  profile?: UnpeekProfile;
  outDir?: string;
  extensions?: string[];
  publicDirs?: string[];
  scrubPaths?: boolean;
  filter?: FilterConfig;
  hotPath?: HotPathConfig;
  vault?: VaultConfig;
  mangler?: ManglerConfig;
  shield?: ShieldOptionsConfig;
  sourcemaps?: SourcemapsConfig;
  next?: NextConfigOptions;
  vite?: ViteConfigOptions;
}

export interface BaseProtectionOptions {
  /** Polymorphic deterministic seed (defaults to random per build) */
  seed?: number;
  /** Minimum string length to encrypt in the O(1) kConst string vault (default: 4) */
  minStringLength?: number;
  /** Inject runtime integrity and DevTools shield into entry chunks (default: true) */
  injectRuntimeShield?: boolean;
  /** Runtime anti-tamper deterrent mode (default: 'passive') */
  deterrentMode?: DeterrentMode;
  /** Treat navigator.webdriver / HeadlessChrome as tamper (default: false) */
  detectHeadless?: boolean;
  /** Enable Layer 2 aggressive protection (Bytecode Micro-VM, Inline WASM KDF, Call-Site Salted Vault) */
  aggressive?: boolean;
  /** Protection preset profile */
  profile?: UnpeekProfile;
  /** Optional Unpeek configuration */
  config?: UnpeekConfig;
}

export interface UnpeekPluginOptions extends BaseProtectionOptions {
  /** Explicit Unpeek configuration object */
  config?: UnpeekConfig;
}

export function defineConfig<const T extends UnpeekConfig>(config: T): T {
  return config;
}

export { loadUnpeekConfig } from './internal/config.js';
