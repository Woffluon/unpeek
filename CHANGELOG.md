# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.0.0] - 2026-11-16

### Added
- **3-Tier Protection & `@unpeek-critical` Enclaves**: Added `UnpeekTier` (`'Tier 1' | 'Tier 2' | 'Tier 3'`), `CriticalConfig` (`critical.annotation`, `critical.include`, `critical.maxFunctionsPerChunk`), `coldFlow` config flag, and `TransformOptions.{rootDir, critical, map}`. `PRESETS.strict` now defaults to `Tier 3` with `@unpeek-critical` enclave targeting, `PRESETS.recommended` to `Tier 2`, and `PRESETS.minimal` to `Tier 1` (`coldFlow: false`, `mangler.minLength: 1`).
- **Micro-VM v2**: Expanded the bytecode Micro-VM to a 43-opcode ISA with pre-VM AST lowering (`LogicalExpression` `&&`/`||`/`??`, `ConditionalExpression` `?:`, `SequenceExpression`, `for`/`while`/`do..while`, `try`/`throw` + `OP_THROW`, `this`, `new`, template literals, destructuring/default params, and `obj.arguments`/`obj.eval` `MemberExpression` support), `[8, 400]` node window, `$step` direct-threaded closure trampoline, inter-block `$f.ac` accumulator key ratchet, and per-`(seed, op)` MBA-wrapped handler ASTs.
- **ECMA-426 Multi-Pass Source Maps & `debugId` Gate**: Added ECMA-426 `.sections` index map flattening, true $M_1 \circ M_2$ `chainSourceMaps` composition with preamble `shiftSourceMapLines`, deterministic SHA-256 UUIDv4 `debugId` stamping across protected JS and `.unpeek-maps/*.map`, URL-encoded App Router path decoding (`%28public%29`, `%5Bsayi%5D`), and `debugid-mismatch` check rule in `checkProject`.
- **Host-Coupled Singleton WASM KDF**: Upgraded `wasm-vault.ts` to a shared singleton `371 B` (`<1.2 KB`) host-coupled WASM KDF (`env.g`/`env.m` imports via `createWasmHostEnv`, `bulkMix`, `mem`) with a bit-identical non-linear Rivest + 256-entry affine S-Box JS fallback.

### Changed
- **Order-Independent Shield & Non-Poisoning Vaults (Issue #1)**: Replaced `window` assumptions with `self`/`globalThis` (`WorkerGlobalScope`-safe) and removed `-1` cache poisoning when `globalThis[sym] === undefined` (async Turbopack/split chunk execution before entry shield initialization). Active tamper (`__unpeek_tampered`, `status === 2`, mismatched delta, pretty-print `/\n/`, or `Reflect.apply` descriptor spoofing) continues to fail closed without writing to cache.
- **64-Bit Salted Vault & Non-Linear MBA**: Upgraded call-site salts from 5-bit to 31-bit (`computeCallSiteSalt64`), replaced single-variable MBA with `>=4`-variable semi-linear MBA + degree-3 Rivest $\mathbb{Z}_{2^{32}}$ permutation polynomials + QNR `((Math.imul(z, z) + 1) & 3) === 3`, and switched decoy bridges to neutral return-domain-aligned structures without leaking source identifiers.
- **AST Hygiene, Mangler & CWE-540 Scrubber**: Fixed consecutive unary/update spacing (`y + +!T * P`), replaced fixed `_a`/`$b`/`_z` prefixes with deterministic polymorphic leading characters, lowered default `mangler.minLength` from `3` to `1` across presets, exempted `TURBOPACK`/`webpackChunk` headers while preserving module maps, and extended `scrubResidualPaths` with `rootDir`, `[project]/`, `webpack://`, and Windows `C:\` path scrubbing.
- **Bundler Lifecycles & Worker Isolation**: Moved Webpack/Rspack to `processAssets` (`PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE`), Vite to `enforce: 'post'` `generateBundle` with automatic `worker.plugins` wiring, esbuild to `onEnd` (`write: false` and `write: true`), Rollup to hash-placeholder `renderChunk`, Next.js manifest discovery (`.next/build-manifest.json`), and default exclusion of Service Workers / Web Workers (`sw.js`, `*.worker*.js`) unless `target: 'worker'`.

---

## [3.0.0]

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
