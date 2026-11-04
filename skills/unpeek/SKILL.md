---
name: unpeek
description: Zero-config, call-graph-aware client-side JavaScript protection, anti-reverse-engineering, and source map security for Next.js, Vite, Webpack, Rollup, and Vanilla JS applications.
license: MIT
metadata:
  author: Woffluon
  version: 1.2.0
---

# unpeek Skill

Zero-config, call-graph-aware client-side JavaScript protection and source map isolation toolkit with <2% runtime CPU overhead and <15% Gzip delta.

## Agent Persona & Language Policy

- **Language Policy**: Always reply in the user's prompt language (e.g., Turkish if prompted in Turkish, English if prompted in English).
- **Technical Fidelity**: Maintain exact technical terms, CLI flags, configuration parameters, and code snippets exactly as defined in the reference documents (e.g., `npx unpeek init`, `npx unpeek protect`, `deterrentMode: 'passive'`, `.unpeek-maps/`, `CustomEvent('unpeek:tamper')`).
- **Client-Only Boundary**: Never modify or protect server/SSR bundles (`.next/server`, `ssr`). Only target compiled browser assets (`.next/static/chunks`, `dist/assets`, `build`).

## Quick Workflow

1. **Initialize**: Run `npx unpeek init` to configure `"postbuild": "unpeek protect"` in `package.json` and add `.unpeek-maps/` to `.gitignore`.
2. **Build**: Run the project's standard production build (`npm run build`).
3. **Protect**: `unpeek protect` executes automatically post-build, extracting `.map` files into `.unpeek-maps/` and applying AST hardening.

## Reference Navigation

Direct user requests to the appropriate modular guide:

- **CLI & Zero-Config Setup**: Consult [Quickstart Guide](references/quickstart.md) for command syntax, postbuild hook creation, and CLI flags (`--out-dir`, `--seed`, `--passive`, `--min-string-length`, `--private-maps-dir`, `--no-shield`).
- **Framework Integrations**: Consult [Frameworks Guide](references/frameworks.md) for Next.js (SSR vs. CSR boundary, static export `out/`), Vite, Webpack, Rollup, and subpath imports (`unpeek/vite`, `unpeek/webpack`, `unpeek/unplugin`).
- **Core Architecture & Performance**: Consult [Architecture Guide](references/architecture.md) for AST traversal, call-graph hot-path exemption (loops, rAF, render functions), O(1) lazy string vault, cold flow guards, and anti-tamper runtime shields.
- **Source Map Vaulting & Security**: Consult [Source Maps Guide](references/sourcemaps.md) for `.unpeek-maps/` relocation, `sourceMappingURL` stripping, Sentry/Datadog CI upload workflows, and `.dockerignore` rules.
- **Programmatic API**: Consult [API Reference](references/api.md) for `protectProject()`, `transformJavaScript()`, `initProject()`, and TypeScript type definitions (`ProtectOptions`, `TransformOptions`, `ProtectSummary`).
- **Operational Recipes & Troubleshooting**: Consult [Recipes Guide](references/recipes.md) for Next.js SSR hydration error solutions, Sentry/Datadog telemetry hooks, and deterministic CI seed generation.
