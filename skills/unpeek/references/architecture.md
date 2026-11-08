# unpeek Architecture & Performance Model

unpeek combines call-graph-aware static AST transformation with a lightweight runtime shield to deter DevTools inspection, binary tampering, and automated deobfuscators without sacrificing client performance.

---

## 1. Two-Tier Defense Architecture Overview

unpeek operates on two distinct defense tiers depending on security requirements and runtime budgets:

- **Layer 1: Default Zero-Config Profile (Fast & Universal)**
  - **Targets**: Everyday production deployments with strict performance and bundle budgets (<2% CPU tax, <15% Gzip delta).
  - **Key Features**: 3-tier call-graph hot-path exemption (`TRUE_HOT_60FPS`, `SHALLOW_RENDER_COMPONENT`, `SERIALIZED_WORKER`), zero-escape 92-char involutory permutation string vault, Tailwind CSS & SVG noise filtering, In-Place Re-Encrypting `Uint8Array` Shader Vault (supporting WebGPU `@vgpu/wgsl` and GLSL), and synchronous entry-chunk runtime shield.
- **Layer 2: `--aggressive` Profile (Zero Plaintext Exposure)**
  - **Targets**: High-value client IP, sensitive licensing algorithms, financial models, and WebGPU compute shaders.
  - **Key Features**: Selective Bytecode Micro-VM (<1.2 KB, 24 opcodes, async/await, try/catch, closures without `eval`/`new Function`), Inline <512 B WebAssembly Key Derivation Function (with CSP JS fallback), and Idempotent Call-Site Salted Lazy String Vault (React 19 Concurrent Mode and StrictMode safe).

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
   - UI Render Functions: PascalCase component declarations (React, Preact), functions calling `useState`, `useEffect`, `createElement`, `_jsx`, `_jsxs`.
   - **Propagation Boundary**: Component render bodies stay hot (0% tax for 60fps renders and SSR Hydration), but downward lexical propagation (`1A`) and bottom-up propagation (`2`) are disabled. Nested `async` handlers (`onSubmit`, `handleSave`) and top-level 1-time `.map()` initializers are classified as **cold paths** and hardened.
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
- Shaders and large template literals (>=256 B or matching WebGPU `@vgpu/wgsl` / GLSL signatures) are packed into compact XOR-encrypted `Uint8Array` buffers.
- At runtime, `_uS(idx)` decrypts the buffer in-place, extracts the string via `TextDecoder`, and **immediately re-encrypts the buffer in-place inside `finally`**.
- Prevents plaintext shaders from lingering in heap memory and guarantees 100% idempotence under React `StrictMode` double-mounts.

---

## 4. 4-Family Contextual MBA Cold Flow Guards

In cold functions (event handlers, authentication, payment logic):
- Eliminates hardcoded `0x7fffffff` signatures and static `0` inputs (`fnIndex = guardedCount`).
- Binds a contextual dynamic runtime zero (`z = param ? 0 : 0`) with 4 distinct algebraic MBA families:
  1. `(((v ^ k) + ((v & k) << 1)) - (v + k)) !== target`
  2. `(((v | k) + (v & k)) ^ (v + k)) !== target`
  3. `(((v | ~k) - (~k)) ^ (v & k)) !== target`
  4. `(((v & ~k) + (v & k)) ^ v) !== target`
- Targets are polymorphic constants derived from the seed and function index (`target = ((seed ^ Math.imul(fnIndex + 1, 0x9e3779b1)) & 0x7fffff) | 1`).
- Shared module-level decoy arrays inject plausible fake API endpoints (`/api/v2/auth/admin-bypass`, `_verifyMasterToken`) to confuse automated reverse engineers.

---

## 5. Runtime Anti-Tamper Shield (Synchronous Attestation)

Injected exclusively into entry chunks as an SSR-safe, self-executing IIFE (<1.5 KB):
- **Synchronous Attestation**: Evaluates native function integrity (`Function.prototype.toString`) and sets `window[sym]` synchronously without deferring to `queueMicrotask`, closing the race condition before string vault decoders execute.
- **Tamper Detection**: Detects DevTools pretty-printing (`/\n/.test(src)`), headless browsers (`navigator.webdriver`), or prototype monkey-patching.
- **Poisoning**: If tampered, sets `window.__unpeek_tampered = true`, poisons the string vault key (`String.prototype._u = 14`), and dispatches `CustomEvent('unpeek:tamper')`. In `gradual` mode, standard console logging methods are silenced.

---

## 6. Layer 2 `--aggressive` Virtualization & WASM Security

When `--aggressive` is enabled:

### Bytecode Micro-VM (<1.2 KB)
- Selected cold functions are translated into stack-based bytecode with 24 seed-permuted opcodes.
- Executes within a lightweight while/switch loop without `eval` or `new Function`, remaining 100% compliant with strict CSP (`script-src 'self'`).
- Fully supports `async/await` (via promise continuation frames), `try/catch` error resumption, and lexical closure scopes.

### Inline <512 B WebAssembly KDF
- Embeds a minimal precompiled WASM binary (~180 bytes) instantiated synchronously via `WebAssembly.Module` and `WebAssembly.Instance`.
- Computes non-linear key mixing: `((fnId ^ seed) * 0x01000193) ^ ((callSiteSalt + shieldHash) * 0x45d9f3b)`.
- Falls back to an identical 32-bit JavaScript `Math.imul` implementation if CSP blocks WebAssembly.

### Idempotent Call-Site Salted Lazy Vault
- Each string reference passes a unique, static `callSiteSalt` constant (`_uD(idx, localSalt)`).
- Eliminates sequential mutable counters, making string access completely safe under React 19 Concurrent Mode interrupted renders.

---

## 7. Performance & Size Budgets

| Metric | Layer 1 (Default) | Layer 2 (`--aggressive`) | Observed Typical |
| :--- | :--- | :--- | :--- |
| **Runtime CPU Overhead** | `< 2.0%` | `< 5.0%` | `0.4% - 1.2%` |
| **Gzip Bundle Size Delta** | `< 15.0%` | `< 25.0%` | `3.8% - 7.9%` (L1) |
| **Deobfuscator Resistance**| Class 1 & 2 Resistant | Class 1–4 Immune | `%0` static recovery |
| **React StrictMode / SSR** | 100% Idempotent | 100% Idempotent | 0 hydration errors |
