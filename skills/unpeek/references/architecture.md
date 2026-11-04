# unpeek Architecture & Performance Model

unpeek combines call-graph-aware static AST transformation with a lightweight runtime shield to deter DevTools inspection, binary tampering, and automated deobfuscators without sacrificing client performance.

---

## 1. Static AST Engine

The transformation engine operates directly on JavaScript AST nodes via **Acorn** (parser), **Acorn-Walk** (AST traverser), and **Astring** (fast generator):

1. **Deterministic Parsing**: Code is parsed into an ESTree-compliant AST with support for modern ES2022+ features.
2. **Call-Graph Hot-Path Detection**: Functions are classified into hot paths (0% overhead) and cold paths.
3. **Cold Flow Guard Injection**: Polymorphic opaque predicates and dead-end control flow branches are inserted into cold paths only.
4. **Polymorphic Scope Mangling**: Local parameters and function-scoped variables are systematically mangled using seed-derived alphanumeric identifiers.
5. **O(1) `kConst` String Vault**: String literals meeting length thresholds are encrypted into an indexed `kConst` array vault with dual tamper entanglement.
6. **Single-Line Generation**: AST is rendered into minified, single-line JavaScript code.

---

## 2. Call-Graph Hot-Path Exemption (0% Performance Tax)

Conventional obfuscators degrade performance by wrapping every statement and function in dynamic decoders. unpeek analyzes function bodies and call sites to exempt performance-critical paths via **bidirectional call-graph propagation**:

### Exempted Categories (Hot Paths)
- **Loops**: `for`, `for..in`, `for..of`, `while`, `do..while`.
- **Array Higher-Order Methods**: Callbacks passed to `.map()`, `.filter()`, `.forEach()`, `.reduce()`, `.flatMap()`, `.some()`, `.every()`, `.find()`, and `.findIndex()`.
- **Animation Frames**: Callbacks inside `requestAnimationFrame()` and `cancelAnimationFrame()`.
- **UI Render Functions**: PascalCase component declarations (React, Preact), functions invoking `createElement()`, and hook consumers.
- **Bidirectional Propagation**:
  - **Top-Down (`Hot Caller -> Callee`)**: Any helper function called inside a hot function, loop body, or `requestAnimationFrame` frame (e.g., `renderFrame -> lerp -> stepParticles`) transitively inherits hot exemption.
  - **Bottom-Up (`Caller -> Hot Callee`)**: Outer wrapper functions invoking hot paths are exempted from control-flow guards and scope mangling.

```text
Source Code AST
   │
   ├── [Hot Path Detected]  ──> Keep Pristine / 0% Overhead (Loops, rAF, Components, Hot Callees)
   │
   └── [Cold Path]          ──> Inject Polymorphic Flow Guard, Mangle Symbols & Vault Strings
```

This selective transformation guarantees application framerates (60 FPS) and keeps execution overhead well below the **<2% CPU budget**.

---

## 3. O(1) V8 `kConst` String Vault & Tamper Key Entanglement

String literals in cold paths (`length >= minStringLength`, default: 4; hot loop bodies and hot callees are strictly exempted) are protected at build time:

- **FNV-1a & Polymorphic XOR**: Strings are encrypted at build time using a 32-bit FNV-1a hash key derived from the build seed.
- **V8 `kConst` Pre-Decoded Array (`_uC`)**: An encoded string pool is injected once per module (`const _uC = [...].map(...)`) and evaluated once at module load, allowing V8 TurboFan to treat `_uC[index]` lookups as constant O(1) array loads with zero runtime function-call overhead.
- **Tamper Key Entanglement (`a._u` & `/\n/.test(f)`)**: The XOR key derivation embeds both `a._u` (`String.prototype._u`) and self-verifying decoder formatting (`/\n/.test(f)`). In an untampered runtime `a._u` is `undefined` (`| 0`), yielding the exact plaintext; if the runtime shield detects tampering or DevTools pretty-printing, it sets `String.prototype._u = 14`, and even if `String.prototype` is frozen, pretty-printing the decoder function corrupts vault decryption keys automatically.

---

## 4. Cold Flow Guard

In cold functions (event handlers, initialization logic, credential exchanges):
- **Runtime-Invariant Opaque Predicates**: Introduces bitwise invariants bound to global runtime references (`if (((a ^ (b | !String)) & 7) === wrongVal) return null;`) that always evaluate to `false` in V8 (`!String === 0` at JIT time, 0.00% CPU overhead) while preventing static AST literal constant-folders (`webcrack`, `Terser`, `SWC`) from stripping the guard without runtime environment assumptions.

---

## 5. Runtime Anti-Tamper Shield

Injected exclusively into entry chunks as an SSR-safe, self-executing IIFE (<1.5 KB):

### Detection Mechanics & Token Binding
- **Function Integrity & FNV-1a Token Binding**: Evaluates `Function.prototype.toString.call(...)` and binds the build's 32-bit FNV-1a integrity token (`expectedIntegrityHash & 1`) into the native code offset check to detect monkey-patching or breakpoint hooking.
- **Formatting / Deobfuscation Traps & Vault Poisoning**: Checks whether the function representation contains newline characters (`\n` or `\r`), triggering when an attacker pretty-prints or reformats the bundle in DevTools, and sets `String.prototype._u = 14` to poison the string vault key.

### Deterrent Modes
1. **Passive Mode (`--passive` or `deterrentMode: 'passive'`)**:
   - Does not alter browser `console` behavior.
   - Sets `window.__unpeek_tampered = true`.
   - Dispatches a standard browser custom event:
     ```js
     window.dispatchEvent(new CustomEvent('unpeek:tamper'));
     ```
   - Ideal for production telemetry (Sentry, Datadog) without alerting attackers.
2. **Gradual Mode (`deterrentMode: 'gradual'`, CLI default):**
   - Sets `window.__unpeek_tampered = true` and dispatches `unpeek:tamper`.
   - Progressively silences standard logging methods (`console.log`, `console.debug`, `console.info`, `console.table`, `console.dir`).

---

## 6. Performance & Size Budgets

| Metric | Target Budget | Observed Typical |
| :--- | :--- | :--- |
| **Runtime CPU Overhead** | `< 2.0%` | `0.4% - 1.1%` |
| **Gzip Bundle Size Delta** | `< 15.0%` | `3.5% - 8.2%` |
| **Shield Bundle Footprint** | `< 1.5 KB` | `~1.1 KB` uncompressed |
