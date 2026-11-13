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

### Docker / Container Protection (`.dockerignore` Best Practice)
In containerized deployments, commands like `COPY . .` in a Dockerfile will copy the local `.unpeek-maps/` directory into the Docker image layer unless explicitly ignored. This can inadvertently expose private source maps inside public or shared container images.

#### unpeek Advisory Warning
During execution, `unpeek protect` inspects `.dockerignore` in your project root. If `.dockerignore` does not exist or omits `.unpeek-maps/`, unpeek issues an advisory:

```text
[unpeek:advisory] .dockerignore is missing .unpeek-maps/. Private maps may leak into Docker image during 'COPY . .'.
```

#### Recommended `.dockerignore`
Ensure `.dockerignore` includes `.unpeek-maps/` alongside standard build caches:

```dockerignore
# unpeek private source map vault
.unpeek-maps/

# Bundler caches & dependencies
node_modules
.next/cache
.git
npm-debug.log*
```

#### Multi-Stage Dockerfile Pattern
In multi-stage Docker builds, only copy public distribution assets to the runtime stage:

```dockerfile
# Stage 1: Build & Protect
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
# unpeek protect runs post-build: .unpeek-maps/ created, public chunks stripped

# (Optional CI step: upload .unpeek-maps/ to Sentry / Datadog)

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy only public client chunks and standalone server; exclude .unpeek-maps/
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

### Verification Command
Run `unpeek check` in your CI pipeline before deploying to verify zero source map exposure, clean `sourceMappingURL` stripping, `.gitignore`/`.dockerignore` coverage, and Gzip budget compliance:
```bash
npx unpeek check --max-gzip-delta 15 --require-zero-eval
```

To resolve a production stack trace locally using the vaulted maps:
```bash
npx unpeek symbolicate --maps-dir .unpeek-maps --file error.log
```

---

## 4. Alternative: Complete Source Map Deletion (`--no-maps`)

If your project does not use Sentry, Datadog, or Bugsnag and you want to discard source maps entirely:

```bash
npx unpeek protect --no-maps
```

With `--no-maps`, unpeek permanently deletes all `.map` files and strips public map comments without creating `.unpeek-maps/`.
