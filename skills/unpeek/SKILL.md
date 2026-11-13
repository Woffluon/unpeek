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
4. **Protect**: `unpeek protect` runs post-build under Tier 1 (<2% CPU, <15% Gzip). Append `--aggressive` for Tier 2 defense (Micro-VM & WASM KDF), `--dry-run` to preview, or `--max-gzip-delta <percent>` to enforce a budget.
5. **Verify & Symbolicate**: Run `npx unpeek check` as a read-only CI gate and `npx unpeek symbolicate` to resolve production stack traces locally using `.unpeek-maps/`.

## Two-Tier Defense Architecture

- **Tier 1 (Default Profile)**: Production protection (<2% CPU, <15% Gzip delta). Employs 3-tier call-graph exemption (`TRUE_HOT_60FPS`, `SHALLOW_RENDER_COMPONENT`, `SERIALIZED_WORKER`), 92-char involutory string vault, quadratic MBA predicates, in-place shader vault, and runtime shield.
- **Tier 2 (`--aggressive` Profile)**: Zero plaintext exposure for sensitive logic. Compiles cold functions to a <1.2 KB 24-opcode Bytecode Micro-VM (with closures, without `eval`), backed by inline WASM KDF (with CSP fallback) and call-site salted decoders.

## Reference Navigation

Direct requests to the relevant modular guide:

- **CLI & Zero-Config Setup**: See [Quickstart Guide](references/quickstart.md) for `init`, `protect`, `check`, `symbolicate`, `unpeek.config.js` setup, and CLI flags (`--profile`, `--dry-run`, `--max-gzip-delta`, `--out-dir`, `--seed`, `--passive`, `--min-string-length`, `--private-maps-dir`, `--no-shield`, `--aggressive`).
- **Framework Integrations**: See [Frameworks Guide](references/frameworks.md) for Next.js (`phase`-aware `withUnpeek`, SSR boundary, custom `distDir`), Vite, Webpack, Rspack, Rollup, and subpath imports (`unpeek/vite`, `unpeek/webpack`, `unpeek/rspack`, `unpeek/unplugin`).
- **Core Architecture & Performance**: See [Architecture Guide](references/architecture.md) for two-tier defense, 3-tier hot-path exemption (loops, rAF, useFrame), shader vault, Bytecode Micro-VM, WASM KDF, O(1) string vault, and runtime shield.
- **Source Map Vaulting & Security**: See [Source Maps Guide](references/sourcemaps.md) for `.unpeek-maps/` relocation, `sourceMappingURL` stripping, `unpeek check` / `unpeek symbolicate`, Sentry/Datadog CI workflows, and `.dockerignore` best practices.
- **Programmatic API**: See [API Reference](references/api.md) for `protectProject()`, `transformJavaScript()`, `initProject()`, `checkProject()`, `symbolicateStackTrace()`, `PRESETS`, `isUnpeekError`, config helpers (`defineConfig`, `loadUnpeekConfig`), and TypeScript types (`UnpeekConfig`, `ProtectOptions`, `ProtectSummary`, `UnpeekDiagnostic`, `TransformResult`).
- **Operational Recipes & Troubleshooting**: See [Recipes Guide](references/recipes.md) for Next.js SSR hydration solutions, telemetry hooks, and deterministic CI seeds.
