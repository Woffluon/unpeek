# unpeek Quickstart & CLI Reference

unpeek provides zero-config, post-build client bundle hardening and source map extraction for modern JavaScript applications.

---

## 1. Zero-Configuration Initialization

Run the initializer in your project root:

```bash
npx unpeek init
```

### What `unpeek init` Does
1. **Detects Framework**: Automatically identifies Next.js, Vite, Webpack, or Vanilla JS.
2. **Wires Build Protection**:
   - **Next.js >= 16.2**: Wraps `next.config.*` with `withUnpeek` from `unpeek/next` so protection runs automatically via the Next.js Build Adapter.
   - **All other frameworks (including Next.js < 16.2)**: Updates `package.json`:
   ```json
   {
     "scripts": {
       "postbuild": "unpeek protect"
     }
   }
   ```
   If a `postbuild` script already exists, unpeek appends `&& unpeek protect` while preserving indentation and newlines.
3. **Secures Source Map Vault**: Appends `.unpeek-maps/` to `.gitignore` so private production maps are never committed.
4. **Dry Run**: Pass `--dry-run` to preview changes without modifying files:
   ```bash
   npx unpeek init --dry-run
   ```

---

## 2. Configuration File Setup (`unpeek.config.js`)

While unpeek works zero-config out of the box, you can define persistent settings via a configuration file in your project root. unpeek automatically looks for:
1. `unpeek.config.js` (ESM or CommonJS)
2. `unpeek.config.mjs`
3. `unpeek.config.cjs`
4. `unpeek.config.json`

### Creating a Configuration File
Use the `defineConfig` helper from `unpeek/config` (also re-exported from `unpeek`) for full TypeScript type hints. Malformed or non-object config files throw `UnpeekError`:

```js
// unpeek.config.js
import { defineConfig } from 'unpeek/config';

export default defineConfig({
  target: 'browser',
  vault: {
    minStringLength: 4,
    cssFramework: 'tailwind',
    polymorphicDecoys: true,
  },
  sourcemaps: {
    keepPrivate: true,
    vaultDir: '.unpeek-maps',
  },
  hotPath: {
    customHooks: ['useAnimationLoop'],
  },
});
```

CLI flags take precedence over configuration file settings when both are specified.

---

## 3. Defense Tiers & Running Protection

After running your standard production build (e.g. `npm run build`), trigger protection:

```bash
npx unpeek protect
```

If `postbuild` is configured, `npm run build` triggers `unpeek protect` automatically.

### Defense Tiers

unpeek provides two distinct defense tiers depending on security and performance requirements:

- **Tier 1 (Default Profile)**:
  - Command: `npx unpeek protect`
  - Targets everyday production deployments where strict performance and size budgets must be maintained (<2% runtime CPU overhead, <15% Gzip size delta).
  - Employs 3-tier bidirectional call-graph exemption (`TRUE_HOT_60FPS`, `SHALLOW_RENDER_COMPONENT`, `SERIALIZED_WORKER`), 92-character zero-escape involutory string vaulting, non-linear quadratic MBA opaque predicates, in-place re-encrypting `Uint8Array` shader vault, and synchronous entry-chunk anti-tamper shield.
- **Tier 2 (`--aggressive` Profile)**:
  - Command: `npx unpeek protect --aggressive`
  - Eliminates plaintext exposure for high-value intellectual property, proprietary algorithms, financial calculations, and sensitive handlers.
  - Compiles selected cold functions into a compact (<1.2 KB, 24 opcodes) Bytecode Micro-VM supporting `async/await`, `try/catch`, and lexical closures without `eval` or `new Function`.
  - Backed by an inline WebAssembly Key Derivation Function (WASM KDF, <512 B, with hardened CSP JS fallback) and React 19 Concurrent-safe call-site salted decoders.

---

## 4. CLI Command Options & Flags

| Flag | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--out-dir <dir>` | `string` | Auto-detected | Explicit client output directory override. |
| `--seed <number>` | `number` | Random per build | Deterministic polymorphic seed for reproducible CI builds. |
| `--passive` | `boolean` | `true` (default) | Passive deterrent mode (telemetry event only; does not mute console). |
| `--gradual` | `boolean` | `false` | Gradual deterrent mode (silences console and corrupts runtime state on tamper). |
| `--detect-headless` | `boolean` | `false` | Treat `navigator.webdriver` / `HeadlessChrome` signals as tamper. |
| `--no-maps` | `boolean` | `false` | Permanently deletes `.map` files instead of moving them to vault. |
| `--private-maps-dir <dir>` | `string` | `.unpeek-maps` | Target directory for extracted production source maps. |
| `--min-string-length <num>` | `number` | `4` | Minimum string literal character length for string vault encryption. |
| `--no-shield` | `boolean` | `false` | Skips injecting the runtime anti-tamper deterrent shield into entry chunks. |
| `--aggressive` | `boolean` | `false` | Enables Tier 2 aggressive defense: Bytecode Micro-VM and inline WASM KDF. |
| `-v, --version` | `boolean` | — | Prints installed unpeek version. |
| `-h, --help` | `boolean` | — | Displays command-line help. |

---

## 5. CLI Execution Output & Metrics

Upon completing protection, unpeek prints a structured metrics summary:

```text
  ▛▀▀▜  unpeek 1.12.0
  ▙▄▄▟  client bundle protection

  PROJECT ──────────────────────────────────────
  framework            nextjs
  tier                 Tier 1 (default: <2% CPU, <15% Gzip)
  output               /workspace/.next/static/chunks
  bundles              14

  CALL GRAPH ───────────────────────────────────
  hot path exempt      42  0% tax
  cold path protected  128

  TRANSFORM ────────────────────────────────────
  string vault         256 literals  O(1) memo
  symbol mangling      312 bindings

  OUTPUT ───────────────────────────────────────
  source maps          14 moved -> .unpeek-maps/
  gzip                 412.30 KB -> 438.10 KB  +6.26%
  elapsed              48 ms

  done. maps are private. hot path untouched.
```

If `.dockerignore` is missing or omits `.unpeek-maps/`, unpeek prints an advisory:
```text
[unpeek:advisory] .dockerignore is missing .unpeek-maps/. Private maps may leak into Docker image during 'COPY . .'.
```

### Verification Checklist
- [ ] `bundles` > 0.
- [ ] `source maps` matches expected client `.map` file count.
- [ ] `gzip` delta remains within the <15% size budget.
- [ ] `.unpeek-maps/` contains the extracted `.map` files.
- [ ] `.dockerignore` contains `.unpeek-maps/`.
