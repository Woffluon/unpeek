# unpeek Architecture & Performance Model

unpeek combines call-graph-aware static AST transformation with a lightweight runtime shield to deter DevTools inspection, binary tampering, and automated deobfuscators without sacrificing client performance.

---

## 1. Static AST Engine

The transformation engine operates directly on JavaScript AST nodes via **Acorn** (parser), **Acorn-Walk** (AST traverser), and **Astring** (fast generator):

1. **Deterministic Parsing**: Code is parsed into an ESTree-compliant AST with support for modern ES2022+ features.
2. **Call-Graph Hot-Path Detection**: Functions are classified into hot paths (0% overhead) and cold paths.
3. **Cold Flow Guard Injection**: Polymorphic opaque predicates and dead-end control flow branches are inserted into cold paths only.
4. **Polymorphic Scope Mangling**: Local parameters and function-scoped variables are systematically mangled using seed-derived alphanumeric identifiers.
5. **O(1) Lazy String Vault**: String literals meeting length thresholds are encrypted into an indexed vault.
6. **Single-Line Generation**: AST is rendered into minified, single-line JavaScript code.

---

## 2. Call-Graph Hot-Path Exemption (0% Performance Tax)

Conventional obfuscators degrade performance by wrapping every statement and function in dynamic decoders. unpeek analyzes function bodies and call sites to exempt performance-critical paths:

### Exempted Categories (Hot Paths)
- **Loops**: `for`, `for..in`, `for..of`, `while`, `do..while`.
- **Array Higher-Order Methods**: Callbacks passed to `.map()`, `.filter()`, `.forEach()`, `.reduce()`, `.flatMap()`, `.some()`, `.every()`, `.find()`, and `.findIndex()`.
- **Animation Frames**: Callbacks inside `requestAnimationFrame()` and `cancelAnimationFrame()`.
- **UI Render Functions**: PascalCase component declarations (React, Preact), functions invoking `createElement()`, and hook consumers.

```text
Source Code AST
   │
   ├── [Hot Path Detected]  ──> Keep Pristine / 0% Overhead (Loops, rAF, Components)
   │
   └── [Cold Path]          ──> Inject Polymorphic Flow Guard & Mangle Symbols
```

This selective transformation guarantees application framerates (60 FPS) and keeps execution overhead well below the **<2% CPU budget**.

---

## 3. O(1) Lazy String Vault

String literals expose business logic, API endpoints, and private keys. unpeek protects literals (`length >= minStringLength`, default: 4):

- **FNV-1a & Polymorphic XOR**: Strings are encrypted at build time using a 32-bit FNV-1a hash key derived from the build seed.
- **Inline Array Vault**: An encoded string pool is injected once per module.
- **Lazy Inline Cache**: Each encrypted string access resolves through an inlined decoder. On first access, the plaintext is decoded and stored in an inline cache index; subsequent lookups execute in **O(1)** time.

---

## 4. Cold Flow Guard

In cold functions (event handlers, initialization logic, credential exchanges):
- **Opaque Predicates**: Introduces algebraic invariants (e.g., `(x * (x + 1)) % 2 === 0`) that always evaluate to true at runtime but cannot be resolved statically by AST decompilers.
- **Dead-Code Branches**: Injects unreachable synthetic branches containing plausible control flow, defeating automated pattern recognizers and symbolic execution analyzers.

---

## 5. Runtime Anti-Tamper Shield

Injected exclusively into entry chunks as an SSR-safe, self-executing IIFE (<1.5 KB):

### Detection Mechanics
- **Function Integrity**: Evaluates `Function.prototype.toString.call(...)` to detect monkey-patching or breakpoint hooking.
- **Formatting / Deobfuscation Traps**: Checks whether the function representation contains newline characters (`\n` or `\r`), triggering when an attacker pretty-prints or reformats the bundle in DevTools.

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
