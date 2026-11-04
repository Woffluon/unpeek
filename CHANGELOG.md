# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
