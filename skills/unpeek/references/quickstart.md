# unpeek Quickstart & CLI Reference

unpeek provides zero-config, post-build client bundle hardening and source map extraction for modern JavaScript applications.

## 1. Zero-Configuration Initialization

Run the initializer in your project root:

```bash
npx unpeek init
```

### What `unpeek init` Does
1. **Detects Framework**: Automatically identifies Next.js, Vite, Webpack, or Vanilla JS.
2. **Configures Postbuild Hook**: Updates `package.json`:
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

## 2. Running Protection

After running your standard production build (e.g., `npm run build`), trigger protection:

```bash
npx unpeek protect
```

If `postbuild` is set up, `npm run build` triggers `unpeek protect` automatically.

---

## 3. CLI Command Options & Flags

| Flag | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--out-dir <dir>` | `string` | Auto-detected | Explicit client output directory override. |
| `--seed <number>` | `number` | Random per build | Deterministic polymorphic seed for reproducible CI builds. |
| `--passive` | `boolean` | `false` | Enables passive deterrent mode (telemetry event only; does not mute console). |
| `--no-maps` | `boolean` | `false` | Permanently deletes `.map` files instead of moving them to vault. |
| `--private-maps-dir <dir>` | `string` | `.unpeek-maps` | Target directory for extracted production source maps. |
| `--min-string-length <num>` | `number` | `4` | Minimum string literal character length for O(1) string vault encryption. |
| `--no-shield` | `boolean` | `false` | Skips injecting the runtime anti-tamper deterrent shield into entry chunks. |
| `-v, --version` | `boolean` | — | Prints installed unpeek version. |
| `-h, --help` | `boolean` | — | Displays command-line help. |

---

## 4. CLI Execution Output & Metrics

Upon completing protection, unpeek prints an ASCII metrics summary:

```text
[unpeek] Protection Complete
+--------------------------------+--------------------------------------------------------+
| Framework                      | nextjs                                                 |
| Client OutDir                  | /workspace/.next/static/chunks                         |
| Processed Bundles              | 14                                                     |
| Vaulted Source Maps            | 14                                                     |
| Cold Functions Protected       | 128                                                    |
| Hot Functions Skipped (0% Tax) | 42                                                     |
| Encrypted Strings              | 256                                                    |
| Mangled Symbols                | 312                                                    |
| Gzip Bundle Size               | 412.30 KB -> 438.10 KB (+6.26%)                        |
| Elapsed Time                   | 48 ms                                                  |
+--------------------------------+--------------------------------------------------------+
```

### Verification Checklist
- [ ] `Processed Bundles` > 0.
- [ ] `Vaulted Source Maps` matches expected client `.map` count.
- [ ] `Gzip Bundle Size` delta remains within the <15% budget.
- [ ] `.unpeek-maps/` contains the extracted `.map` files.
