# Migrating to unpeek v3.0.0

This guide covers breaking changes in `unpeek` v3.0.0 and how to update your configuration, bundler plugins, and programmatic imports.

## Breaking Changes

### 1. Removed `./ast` and `./runtime` Subpath Exports

The `unpeek/ast` and `unpeek/runtime` subpaths have been removed from `package.json` `exports`.

**Before (v2.x):**
```ts
import { transformJavaScript } from 'unpeek/ast';
import type { DeterrentMode, ShieldConfig } from 'unpeek/runtime';
```

**After (v3.0.0):**
```ts
import {
  transformJavaScript,
  type TransformOptions,
  type TransformResult,
  type DeterrentMode,
  type ShieldConfig,
} from 'unpeek';
```

### 2. Removed Internal Helpers from `unpeek/config`

Internal configuration resolution helpers are no longer exported from `unpeek/config`:
- `DEFAULT_CONFIG`
- `normalizeConfig`
- `mergeUnpeekConfig`
- `findConfigFile`
- `resolveUnpeekConfigSync`
- `CONFIG_CANDIDATES`

**After (v3.0.0):**
Use `defineConfig`, `loadUnpeekConfig`, and `PRESETS` (`'minimal' | 'recommended' | 'strict'`):
```ts
import { PRESETS, defineConfig, loadUnpeekConfig } from 'unpeek';
// or: import { defineConfig, loadUnpeekConfig } from 'unpeek/config';

export default defineConfig({
  ...PRESETS.recommended,
  scrubPaths: true,
});
```

### 3. Removed Internal Helpers from `runtime`

`deriveWindowKeySymbol` and `deriveIntegrityFnName` are no longer exported. Subscribe to tamper telemetry via the standard DOM event:
```ts
window.addEventListener('unpeek:tamper', (event) => {
  // Handle tamper telemetry
});
```

### 4. Removed `unplugin` Inline `UnpeekConfig` Duck-Typing

Bundler plugins (`unpeek/unplugin`, `unpeek/vite`, `unpeek/webpack`, `unpeek/rollup`, `unpeek/esbuild`, `unpeek/rspack`) no longer accept top-level `UnpeekConfig` fields directly on `UnpeekPluginOptions`. Pass `UnpeekConfig` overrides inside the `config` property.

**Before (v2.x):**
```ts
import unpeek from 'unpeek/vite';

export default {
  plugins: [unpeek({ vault: { minStringLength: 6 } })],
};
```

**After (v3.0.0):**
```ts
import unpeek from 'unpeek/vite';

export default {
  plugins: [
    unpeek({
      profile: 'recommended',
      config: {
        vault: { minStringLength: 6 },
      },
    }),
  ],
};
```

### 5. Narrowed `ProtectSummary.tier` and `InitResult.framework`

- `ProtectSummary.tier` is now narrowed to `'Tier 1' | 'Tier 2' | undefined`.
- `InitResult.framework` is now typed as `UnpeekFramework | undefined` (`'nextjs' | 'vite' | 'webpack' | 'vanilla'`).

If your code compared `summary.tier` or `initResult.framework` against arbitrary strings, update the type guards accordingly.

## New Capabilities in v3.0.0

- **CLI Commands & Flags**:
  - `unpeek check` — read-only CI gate for leaked `.map` files, `sourceMappingURL` comments, missing ignore entries, Gzip budget, and `eval()`/`new Function()` usage.
  - `unpeek symbolicate` — resolve production stack traces locally using `.unpeek-maps/`.
  - `--profile <minimal|recommended|strict>`, `--dry-run`, `--max-gzip-delta <percent>`.
- **Programmatic API**:
  - `PRESETS`, `defineConfig<const T>`, `isUnpeekError`, `checkProject`, `symbolicateStackTrace`.
  - `UnpeekDiagnostic` on `ProtectSummary.diagnostics`, `TransformResult.skippedReason`.
  - `scrubPaths` option and `vault.fragmented` / `vault.fragmentCount`.
- **Adapters & Exports**:
  - `unpeek/rspack` adapter and `unpeek/package.json` export.
  - Next.js 16 `phase`-aware `withUnpeek` (skips non-production phases when wrapping a config function) and `RegExp`-safe `UNPEEK_NEXT_OPTIONS` bridge.
