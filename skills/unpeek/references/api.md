# Programmatic API & TypeScript Reference

In addition to the CLI, unpeek exports high-level node automation functions, configuration utilities, AST transformations, and bundler plugins.

---

## 1. High-Level Project Functions

### `protectProject(options?: ProtectOptions): Promise<ProtectSummary>`
Protects a compiled client build in place by discovering chunks, relocating source maps, and applying polymorphic AST transformations.

```ts
import { protectProject } from 'unpeek';

const summary = await protectProject({
  cwd: process.cwd(),
  outDir: 'dist/assets',
  seed: 0x9e3779b9,
  deterrentMode: 'passive',
  minStringLength: 4,
  keepPrivateMaps: true,
  privateMapsDir: '.unpeek-maps',
  injectRuntimeShield: true,
  aggressive: false,
});

console.log(`Protected ${summary.processedFiles} files in ${summary.elapsedMs}ms`);
```

### `initProject(cwd?: string, options?: InitOptions | boolean): InitResult`
Configures `package.json` postbuild scripts and updates `.gitignore`.

```ts
import { initProject } from 'unpeek';

const result = initProject(process.cwd(), { dryRun: false });
console.log(result.message);
```

### `checkProject(options?: CheckOptions): Promise<CheckResult>`
Read-only CI gate that checks for leaked `.map` files, `sourceMappingURL` comments, missing ignore entries, Gzip budget, and `eval()`/`new Function()` usage.

### `symbolicateStackTrace(options: SymbolicateOptions): SymbolicateResult`
Resolves a minified stack trace locally using source maps stored in `.unpeek-maps/`.

### `isUnpeekError(err: unknown): err is UnpeekError`
Cross-realm type guard for `UnpeekError` instances.

---

## 2. Configuration Functions

### `defineConfig<const T extends UnpeekConfig>(config: T): T`
Type helper providing `const` literal inference, IDE auto-completion, and static verification for `unpeek.config.js`, `unpeek.config.mjs`, or `unpeek.config.cjs`. Re-exported from `unpeek` and `unpeek/config`.

### `PRESETS: Record<UnpeekProfile, UnpeekConfig>`
Built-in protection profiles (`'minimal'`, `'recommended'`, `'strict'`).

### `loadUnpeekConfig(cwd?: string, explicitConfig?: UnpeekConfig): Promise<UnpeekConfig>`
Asynchronously locates, parses, normalizes regexes, and merges project configuration with `PRESETS` and optional explicit overrides. Throws `UnpeekError` (`ERR_CONFIG_INVALID` or `ERR_CONFIG_LOAD`) on malformed or non-object config files.

```ts
import { PRESETS, defineConfig, loadUnpeekConfig } from 'unpeek';

const resolvedConfig = await loadUnpeekConfig(process.cwd(), {
  ...PRESETS.recommended,
  scrubPaths: true,
  vault: { minStringLength: 6, fragmented: true, fragmentCount: 4 },
});
```

---

## 3. Low-Level AST Transformation Functions

### `transformJavaScript(code: string, options?: TransformOptions): TransformResult`
Transforms a JavaScript code string directly through the unpeek AST pipeline.

```ts
import { transformJavaScript } from 'unpeek';

const result = transformJavaScript(sourceCode, {
  seed: 42,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: 'gradual',
  aggressive: false,
});

console.log(result.code);
console.log(`Encrypted strings: ${result.encryptedStringsCount}`);
console.log(`Hot paths skipped: ${result.hotPathReport.hotFunctionsSkipped.length}`);
```

---

## 4. TypeScript Interfaces & Configuration Types

### `UnpeekConfig`
The top-level configuration schema accepted in `unpeek.config.js`, `unpeek.config.mjs`, `unpeek.config.json`, or passed programmatically.

```ts
export type ConfigFramework = 'nextjs' | 'vite' | 'webpack' | 'vanilla';
export type ConfigTarget = 'browser' | 'worker' | 'universal';

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
```

### Configuration Option Blocks

#### `FilterConfig`
Glob patterns to control which files unpeek processes:
```ts
export interface FilterConfig {
  include?: string[];
  exclude?: string[]; // default: ['node_modules/**', '**/*.test.*', '**/*.spec.*']
}
```

#### `HotPathConfig`
Heuristics to identify and exempt performance-critical execution paths (0% tax):
```ts
export interface HotPathConfig {
  customAnimationCalls?: string[]; // e.g. ['requestAnimationFrame', 'animate']
  importSources?: Record<string, string[]>;
  hookPattern?: RegExp;
  customHooks?: string[];          // e.g. ['useFrame', 'useScroll']
  arrayHofMethods?: string[];      // e.g. ['map', 'filter', 'reduce']
  eventHandlerRegex?: RegExp;
  maxPipelineCallers?: number;     // max depth for caller propagation (default: 2)
  hocWrappers?: string[];
  excludeComponents?: string[];
}
```

#### `VaultConfig` & `SemanticAnchorsConfig`
Controls O(1) string vault encryption and CSS/SVG token filtering:
```ts
export interface SemanticAnchorsConfig {
  patterns?: RegExp[];
  excludeUiClasses?: boolean;      // default: true
}

export interface VaultConfig {
  minStringLength?: number;        // default: 4
  customDirectives?: string[];
  reservedProps?: string[];
  cssFramework?: 'tailwind' | 'unocss' | 'none'; // default: 'tailwind'
  semanticAnchors?: SemanticAnchorsConfig;
  polymorphicDecoys?: boolean;     // default: true
  fragmented?: boolean;
  fragmentCount?: number;
}
```

#### `ManglerConfig`
Identifier mangling rules and exclusion boundaries:
```ts
export interface ManglerConfig {
  reservedIdentifiers?: string[];
  excludePrefixes?: string[];
  excludePatterns?: RegExp[];
}
```

#### `SourcemapsConfig`
Source map relocation and comment stripping controls:
```ts
export interface SourcemapsConfig {
  keepPrivate?: boolean;           // default: true
  vaultDir?: string;               // default: '.unpeek-maps'
  stripComments?: boolean;         // default: true
}
```

#### `NextConfigOptions` & `ViteConfigOptions`
Framework-specific output directory overrides:
```ts
export interface NextConfigOptions {
  distDir?: string;                // Next.js custom build folder (default: '.next')
}

export interface ViteConfigOptions {
  outDir?: string;                 // Vite output folder (default: 'dist')
  assetsDir?: string;              // Vite assets folder (default: 'assets')
}
```

---

## 5. Execution Interfaces & Results

### `ProtectOptions`
```ts
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
  deterrentMode?: DeterrentMode; // 'gradual' | 'passive'
  /** Inject runtime integrity and DevTools shield into entry chunks (default: true) */
  injectRuntimeShield?: boolean;
  /** Minimum string length to encrypt in the O(1) kConst string vault (default: 4) */
  minStringLength?: number;
  /** Enable Layer 2 aggressive protection (Bytecode Micro-VM, Inline WASM KDF, Call-Site Salted Vault) */
  aggressive?: boolean;
  /** Protection preset profile */
  profile?: UnpeekProfile;
  /** Compute summary and Gzip delta in memory without writing files */
  dryRun?: boolean;
  /** Fail with ERR_BUDGET_EXCEEDED if gzipDeltaPercent exceeds this percentage */
  maxGzipDelta?: number;
  /** Scrub local filesystem paths and residual dev metadata (CWE-540) */
  scrubPaths?: boolean;
  /** Optional Unpeek configuration */
  config?: UnpeekConfig;
}
```

### `TransformOptions` & `TransformResult`
```ts
export interface TransformOptions {
  seed?: number;
  minStringLength?: number;
  filename?: string;
  injectRuntimeShield?: boolean;
  deterrentMode?: DeterrentMode;
  /** Enable Layer 2 aggressive protection */
  aggressive?: boolean;
  /** Throw UnpeekError on JavaScript parse failures instead of returning input unchanged */
  strict?: boolean;
  /** Scrub local filesystem paths and residual dev metadata (CWE-540) */
  scrubPaths?: boolean;
  /** Optional Unpeek configuration */
  config?: UnpeekConfig;
}

export type TransformSkippedReason = 'empty' | 'already-protected' | 'parse-error';

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
```

### `ProtectSummary` & `UnpeekDiagnostic`
```ts
export interface UnpeekDiagnostic {
  code: 'DOCKERIGNORE_MISSING' | 'PARSE_FALLBACK' | 'ALREADY_PROTECTED' | 'EMPTY_INPUT';
  severity: 'info' | 'warning';
  message: string;
  file?: string;
}

export interface ProtectSummary {
  framework: UnpeekFramework; // 'nextjs' | 'vite' | 'webpack' | 'vanilla'
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
  seed?: number;
  tier?: 'Tier 1' | 'Tier 2';
  aggressive?: boolean;
  dockerIgnoreMissing?: boolean;
  dryRun?: boolean;
  profile?: UnpeekProfile;
  budgetExceeded?: boolean;
  debugIdsPreserved?: number;
  diagnostics?: readonly UnpeekDiagnostic[];
}
```

### `InitResult`
```ts
export interface InitResult {
  updatedPackageJson: boolean;
  updatedGitignore: boolean;
  updatedNextConfig?: boolean;
  framework?: UnpeekFramework;
  isNext162Plus?: boolean;
  message: string;
}
```

### `UnpeekError` & `UnpeekErrorCode`
Structured error class exported from `unpeek` for deterministic error handling across config loading, CLI validation, AST parsing, budget checks, and Next.js adapter chaining:
```ts
export type UnpeekErrorCode =
  | 'ERR_CONFIG_INVALID'
  | 'ERR_CONFIG_LOAD'
  | 'ERR_INIT_INVALID_PACKAGE_JSON'
  | 'ERR_SECURITY_PATH_TRAVERSAL'
  | 'ERR_CLI_INVALID_ARGS'
  | 'ERR_PARSE_FAILED'
  | 'ERR_NEXT_ADAPTER'
  | 'ERR_BUDGET_EXCEEDED';

export declare class UnpeekError extends Error {
  readonly code: UnpeekErrorCode;
  constructor(code: UnpeekErrorCode, message: string, options?: { cause?: unknown });
}

export declare function isUnpeekError(err: unknown): err is UnpeekError;
```

### `SourceMapVaultResult`
```ts
export interface SourceMapVaultResult {
  movedMapsCount: number;
  strippedFilesCount: number;
  vaultDir: string;
  movedFiles: string[];
  dockerIgnoreMissing?: boolean;
}
```
