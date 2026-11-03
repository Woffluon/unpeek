# unpeek

**Zero-config, call-graph-aware polymorphic JavaScript protection and runtime anti-tamper toolkit with <2% CPU overhead.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![CPU Overhead](https://img.shields.io/badge/CPU_Overhead-%3C2%25-10b981.svg)](packages/unpeek/benchmarks/overhead.bench.ts)
[![Gzip Delta](https://img.shields.io/badge/Gzip_Delta-%3C15%25-06b6d4.svg)](packages/unpeek/benchmarks/overhead.bench.ts)
[![Interactive Playground](https://img.shields.io/badge/Playground-Live_Demo-6366f1.svg)](https://woffluon.github.io/unpeek)

English | [Türkçe](./README.tr.md) · [Live Interactive Playground](https://woffluon.github.io/unpeek) · [Agent Architecture Guide](./AGENTS.md) · [AI Skill](./skills/unpeek/SKILL.md)

---

<baglam>

## Why unpeek?

Shipping a modern web application in Next.js, Vite, or Webpack exposes client-side business logic, internal API endpoints, feature flags, and proprietary algorithms to anyone who opens Chrome DevTools or runs an automated AST deobfuscator (`webcrack`, `synchrony`).

Existing tools force an uncomfortable trade-off:
- **Standard minifiers (`esbuild`, `SWC`, `Terser`)** compress whitespace and shorten variable names, leaving string literals, endpoint URLs, and control flow readable after a single click on the DevTools Pretty-Print (`{}`) button.
- **Legacy AST obfuscators (`javascript-obfuscator`)** apply indiscriminate control-flow flattening, `eval` traps, and eager string-array rotation to every function in the bundle. This inflates bundle sizes by 40–300%, breaks V8 TurboFan JIT inlining inside 60fps UI rendering loops, and triggers false-positive browser freezes.

`unpeek` resolves this trade-off by combining static call-graph analysis with polymorphic compile-time encryption:

| Capability | Standard Minifiers (`Terser` / `SWC`) | Legacy AST Obfuscators | `unpeek` |
| :--- | :--- | :--- | :--- |
| **Runtime CPU Overhead** | ~0% | 15% – 85% (throttles UI loops) | **< 2.0%** (Call-Graph Hot-Path Exemption) |
| **Gzip Bundle Growth** | 0% (Baseline) | +45% – +300% | **< 15%** (O(1) Lazy String Vault) |
| **String & Endpoint Encryption** | Plaintext in bundle | Eager array rotation (high CPU) | **Polymorphic XOR + O(1) Memoized Vault** |
| **DevTools Pretty-Print (`{}`) Defense** | None | `debugger` infinite loops (easily bypassed) | **`Function.prototype.toString()` FNV-1a Integrity** |
| **Source Map Isolation** | Manual CI scripts | Manual configuration | **Automatic `.unpeek-maps/` Vault + Comment Strip** |
| **Static Deobfuscator Resistance** | None | Fixed templates (fingerprinted by `webcrack`) | **Per-Build Polymorphic AST Seed** |
| **SSR / Next.js Compatibility** | Native | Frequently breaks server hydration | **Client-Only Auto-Detection + SSR Guard** |

### Core Architecture

1. **Call-Graph Hot-Path Exemption (`<2%` CPU Budget)**
   Before modifying a single AST node, [`detectHotPaths`](packages/unpeek/src/ast/index.ts) traverses the file's call graph. Functions containing loops (`for`, `while`, `do-while`, `for-of`), array higher-order callbacks (`.map`, `.filter`, `.reduce`, `.forEach`), `requestAnimationFrame` tickers, and React/UI render components (`useState`, `useEffect`, `createElement`) are flagged as hot paths. `unpeek` mangles identifiers and encrypts string constants across the entire bundle, while injecting opaque control-flow predicates exclusively into cold functions (such as license checks, request signers, and auth validators). V8 JIT optimization inside hot loops remains untouched.
2. **O(1) Lazy String Vault (`<15%` Gzip Budget)**
   Plaintext string literals (`minStringLength >= 4`) are encrypted at build time with a polymorphic XOR stream cipher keyed by a per-build 32-bit seed. Instead of decrypting every string on page startup, the injected vault helper decodes each string lazily on its first access and caches the plaintext result in its array slot. Subsequent reads resolve in O(1) time via direct array indexing.
3. **Self-Defending `Function.prototype.toString()` Integrity & Passive Deterrent**
   When an analyst formats a protected chunk using DevTools Pretty-Print (`{}`) or edits a branch instruction in the Sources panel, the formatted source alters `Function.prototype.toString()`. [`verifyCodeIntegrity`](packages/unpeek/src/runtime/index.ts) validates a seeded 32-bit FNV-1a checksum against the function's source representation with zero false positives on untouched minified code, triggering gradual state degradation (`deterrentMode: 'gradual'`) rather than an obvious crash point that attackers can patch out.
4. **Automatic Source Map Vault (`.unpeek-maps/`)**
   Leaving `.js.map` files in a public build directory reconstructs your original TypeScript project tree inside DevTools. [`protectDirectory`](packages/unpeek/src/cli/index.ts) automatically extracts `.map` files from your public build directory into a private `.unpeek-maps/` folder and strips `//# sourceMappingURL=` comments from every client bundle so you can upload maps to Sentry or Datadog without serving them to end users.

</baglam>

---

<talimat>

## Quick Start

### 1. One-Command Project Setup (`npx unpeek init`)

Run the initializer from your project root (Next.js, Vite, Webpack, or vanilla):

```bash
npx unpeek init
```

This command performs three non-destructive setup actions:
1. Detects your framework (`nextjs`, `vite`, `webpack`, or `vanilla`) from `package.json` and build config files.
2. Adds `"postbuild": "unpeek protect"` to your `package.json` scripts so every production build is automatically protected.
3. Appends `.unpeek-maps/` to `.gitignore` so extracted source maps stay out of version control.

### 2. CLI Usage (`unpeek protect`)

You can also install `unpeek` as a development dependency and run it directly in CI/CD or local builds:

```bash
npm install -D unpeek
npx unpeek protect
```

#### CLI Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--dir <path>` | Explicit client output directory override (e.g., `dist/assets`, `.next/static/chunks`) | Auto-detected |
| `--seed <number>` | Deterministic 32-bit polymorphic build seed | Random per build |
| `--mode <gradual\|passive>` | Runtime anti-tamper deterrent mode | `gradual` |
| `--min-str <number>` | Minimum character length for O(1) lazy string vault encryption | `4` |
| `--no-shield` | Skip injecting the runtime integrity and DevTools telemetry preamble | Shield enabled |
| `--delete-maps` | Permanently delete `.map` files instead of moving them to `.unpeek-maps/` | Moves to `.unpeek-maps/` |

### 3. Universal Bundler Plugin (`unpeek/unplugin`)

If you prefer in-memory chunk transformations during the bundler lifecycle rather than a post-build CLI pass, use [`unpeek/unplugin`](packages/unpeek/src/bundler/unplugin.ts):

#### Vite (`vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import unpeek from 'unpeek/unplugin';

export default defineConfig({
  build: {
    sourcemap: true, // Extracted into .unpeek-maps/ automatically
  },
  plugins: [
    unpeek.vite({
      deterrentMode: 'gradual',
      keepPrivateMaps: true,
    }),
  ],
});
```

#### Next.js (`next.config.mjs`)

Scope the plugin to client bundles (`!isServer`) so Node.js server chunks keep their native stack traces:

```js
import unpeek from 'unpeek/unplugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      config.plugins.push(
        unpeek.webpack({
          deterrentMode: 'gradual',
          keepPrivateMaps: true,
        })
      );
    }
    return config;
  },
};

export default nextConfig;
```

#### Programmatic API

```ts
import { transformJavaScript, protectDirectory } from 'unpeek';

// Transform an individual JavaScript string in memory
const result = transformJavaScript(sourceCode, {
  seed: 0x7f3a91,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: 'gradual',
});

console.log(result.hotPathReport);
// { totalFunctions: 12, hotFunctionsSkipped: ['renderLoop'], coldFunctionsProtected: ['signRequest'] }

// Or protect an entire build directory
const summary = await protectDirectory({
  cwd: process.cwd(),
  keepPrivateMaps: true,
  privateMapsDir: '.unpeek-maps',
});
```

---

## `.unpeek-maps/` Source Map Vault & Sentry Workflow

When `keepPrivateMaps` is enabled (the default), `unpeek` relocates all `.js.map` files from your public output directory into `.unpeek-maps/` while preserving their relative filenames, and strips `//# sourceMappingURL=` directives from the public `.js` chunks.

To retain full stack-trace symbolication in production error trackers:

```bash
# 1. Build your app and run unpeek (automatically triggered if wired via postbuild)
npm run build

# 2. Upload the private source maps from .unpeek-maps/ to Sentry or Datadog
npx @sentry/cli sourcemaps upload .unpeek-maps --release="$GIT_COMMIT_SHA"

# 3. Deploy your public build folder (.next/, dist/, or build/)
```

---

## Official AI Agent Skill Installation

`unpeek` ships with an official, token-optimized AI Agent Skill ([`skills/unpeek/SKILL.md`](skills/unpeek/SKILL.md)) following Agent Skills Discovery Optimization (SDO) standards. Installing this skill teaches your coding agent (Claude Code, Cursor, Antigravity, OpenAI Codex, or Gemini CLI) how to configure `unpeek`, guard SSR chunks, and wire `.unpeek-maps/` into CI/CD pipelines.

### Project-Scoped Installation (Shared with Team via Git)

Copy the skill into your repository's `.agents/skills/unpeek/` directory:

```bash
mkdir -p .agents/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o .agents/skills/unpeek/SKILL.md
```

### Global Machine Installation (Antigravity / Gemini CLI / Claude Code)

```bash
# Antigravity & Gemini CLI
mkdir -p ~/.gemini/config/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o ~/.gemini/config/skills/unpeek/SKILL.md

# Cross-agent standard (~/.agents/skills)
mkdir -p ~/.agents/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o ~/.agents/skills/unpeek/SKILL.md
```

</talimat>

---

<dogrulama>

## Verification, Testing & Benchmarks

This monorepo is managed with `pnpm` and verified against strict semantic equivalence, deobfuscation resistance, and runtime overhead budgets:

```bash
# Install workspace dependencies
pnpm install

# Run unit & reverse-engineering resistance test suites (Vitest)
pnpm test

# Run the V8 VM CPU overhead (<2%) & Gzip delta (<15%) benchmark
pnpm bench

# Run strict TypeScript typechecking across packages/unpeek and apps/web
pnpm typecheck

# Build the core package and static interactive web playground
pnpm build
```

### Benchmark Output Reference ([`packages/unpeek/benchmarks/overhead.bench.ts`](packages/unpeek/benchmarks/overhead.bench.ts))

- **Build / Transform Time**: `< 3000 ms`
- **Gzip Size Delta**: `< 15%` on production application bundles
- **Runtime CPU Overhead**: `< 2.00%` (interleaved multi-round V8 JIT benchmark)
- **Plaintext Leak Rate**: `0%` for string literals meeting `minStringLength`

</dogrulama>

## License

Released under the [MIT License](./LICENSE).
