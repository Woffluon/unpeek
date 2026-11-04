# unpeek Operational Recipes & Troubleshooting

Practical configurations, troubleshooting guides, and production recipes for common scenarios.

---

## 1. Next.js SSR Hydration Error Prevention

### Symptom
Console errors such as:
`Text content does not match server-rendered HTML` or `Hydration failed because the initial UI does not match what was rendered on the server`.

### Root Cause
Protection was erroneously applied to server-side chunks (`.next/server/`), creating a divergence between server-rendered HTML and client bundle execution.

### Resolution
1. **Use Default Postbuild CLI**: unpeek automatically filters out `.next/server/` and processes only `.next/static/chunks/` or `out/_next/static/chunks/`.
2. **If using `next.config.mjs`**, ensure the plugin is guarded by `!isServer` and `!dev`:
   ```js
   // next.config.mjs
   import unpeek from 'unpeek/webpack';

   export default {
     webpack: (config, { dev, isServer }) => {
       if (!dev && !isServer) {
         config.plugins.push(unpeek({ deterrentMode: 'passive' }));
       }
       return config;
     },
   };
   ```

---

## 2. Telemetry & APM Integration (Sentry, Datadog)

### Requirement
Detect DevTools tampering without disrupting error reporting or console logs captured by browser APM agents.

### Recipe: Passive Mode + CustomEvent Listener
Run protection with `--passive`:
```bash
npx unpeek protect --passive
```
In your frontend entrypoint (e.g. `src/main.ts` or `app/layout.tsx`), register a telemetry listener:
```ts
if (typeof window !== 'undefined') {
  window.addEventListener('unpeek:tamper', () => {
    // Send event to Sentry
    if (window.Sentry) {
      window.Sentry.captureMessage('Client DevTools tampering detected', 'warning');
    }

    // Or track via Datadog RUM
    if (window.DD_RUM) {
      window.DD_RUM.addAction('devtools_tampered', {
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      });
    }
  });
}
```

---

## 3. Deterministic Builds for CI Caching

### Requirement
Prevent cache invalidation and ensure reproducible binary outputs across distributed CI runner shards.

### Recipe: Commit-Hash or Timestamp Seed
Pass `--seed <number>` to fix the pseudo-random generator state:

```bash
# Derive a 32-bit integer from the Git commit hash
SEED_HEX=$(git rev-parse --short=8 HEAD)
SEED_DEC=$((16#$SEED_HEX & 0x7FFFFFFF))

npx unpeek protect --seed $SEED_DEC
```

In GitHub Actions:
```bash
npx unpeek protect --seed ${{ github.run_id }}
```

---

## 4. Custom Output Directory Routing

### Recipe: Monorepos or Non-Standard Output Paths
If your bundler writes to a customized client folder (e.g. `dist/public`, `build/client`):

```bash
npx unpeek protect --out-dir build/client
```

Or programmatically in `package.json`:
```json
{
  "scripts": {
    "build": "vite build --outDir dist/app",
    "postbuild": "unpeek protect --out-dir dist/app"
  }
}
```

---

## 5. Balancing Obfuscation Strength vs. Bundle Size

### Adjusting String Vault Minimum Length
The default `--min-string-length` is `4`. Short strings (`"ok"`, `""`, `"id"`) create slight overhead when encrypted:
- To minimize bundle size on mobile web: `--min-string-length 8`
- To encrypt virtually all identifiers: `--min-string-length 3`
