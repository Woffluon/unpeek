# Framework Integrations & Bundler Setup

unpeek supports automated postbuild scanning and in-memory bundler transforms across Next.js, Vite, Webpack, Rollup, and Vanilla JS.

---

## 1. Automatic Framework Detection Matrix

When running `npx unpeek protect` without `--out-dir`, unpeek evaluates package dependencies and directory structures in order:

| Framework | Detection Criteria | Default Protected Output Directory |
| :--- | :--- | :--- |
| **Next.js** | `next` in `package.json` or `.next/` directory | `.next/static/chunks`<br>*(Static Export: `out/_next/static/chunks` or `out`)* |
| **Vite** | `vite` in `package.json` or `dist/assets/` | `dist/assets` *(falls back to `dist`)* |
| **Webpack** | `webpack`, `react-scripts`, or `@rspack/core` | `dist` *(falls back to `build`)* |
| **Vanilla JS** | Fallback scan across candidate folders | First match: `dist`, `build`, or `public` |

---

## 2. Next.js Integration

### Client vs. SSR Boundary (Strict Isolation)
unpeek strictly enforces a client-only protection boundary:
- **Client Assets**: `.next/static/chunks` and `out/_next/static/chunks` are protected.
- **Server Assets Excluded**: Directories matching `server`, `ssr`, or `node_modules` are skipped.
- **Why**: Keeps server-side stack traces clean in Datadog/Sentry, eliminates SSR hydration mismatches, and prevents overhead on Node runtime.

### Option A: Zero-Config Postbuild CLI
Add to `package.json`:
```json
{
  "scripts": {
    "build": "next build",
    "postbuild": "unpeek protect"
  }
}
```

### Static Exports (`output: 'export'`)
For static exports (`next export` or Next 13.3+ `output: 'export'`), unpeek automatically discovers `out/_next/static/chunks` or `out`. You can also target it explicitly:
```bash
npx unpeek protect --out-dir out
```

### Custom Build Directory (`distDir`) via `unpeek.config.ts`
When Next.js is configured with a non-default build output directory (e.g. `distDir: 'build'` or `distDir: '.build'`), unpeek automatically parses `next.config.*` for the declaration.

You can also explicitly define `distDir` in `unpeek.config.ts` or `unpeek.config.js`:

```ts
// unpeek.config.ts
import { defineConfig } from 'unpeek';

export default defineConfig({
  framework: 'nextjs',
  next: {
    distDir: 'build', // Protects build/static/chunks; excludes build/server
  },
});
```

This guarantees unpeek locates client chunks under `<distDir>/static/chunks` while keeping `<distDir>/server` and SSR assets strictly untouched.

### Option B: Next.js >= 16.2 Build Adapter (`unpeek/next`)
For Next.js >= 16.2 (including Turbopack), wrap your config with `withUnpeek` from `unpeek/next` (automatically wired by `npx unpeek init`). `withUnpeek` is `phase`-aware when wrapping a Next.js config function (skipping non-production phases like `phase-development-server`) and uses a `RegExp`-safe `UNPEEK_NEXT_OPTIONS` bridge for worker-process serialization:
```js
// next.config.mjs (or CommonJS: const { withUnpeek } = require('unpeek/next');)
import { withUnpeek } from 'unpeek/next';

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withUnpeek(nextConfig);
```
> **Security Note:** `upstreamAdapterPath` / `UNPEEK_UPSTREAM_ADAPTER_PATH` dynamically imports an upstream adapter module at build time. Only set it in trusted project contexts.

### Option C: `next.config.mjs` with Webpack Plugin (Next.js < 16.2)
For chunk protection during the compilation lifecycle:
```js
// next.config.mjs
import unpeek from 'unpeek/webpack';

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      config.plugins.push(
        unpeek({
          deterrentMode: 'passive',
          minStringLength: 4,
        })
      );
    }
    return config;
  },
};

export default nextConfig;
```

---

## 3. Vite Integration

### Subpath Import (`unpeek/vite`)
```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import unpeek from 'unpeek/vite';

export default defineConfig({
  plugins: [
    react(),
    unpeek({
      deterrentMode: 'passive',
      minStringLength: 4,
    }),
  ],
  build: {
    sourcemap: true, // unpeek will extract maps to .unpeek-maps/
  },
});
```

### Custom Output Directory via `unpeek.config.ts`
When Vite customizes `build.outDir` or `build.assetsDir`, unpeek detects them automatically from `vite.config.*`, or you can declare them explicitly:

```ts
// unpeek.config.ts
import { defineConfig } from 'unpeek';

export default defineConfig({
  framework: 'vite',
  vite: {
    outDir: 'custom-dist',
    assetsDir: 'assets',
  },
});
```

---

## 4. Webpack & Rspack Integration

### Subpath Import (`unpeek/webpack` & `unpeek/rspack`)
`unpeek` and all subpaths natively support both ESM `import` and CommonJS `require(...)` (with `default` export for bundler subpaths). Use `unpeek/rspack` for Rspack builds, or `unpeek/webpack` for Webpack 5. Note that bundler plugins expect `UnpeekConfig` overrides nested under `options.config` (inline top-level `UnpeekConfig` duck-typing was removed in v3.0.0):
```js
// webpack.config.js
const unpeek = require('unpeek/webpack');

module.exports = {
  mode: 'production',
  plugins: [
    unpeek({
      deterrentMode: 'passive',
      seed: 0x42f00d,
    }),
  ],
};
```

---

## 5. Rollup & Esbuild Integration

### Rollup (`unpeek/rollup`)
```js
// rollup.config.js
import unpeek from 'unpeek/rollup';

export default {
  input: 'src/index.js',
  output: { dir: 'dist', format: 'es', sourcemap: true },
  plugins: [
    unpeek({
      deterrentMode: 'passive',
    }),
  ],
};
```

### Esbuild (`unpeek/esbuild`)
```js
// build.js
import esbuild from 'esbuild';
import unpeek from 'unpeek/esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  plugins: [unpeek()],
});
```

---

## 6. Subpath Import Reference

| Subpath | Bundler Target |
| :--- | :--- |
| `unpeek` | Narrowed root API (`protectProject`, `transformJavaScript`, `initProject`, `defineConfig`, `loadUnpeekConfig`, `UnpeekError`, `UnpeekErrorCode`, types) |
| `unpeek/config` | Configuration utilities (`defineConfig`, `loadUnpeekConfig`, `findConfigFile`, `mergeUnpeekConfig`, `DEFAULT_CONFIG`) |
| `unpeek/next` | Next.js >= 16.2 Build Adapter (`withUnpeek`, `createUnpeekNextAdapter`) |
| `unpeek/next/adapter` | Next.js adapter entry referenced by `adapterPath` |
| `unpeek/unplugin` | Base Unplugin instance (`unpeekPlugin`, `vitePlugin`, `webpackPlugin`, etc.) |
| `unpeek/vite` | Dedicated Vite plugin export |
| `unpeek/webpack` | Dedicated Webpack / Rspack plugin export |
| `unpeek/rollup` | Dedicated Rollup plugin export |
| `unpeek/esbuild` | Dedicated Esbuild plugin export |
| `unpeek/ast` | Standalone AST transformation & hot-path detector |
| `unpeek/runtime` | Standalone runtime anti-tamper shield & integrity checker |
| `unpeek/browser` | Browser-side client runtime utilities |
