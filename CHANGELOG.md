# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] (v3.0.0)

### Added
- **CLI**: Added `unpeek check` (read-only CI gate for leaked maps, `sourceMappingURL` comments, ignore entries, Gzip budget, and `eval()`/`new Function()`), `unpeek symbolicate` (local stack trace resolution via `.unpeek-maps/`), and `--profile <minimal|recommended|strict>`, `--dry-run`, `--max-gzip-delta <percent>` flags.
- **Public API & Options**: Added `PRESETS` (`UnpeekProfile`), `defineConfig<const T>`, `isUnpeekError`, `UnpeekDiagnostic`, `TransformResult.skippedReason`, `checkProject`, `symbolicateStackTrace`, `scrubPaths`, and `vault.fragmented` / `vault.fragmentCount`.
- **Adapters & Exports**: Added `./rspack` (`unpeek/rspack`) and `./package.json` subpath exports, plus Next.js 16 `phase`-aware `withUnpeek` and `RegExp`-safe `UNPEEK_NEXT_OPTIONS` config bridge.
- **Migration Guide**: Added `docs/MIGRATION_V3.md`.

### Breaking Changes
- Removed `./ast` and `./runtime` subpath exports; import `transformJavaScript` and public types from the root `unpeek` entry point.
- Removed internal config helpers from `unpeek/config` (`DEFAULT_CONFIG`, `normalizeConfig`, `mergeUnpeekConfig`, `findConfigFile`, `resolveUnpeekConfigSync`, `CONFIG_CANDIDATES`) and internal runtime helpers (`deriveWindowKeySymbol`, `deriveIntegrityFnName`).
- Removed `unplugin` inline `UnpeekConfig` duck-typing; pass `UnpeekConfig` overrides via `options.config`.
- Narrowed `ProtectSummary.tier` (`'Tier 1' | 'Tier 2' | undefined`) and `InitResult.framework` (`UnpeekFramework | undefined`).

---

## [1.0.1] - 2026-11-04

### Changed
- Synchronized documentation sites, code samples, and CLI options with implementation.
- Updated Next.js configuration to eliminate workspace root warning using `outputFileTracingRoot`.
- Standardized universal unplugin and Vite subpath imports across documentation.

### Fixed
- Fixed release backlog and npm base version discovery in CI release pipeline.
- Configured npm OIDC trusted publishing and immutable release pipeline.

---

## [1.0.0] - 2026-11-01

### Added
- Initial release of `unpeek`.
- Call-graph-aware AST traversal engine with transitive hot-path exemption (<2% CPU overhead).
- Polymorphic lazy string vault with O(1) runtime caching (<15% Gzip growth).
- Runtime anti-tamper shield with 32-bit FNV-1a checksum and passive deterrent modes.
- Source map isolation vault (`.unpeek-maps/`) with automatic `//# sourceMappingURL=` comment removal.
- Universal bundler plugin support via unplugin (`unpeek/unplugin`, `unpeek/vite`, `unpeek/webpack`, `unpeek/rollup`, `unpeek/esbuild`).
- Postbuild CLI with `init` and `protect` commands.
- Bilingual (EN/TR) static documentation website and interactive playground under `apps/web`.
