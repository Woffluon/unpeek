---
name: unpeek
description: Use when protecting client-side JavaScript bundles from DevTools inspection, source map exposure, or automated deobfuscation in Vite, Next.js, Webpack, or vanilla web projects without modifying application source code.
---

# unpeek — Client-Side JavaScript Protection Skill

<baglam>
`unpeek` hardens production browser bundles against DevTools inspection, source map leaks, and static AST deobfuscators while keeping runtime CPU overhead below 2% and Gzip growth below 15%. It operates exclusively on compiled build artifacts or bundler output chunks so application source files remain untouched.
</baglam>

<kurulum_adimlari>
### Option A: Zero-Config Post-Build CLI (Recommended)

1. Run the initializer in the project root to wire `"postbuild": "unpeek protect"` and add `.unpeek-maps/` to `.gitignore`:
   ```bash
   npx unpeek init
   ```
2. Or install `unpeek` as a dev dependency and invoke it after your production build:
   ```bash
   npm install -D unpeek
   npx unpeek protect
   ```
   `unpeek` auto-detects Next.js (`.next/static/chunks`), Vite (`dist/assets`), Webpack (`build/static/js`), or vanilla output directories.

### Option B: Bundler Integration (`unplugin`)

Attach `unpeek/unplugin` for in-memory chunk protection during the bundler `renderChunk` lifecycle:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import unpeek from 'unpeek/unplugin';

export default defineConfig({
  plugins: [
    unpeek.vite({
      deterrentMode: 'gradual',
      keepPrivateMaps: true,
    }),
  ],
});
```

For Next.js or Webpack, register `unpeek.webpack({ deterrentMode: 'gradual' })` inside `if (!dev && !isServer)` so server bundles remain unmodified.
</kurulum_adimlari>

<dogrulama>
Verify the integration by running a production build and checking three observable outcomes:

1. **Summary Metrics**: Confirm the CLI prints `UNPEEK PROTECTION SUMMARY` with `Processed JS Chunks > 0` and `Gzip Size Delta < 15%`.
2. **Source Map Isolation**: Verify `.map` files move into `.unpeek-maps/` and public `.js` chunks no longer contain `//# sourceMappingURL=`.
3. **Plaintext Absence**: Search the output folder (`grep -R "your_secret_constant" dist/ .next/static/`) to confirm string literals (`length >= 4`) are encoded in the O(1) lazy string vault.
</dogrulama>

## Troubleshooting & Operational Recipes

| Scenario | Resolution |
| :--- | :--- |
| **SSR / Next.js Server Chunks** | Scope protection to client output (`.next/static/chunks`) or guard `unplugin` with `if (!isServer)` to preserve readable server stack traces. |
| **Sentry / Datadog Stack Traces** | Upload `.unpeek-maps/` to Sentry/Datadog during CI, then deploy only the stripped public folder. Keep `.unpeek-maps/` in `.gitignore`. |
| **Custom Output Folder** | Pass `--dir <path>` (`npx unpeek protect --dir build/client`) or set `outDir` in `ProtectOptions`. |
| **Deterministic Builds** | Pass `--seed <number>` to produce reproducible polymorphic output across CI shards. |
| **Passive Telemetry Mode** | Pass `--mode passive` (`deterrentMode: 'passive'`) to monitor integrity without triggering gradual state degradation. |
