export type Locale = "en" | "tr";

export interface DocCodeBlock {
  label: string;
  language: string;
  code: string;
}

export interface DocSubsection {
  title: string;
  body: string[];
  bullets?: string[];
  codeBlocks?: DocCodeBlock[];
}

export interface DocSection {
  id: string;
  number: string;
  title: string;
  summary: string;
  subsections: DocSubsection[];
}

export interface ComparisonRow {
  metric: string;
  unpeek: string;
  legacyObfuscator: string;
  plainMinifier: string;
}

export interface SpecRow {
  metric: string;
  value: string;
  where: string;
}

export interface Dictionary {
  meta: {
    version: string;
    license: string;
  };
  nav: {
    parser: string;
    lab: string;
    specs: string;
    docs: string;
    github: string;
  };
  hero: {
    eyebrow: string;
    metaRight: string;
    headlineTop: string;
    headlineBottom: string;
    subtext: string;
    initCmd: string;
    copyLabel: string;
    copiedLabel: string;
    secondaryCta: string;
    sourceCta: string;
    npmCta: string;
    ledger: { label: string; value: string }[];
    tickerSource: string;
    tickerProtected: string;
    hotLabel: string;
    coldLabel: string;
  };
  metricsStrip: {
    note: string;
    items: { value: string; label: string }[];
  };
  parserSection: {
    title: string;
    lead: string;
    hotTitle: string;
    hotBody: string;
    coldTitle: string;
    coldBody: string;
    stages: { step: string; title: string; detail: string }[];
  };
  lab: {
    title: string;
    lead: string;
    codeTitle: string;
    codeNote: string;
    analyze: string;
    analyzing: string;
    reset: string;
    protectHot: string;
    exemptHot: string;
    particleLoad: string;
    fpsLabel: string;
    hotFpsCaption: string;
    coldFpsCaption: string;
    disclaimer: string;
    decisionHot: string;
    decisionCold: string;
    decisionCaller: string;
    legendHot: string;
    legendCold: string;
    evidence: string;
  };
  specSection: {
    title: string;
    lead: string;
    columns: { metric: string; value: string; where: string };
    rows: SpecRow[];
  };
  comparisonSection: {
    title: string;
    subtitle: string;
    columns: {
      metric: string;
      unpeek: string;
      legacy: string;
      minifier: string;
    };
    rows: ComparisonRow[];
    note: string;
    scaleNote: string;
    barLabels: { unpeek: string; legacy: string };
  };
  docsHeader: {
    title: string;
    subtitle: string;
    sidebarTitle: string;
    onPageLabel: string;
    backToHomeLabel: string;
    previousLabel: string;
    nextLabel: string;
    stats: { sections: string; topics: string; samples: string };
  };
  docsSections: DocSection[];
  docsCta: {
    kicker: string;
    title: string;
    body: string;
    cta: string;
  };
  installSection: {
    title: string;
    lead: string;
    command: string;
    starCta: string;
    npmCta: string;
    note: string;
  };
  footer: {
    tagline: string;
    license: string;
    links: {
      docs: string;
      github: string;
      npm: string;
    };
  };
}

export const CODE_SAMPLES = {
  source: `// license-guard.ts
export function renderFrame(t: number) {
  // 60fps loop, called from requestAnimationFrame
  for (let i = 0; i < particles.length; i++) {
    particles[i].x += lerp(a, b, t);
  }
}

export function validateLicense(key: string) {
  const salt = "uNp33k_v4";
  const endpoint = "https://api.unpeek.dev/v1/license";
  return check(key, salt, endpoint);
}`,
  protected: `// license-guard.js, protected output
const _uC = ["uNp33k_v4","https://api.unpeek.dev/v1/license"].map(function f(a) {
  let s = "", j = 0;
  for (; j < a.length; j++) s += String.fromCharCode(a.charCodeAt(j) ^ (((27 ^ ((a._u || /\\n/.test(f) * 14) | ((j & 1) * 27))) & 30) | 1));
  return s;
});

// hot path exempted by the call graph
export function renderFrame(t) {
  for (let i = 0; i < particles.length; i++) {
    particles[i].x += lerp(a, b, t);
  }
}

// cold path protected: O(1) kConst vault + mangling + FNV-1a
export function validateLicense(_0x4a1) {
  if (((912 ^ (419 | !String)) & 7) === 3) return null;
  const _0x8b2 = _uC[0];
  const _0x9c4 = _uC[1];
  return check(_0x4a1, _0x8b2, _0x9c4);
}`,
};

export const DICTIONARY: Record<Locale, Dictionary> = {
  en: {
    meta: {
      version: "v1.8.0",
      license: "MIT License",
    },
    nav: {
      parser: "Parser",
      lab: "Lab",
      specs: "Specs",
      docs: "Docs",
      github: "GitHub",
    },
    hero: {
      eyebrow: "CALL-GRAPH AWARE JS PROTECTION",
      metaRight: "v1.6.0 / MIT / npm",
      headlineTop: "Nothing to peek at.",
      headlineBottom: "Nothing to slow down.",
      subtext:
        "unpeek reads the call graph before it rewrites a token. Cold paths go into an O(1) string vault. Hot paths, the frame loops and everything they call, keep their original source.",
      initCmd: "npx unpeek init",
      copyLabel: "Copy",
      copiedLabel: "Copied",
      secondaryCta: "Read the spec",
      sourceCta: "Source",
      npmCta: "npm",
      ledger: [
        { label: "hot path", value: "left byte for byte" },
        { label: "cold path", value: "string vault, O(1) lookup" },
        { label: "integrity", value: "FNV-1a, 32 bit" },
      ],
      tickerSource: "source",
      tickerProtected: "protected",
      hotLabel: "HOT PATH / EXEMPT",
      coldLabel: "COLD PATH / VAULTED",
    },
    metricsStrip: {
      note: "Default profile, measured by the benchmark suite in packages/unpeek/benchmarks.",
      items: [
        { value: "< 2%", label: "Hot-path CPU overhead" },
        { value: "< 15%", label: "Gzip bundle delta" },
        { value: "0 LOC", label: "Application changes" },
        { value: "100%", label: "Source maps isolated" },
      ],
    },
    parserSection: {
      title: "The parser sees two kinds of code.",
      lead: "unpeek builds a call graph before it rewrites a single token. Functions that run inside a frame are marked hot and left alone. Everything else goes to the vault.",
      hotTitle: "Hot path",
      hotBody:
        "Any function with a loop, a requestAnimationFrame callback, or a high-frequency timer. Hot status propagates to every callee in the chain, so a helper called from a render loop stays untouched too.",
      coldTitle: "Cold path",
      coldBody:
        "License checks, telemetry, API clients. String literals move to an O(1) lookup, local bindings get renamed, and the entry chunk receives a 32-bit FNV-1a integrity check.",
      stages: [
        { step: "01", title: "Parse", detail: "Acorn builds an AST for each client chunk. Server output is never opened." },
        { step: "02", title: "Graph", detail: "Calls and references become an intra-module call graph." },
        { step: "03", title: "Mark", detail: "Loops and rAF callbacks flag hot. Callees inherit the flag." },
        { step: "04", title: "Transform", detail: "Only cold functions are rewritten. Hot functions keep their original source." },
        { step: "05", title: "Seal", detail: "Source maps move to .unpeek-maps/. The public bundle loses the mapping URL." },
      ],
    },
    lab: {
      title: "Run the call graph yourself.",
      lead: "Same source, same seed. Turn the exemption off and watch the frame rate answer.",
      codeTitle: "license-guard.ts",
      codeNote: "Panels: hot lines stay as written.",
      analyze: "Analyze bundle",
      analyzing: "Scanning",
      reset: "Reset",
      protectHot: "Protect hot path",
      exemptHot: "Exempt hot path",
      particleLoad: "Particle load",
      fpsLabel: "Frames per second",
      hotFpsCaption: "Exempt: the loop runs as written.",
      coldFpsCaption: "Protected: every iteration pays the vault.",
      disclaimer:
        "Demo workload modeled on the project benchmark profile. Not a device benchmark.",
      decisionHot: "Loop found. Flagged hot, then propagated to lerp and stepParticles.",
      decisionCold: "No loop, no rAF. Cold path, so literals and bindings are rewritten.",
      decisionCaller: "Called from a hot function. Inherits the exemption.",
      legendHot: "Exempt",
      legendCold: "Protected",
      evidence: "Selection",
    },
    specSection: {
      title: "What ships, and where it lands.",
      lead: "Every number below comes from the benchmark suite or the transform pipeline in this repository. Nothing is rounded up for the page.",
      columns: { metric: "Dimension", value: "Default profile", where: "Source" },
      rows: [
        { metric: "Hot-path CPU overhead", value: "under 2%", where: "benchmarks/overhead.bench.ts" },
        { metric: "Gzip bundle delta", value: "+4% to +14%", where: "src/cli/protect.ts" },
        { metric: "Cold function transform", value: "string vault + mangling", where: "src/ast" },
        { metric: "Source map handling", value: "moved to .unpeek-maps/", where: "src/bundler/sourcemap-vault.ts" },
        { metric: "Runtime shield", value: "FNV-1a, 32-bit", where: "src/runtime" },
        { metric: "Client bundle scope", value: "static chunks only", where: "src/bundler/detector.ts" },
      ],
    },
    comparisonSection: {
      title: "Measured against legacy obfuscation.",
      subtitle: "The tradeoff is not speed against secrecy. It is where the secrecy is spent.",
      columns: {
        metric: "Dimension",
        unpeek: "unpeek",
        legacy: "Legacy obfuscator",
        minifier: "Minifier only",
      },
      rows: [
        {
          metric: "Hot-path CPU",
          unpeek: "< 2%, call-graph exempt",
          legacyObfuscator: "+300% to +850%",
          plainMinifier: "0% baseline",
        },
        {
          metric: "Gzip delta",
          unpeek: "+4% to +14%",
          legacyObfuscator: "+120% to +340%",
          plainMinifier: "0% baseline",
        },
        {
          metric: "String decode",
          unpeek: "O(1) kConst array vault",
          legacyObfuscator: "O(N) per call",
          plainMinifier: "Plaintext in bundle",
        },
        {
          metric: "Source maps",
          unpeek: "Vaulted, URL stripped",
          legacyObfuscator: "Manual",
          plainMinifier: "Shipped by default",
        },
        {
          metric: "Integrity check",
          unpeek: "32-bit FNV-1a",
          legacyObfuscator: "Regex self-defense",
          plainMinifier: "None",
        },
      ],
      note: "Legacy figures are published ranges for control-flow flattening presets. unpeek figures come from this repository's benchmark run.",
      scaleNote:
        "Both bars share one scale per row: the unpeek bar is the measured figure drawn against the legacy upper bound.",
      barLabels: { unpeek: "unpeek", legacy: "legacy" },
    },
    docsHeader: {
      title: "Documentation",
      subtitle:
        "CLI, bundler adapters, hot-path heuristics, the source map vault, the programmatic API, the security model, and the failure modes you will actually hit.",
      sidebarTitle: "Sections",
      onPageLabel: "Reference",
      backToHomeLabel: "Back to overview",
      previousLabel: "Previous",
      nextLabel: "Next",
      stats: { sections: "sections", topics: "topics", samples: "code samples" },
    },
    docsCta: {
      kicker: "Reference",
      title: "The full manual lives on its own page.",
      body: "CLI flags, bundler adapters, hot-path heuristics, the source map vault, the programmatic API and the security model. Every section is written against this repository.",
      cta: "Open the documentation",
    },
    docsSections: [
      {
        id: "quickstart",
        number: "01",
        title: "Installation & Quick Start",
        summary:
          "Initialize unpeek in any JavaScript or TypeScript project in under 30 seconds with zero manual AST configuration.",
        subsections: [
          {
            title: "One-Command Initialization (npx unpeek init)",
            body: [
              "Run npx unpeek init at the root of your repository. The CLI inspects your package.json and build configuration to detect Next.js, Vite, Webpack, or Vanilla JS setups.",
              "It automatically wires a postbuild hook (`unpeek protect`) into your package.json scripts and appends `.unpeek-maps/` to `.gitignore` so extracted source maps are never committed or deployed to public CDNs.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Interactive / Zero-Config Init",
                language: "bash",
                code: `# 1. Initialize in your project root
npx unpeek init

# Output:
# [unpeek] Detected framework: nextjs (.next/static/chunks)
# [unpeek] Added "postbuild": "unpeek protect" to package.json
# [unpeek] Added ".unpeek-maps/" to .gitignore`,
              },
            ],
          },
          {
            title: "Running Standalone Protection (npx unpeek protect)",
            body: [
              "Whenever you run `npm run build` / `pnpm build`, the `postbuild` script automatically invokes `unpeek protect`. You can also invoke it directly in CI/CD pipelines with a deterministic polymorphic seed.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Postbuild Protection & Summary",
                language: "bash",
                code: `# Run manually or via npm/pnpm postbuild
npx unpeek protect --seed 482910

# Output:
# [unpeek] Framework: nextjs | Directory: .next/static/chunks
# [unpeek] Processed 18 client chunks in 142ms
# [unpeek] Hot functions exempted: 24 | Cold functions protected: 61
# [unpeek] Encrypted strings: 312 | Mangled lexical symbols: 489
# [unpeek] Source maps vaulted: 18 -> .unpeek-maps/
# [unpeek] Gzip delta: +6.42% (within <15% budget)`,
              },
            ],
          },
        ],
      },
      {
        id: "frameworks",
        number: "02",
        title: "Framework Integrations",
        summary:
          "How unpeek discovers and protects client-only chunks across Next.js, Vite, Webpack, and Vanilla JS without touching SSR server bundles.",
        subsections: [
          {
            title: "Next.js (App Router & Pages Router)",
            body: [
              "In Next.js projects, unpeek strictly targets `.next/static/chunks` (and `.next/static/` client assets) while leaving `.next/server` completely untouched. This guarantees that React Server Components (RSC), API routes, and Node.js server actions suffer zero startup or execution overhead.",
              "Both `postbuild` CLI execution and the `unpeek/unplugin` adapter are supported.",
            ],
            codeBlocks: [
              {
                label: "package.json: Recommended Next.js Postbuild Setup",
                language: "json",
                code: `{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "postbuild": "unpeek protect"
  },
  "devDependencies": {
    "unpeek": "^1.0.1"
  }
}`,
              },
              {
                label: "next.config.mjs: unplugin Webpack Integration",
                language: "javascript",
                code: `import unpeek from "unpeek/unplugin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      config.plugins.push(
        unpeek.webpack({
          deterrentMode: "gradual",
        })
      );
    }
    return config;
  },
};

export default nextConfig;`,
              },
            ],
          },
          {
            title: "Vite & Rollup (CLI or unplugin)",
            body: [
              "For Vite applications, unpeek automatically detects the `dist/` output directory. If you prefer in-memory bundle transformation during the Vite build phase rather than a postbuild pass, use the first-class `unpeek/vite` plugin or `unpeek/unplugin`.",
            ],
            codeBlocks: [
              {
                label: "vite.config.ts: Native Vite Plugin Integration",
                language: "typescript",
                code: `import { defineConfig } from "vite";
import { vitePlugin } from "unpeek/vite";

export default defineConfig({
  build: {
    sourcemap: true, // Extracted to .unpeek-maps/ during postbuild
  },
  plugins: [
    vitePlugin({
      seed: 0x9fa21b,
      minStringLength: 4,
      injectRuntimeShield: true,
      deterrentMode: "gradual",
    }),
  ],
});`,
              },
            ],
          },
          {
            title: "Webpack & Vanilla JS Targets",
            body: [
              "For Webpack 5 builds, import `unpeek` from `unpeek/unplugin` (or `webpackPlugin` from `unpeek/webpack`) or pass `--out-dir build/static/js` to the CLI. For Vanilla JS projects, point `--out-dir` to your public asset folder.",
            ],
            codeBlocks: [
              {
                label: "webpack.config.js: Webpack Plugin",
                language: "javascript",
                code: `import unpeek from "unpeek/unplugin";

export default {
  mode: "production",
  plugins: [
    unpeek.webpack({
      deterrentMode: "passive",
      minStringLength: 5,
    }),
  ],
};`,
              },
            ],
          },
        ],
      },
      {
        id: "architecture",
        number: "03",
        title: "Architecture & Hot-Path Exemption Engine",
        summary:
          "Deep dive into how unpeek achieves <2% CPU overhead through scope-aware static call-graph analysis, O(1) kConst string vaults, and dual-entangled FNV-1a integrity verification.",
        subsections: [
          {
            title: "Static Call-Graph & Transitive Hot-Path Exemption",
            body: [
              "Why do traditional JavaScript obfuscators ruin application responsiveness? Because they blindly transform every AST node: turning a 60fps animation loop or virtual DOM diffing helper into thousands of string-array lookups and switch-case state machines.",
              "unpeek solves this by constructing a bidirectional static call graph of every module before applying any transformation:",
            ],
            bullets: [
              "Direct Hot Detection: Any function containing `for`, `while`, `do...while`, `for...in`, or `for...of` loops, array higher-order callbacks (`.map`, `.filter`, `.forEach`, `.reduce`), `requestAnimationFrame`, or React/UI render primitives is flagged as directly hot.",
              "Bidirectional Transitive Propagation: If a hot function calls a helper (top-down, e.g., `renderFrame -> lerp -> stepParticles`), or if an outer wrapper calls a hot function (bottom-up), the entire chain is transitively exempted across the call graph.",
              "Zero-Overhead Bypass: All hot-marked functions and loop bodies bypass string encryption, lexical mangling, and control mutations completely, preserving native JIT compilation in V8, SpiderMonkey, and JavaScriptCore.",
            ],
          },
          {
            title: "O(1) kConst String Vault & Tamper-Entangled Keys",
            body: [
              "In cold-path functions (authentication handshakes, license validators, API client builders, feature-flag evaluators), string literals of length >= `minStringLength` (default `4`) are extracted at build time.",
              "Each string is encoded using a polymorphic XOR cipher parameterized by the build's 32-bit `seed` and dual-entangled with both the runtime integrity state (`String.prototype._u`) and self-verifying decoder formatting (`/\n/.test(f)`). At module evaluation time, the injected `const _uC = [...].map(...)` array decodes each string once into a V8 `kConst` array. Subsequent cold-path accesses resolve via direct `_uC[index]` indexing in O(1) constant time with zero call or allocation overhead.",
            ],
          },
          {
            title: "32-bit FNV-1a Integrity & DevTools Shield",
            body: [
              "Entry chunks receive a compact runtime shield (`injectRuntimeShield: true`). It verifies native function integrity (`Function.prototype.toString()`), binds the 32-bit FNV-1a integrity token (`offset_basis = 2166136261`), and poisons the string vault key (`String.prototype._u = 14`) if tampering or pretty-printing is detected.",
              "Two deterrent modes are available: `gradual` (corrupts tampered vault keys and progressively silences console inspection) and `passive` (sets `window.__unpeek_tampered = true` and dispatches `CustomEvent('unpeek:tamper')` for telemetry without altering console behavior).",
            ],
          },
        ],
      },
      {
        id: "sourcemaps",
        number: "04",
        title: "Source Map Vault & Production Debugging",
        summary:
          "Never ship .js.map files to public users again, while retaining full stack-trace symbolication in Sentry, Datadog, or local crash triage.",
        subsections: [
          {
            title: "How .unpeek-maps/ Isolation Works",
            body: [
              "Leaving `.map` files in your public build folder allows anyone to reconstruct your exact TypeScript source tree in Chrome DevTools with a single click. Conversely, disabling source maps entirely blinds your engineering team during production incidents.",
              "unpeek resolves this dilemma automatically during `unpeek protect`:",
            ],
            bullets: [
              "Scans the target build directory recursively for all `*.map` files.",
              "Relocates them into `.unpeek-maps/` (preserving relative directory structure) outside your publicly served web root.",
              "Strips `//# sourceMappingURL=...` and `/*# sourceMappingURL=... */` directives from the end of every public `.js` file so browsers never request `.map` URLs.",
            ],
          },
          {
            title: "Uploading Vaulted Maps to Sentry / Datadog in CI",
            body: [
              "After `unpeek protect` completes in your CI workflow, point your observability CLI (`sentry-cli` or `datadog-ci`) at `.unpeek-maps/` to upload private debugging symbols, then discard the folder before deploying your static artifact.",
            ],
            codeBlocks: [
              {
                label: "GitHub Actions: Upload .unpeek-maps to Sentry",
                language: "yaml",
                code: `- name: Build & Protect Client Bundles
  run: |
    pnpm build
    npx unpeek protect

- name: Upload Private Source Maps to Sentry
  env:
    SENTRY_AUTH_TOKEN: \${{ secrets.SENTRY_AUTH_TOKEN }}
  run: |
    npx @sentry/cli sourcemaps upload \\
      --org acme-corp \\
      --project web-client \\
      .unpeek-maps`,
              },
            ],
          },
        ],
      },
      {
        id: "api",
        number: "05",
        title: "CLI Flags & Programmatic API Reference",
        summary:
          "Complete specification for the unpeek CLI binary, Node.js programmatic functions, and TypeScript interfaces exported from packages/unpeek/src/types.ts.",
        subsections: [
          {
            title: "CLI Commands & Flags",
            body: [
              "The `unpeek` binary supports `init` and `protect` commands with deterministic flags suitable for local development and reproducible CI builds.",
            ],
            codeBlocks: [
              {
                label: "CLI Reference",
                language: "bash",
                code: `unpeek init [--dry-run]
  Detects framework, configures package.json "postbuild", and updates .gitignore.

unpeek protect [options]
  --out-dir <dir>            Explicit client output directory override
  --seed <number>            Deterministic 32-bit polymorphic seed
  --passive                  Use passive telemetry deterrent mode instead of gradual
  --no-maps                  Delete .map files instead of moving to .unpeek-maps/
  --min-string-length <num>  Minimum string length for encryption vault (default: 4)
  --private-maps-dir <dir>   Directory to store vaulted source maps (default: .unpeek-maps)
  --no-shield                Do not inject runtime anti-tamper deterrent shield
  -h, --help                 Show help message
  -v, --version              Show version number`,
              },
            ],
          },
          {
            title: "Programmatic Node.js API & TypeScript Types",
            body: [
              "Import `protectProject`, `transformJavaScript`, or bundler plugins directly from `unpeek` to build custom compilation pipelines.",
            ],
            codeBlocks: [
              {
                label: "TypeScript: Programmatic Usage & Exported Interfaces",
                language: "typescript",
                code: `import {
  protectProject,
  transformJavaScript,
  type ProtectOptions,
  type ProtectSummary,
  type TransformOptions,
  type TransformResult,
} from "unpeek";

// 1. Transform a single JavaScript module in memory
const result: TransformResult = transformJavaScript(sourceCode, {
  seed: 0x10b981,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: "gradual",
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.mangledSymbolsCount);

// 2. Protect an entire framework build directory
const summary: ProtectSummary = await protectProject({
  cwd: process.cwd(),
  keepPrivateMaps: true,
  privateMapsDir: ".unpeek-maps",
  deterrentMode: "gradual",
});`,
              },
            ],
          },
        ],
      },
      {
        id: "agents",
        number: "06",
        title: "Using unpeek with AI Coding Agents",
        summary:
          "Equip Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, and OpenCode with the official unpeek skill via Vercel Agent Skills so autonomous agents never break hot-path budgets or leak source maps.",
        subsections: [
          {
            title: "Vercel Agent Skills Standard Installation (`npx skills add`)",
            body: [
              "unpeek ships with an official agent skill compliant with the open Vercel Agent Skills specification (`skills/unpeek/SKILL.md`) and Agent Skills Discovery Optimization (SDO) standards. It equips coding agents to automate unpeek build protection, guard SSR boundaries, and isolate private source maps.",
              "Install the skill with a single command, install locally from repository source, or target multiple agents globally without prompts:",
            ],
            codeBlocks: [
              {
                label: "Terminal: Install via Vercel Agent Skills CLI",
                language: "bash",
                code: `# Standard installation into your project or configured agent
npx skills add Woffluon/unpeek

# Local repository installation (when developing inside unpeek)
npx skills add .

# Multi-agent targeting & global installation
npx skills add Woffluon/unpeek --agent claude-code codex cursor gemini-cli github-copilot opencode --global --yes`,
              },
              {
                label: "Agent Prompt: Triggering unpeek via $unpeek",
                language: "text",
                code: `$unpeek Protect this build with passive telemetry and seed 0x7f4a2c.`,
              },
            ],
          },
          {
            title: "Token-Optimized Modular References (`skills/unpeek/references/`)",
            body: [
              "To preserve agent context windows and minimize token overhead, the primary `SKILL.md` delegates specialized implementation details to 6 on-demand modular reference guides under `skills/unpeek/references/`. Agents selectively load only the reference file required for their active task:",
            ],
            bullets: [
              "`quickstart`: Immediate zero-config setup, postbuild wiring, and 3-step verification loops.",
              "`frameworks`: Framework build configurations and SSR client boundaries (Next.js, Vite, Webpack, Rollup).",
              "`architecture`: Acorn AST parsing, transitive call-graph hot-path exemption, and FNV-1a checksums.",
              "`sourcemaps`: `.unpeek-maps/` vault isolation, CI pipelines, and Sentry/Datadog symbol uploads.",
              "`api`: Complete CLI flag specifications, programmatic Node.js API, and TypeScript interfaces.",
              "`recipes`: Production hardening recipes, deterministic CI seeds, and passive telemetry troubleshooting.",
            ],
          },
        ],
      },
      {
        id: "troubleshooting",
        number: "07",
        title: "Troubleshooting & Failure Modes",
        summary:
          "The symptoms that show up after a protected deploy, what causes them, and the first command to run for each.",
        subsections: [
          {
            title: "A hydrated page stops matching the server markup",
            body: [
              "unpeek only opens client output directories: `.next/static/chunks`, `dist/assets`, and `build/static/js`. Server bundles under `.next/server` are never parsed, so React server rendering stays untouched.",
              "If a mismatch appears anyway, confirm the protected directory with `--out-dir` and check that it points at the client output rather than the project root. A wrong `--out-dir` is the only way protection reaches a server bundle.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Point the CLI at the client output",
                language: "bash",
                code: `# Explicit target, passive shield, deterministic seed
unpeek protect --out-dir .next/static/chunks --passive --seed 0x7f4a2c`,
              },
            ],
          },
          {
            title: "Production stack traces point at _0x4a1",
            body: [
              "Source maps are moved into `.unpeek-maps/` and the `//# sourceMappingURL=` comment is stripped from the public bundle, so the browser has nothing to resolve. Upload the vault to your error tracker instead of the public directory.",
            ],
            bullets: [
              "Point the Sentry or Datadog upload step at `.unpeek-maps/`, never at the public output.",
              "Keep `.unpeek-maps/` in `.gitignore`. `unpeek init` appends the entry for you.",
              "Use `--no-maps` when the vault is not needed and the maps should be deleted outright.",
            ],
          },
          {
            title: "A slow function was not marked hot",
            body: [
              "Hot status comes from loops, `requestAnimationFrame` callbacks, and high-frequency timers, and it propagates to every callee in the chain. Work driven by a Web Worker, a virtualized list, or a layout effect without a loop is not part of that graph.",
              "That is safe but not free: the function still behaves correctly, it just pays the vault lookup. If a profile shows the cost, move the work behind a detected frame loop or raise `--min-string-length` so fewer literals enter the vault.",
            ],
          },
        ],
      },
      {
        id: "security-model",
        number: "08",
        title: "Security Model & Limits",
        summary:
          "What the transform buys you, what it does not, and how to reason about the runtime shield.",
        subsections: [
          {
            title: "Threat model",
            body: [
              "unpeek raises the cost of reading a client bundle. String literals leave the source, local bindings are renamed with a seeded polymorphic pass, and cold control flow is rewritten so a reader cannot follow a license check or an internal endpoint straight out of the shipped file.",
              "It is not a cryptographic boundary. Any code the browser can execute can be executed by anyone who receives it. Treat the output as a deterrent against casual inspection and scraping, not as a secret store.",
            ],
            bullets: [
              "Do not ship API keys, signing salts, or private tokens in client code. The vault relocates them, it does not protect them.",
              "Keep authorization decisions on the server. A protected bundle is still not a trusted place for them.",
              "Pin `--seed` in CI so repeated builds produce identical output and diffs stay reviewable.",
            ],
          },
          {
            title: "Runtime shield",
            body: [
              "The injected shield hashes its own source with 32-bit FNV-1a over `Function.prototype.toString()`. Pretty-printing, patching, or wrapping the protected function changes the hash and trips the deterrent.",
              "`--passive` logs and continues. The default `gradual` mode escalates in steps instead of throwing on the first mismatch, so one false positive does not take down a production session.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Shield modes",
                language: "bash",
                code: `# Gradual deterrent (default)
unpeek protect --seed 0x7f4a2c

# Passive deterrent for staged rollouts
unpeek protect --passive

# No shield at all
unpeek protect --no-shield`,
              },
            ],
          },
        ],
      },
    ],
    installSection: {
      title: "One line in postbuild.",
      lead: "unpeek reads the framework, finds the client output, and protects it. Server bundles stay readable.",
      command: "npx unpeek init",
      starCta: "Star on GitHub",
      npmCta: "View on npm",
      note: "No config file. No wrapper. Remove the postbuild line and the next build ships untouched.",
    },
    footer: {
      tagline: "Client-side protection with a frame budget.",
      license: "MIT License",
      links: {
        docs: "Docs",
        github: "GitHub",
        npm: "npm",
      },
    },
  },
  tr: {
    meta: {
      version: "v1.8.0",
      license: "MIT Lisansı",
    },
    nav: {
      parser: "Parser",
      lab: "Laboratuvar",
      specs: "Spesifikasyon",
      docs: "Dokümanlar",
      github: "GitHub",
    },
    hero: {
      eyebrow: "ÇAĞRI GRAFİĞİ FARKINDALIKLI JS KORUMASI",
      metaRight: "v1.6.0 / MIT / npm",
      headlineTop: "Bakacak bir şey yok.",
      headlineBottom: "Yavaşlayacak bir şey yok.",
      subtext:
        "unpeek tek bir token yazmadan önce çağrı grafiğini okur. Soğuk yollar O(1) string kasasına girer. Sıcak yollar, kare döngüleri ve çağırdıkları her şey, özgün kaynağını korur.",
      initCmd: "npx unpeek init",
      copyLabel: "Kopyala",
      copiedLabel: "Kopyalandı",
      secondaryCta: "Spesifikasyonu oku",
      sourceCta: "Kaynak",
      npmCta: "npm",
      ledger: [
        { label: "sıcak yol", value: "bayt bayt olduğu gibi" },
        { label: "soğuk yol", value: "string kasası, O(1) arama" },
        { label: "bütünlük", value: "FNV-1a, 32 bit" },
      ],
      tickerSource: "kaynak",
      tickerProtected: "korumalı",
      hotLabel: "SICAK YOL / MUAF",
      coldLabel: "SOĞUK YOL / KASADA",
    },
    metricsStrip: {
      note: "Varsayılan profil, packages/unpeek/benchmarks altındaki ölçüm paketiyle alındı.",
      items: [
        { value: "%2'den az", label: "Sıcak yol CPU maliyeti" },
        { value: "%15'ten az", label: "Gzip paket artışı" },
        { value: "0 satır", label: "Uygulama kodu değişikliği" },
        { value: "%100", label: "Kaynak haritası izolasyonu" },
      ],
    },
    parserSection: {
      title: "Parser iki tür kod görür.",
      lead: "unpeek tek bir token yazmadan önce çağrı grafiğini kurar. Kare içinde çalışan fonksiyonlar sıcak işaretlenir ve olduğu gibi bırakılır. Geri kalanı kasaya girer.",
      hotTitle: "Sıcak yol",
      hotBody:
        "Döngü içeren, requestAnimationFrame geri çağrısı olan veya yüksek frekanslı zamanlayıcı kullanan her fonksiyon. Sıcak durumu zincirdeki tüm çağrılanlara geçer, yani render döngüsünden çağrılan yardımcı da korunmaz.",
      coldTitle: "Soğuk yol",
      coldBody:
        "Lisans kontrolleri, telemetri, API istemcileri. String sabitleri O(1) aramaya taşınır, yerel bağlar yeniden adlandırılır ve giriş paketine 32 bit FNV-1a bütünlük kontrolü eklenir.",
      stages: [
        { step: "01", title: "Ayrıştır", detail: "Acorn her istemci paketi için AST kurar. Sunucu çıktısı hiç açılmaz." },
        { step: "02", title: "Graf", detail: "Çağrılar ve referanslar modül içi bir çağrı grafiğine dönüşür." },
        { step: "03", title: "İşaretle", detail: "Döngüler ve rAF geri çağrıları sıcak işaretler. Çağrılanlar bu işareti devralır." },
        { step: "04", title: "Dönüştür", detail: "Yalnızca soğuk fonksiyonlar yeniden yazılır. Sıcak fonksiyonlar özgün kaynağını korur." },
        { step: "05", title: "Mühürle", detail: "Kaynak haritaları .unpeek-maps/ içine taşınır. Genel pakette eşleme adresi kalmaz." },
      ],
    },
    lab: {
      title: "Çağrı grafiğini kendiniz çalıştırın.",
      lead: "Aynı kaynak, aynı tohum. Muafiyeti kapatın ve kare hızının nasıl tepki verdiğini görün.",
      codeTitle: "license-guard.ts",
      codeNote: "Sıcak satırlar yazıldığı gibi kalır.",
      analyze: "Paketi analiz et",
      analyzing: "Taranıyor",
      reset: "Sıfırla",
      protectHot: "Sıcak yolu koru",
      exemptHot: "Sıcak yolu muaf tut",
      particleLoad: "Parçacık yükü",
      fpsLabel: "Saniyedeki kare",
      hotFpsCaption: "Muaf: döngü yazıldığı gibi çalışır.",
      coldFpsCaption: "Korumalı: her yineleme kasanın bedelini öder.",
      disclaimer:
        "Gösterim yükü proje ölçüm profiline göre modellendi. Cihaz ölçümü değildir.",
      decisionHot: "Döngü bulundu. Sıcak işaretlendi, ardından lerp ve stepParticles fonksiyonlarına geçti.",
      decisionCold: "Döngü yok, rAF yok. Soğuk yol, bu yüzden sabitler ve bağlar yeniden yazılır.",
      decisionCaller: "Sıcak bir fonksiyondan çağrılıyor. Muafiyeti devralır.",
      legendHot: "Muaf",
      legendCold: "Korumalı",
      evidence: "Seçim",
    },
    specSection: {
      title: "Neyin gönderildiği ve nereye indiği.",
      lead: "Aşağıdaki her değer bu depodaki ölçüm paketinden veya dönüşüm hattından gelir. Sayfa için yukarı yuvarlanmış tek bir sayı yok.",
      columns: { metric: "Boyut", value: "Varsayılan profil", where: "Kaynak" },
      rows: [
        { metric: "Sıcak yol CPU maliyeti", value: "%2 altında", where: "benchmarks/overhead.bench.ts" },
        { metric: "Gzip paket artışı", value: "%4 ile %14 arası", where: "src/cli/protect.ts" },
        { metric: "Soğuk fonksiyon dönüşümü", value: "string kasası + mangling", where: "src/ast" },
        { metric: "Kaynak haritası işlemi", value: ".unpeek-maps/ içine taşınır", where: "src/bundler/sourcemap-vault.ts" },
        { metric: "Çalışma zamanı kalkanı", value: "FNV-1a, 32 bit", where: "src/runtime" },
        { metric: "İstemci paketi kapsamı", value: "yalnızca statik paketler", where: "src/bundler/detector.ts" },
      ],
    },
    comparisonSection: {
      title: "Eski obfuscation ile ölçülmüş karşılaştırma.",
      subtitle: "Tradeoff hız ile gizlilik arasında değil. Gizliliğin nerede harcandığında.",
      columns: {
        metric: "Boyut",
        unpeek: "unpeek",
        legacy: "Eski obfuscator",
        minifier: "Sadece minifier",
      },
      rows: [
        {
          metric: "Sıcak yol CPU",
          unpeek: "%2 altı, çağrı grafiği muaf",
          legacyObfuscator: "%300 ile %850 arası",
          plainMinifier: "%0 taban",
        },
        {
          metric: "Gzip artışı",
          unpeek: "%4 ile %14 arası",
          legacyObfuscator: "%120 ile %340 arası",
          plainMinifier: "%0 taban",
        },
        {
          metric: "String çözümü",
          unpeek: "O(1) kConst dizi kasası",
          legacyObfuscator: "Her çağrıda O(N)",
          plainMinifier: "Pakette düz metin",
        },
        {
          metric: "Kaynak haritaları",
          unpeek: "Kasada, adres silinmiş",
          legacyObfuscator: "Elle yapılandırma",
          plainMinifier: "Varsayılan olarak genel",
        },
        {
          metric: "Bütünlük kontrolü",
          unpeek: "32 bit FNV-1a",
          legacyObfuscator: "Regex savunması",
          plainMinifier: "Yok",
        },
      ],
      note: "Eski obfuscator değerleri kontrol akışı düzleştirme profilleri için yayımlanmış aralıklardır. unpeek değerleri bu depodaki ölçüm koşusundan gelir.",
      scaleNote:
        "Her satırda iki çubuk aynı ölçeği paylaşır: unpeek çubuğu, eski obfuscator üst sınırına göre çizilmiş ölçülmüş değerdir.",
      barLabels: { unpeek: "unpeek", legacy: "eski obf." },
    },
    docsHeader: {
      title: "Dokümantasyon",
      subtitle:
        "CLI, bundler adaptörleri, sıcak yol sezgileri, kaynak haritası kasası, programatik API, güvenlik modeli ve gerçekte karşılaşacağınız hata modları.",
      sidebarTitle: "Bölümler",
      onPageLabel: "Referans",
      backToHomeLabel: "Genel bakışa dön",
      previousLabel: "Önceki",
      nextLabel: "Sonraki",
      stats: { sections: "bölüm", topics: "konu", samples: "kod örneği" },
    },
    docsCta: {
      kicker: "Referans",
      title: "Tam kılavuz kendi sayfasında.",
      body: "CLI bayrakları, bundler adaptörleri, sıcak yol sezgileri, kaynak haritası kasası, programatik API ve güvenlik modeli. Her bölüm bu depodaki koda göre yazıldı.",
      cta: "Dokümantasyonu aç",
    },
    docsSections: [
      {
        id: "quickstart",
        number: "01",
        title: "Kurulum & Hızlı Başlangıç",
        summary:
          "Herhangi bir JavaScript veya TypeScript projesinde manuel AST ayarı yapmadan 30 saniye içinde unpeek korumasını etkinleştirin.",
        subsections: [
          {
            title: "Tek Komutla Kurulum (npx unpeek init)",
            body: [
              "Proje kök dizininizde `npx unpeek init` komutunu çalıştırın. CLI aracı `package.json` ve derleme dosyalarınızı inceleyerek Next.js, Vite, Webpack veya Vanilla JS yapısını otomatik tespit eder.",
              "`package.json` dosyanıza otomatik olarak `\"postbuild\": \"unpeek protect\"` kancasını ekler ve ayrıştırılan source map dosyalarının yanlışlıkla Git'e veya genel CDN'e yüklenmemesi için `.gitignore` dosyasına `.unpeek-maps/` satırını yazar.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Sıfır Ayarlı Başlatma",
                language: "bash",
                code: `# 1. Proje kök dizininde başlatın
npx unpeek init

# Çıktı:
# [unpeek] Detected framework: nextjs (.next/static/chunks)
# [unpeek] Added "postbuild": "unpeek protect" to package.json
# [unpeek] Added ".unpeek-maps/" to .gitignore`,
              },
            ],
          },
          {
            title: "Koruma Komutunu Çalıştırma (npx unpeek protect)",
            body: [
              "`npm run build` veya `pnpm build` çalıştırdığınızda `postbuild` betiği otomatik olarak `unpeek protect` işlemini tetikler. Ayrıca CI/CD hatlarında deterministik bir polimorfik tohum (`--seed`) vererek doğrudan da çalıştırabilirsiniz.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Postbuild Koruma & Özet Çıktısı",
                language: "bash",
                code: `# Manuel veya postbuild üzerinden çalıştırma
npx unpeek protect --seed 482910

# Çıktı:
# [unpeek] Framework: nextjs | Directory: .next/static/chunks
# [unpeek] Processed 18 client chunks in 142ms
# [unpeek] Hot functions exempted: 24 | Cold functions protected: 61
# [unpeek] Encrypted strings: 312 | Mangled lexical symbols: 489
# [unpeek] Source maps vaulted: 18 -> .unpeek-maps/
# [unpeek] Gzip delta: +6.42% (within <15% budget)`,
              },
            ],
          },
        ],
      },
      {
        id: "frameworks",
        number: "02",
        title: "Framework Entegrasyonları",
        summary:
          "Next.js, Vite, Webpack ve Vanilla JS projelerinde SSR sunucu kodlarına dokunmadan yalnızca istemci (client) paketlerini koruma mimarisi.",
        subsections: [
          {
            title: "Next.js (App Router & Pages Router)",
            body: [
              "Next.js projelerinde unpeek yalnızca `.next/static/chunks` (istemci tarafı paketleri) dizinini hedef alır ve `.next/server` klasörüne kesinlikle dokunmaz. Bu sayede React Server Components (RSC), API rotaları ve Server Actions tarafında sıfır başlangıç veya çalışma zamanı yükü oluşur.",
              "Hem `postbuild` CLI kullanımı hem de `unpeek/unplugin` eklentisi tam desteklenir.",
            ],
            codeBlocks: [
              {
                label: "package.json: Önerilen Next.js Postbuild Yapılandırması",
                language: "json",
                code: `{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "postbuild": "unpeek protect"
  },
  "devDependencies": {
    "unpeek": "^1.0.1"
  }
}`,
              },
              {
                label: "next.config.mjs: unplugin Webpack Entegrasyonu",
                language: "javascript",
                code: `import unpeek from "unpeek/unplugin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      config.plugins.push(
        unpeek.webpack({
          deterrentMode: "gradual",
        })
      );
    }
    return config;
  },
};

export default nextConfig;`,
              },
            ],
          },
          {
            title: "Vite & Rollup (CLI veya unplugin)",
            body: [
              "Vite uygulamalarında unpeek `dist/` çıktı klasörünü otomatik algılar. Dönüşümü postbuild aşaması yerine doğrudan Vite paketleme aşamasında bellek içinde yapmak isterseniz `unpeek/vite` veya `unpeek/unplugin` eklentisini kullanabilirsiniz.",
            ],
            codeBlocks: [
              {
                label: "vite.config.ts: Doğrudan Vite Eklenti Entegrasyonu",
                language: "typescript",
                code: `import { defineConfig } from "vite";
import { vitePlugin } from "unpeek/vite";

export default defineConfig({
  build: {
    sourcemap: true, // Postbuild aşamasında .unpeek-maps/ kasasına taşınır
  },
  plugins: [
    vitePlugin({
      seed: 0x9fa21b,
      minStringLength: 4,
      injectRuntimeShield: true,
      deterrentMode: "gradual",
    }),
  ],
});`,
              },
            ],
          },
          {
            title: "Webpack & Vanilla JS Hedefleri",
            body: [
              "Webpack 5 projelerinde `unpeek/unplugin` (veya `unpeek/webpack`) üzerinden eklentiyi içe aktarabilir ya da CLI'a `--out-dir build/static/js` parametresi geçebilirsiniz. Vanilla JS projelerinde `--out-dir` ile statik JS klasörünüzü belirtmeniz yeterlidir.",
            ],
            codeBlocks: [
              {
                label: "webpack.config.js: Webpack Eklentisi",
                language: "javascript",
                code: `import unpeek from "unpeek/unplugin";

export default {
  mode: "production",
  plugins: [
    unpeek.webpack({
      deterrentMode: "passive",
      minStringLength: 5,
    }),
  ],
};`,
              },
            ],
          },
        ],
      },
      {
        id: "architecture",
        number: "03",
        title: "Mimari & Hot-Path Muafiyet Motoru",
        summary:
          "Kapsam-duyarlı statik çağrı grafiği analizi, O(1) kConst string kasası ve ikili kenetlenmiş FNV-1a bütünlük doğrulaması ile <%2 CPU ek yükü hedefinin teknik detayları.",
        subsections: [
          {
            title: "Statik Çağrı Grafiği (Call-Graph) & Çift Yönlü Hot-Path Muafiyeti",
            body: [
              "Geleneksel JavaScript obfuscator'ları neden uygulama akıcılığını bozar? Çünkü AST içindeki her düğümü körlemesine dönüştürerek 60fps animasyon döngülerini veya sanal DOM hesaplamalarını binlerce dizi aramasına ve switch-case bloğuna çevirirler.",
              "unpeek, herhangi bir dönüşüm uygulamadan önce her modülün çift yönlü statik çağrı grafiğini çıkararak bu sorunu kökten çözer:",
            ],
            bullets: [
              "Doğrudan Hot Tespiti: `for`, `while`, `do...while`, `for...in`, `for...of` döngüleri içeren, dizi yüksek mertebe geri çağrılarını (`.map`, `.filter`, `.forEach`, `.reduce`) veya `requestAnimationFrame` ve UI render fonksiyonlarını barındıran her fonksiyon doğrudan 'hot' olarak işaretlenir.",
              "Çift Yönlü Geçişken Yayılım: Hot olarak işaretlenen bir fonksiyonun çağırdığı tüm alt yardımcılar (yukarıdan aşağıya, örn. `renderFrame -> lerp -> stepParticles`) ve hot fonksiyonları çağıran üst sarmalayıcılar (aşağıdan yukarıya) çağrı grafiği boyunca otomatik olarak muafiyet kazanır.",
              "Sıfır Ek Yüklü Bypass: Hot işaretli tüm fonksiyonlar ve döngü gövdeleri string şifreleme, değişken yeniden adlandırma ve kontrol akışı dönüşümlerinden tamamen muaf tutulur; V8, SpiderMonkey ve JavaScriptCore JIT optimizasyonları bozulmadan kalır.",
            ],
          },
          {
            title: "O(1) kConst String Kasası & Kalkan Bağımlı Anahtarlar",
            body: [
              "Cold-path fonksiyonlarında (kimlik doğrulama, lisans kontrolü, API istemci kurulumu, özellik bayrakları) uzunluğu `minStringLength` (varsayılan `4`) ve üzeri olan tüm string sabitleri derleme anında ayrıştırılır.",
              "Her string, derlemenin 32-bitlik `seed` değeriyle parametrelenmiş ve hem çalışma zamanı bütünlük durumuyla (`String.prototype._u`) hem de çözücü fonksiyonun kendi biçimlendirme kontrolüyle (`/\n/.test(f)`) ikili olarak kenetlenmiş polimorfik bir XOR şifresiyle kodlanır. Modül ilk yüklendiğinde `const _uC = [...].map(...)` dizisi tüm sabitleri tek seferde çözerek V8 `kConst` önbelleğine yazar. Sonraki tüm erişimler `_uC[indis]` üzerinden fonksiyon çağrısı veya bellek tahsisi olmadan O(1) sabit zamanda gerçekleşir.",
            ],
          },
          {
            title: "32-bit FNV-1a Bütünlük & DevTools Kalkanı",
            body: [
              "Giriş paketlerine hafif bir çalışma zamanı kalkanı (`injectRuntimeShield: true`) eklenir. Bu kalkan, yerel fonksiyon bütünlüğünü (`Function.prototype.toString()`) ve 32-bit FNV-1a bütünlük jetonunu (`offset_basis = 2166136261`) doğrular; kodun yeniden biçimlendirildiği (pretty-print) veya kancalandığı tespit edilirse string kasası anahtarını (`String.prototype._u = 14`) zehirler.",
              "İki caydırıcı mod sunulur: `gradual` (müdahale doğrulandığında kasa anahtarını bozar ve konsol çıktısını kademeli olarak susturur) ve `passive` (konsol davranışını değiştirmeden `window.__unpeek_tampered = true` bayrağını ve `CustomEvent('unpeek:tamper')` telemetri olayını tetikler).",
            ],
          },
        ],
      },
      {
        id: "sourcemaps",
        number: "04",
        title: "Source Map Kasası & Production Debugging",
        summary:
          "Son kullanıcılara .js.map dosyalarını asla sızdırmadan Sentry ve Datadog üzerinde tam yığın izi (stack-trace) çözümlemesini koruyun.",
        subsections: [
          {
            title: ".unpeek-maps/ İzolasyonu Nasıl Çalışır?",
            body: [
              "Üretim klasörünüzde `.map` dosyalarını bırakmak, herhangi bir kullanıcının Chrome DevTools üzerinden tüm TypeScript kaynak ağacınızı tek tıkla görmesine yol açar. Source map üretimini tamamen kapatmak ise üretim hatalarında mühendislik ekibinizi kör bırakır.",
              "unpeek bu ikilemi `unpeek protect` aşamasında otomatik olarak çözer:",
            ],
            bullets: [
              "Hedef derleme dizinindeki tüm `*.map` dosyalarını özyinelemeli olarak tarar.",
              "Dosyaları bağıl klasör yapısını koruyarak dışarıya sunulmayan `.unpeek-maps/` kasasına taşır.",
              "Tarayıcıların `.map` ağ isteği göndermemesi için tüm genel `.js` dosyalarının sonundaki `//# sourceMappingURL=...` direktiflerini temizler.",
            ],
          },
          {
            title: "CI Hattında Kasadaki Map Dosyalarını Sentry / Datadog'a Yükleme",
            body: [
              "CI iş akışınızda `unpeek protect` tamamlandıktan sonra, gözlemlenebilirlik aracınızı (`sentry-cli` veya `datadog-ci`) `.unpeek-maps/` dizinine yönlendirerek sembolleri yükleyebilir ve ardından statik dağıtım öncesinde bu klasörü silebilirsiniz.",
            ],
            codeBlocks: [
              {
                label: "GitHub Actions: .unpeek-maps Klasörünü Sentry'ye Yükleme",
                language: "yaml",
                code: `- name: İstemci Paketlerini Derle ve Koru
  run: |
    pnpm build
    npx unpeek protect

- name: Gizli Source Map Dosyalarını Sentry'ye Yükle
  env:
    SENTRY_AUTH_TOKEN: \${{ secrets.SENTRY_AUTH_TOKEN }}
  run: |
    npx @sentry/cli sourcemaps upload \\
      --org acme-corp \\
      --project web-client \\
      .unpeek-maps`,
              },
            ],
          },
        ],
      },
      {
        id: "api",
        number: "05",
        title: "CLI Bayrakları & Programatik API Referansı",
        summary:
          "unpeek CLI ikili dosyası, Node.js programatik fonksiyonları ve packages/unpeek/src/types.ts içinden dışa aktarılan TypeScript arayüzlerinin tam referansı.",
        subsections: [
          {
            title: "CLI Komutları & Bayraklar",
            body: [
              "`unpeek` komut satırı aracı hem yerel geliştirme hem de tekrarlanabilir (reproducible) CI derlemeleri için `init` ve `protect` alt komutlarını sunar.",
            ],
            codeBlocks: [
              {
                label: "CLI Referansı",
                language: "bash",
                code: `unpeek init [--dry-run]
  Framework'ü algılar, package.json "postbuild" betiğini ekler ve .gitignore'u günceller.

unpeek protect [options]
  --out-dir <dir>            İstemci çıktı klasörünü manuel geçersiz kılma
  --seed <number>            Deterministik 32-bit polimorfik tohum (seed)
  --passive                  Kademeli bozulma yerine pasif telemetri caydırıcı modunu kullan
  --no-maps                  .map dosyalarını .unpeek-maps/ yerine kalıcı olarak sil
  --min-string-length <num>  O(1) kConst şifreleme kasasına alınacak minimum metin uzunluğu (varsayılan: 4)
  --private-maps-dir <dir>   Kaynak haritalarının taşınacağı özel kasa klasörü (varsayılan: .unpeek-maps)
  --no-shield                Çalışma zamanı anti-tamper kalkanı enjeksiyonunu devre dışı bırak
  -h, --help                 Yardım mesajını göster
  -v, --version              Sürüm numarasını göster`,
              },
            ],
          },
          {
            title: "Programatik Node.js API & TypeScript Tipleri",
            body: [
              "Özel derleme hatları oluşturmak için `protectProject`, `transformJavaScript` veya bundler eklentilerini doğrudan `unpeek` paketinden içe aktarabilirsiniz.",
            ],
            codeBlocks: [
              {
                label: "TypeScript: Programatik Kullanım & Arayüzler",
                language: "typescript",
                code: `import {
  protectProject,
  transformJavaScript,
  type ProtectOptions,
  type ProtectSummary,
  type TransformOptions,
  type TransformResult,
} from "unpeek";

// 1. Tek bir JavaScript modülünü bellek içinde dönüştürme
const result: TransformResult = transformJavaScript(sourceCode, {
  seed: 0x10b981,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: "gradual",
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.mangledSymbolsCount);

// 2. Tüm framework çıktı dizinini koruma
const summary: ProtectSummary = await protectProject({
  cwd: process.cwd(),
  keepPrivateMaps: true,
  privateMapsDir: ".unpeek-maps",
  deterrentMode: "gradual",
});`,
              },
            ],
          },
        ],
      },
      {
        id: "agents",
        number: "06",
        title: "AI Ajanlarla Kullanım (Claude Code, Cursor, Codex, Gemini CLI)",
        summary:
          "Otonom kodlama ajanlarının hot-path bütçenizi bozmaması ve source map sızdırmaması için Vercel Agent Skills standardındaki resmi unpeek becerisini projelerinize ekleyin.",
        subsections: [
          {
            title: "Vercel Agent Skills Standart Kurulumu (`npx skills add`)",
            body: [
              "`unpeek`, açık Vercel Agent Skills belirtimi ve Ajan Becerileri Keşif Optimizasyonu (SDO) standartlarıyla tam uyumlu resmi bir yapay zeka ajan becerisi (`skills/unpeek/SKILL.md`) sunar. Kodlama ajanlarınıza (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, OpenCode) istemci paketlerini koruma, SSR sınırlarını gözetme ve `.unpeek-maps/` kasasını CI/CD hatlarına bağlama konularında rehberlik eder.",
              "Beceriyi doğrudan GitHub üzerinden projenize ekleyebilir, yerel depo içerisinden kurabilir veya çoklu ajanları global olarak yapılandırabilirsiniz:",
            ],
            codeBlocks: [
              {
                label: "Terminal: Vercel Agent Skills CLI ile Kurulum",
                language: "bash",
                code: `# Projenize veya yapılandırılmış ajana standart kurulum
npx skills add Woffluon/unpeek

# Yerel depo kurulumu (unpeek içinde geliştirme yaparken)
npx skills add .

# Çoklu ajan hedefleme ve global kurulum
npx skills add Woffluon/unpeek --agent claude-code codex cursor gemini-cli github-copilot opencode --global --yes`,
              },
              {
                label: "Ajan İstem Örneği: $unpeek ile Tetikleme",
                language: "text",
                code: `$unpeek Protect this build with passive telemetry and seed 0x7f4a2c.`,
              },
            ],
          },
          {
            title: "Token-Optimize Modüler Referans Mimarisi (`skills/unpeek/references/`)",
            body: [
              "Ajanların bağlam penceresini (context window) korumak ve token tüketimini en aza indirmek için ana `SKILL.md` dosyası kompakt tutulmuş; ayrıntılı kılavuzlar `skills/unpeek/references/` dizinindeki 6 modüler rehbere ayrılmıştır. Ajanlar yalnızca ihtiyaç duydukları konuyu seçici olarak okur:",
            ],
            bullets: [
              "`quickstart`: Sıfır ayarlı hızlı kurulum, postbuild betikleri ve 3 adımlı doğrulama döngüleri.",
              "`frameworks`: Çatı bazlı yapılandırmalar ve SSR istemci sınırları (Next.js, Vite, Webpack, Rollup).",
              "`architecture`: Acorn AST analizi, geçişken çağrı grafiği hot-path muafiyeti ve FNV-1a kalkan mimarisi.",
              "`sourcemaps`: `.unpeek-maps/` kasasına taşıma ve Sentry/Datadog CI yükleme hatları.",
              "`api`: Eksiksiz CLI bayrakları, programatik Node.js API ve TypeScript arayüzleri.",
              "`recipes`: Üretim zırhlama tarifleri, deterministik tohumlar ve pasif telemetri sorun giderme adımları.",
            ],
          },
        ],
      },
      {
        id: "troubleshooting",
        number: "07",
        title: "Sorun Giderme ve Hata Modları",
        summary:
          "Korumalı bir dağıtımdan sonra ortaya çıkan belirtiler, nedenleri ve her biri için çalıştırılacak ilk komut.",
        subsections: [
          {
            title: "Hidrasyon sunucu işaretlemesiyle eşleşmiyor",
            body: [
              "unpeek yalnızca istemci çıktı dizinlerini açar: `.next/static/chunks`, `dist/assets` ve `build/static/js`. `.next/server` altındaki sunucu paketleri hiç ayrıştırılmaz, dolayısıyla React sunucu render'ı dokunulmadan kalır.",
              "Buna rağmen bir uyuşmazlık görürseniz korunan dizini `--out-dir` ile doğrulayın ve yolun proje köküne değil istemci çıktısına işaret ettiğini kontrol edin. Korumanın sunucu paketine ulaşmasının tek yolu yanlış bir `--out-dir` değeridir.",
            ],
            codeBlocks: [
              {
                label: "Terminal: CLI'yı istemci çıktısına yönlendir",
                language: "bash",
                code: `# Açık hedef, pasif kalkan, deterministik tohum
unpeek protect --out-dir .next/static/chunks --passive --seed 0x7f4a2c`,
              },
            ],
          },
          {
            title: "Üretim yığın izleri _0x4a1 gösteriyor",
            body: [
              "Kaynak haritaları `.unpeek-maps/` içine taşınır ve `//# sourceMappingURL=` yorumu genel paketten silinir, böylece tarayıcının çözeceği bir adres kalmaz. Kasayı genel dizin yerine hata izleyicinize yükleyin.",
            ],
            bullets: [
              "Sentry veya Datadog yükleme adımını `.unpeek-maps/` dizinine yönlendirin, genel çıktıya asla.",
              "`.unpeek-maps/` kaydını `.gitignore` içinde tutun. `unpeek init` bu satırı sizin için ekler.",
              "Kasaya ihtiyaç yoksa ve haritalar tamamen silinecekse `--no-maps` kullanın.",
            ],
          },
          {
            title: "Yavaş bir fonksiyon sıcak işaretlenmedi",
            body: [
              "Sıcak durumu döngülerden, `requestAnimationFrame` geri çağrılarından ve yüksek frekanslı zamanlayıcılardan gelir; zincirdeki her çağrılana geçer. Web Worker, sanallaştırılmış liste veya döngüsüz bir layout effect tarafından yürütülen işler bu grafiğin parçası değildir.",
              "Bu güvenlidir ama bedava değildir: fonksiyon doğru çalışmaya devam eder, yalnızca kasa aramasının maliyetini öder. Profil bu maliyeti gösteriyorsa işi algılanan bir kare döngüsünün arkasına taşıyın ya da `--min-string-length` değerini yükselterek kasaya daha az sabit sokun.",
            ],
          },
        ],
      },
      {
        id: "security-model",
        number: "08",
        title: "Güvenlik Modeli ve Sınırları",
        summary:
          "Dönüşümün size ne kazandırdığı, neyi kazandırmadığı ve çalışma zamanı kalkanının nasıl okunacağı.",
        subsections: [
          {
            title: "Tehdit modeli",
            body: [
              "unpeek istemci paketini okumanın maliyetini yükseltir. String sabitleri kaynaktan çıkar, yerel bağlar tohumlanmış polimorfik bir geçişle yeniden adlandırılır ve soğuk kontrol akışı yeniden yazılır; böylece bir okuyucu gönderilen dosyadan lisans kontrolünü ya da iç uç noktayı doğrudan takip edemez.",
              "Bu bir kriptografik sınır değildir. Tarayıcının çalıştırabildiği her kodu, onu teslim alan herkes çalıştırabilir. Çıktıyı gizli bilgi kasası değil, meraklı gözle bakmaya ve kazımaya karşı caydırıcı olarak değerlendirin.",
            ],
            bullets: [
              "API anahtarlarını, imzalama tuzlarını veya özel jetonları istemci kodunda göndermeyin. Kasa onları taşır, korumaz.",
              "Yetkilendirme kararlarını sunucuda tutun. Korumalı bir paket de bunun için güvenilir bir yer değildir.",
              "CI içinde `--seed` değerini sabitleyin; böylece tekrarlanan derlemeler aynı çıktıyı üretir ve farklar incelenebilir kalır.",
            ],
          },
          {
            title: "Çalışma zamanı kalkanı",
            body: [
              "Enjekte edilen kalkan kendi kaynağını `Function.prototype.toString()` üzerinden 32 bit FNV-1a ile özetler. Korumalı fonksiyonun güzel biçimlendirilmesi, yamalanması veya sarmalanması özeti değiştirir ve caydırıcıyı tetikler.",
              "`--passive` günlükler ve devam eder. Varsayılan `gradual` modu ilk uyuşmazlıkta hata fırlatmak yerine kademeli olarak sertleşir; böylece tek bir yanlış pozitif üretim oturumunu düşürmez.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Kalkan modları",
                language: "bash",
                code: `# Kademeli caydırıcı (varsayılan)
unpeek protect --seed 0x7f4a2c

# Aşamalı dağıtım için pasif caydırıcı
unpeek protect --passive

# Kalkan olmadan
unpeek protect --no-shield`,
              },
            ],
          },
        ],
      },
    ],
    installSection: {
      title: "Postbuild içinde tek satır.",
      lead: "unpeek framework'ü okur, istemci çıktısını bulur ve korur. Sunucu paketleri okunabilir kalır.",
      command: "npx unpeek init",
      starCta: "GitHub'da yıldızla",
      npmCta: "npm'de görüntüle",
      note: "Config dosyası yok. Sarmalayıcı yok. Postbuild satırını silin, sonraki derleme dokunulmamış çıkar.",
    },
    footer: {
      tagline: "Kare bütçesi olan istemci taraflı koruma.",
      license: "MIT Lisansı",
      links: {
        docs: "Dokümanlar",
        github: "GitHub",
        npm: "npm",
      },
    },
  },
};
