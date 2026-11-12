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

---

## 2. Configuration Functions

### `defineConfig(config: UnpeekConfig): UnpeekConfig`
Type helper providing IDE auto-completion and static verification for `unpeek.config.js`, `unpeek.config.mjs`, or `unpeek.config.ts`.

```ts
// unpeek.config.js
import { defineConfig } from 'unpeek';

export default defineConfig({
  target: 'browser',
  vault: {
    minStringLength: 4,
    cssFramework: 'tailwind',
  },
  sourcemaps: {
    keepPrivate: true,
    vaultDir: '.unpeek-maps',
  },
});
```

### `findConfigFile(cwd?: string): string | null`
Searches `cwd` (default: `process.cwd()`) for configuration candidates in order:
1. `unpeek.config.js`
2. `unpeek.config.mjs`
3. `unpeek.config.cjs`
4. `unpeek.config.json`

Returns the absolute path to the configuration file, or `null` if none exists.

```ts
import { findConfigFile } from 'unpeek';

const configPath = findConfigFile(process.cwd());
// => '/workspace/unpeek.config.js' or null
```

### `loadUnpeekConfig(cwd?: string, explicitConfig?: UnpeekConfig): Promise<UnpeekConfig>`
Asynchronously locates, parses, normalizes regexes, and merges project configuration with `DEFAULT_CONFIG` and optional explicit overrides. Supports ESM modules, CommonJS, and JSON.

```ts
import { loadUnpeekConfig } from 'unpeek';

const resolvedConfig = await loadUnpeekConfig(process.cwd(), {
  vault: { minStringLength: 6 },
});
```

### `mergeUnpeekConfig(base: UnpeekConfig, override?: UnpeekConfig): UnpeekConfig`
Performs a deep merge between two `UnpeekConfig` objects. Combines string arrays, merges nested objects (`hotPath`, `vault`, `mangler`, `sourcemaps`, `filter`, `next`, `vite`), and preserves regex instances.

```ts
import { DEFAULT_CONFIG, mergeUnpeekConfig } from 'unpeek';

const customConfig = mergeUnpeekConfig(DEFAULT_CONFIG, {
  hotPath: {
    customHooks: ['useRenderTick'],
  },
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
```

### `ProtectSummary`
```ts
export interface ProtectSummary {
  framework: DetectedFramework; // 'nextjs' | 'vite' | 'webpack' | 'vanilla'
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
  aggressive?: boolean;
  dockerIgnoreMissing?: boolean;
}
```

### `InitResult`
```ts
export interface InitResult {
  updatedPackageJson: boolean;
  updatedGitignore: boolean;
  framework?: string;
  message: string;
}
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
