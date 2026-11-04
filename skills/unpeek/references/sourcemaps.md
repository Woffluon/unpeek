# Source Map Isolation & Production Security

Deploying production `.map` files publicly allows attackers to reconstruct 100% of your original TypeScript and JSX source code in browser DevTools. unpeek physically isolates source maps while keeping error tracking operational.

---

## 1. Vaulting Mechanism (`relocateSourceMaps`)

When unpeek protects a project (`unpeek protect` or `relocateSourceMaps`):

1. **Physical Relocation**: All `.js.map` and `.mjs.map` files in the client output folder are moved into `.unpeek-maps/` (or `--private-maps-dir`).
2. **Comment Stripping**: Public `.js` bundles are parsed and any `//# sourceMappingURL=...` or `/*# sourceMappingURL=... */` references are stripped.
3. **Directory Mirroring**: Subdirectory structures (e.g., `dist/assets/chunk.js.map`) are mirrored inside `.unpeek-maps/assets/chunk.js.map`.

---

## 2. CI/CD Sentry & Datadog Upload Workflow

Keep your production deployments hardened while maintaining full stack trace de-minification in your error monitoring tools.

### Sentry Upload Example (GitHub Actions)
```yaml
name: Production Build & Deploy

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install & Build
        run: |
          pnpm install
          pnpm run build
          # unpeek runs via postbuild or manually:
          npx unpeek protect

      - name: Upload Maps to Sentry
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: my-org
          SENTRY_PROJECT: web-app
        run: |
          # Upload private maps from vault before public deployment
          npx @sentry/cli sourcemaps upload \
            --release ${{ github.sha }} \
            .unpeek-maps/

      - name: Deploy Client Assets
        run: |
          # Deploy ONLY public output folder (e.g. dist/ or .next/)
          # .unpeek-maps/ is strictly excluded from deployment artifacts
          pnpm run deploy:production
```

### Datadog CI Upload Example
```bash
# Upload vaulted maps to Datadog Error Tracking
datadog-ci sourcemaps upload .unpeek-maps/ \
  --service web-app \
  --release-version 1.2.0 \
  --minified-path-prefix https://myapp.com/assets/
```

---

## 3. Git & Container Security Rules

### `.gitignore` Enforcement
`unpeek init` automatically appends `.unpeek-maps/` to `.gitignore`. Ensure the rule exists:
```gitignore
# unpeek private source map vault
.unpeek-maps/
```

### Docker / Container Protection (`.dockerignore`)
Never copy `.unpeek-maps/` into production container images:
```dockerignore
.unpeek-maps/
.next/cache
node_modules
```

### Verification Command
Run this in your CI pipeline before deploying to guarantee zero source map exposure:
```bash
# Must return 0 lines found in public directory
grep -rn "sourceMappingURL" dist/ .next/static/ || echo "Public bundles are clean!"
```

---

## 4. Alternative: Complete Source Map Deletion (`--no-maps`)

If your project does not use Sentry, Datadog, or Bugsnag and you want to discard source maps entirely:

```bash
npx unpeek protect --no-maps
```

With `--no-maps`, unpeek permanently deletes all `.map` files and strips public map comments without creating `.unpeek-maps/`.
