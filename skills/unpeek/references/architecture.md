# unpeek Architecture & Performance Model

unpeek combines call-graph-aware static AST transformation with a lightweight runtime shield to deter DevTools inspection, binary tampering, and automated deobfuscators without sacrificing client performance.

---

## 1. Three-Tier Defense Architecture Overview

unpeek operates on three protection tiers aligned with `minimal`, `recommended`, and `strict` preset profiles:

- **Tier 1 (`minimal` Profile — Fast Baseline)**:
  - **Targets**: Ultra-low-footprint deployments with `coldFlow: false`, `mangler.minLength: 1`, 3-tier call-graph hot-path exemption, and order-independent `globalThis` runtime shield (`<2%` CPU tax, `<15%` Gzip delta).
- **Tier 2 (`recommended` / Default Profile — Balanced Production Hardening)**:
  - **Targets**: Everyday production deployments (`<2%` CPU tax, `<15%` Gzip delta).
  - **Key Features**: 3-tier call-graph hot-path exemption (`TRUE_HOT_60FPS`, `SHALLOW_RENDER_COMPONENT`, `SERIALIZED_WORKER`), zero-escape 92-char involutory permutation string vault, Tailwind CSS & SVG noise filtering, `>=4`-variable semi-linear MBA + degree-3 Rivest $\mathbb{Z}_{2^{32}}$ QNR predicates, In-Place Re-Encrypting `Uint8Array` Shader Vault (supporting WebGPU `@vgpu/wgsl` and GLSL), `mangler.minLength: 1` with deterministic polymorphic identifier prefixes, and order-independent `globalThis` runtime shield.
- **Tier 3 (`strict` / `--aggressive` Profile — Critical Enclave Virtualization)**:
  - **Targets**: `@unpeek-critical` annotated functions, `critical.include` patterns, high-value client IP, licensing algorithms, financial models, and WebGPU compute shaders.
  - **Key Features**: Micro-VM v2 (43-opcode direct-threaded trampoline with pre-VM AST lowering and inter-block `$f.ac` accumulator ratchet, `[8, 400]` node window, no `eval`/`new Function`), shared singleton `<1.2 KB` (`371 B` binary) host-coupled WASM KDF (`env.g`/`env.m` with bit-identical non-linear JS fallback), 64-bit call-site salted lazy string vault, and CWE-540 path scrubbing (`rootDir`, `[project]/`, `webpack://`, Windows `C:\`).

---

## 2. 3-Tier Call-Graph Hot-Path Exemption (0% Performance Tax)

Conventional obfuscators degrade performance by wrapping every statement and function in dynamic decoders. unpeek analyzes function bodies and call sites to exempt performance-critical paths via **bidirectional call-graph propagation**:

### 3-Tier Classification
1. **`TRUE_HOT_60FPS`**:
   - Loops: `for`, `for..in`, `for..of`, `while`, `do..while`.
   - Animation Frames: Callbacks passed to `requestAnimationFrame()` and `cancelAnimationFrame()`.
   - High-Frequency Animation Hooks: Three.js and React Three Fiber `useFrame((state, delta) => ...)` animation loops.
   - Loop/Function-Scoped Array Higher-Order Methods: Callbacks in `.map()`, `.filter()`, `.forEach()`, `.reduce()`, etc.
   - **Propagation**: Transitive top-down (`Hot Caller -> Callee`) and bottom-up (`Caller -> Hot Callee`) exemption is preserved.
2. **`SHALLOW_RENDER_COMPONENT`**:
   - UI Render Functions: PascalCase component declarations (React, Preact) carrying an explicit JSX (`createElement`, `cloneElement`, `jsx`, `jsxs`, `_jsx`, `_jsxs`, `jsxDEV`, `_jsxDEV`), React hook (`use*`), or HOC (`memo`, `forwardRef`) UI signal—non-UI PascalCase helpers/classes (e.g., `LicenseValidator`) stay cold and protected.
   - **Propagation Boundary**: Component render bodies stay hot (0% tax for 60fps renders and SSR Hydration), but downward lexical propagation (`1A`) and bottom-up propagation (`2`) are disabled. Nested `async` handlers (`onSubmit`, `handleSave`) and top-level 1-time `.map()` initializers are classified as **cold paths** and hardened.
   - **Source Map v3 Critical Targeting**: `analyzeAstHotPaths` accepts an optional Source Map v3 (`sourcemap-critical.ts`) so `/*! @unpeek-critical */` annotations and `critical.include` names resolve accurately via VLQ mappings, `sourcesContent`, and `names` even when bundlers strip comments or rename functions.
3. **`SERIALIZED_WORKER`**:
   - Worker factories and descriptors calling `.toString()`, `importScripts()`, or `onmessage`. Entire sub-trees are exempted from mangling and transformation to prevent runtime serialization errors.

```text
Source Code AST
   │
   ├── [TRUE_HOT_60FPS]          ──> Keep Pristine / 0% Tax (Loops, rAF, useFrame, Hot Callees)
   │
   ├── [SHALLOW_RENDER_COMPONENT]──> Render Frame Hot / Cold Handlers (onSubmit, handleSave) Hardened
   │
   └── [Cold Path]               ──> Inject Contextual MBA Guard, Mangle Symbols & Vault Strings
```

---

## 3. O(1) String Vault, Noise Filters & In-Place Shader Vault

String literals in cold paths (`length >= minStringLength`, default: 4) are protected at build time:

### Zero-Escape 92-Char Involutory ASCII Permutation
- Replaces periodic XOR with an involutory ASCII permutation table (`P[P[c]] = c`) excluding `"` and `\`.
- Preserves LZ77/DEFLATE dictionary redundancy (>98% match) while eliminating JSON escaping bloat.
- Rotated at runtime by a hash derived from the decoder's own `f.toString()` and the synchronous runtime shield state (`rot = ((h ^ (a._u || 0) ^ window[sym]) & 31)`), defeating static deobfuscators like `unpeek-solver.mjs` (%0 string recovery).

### Tailwind CSS & SVG Path Noise Filtering
- Strings matching SVG path coordinates (`M...`) or containing >=3 tokens with >=50% Tailwind CSS class prefix matches are exempted from vault encryption, preventing bundle bloat.

### In-Place Re-Encrypting Shader Vault (`Uint8Array`)
- Shaders and large template literals (>=256 B or matching WebGPU `@vgpu/wgsl` / GLSL signatures outside direct loops) are packed into compact XOR-encrypted `Uint8Array` buffers across both Tier 2 (`recommended`) and Tier 3 (`strict` / `--aggressive`), while exempting universal binary/Base64 WASM payloads (`AGFzbQE`), binary `data:` URIs (`application/wasm`, `application/octet-stream`, `image/`, `font/`, `audio/`, `video/`), and large pure Base64 blobs (`>=4096` chars).
- At runtime, `_uS(idx)` verifies runtime shield coupling (`sym`, `expectedDelta`, `NARROWED_ASYNC_BR_DECL`), decrypts the buffer in-place, extracts the string via `TextDecoder`, and **immediately re-encrypts the buffer in-place inside `finally`** (bypassing cache and perturbing key derivation on tamper).
- Prevents plaintext shaders from lingering in heap memory and guarantees 100% idempotence under React `StrictMode` double-mounts.

---

## 4. Non-Linear Semi-Linear MBA, Rivest Polynomials & QNR Cold Flow Guards

In cold functions (`coldFlow: true`; event handlers, authentication, payment logic — skipping already-virtualized Micro-VM bodies):
- Eliminates static single-variable `0 === odd` identities and hardcoded `0x7fffffff` signatures, while type-guarding parameter coercions (`typeof param === 'number' ? param | 0 : 0`) so `Object.create(null)`, `Symbol`, and `BigInt` inputs never throw `TypeError`.
- Combines `>=4`-variable semi-linear Mixed Boolean-Arithmetic (MBA) predicates with folded constants, degree-3 Rivest permutation polynomials mod $2^{32}$, a 256-entry seeded S-Box, and 4 state- and shield-coupled predicate forms across 4 quadratic non-residue (QNR) modular residue families ($\pmod 4, \pmod 8, \pmod{16}$) with alias-table write-read perturbation (removing fixed `=== R` AST suffixes).
- Existing application `if/else` branches are never mutated; neutral, return-domain-aligned contextual decoy bridges (`number`/`boolean`/`string`/`void`/`object`) avoid leaking source identifiers or hardcoded decoy routes.
- Bundler runtime headers (`globalThis.TURBOPACK.push` headers/IDs/keys, `self.webpackChunk*`, `__rspack_chunk*`) and `serializedFunctionNodes` (including nested worker helpers) are exempted selectively while keeping module factory bodies inside vault coverage, and `compactGenerator` preserves spacing around consecutive unary/update operators (`y + +!T * P`).

---

## 5. Order-Independent `globalThis` Anti-Tamper Shield

Injected exclusively into entry chunks as a `WorkerGlobalScope`-safe (`self`/`globalThis`), self-executing IIFE:
- **Hybrid Browser-Context & Order-Independent Attestation**: Writes `globalThis[sym]` and companion state record `globalThis[sym + '_s']` synchronously without `queueMicrotask` races. Narrowed async tolerance (`sv === void 0`) applies only to genuine loading DOM (`document.scripts.length > 0 && document.readyState !== 'complete'`) or Web Worker (`typeof self.importScripts === 'function'`) contexts so async split chunks (such as Next.js 16 Turbopack) executing before the entry shield initializes resolve cleanly without poisoning cache (`d = -1` removed); bare non-browser VMs (`node:vm`, bare `{}`) and already-complete documents without a shield fail closed.
- **Tamper & Proxy Trap Detection**: Detects DevTools pretty-printing (`/\n/.test(src)`), headless browsers (`navigator.webdriver`), or `Reflect.apply` / `Object.getOwnPropertyDescriptor` / `Function.prototype.toString` / `Function.prototype.call` / `Error.prepareStackTrace` / `Error.prototype.stack` spoofing—including naive and self-spoofing `Proxy` traps via descriptor locks, prototype-chain checks, native signature regexes, cross-call probes, and V8 stack-trace trap inspection.
- **Fail-Closed Poisoning**: On active tampering (`__unpeek_tampered === true`, `status === 2`, or mismatched delta) or bare VM harvesting, decoders fail closed without writing to cache, while dispatching `CustomEvent('unpeek:tamper')` (and silencing `console` in `gradual` mode).

---

## 6. Tier 3 `--aggressive` Virtualization & Host-Coupled WASM KDF

When `--aggressive` or `tier: 'Tier 3'` (`--profile strict`) is enabled:

### Bytecode Micro-VM v2 (43-Opcode Direct-Threaded Trampoline)
- Priority-scores cold functions for `maxFunctionsPerChunk` (`@unpeek-critical` / `critical.include` > submit/validation/auth/checkout/server-action/`fetch` handlers > multi-statement logic; default `12`, `[8, 400]` AST node window) without touching hot paths.
- Pre-VM AST lowering supports `&&`/`||`/`??`, `?:`, sequence expressions, `for`/`while`/`do..while` loops, `try/throw` (`OP_THROW`), `this`, `new`, template literals, destructuring/default parameters, and `obj.arguments`/`obj.eval` member accesses, and prunes unreachable post-`RET`/`THROW` epilogues.
- Shares per-`(scope, seed)` runtime instances on `globalThis.__unpeek_vm`, checks `_uVm*` `Function.prototype.toString()` for pretty-print formatting (`$flt = 1`), verifies 32-bit `sym_s[1]` (`expectedStateHash`), and executes via a `$step` direct-threaded closure trampoline with an inter-block `$f.ac` accumulator ratchet and per-`(seed, op)` non-zero semantic handler biases (`1..31`)—zero `eval()` or `new Function()`, 100% strict CSP compliant.

### Shared Host-Coupled WASM KDF (<1.2 KB Singleton)
- Synthesizes a compact `<1.2 KB` WebAssembly binary importing masked `env.g(i32)->i32` and `env.m(i32, i32)->i32` host hooks (`gMask`, `pcMask`, plus `bulkMix` and `mem` exports; zero-import instantiation fails with `TypeError`/`LinkError`).
- Compiled once into a shared `globalThis` polymorphic singleton slot across split chunks, eliminating per-chunk WASM bloat, with a bit-identical non-linear Rivest + 256-entry affine S-Box JavaScript fallback (`kdfParityVerified: true`) when CSP blocks WebAssembly.

### Idempotent 64-Bit Call-Site Salted Lazy Vault
- Each string reference passes a 31-bit positive call-site salt derived via 64-bit mixing (`computeCallSiteSalt64`) instead of a 5-bit mask or mutable counter, guaranteeing React 19 Concurrent Mode and StrictMode idempotence.

---

## 7. Performance & Size Budgets

| Metric | Tier 1 (`minimal`) | Tier 2 (`recommended`) | Tier 3 (`strict` / `--aggressive`) |
| :--- | :--- | :--- | :--- |
| **Runtime CPU Overhead** | `< 1.0%` | `< 2.0%` | `< 5.0%` (0% hot loop) |
| **Gzip Bundle Size Delta** | `< 5.0%` | `< 15.0%` | `< 25.0%` |
| **Deobfuscator Resistance**| Mangling + Shield | Class 1–2 Resistant | Class 1–4 Enclave Hardened |
| **React StrictMode / SSR** | 100% Idempotent | 100% Idempotent | 0 hydration errors |
