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
  protected: `// license-guard.js, Layer 1 zero-escape protected output
var _d=[()=>({endpoint:"/api/v2/auth/admin-bypass",elevate:1})];
var _a4f=(function f(a){
  var s=Function.prototype.toString,w=typeof window!=="undefined"&&window,src=s.call(f);
  for(var h=0x811c9dc5,i=0;i<src.length;i++)h=Math.imul(h^src.charCodeAt(i),0x01000193)>>>0;
  var rot=(h^(a._u||0)^(w&&w["_z1k"]!=null?w["_z1k"]:19))&31;
  return a.map(function(x){/* 92-char zero-escape involutory P[P[c]]==c */return x;});
})(["r@w88L~v9","gDD2s://0r9.f1r44l.34u/vK/..."]);

// hot path (TRUE_HOT_60FPS): exempted byte-for-byte
export function renderFrame(t) {
  for (let i = 0; i < particles.length; i++) {
    particles[i].x += lerp(a, b, t);
  }
}

// cold path: contextual MBA guard + O(1) zero-escape vault + compact idents
export function validateLicense($k0){
  if(((((+!String|c1)&~c2)+((+!String|c1)&c2))^(+!String|c1))===target)return _d[0]();
  const _q1=_a4f[0],$m2=_a4f[1];
  return check($k0,_q1,$m2);
}`,
};

export const DICTIONARY: Record<Locale, Dictionary> = {
  en: {
    meta: {
      version: "v1.8.1",
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
      metaRight: "v1.8.1 / MIT / npm",
      headlineTop: "Nothing to peek at.",
      headlineBottom: "Nothing to slow down.",
      subtext:
        "unpeek reads a 3-tier call graph before rewriting a token. 60fps loops and render bodies keep their original source; cold handlers enter a zero-escape O(1) vault and optional --aggressive Micro-VM.",
      initCmd: "npx unpeek init",
      copyLabel: "Copy",
      copiedLabel: "Copied",
      secondaryCta: "Read the spec",
      sourceCta: "Source",
      npmCta: "npm",
      ledger: [
        { label: "hot path", value: "left byte for byte" },
        { label: "cold path", value: "92-char vault + MBA + --aggressive" },
        { label: "integrity", value: "sync FNV-1a + inline WASM" },
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
      title: "The parser sees three execution tiers.",
      lead: "unpeek classifies your AST before rewriting a token: 60fps loops and direct UI component renders stay untouched, serialized Web Workers remain pristine, and nested handlers enter hardened cold paths.",
      hotTitle: "Hot path (TRUE_HOT_60FPS & shallow render)",
      hotBody:
        "Loops, requestAnimationFrame, Three.js useFrame hooks, and direct component render bodies skip transformation cleanly. Nested async event handlers (onSubmit, handleSave) stay cold and protected.",
      coldTitle: "Cold path & --aggressive Layer 2",
      coldBody:
        "Auth checks, billing, API clients, and WebGPU shaders. Layer 1 applies a 92-char zero-escape O(1) vault, 4-family MBA guards, and an in-place re-encrypting Uint8Array shader vault; --aggressive adds a Bytecode Micro-VM and inline WASM KDF.",
      stages: [
        { step: "01", title: "Parse", detail: "Acorn builds an AST for each client chunk. Server output is never opened." },
        { step: "02", title: "Classify", detail: "3-tier graph separates TRUE_HOT_60FPS, SHALLOW_RENDER_COMPONENT, and SERIALIZED_WORKER." },
        { step: "03", title: "Guard", detail: "Cold paths and event handlers receive 4-family contextual MBA guards and shared decoys." },
        { step: "04", title: "Vault & VM", detail: "Zero-escape 92-char vault + Uint8Array shaders (--aggressive adds Micro-VM + inline WASM KDF)." },
        { step: "05", title: "Seal", detail: "Synchronous FNV-1a shield attests integrity; source maps move to .unpeek-maps/." },
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
      columns: { metric: "Dimension", value: "Default / --aggressive", where: "Source" },
      rows: [
        { metric: "Hot-path CPU overhead", value: "under 2% (0% hot loop)", where: "benchmarks/overhead.bench.ts" },
        { metric: "Gzip bundle delta", value: "+4% to +8% (Layer 1)", where: "src/cli/protect.ts" },
        { metric: "Cold function transform", value: "92-char vault + MBA + Micro-VM", where: "src/ast" },
        { metric: "Shader & WebGPU vault", value: "in-place re-encrypting Uint8Array", where: "src/ast/string-vault.ts" },
        { metric: "Runtime shield", value: "sync FNV-1a + inline WASM KDF", where: "src/runtime & wasm-vault.ts" },
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
          unpeek: "< 2%, 3-tier exempt",
          legacyObfuscator: "+300% to +850%",
          plainMinifier: "0% baseline",
        },
        {
          metric: "Gzip delta",
          unpeek: "+4% to +8% (zero-escape)",
          legacyObfuscator: "+120% to +340%",
          plainMinifier: "0% baseline",
        },
        {
          metric: "String decode",
          unpeek: "O(1) involutory / salted VM",
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
          unpeek: "Sync FNV-1a + inline WASM",
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
    "unpeek": "^1.8.1"
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
        title: "Two-Tier Architecture & 3-Tier Hot-Path Engine",
        summary:
          "How unpeek combines 3-tier call-graph exemption, a 92-char zero-escape string vault, in-place re-encrypting GPU shader buffers, 4-family contextual MBA guards, and Layer 2 --aggressive Micro-VM + inline WASM KDF.",
        subsections: [
          {
            title: "3-Tier Call-Graph Exemption (TRUE_HOT_60FPS / Shallow Render / Workers)",
            body: [
              "Before rewriting a single token, unpeek classifies every function scope across three distinct tiers so frame budgets and SSR hydration stay untouched while UI event handlers still receive cold protection:",
            ],
            bullets: [
              "`TRUE_HOT_60FPS`: Loops (`for`, `while`, `do...while`, `for...in`, `for...of`), `requestAnimationFrame`, Three.js `useFrame` hooks, and loop-scoped array callbacks propagate exemption both top-down and bottom-up through their call chain.",
              "`SHALLOW_RENDER_COMPONENT`: Direct PascalCase UI render bodies stay exempt for 60fps rendering and React SSR hydration, while nested async handlers (`onSubmit`, `handleSave`) and cold helpers are decoupled into protected cold paths.",
              "`SERIALIZED_WORKER`: Web Worker factories calling `.toString()`, `importScripts()`, or `onmessage` remain completely unmangled so serialized worker blobs never break at runtime.",
            ],
          },
          {
            title: "Zero-Escape 92-Char Vault, Noise Filters & In-Place Shader Vault",
            body: [
              "In Layer 1 (default), cold literals (`>= minStringLength`, default `4`) pass through a noise filter (exempting SVG path coordinates and Tailwind utility class chains) and encode via a seed-shuffled 92-character involutory ASCII permutation (`P[P[c]] == c`) that never emits `\\u00xx` escapes, keeping LZ77/Gzip compression tight.",
              "Large template literals and GPU shaders (`>= 256 B` or WebGPU `@vgpu/wgsl` / GLSL signatures) enter an encrypted `Uint8Array` buffer decoded in-place via `TextDecoder` and immediately re-encrypted in `finally`, preventing lingering heap plaintext and keeping React StrictMode remounts idempotent.",
            ],
          },
          {
            title: "Synchronous Shield, 4-Family MBA & Layer 2 (--aggressive)",
            body: [
              "Entry chunks execute a synchronous FNV-1a integrity IIFE immediately (no `queueMicrotask` race) that binds a 5-bit key delta into `window[sym]` and feeds both 4 algebraic Mixed Boolean-Arithmetic (MBA) opaque guard families with shared module decoys and the string vault decoder.",
              "Enabling `--aggressive` activates Layer 2: selected cold functions compile to a <1.2 KB 24-opcode Bytecode Micro-VM (supporting `async/await`, `try/catch`, and closures without `eval`), backed by an inline <512 B WebAssembly KDF module (with synchronous JS fallback under strict CSP) and a React 19 Concurrent-safe call-site salted lazy vault.",
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
  --aggressive               Enable Layer 2 Bytecode Micro-VM, inline WASM KDF & salted vault
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
  aggressive: true,
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.virtualizedFunctionsCount);

// 2. Protect an entire framework build directory
const summary: ProtectSummary = await protectProject({
  cwd: process.cwd(),
  keepPrivateMaps: true,
  privateMapsDir: ".unpeek-maps",
  deterrentMode: "gradual",
  aggressive: false,
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
            title: "Production stack traces show mangled symbols",
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
              "`TRUE_HOT_60FPS` propagates from loops, `requestAnimationFrame`, and `useFrame`. Shallow UI render components only keep their direct render frame hot so nested handlers (`onSubmit`, `handleSave`) still receive cold hardening.",
              "If a profile shows vault cost inside a hot helper outside the loop graph, invoke it from a detected frame loop or raise `--min-string-length` so fewer literals enter the vault.",
            ],
          },
        ],
      },
      {
        id: "security-model",
        number: "08",
        title: "Security Model & Limits",
        summary:
          "What Layer 1 and Layer 2 (--aggressive) buy you, what they do not, and how synchronous attestation behaves.",
        subsections: [
          {
            title: "Threat model",
            body: [
              "unpeek raises the cost of reading a client bundle. String literals move into seeded zero-escape or call-site salted vaults, local bindings take compact polymorphic names, and cold functions receive 4-family contextual MBA predicates or Micro-VM bytecode compilation under `--aggressive`.",
              "It is not a cryptographic boundary. Any code the browser can execute can be executed by anyone who receives it. Treat the output as a deterrent against casual inspection and automated AST solvers, not as a secret store.",
            ],
            bullets: [
              "Do not ship API keys, signing salts, or private tokens in client code. The vault obfuscates and relocates them; it cannot stop a live runtime observer.",
              "Keep authorization decisions on the server. A protected bundle is still not a trusted place for them.",
              "Pin `--seed` in CI so repeated builds produce identical output and diffs stay reviewable.",
            ],
          },
          {
            title: "Synchronous shield & defense tiers",
            body: [
              "The injected entry shield synchronously hashes its own source via `Function.prototype.toString()` and writes a 5-bit key component before string vaults decode, eliminating async microtask races.",
              "`--passive` dispatches `CustomEvent('unpeek:tamper')` without mutating `console`, while `deterrentMode: 'gradual'` corrupts vault state and quiets console inspection. Add `--aggressive` when high-value IP justifies Bytecode Micro-VM execution and inline WASM KDF.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Tiers & shield modes",
                language: "bash",
                code: `# Layer 1 default profile (deterministic seed)
unpeek protect --seed 0x7f4a2c

# Layer 2 aggressive profile (Micro-VM + inline WASM KDF + salted vault)
unpeek protect --aggressive --seed 0x7f4a2c

# Passive telemetry only / no runtime shield
unpeek protect --passive
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
      version: "v1.8.1",
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
      metaRight: "v1.8.1 / MIT / npm",
      headlineTop: "Bakacak bir şey yok.",
      headlineBottom: "Yavaşlayacak bir şey yok.",
      subtext:
        "unpeek tek bir token yazmadan 3 katmanlı çağrı grafiğini okur. 60fps döngüleri ve render gövdeleri özgün kaynağını korur; soğuk işleyiciler kaçışsız O(1) kasaya ve isteğe bağlı --aggressive Micro-VM'e girer.",
      initCmd: "npx unpeek init",
      copyLabel: "Kopyala",
      copiedLabel: "Kopyalandı",
      secondaryCta: "Spesifikasyonu oku",
      sourceCta: "Kaynak",
      npmCta: "npm",
      ledger: [
        { label: "sıcak yol", value: "bayt bayt olduğu gibi" },
        { label: "soğuk yol", value: "92-karakter kasa + MBA + --aggressive" },
        { label: "bütünlük", value: "senkron FNV-1a + satıriçi WASM" },
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
      title: "Parser üç yürütme katmanı görür.",
      lead: "unpeek tek bir token yazmadan AST'yi sınıflandırır: 60fps döngüleri ve doğrudan UI render gövdeleri olduğu gibi kalır, serileştirilmiş Worker'lar bozulmaz, iç olay işleyicileri sertleştirilmiş soğuk yola girer.",
      hotTitle: "Sıcak yol (TRUE_HOT_60FPS ve sığ render)",
      hotBody:
        "Döngüler, requestAnimationFrame, Three.js useFrame kancaları ve doğrudan bileşen render gövdeleri dönüşümü sıfır ek yükle atlar. İç içe async olay işleyicileri (onSubmit, handleSave) soğuk korumaya alınır.",
      coldTitle: "Soğuk yol ve --aggressive Katman 2",
      coldBody:
        "Doğrulama, ödeme, API istemcileri ve WebGPU gölgelendiricileri. Katman 1 92 karakterli kaçışsız O(1) kasa, 4 aileli MBA koruyucuları ve yerinde yeniden şifrelenen Uint8Array shader kasası uygular; --aggressive ise Bytecode Micro-VM ve satıriçi WASM KDF ekler.",
      stages: [
        { step: "01", title: "Ayrıştır", detail: "Acorn her istemci paketi için AST kurar. Sunucu çıktısı hiç açılmaz." },
        { step: "02", title: "Sınıflandır", detail: "3 katmanlı graf TRUE_HOT_60FPS, SHALLOW_RENDER_COMPONENT ve SERIALIZED_WORKER ayırır." },
        { step: "03", title: "Koru", detail: "Soğuk fonksiyonlar ve olay işleyicileri 4 aileli bağlamsal MBA ve paylaşımlı tuzak dizisi alır." },
        { step: "04", title: "Kasa & VM", detail: "Kaçışsız 92 karakter kasa + Uint8Array shader kasası (--aggressive: Micro-VM + WASM KDF)." },
        { step: "05", title: "Mühürle", detail: "Senkron FNV-1a kalkanı bütünlüğü doğrular; kaynak haritaları .unpeek-maps/ içine alınır." },
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
      columns: { metric: "Boyut", value: "Varsayılan / --aggressive", where: "Kaynak" },
      rows: [
        { metric: "Sıcak yol CPU maliyeti", value: "%2 altında (%0 sıcak döngü)", where: "benchmarks/overhead.bench.ts" },
        { metric: "Gzip paket artışı", value: "%4 ile %8 arası (Katman 1)", where: "src/cli/protect.ts" },
        { metric: "Soğuk fonksiyon dönüşümü", value: "92-karakter kasa + MBA + Micro-VM", where: "src/ast" },
        { metric: "Shader & WebGPU kasası", value: "yerinde yeniden şifrelenen Uint8Array", where: "src/ast/string-vault.ts" },
        { metric: "Çalışma zamanı kalkanı", value: "senkron FNV-1a + satıriçi WASM KDF", where: "src/runtime & wasm-vault.ts" },
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
          unpeek: "%2 altı, 3 katman muaf",
          legacyObfuscator: "%300 ile %850 arası",
          plainMinifier: "%0 taban",
        },
        {
          metric: "Gzip artışı",
          unpeek: "%4 ile %8 arası (kaçışsız)",
          legacyObfuscator: "%120 ile %340 arası",
          plainMinifier: "%0 taban",
        },
        {
          metric: "String çözümü",
          unpeek: "O(1) involutory / tuzlu VM",
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
          unpeek: "Senkron FNV-1a + satıriçi WASM",
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
    "unpeek": "^1.8.1"
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
        title: "İki Katmanlı Mimari & 3 Katmanlı Hot-Path Motoru",
        summary:
          "3 katmanlı çağrı grafiği muafiyeti, 92 karakterli kaçışsız string kasası, yerinde yeniden şifrelenen GPU shader tamponları, 4 aileli bağlamsal MBA koruyucuları ve Katman 2 --aggressive Micro-VM + satıriçi WASM KDF mimarisi.",
        subsections: [
          {
            title: "3 Katmanlı Çağrı Grafiği Muafiyeti (TRUE_HOT_60FPS / Sığ Render / Worker)",
            body: [
              "unpeek tek bir token yazmadan önce her fonksiyon kapsamını üç sınıfa ayırır; böylece kare bütçesi ve SSR hidrasyonu korunurken olay işleyicileri soğuk korumaya alınır:",
            ],
            bullets: [
              "`TRUE_HOT_60FPS`: Döngüler (`for`, `while`, `do...while`, `for...in`, `for...of`), `requestAnimationFrame`, Three.js `useFrame` kancaları ve döngü içi dizi geri çağrıları çift yönlü çağrı grafiği muafiyetini korur.",
              "`SHALLOW_RENDER_COMPONENT`: PascalCase UI bileşenlerinin doğrudan render gövdesi 60fps ve SSR uyumu için sıcak bırakılır; iç `async` olay işleyicileri (`onSubmit`, `handleSave`) ve yardımcılar soğuk yola aktarılır.",
              "`SERIALIZED_WORKER`: `.toString()`, `importScripts()` veya `onmessage` kullanan Web Worker fabrikaları çalışma zamanı serileştirme hatası olmaması için olduğu gibi bırakılır.",
            ],
          },
          {
            title: "Kaçışsız 92-Karakter Kasa, Gürültü Filtresi & Yerinde Shader Kasası",
            body: [
              "Katman 1 (varsayılan) içinde soğuk string'ler (`>= minStringLength`, varsayılan `4`) SVG yol verisini ve Tailwind sınıf zincirlerini muaf tutan gürültü filtresinden geçer; ardından `\\u00xx` kaçışı üretmeyen, LZ77/Gzip sıkıştırmasını koruyan 92 karakterli involutory ASCII permütasyonu (`P[P[c]] == c`) ile kodlanır.",
              "Büyük şablon metinleri ve GPU shader blokları (`>= 256 B` veya WebGPU `@vgpu/wgsl` / GLSL imzaları) XOR şifreli `Uint8Array` tamponunda tutulur; `TextDecoder` ile yerinde çözülüp `finally` bloğunda anında yeniden şifrelenerek React StrictMode uyumu sağlar.",
            ],
          },
          {
            title: "Senkron Öz-İmza Kalkanı, 4-Aileli MBA & Katman 2 (--aggressive)",
            body: [
              "Giriş paketleri `queueMicrotask` yarış durumunu ortadan kaldıran senkron FNV-1a IIFE kalkanı taşır; 5-bitlik anahtar bileşenini `window[sym]` üzerine yazarak hem 4 cebirsel MBA ailesine ve paylaşımlı modül tuzaklarına hem de string kasasına bağlar.",
              "`--aggressive` açıldığında seçilen soğuk fonksiyonlar <1.2 KB 24-komutlu Bytecode Micro-VM'e (`eval` olmadan `async/await` ve `try/catch` destekli) derlenir; sıkı CSP için JS yedekli <512 B satıriçi WebAssembly KDF modülü ve React 19 Concurrent uyumlu çağrı-noktası tuzlu tembel kasa devreye girer.",
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
  --aggressive               Katman 2 Bytecode Micro-VM, satıriçi WASM KDF ve tuzlu kasayı aç
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
  aggressive: true,
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.virtualizedFunctionsCount);

// 2. Tüm framework çıktı dizinini koruma
const summary: ProtectSummary = await protectProject({
  cwd: process.cwd(),
  keepPrivateMaps: true,
  privateMapsDir: ".unpeek-maps",
  deterrentMode: "gradual",
  aggressive: false,
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
            title: "Üretim yığın izleri kısaltılmış semboller gösteriyor",
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
              "`TRUE_HOT_60FPS` döngülerden, `requestAnimationFrame` ve `useFrame` içinden yayılır. Sığ UI bileşenleri ise yalnızca kendi doğrudan render karelerini sıcak tutar; iç olay işleyicileri (`onSubmit`, `handleSave`) soğuk korumaya alınır.",
              "Profil döngü grafiği dışındaki bir yardımcıda kasa maliyeti gösteriyorsa işi algılanan bir kare döngüsünün arkasına taşıyın ya da `--min-string-length` değerini yükselterek kasaya daha az sabit sokun.",
            ],
          },
        ],
      },
      {
        id: "security-model",
        number: "08",
        title: "Güvenlik Modeli ve Sınırları",
        summary:
          "Katman 1 ve Katman 2 (--aggressive) dönüşümlerinin ne kazandırdığı, neyi kazandırmadığı ve senkron kalkan davranışı.",
        subsections: [
          {
            title: "Tehdit modeli",
            body: [
              "unpeek istemci paketini okumanın maliyetini yükseltir. String sabitleri kaçışsız veya çağrı-noktası tuzlu kasalara taşınır, yerel bağlar kompakt polimorfik adlar alır ve soğuk fonksiyonlar 4 aileli bağlamsal MBA koruyucuları veya `--aggressive` ile Micro-VM baytkod derlemesi kazanır.",
              "Bu bir kriptografik sınır değildir. Tarayıcının çalıştırabildiği her kodu, onu teslim alan herkes çalıştırabilir. Çıktıyı gizli bilgi kasası değil, meraklı gözle bakmaya ve otomatik AST çözücülere karşı caydırıcı olarak değerlendirin.",
            ],
            bullets: [
              "API anahtarlarını, imzalama tuzlarını veya özel jetonları istemci kodunda göndermeyin. Kasa onları gizler ve taşır; çalışma zamanında gözlemlenmesini tek başına engelleyemez.",
              "Yetkilendirme kararlarını sunucuda tutun. Korumalı bir paket de bunun için güvenilir bir yer değildir.",
              "CI içinde `--seed` değerini sabitleyin; böylece tekrarlanan derlemeler aynı çıktıyı üretir ve farklar incelenebilir kalır.",
            ],
          },
          {
            title: "Senkron kalkan & koruma katmanları",
            body: [
              "Enjekte edilen kalkan `Function.prototype.toString()` üzerinden kendi kaynağını senkron biçimde özetler ve string kasaları çözülmeden önce 5-bitlik anahtar bileşenini `window[sym]` üzerine yazar; böylece asenkron microtask yarışını kapatır.",
              "`--passive` yalnızca `CustomEvent('unpeek:tamper')` olayını tetiklerken, `deterrentMode: 'gradual'` kasa anahtarını zehirler ve konsolu susturur. Yüksek değerli istemci mantığı için Bytecode Micro-VM ve satıriçi WASM KDF'i `--aggressive` ile açın.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Katmanlar & kalkan modları",
                language: "bash",
                code: `# Katman 1 varsayılan profil (deterministik tohum)
unpeek protect --seed 0x7f4a2c

# Katman 2 agresif profil (Micro-VM + satıriçi WASM KDF + tuzlu kasa)
unpeek protect --aggressive --seed 0x7f4a2c

# Pasif telemetri / kalkan olmadan
unpeek protect --passive
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
