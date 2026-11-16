---
name: unpeek
description: Zero-config, call-graph-aware client-side JavaScript protection, anti-reverse-engineering, and source map security for Next.js, Vite, Webpack, Rollup, and Vanilla JS applications.
license: MIT
metadata:
  author: Woffluon
  version: 1.12.0
---

# unpeek Skill

Zero-config, call-graph-aware client-side JavaScript protection and source map isolation toolkit with <2% runtime CPU overhead and <15% Gzip delta.

## Agent Persona & Language Policy

- **Language Policy**: Reply in the user's prompt language (e.g. Turkish or English).
- **Technical Fidelity**: Maintain exact technical terms, CLI flags, and options from references (`npx unpeek protect`, `.unpeek-maps/`, `deterrentMode: 'passive'`).
- **Client-Only Boundary**: Never touch server/SSR bundles (`.next/server`). Target compiled browser assets only (`.next/static/chunks`, `dist/assets`).

## Quick Workflow

1. **Initialize**: Run `npx unpeek init` (optionally with `--dry-run` or `--profile <minimal|recommended|strict>`) to wire `"postbuild": "unpeek protect"` in `package.json` and add `.unpeek-maps/` to `.gitignore`.
2. **Configure (Optional)**: Declare settings in `unpeek.config.js` via `defineConfig` and `PRESETS` to tune hot paths, vaults, mangling, or framework options.
3. **Build**: Run the project's standard production build (`npm run build`).
4. **Protect**: `unpeek protect` runs post-build under `<2%` CPU and `<15%` Gzip budgets. Pass `--profile <minimal|recommended|strict>` or `--aggressive` for Micro-VM v2 + singleton WASM KDF, `--dry-run` to preview, or `--max-gzip-delta <percent>` to enforce a budget.
5. **Verify & Symbolicate**: Run `npx unpeek check` as a read-only CI gate (including `debugId` integrity) and `npx unpeek symbolicate` to resolve production stack traces locally using `.unpeek-maps/`.

## Defense Architecture (Tiers 1–3)

- **Tier 1 (`minimal` / Fast Baseline)**: Call-graph hot-path exemption (`TRUE_HOT_60FPS`, `SHALLOW_RENDER_COMPONENT`, `SERIALIZED_WORKER`), `mangler.minLength: 1` without cold-flow bloat (`coldFlow: false`), and order-independent `globalThis` runtime shield (`<2%` CPU, `<15%` Gzip).
- **Tier 2 (`recommended` / Default)**: Adds 92-char involutory string vault, `>=4`-var semi-linear MBA + degree-3 Rivest $\mathbb{Z}_{2^{32}}$ QNR guards, in-place `Uint8Array` shader vault, and non-poisoning async chunk handling.
- **Tier 3 (`strict` / `--aggressive` Enclave)**: Targets `@unpeek-critical` or `critical.include` functions with a 43-opcode direct-threaded Micro-VM v2 (no `eval`), singleton `<1.2 KB` host-coupled WASM KDF (with bit-identical JS fallback), 64-bit call-site salted vault, and CWE-540 path scrubbing.

## Reference Navigation

Direct requests to the relevant modular guide:

- **CLI & Zero-Config Setup**: See [Quickstart Guide](references/quickstart.md) for `init`, `protect`, `check`, `symbolicate`, `unpeek.config.js` setup, and CLI flags (`--profile`, `--dry-run`, `--max-gzip-delta`, `--out-dir`, `--seed`, `--passive`, `--min-string-length`, `--private-maps-dir`, `--no-shield`, `--aggressive`).
- **Framework Integrations**: See [Frameworks Guide](references/frameworks.md) for Next.js (`phase`-aware `withUnpeek`, SSR boundary, custom `distDir`), Vite, Webpack, Rspack, Rollup, and subpath imports (`unpeek/vite`, `unpeek/webpack`, `unpeek/rspack`, `unpeek/unplugin`).
- **Core Architecture & Performance**: See [Architecture Guide](references/architecture.md) for two-tier defense, 3-tier hot-path exemption (loops, rAF, useFrame), shader vault, Bytecode Micro-VM, WASM KDF, O(1) string vault, and runtime shield.
- **Source Map Vaulting & Security**: See [Source Maps Guide](references/sourcemaps.md) for `.unpeek-maps/` relocation, `sourceMappingURL` stripping, `unpeek check` / `unpeek symbolicate`, Sentry/Datadog CI workflows, and `.dockerignore` best practices.
- **Programmatic API**: See [API Reference](references/api.md) for `protectProject()`, `transformJavaScript()`, `initProject()`, `checkProject()`, `symbolicateStackTrace()`, `PRESETS`, `isUnpeekError`, config helpers (`defineConfig`, `loadUnpeekConfig`), and TypeScript types (`UnpeekConfig`, `ProtectOptions`, `ProtectSummary`, `UnpeekDiagnostic`, `TransformResult`).
- **Operational Recipes & Troubleshooting**: See [Recipes Guide](references/recipes.md) for Next.js SSR hydration solutions, telemetry hooks, and deterministic CI seeds.
