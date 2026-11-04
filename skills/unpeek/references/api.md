# Programmatic API & TypeScript Reference

In addition to the CLI, unpeek exports high-level node automation functions, AST transformations, and bundler plugins.

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

## 2. Low-Level AST Transformation Functions

### `transformJavaScript(code: string, options?: TransformOptions): TransformResult`
Transforms a JavaScript code string directly through the unpeek AST pipeline.

```ts
import { transformJavaScript } from 'unpeek';

const result = transformJavaScript(sourceCode, {
  seed: 42,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: 'gradual',
});

console.log(result.code);
console.log(`Encrypted strings: ${result.encryptedStringsCount}`);
console.log(`Hot paths skipped: ${result.hotPathReport.hotFunctionsSkipped.length}`);
```

---

## 3. TypeScript Interfaces & Types

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
  /** Minimum string length to encrypt in the O(1) lazy string vault (default: 4) */
  minStringLength?: number;
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
}

export interface TransformResult {
  code: string;
  encryptedStringsCount: number;
  mangledSymbolsCount: number;
  hotPathReport: HotPathReport;
  integrityToken: number;
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
}
```
