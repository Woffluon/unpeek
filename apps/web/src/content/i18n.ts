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
      version: "v4.2.0",
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
      metaRight: "v1.13.0 / MIT / npm",
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
        { label: "cold path", value: "92-char / 64-bit vault + Rivest MBA" },
        { label: "integrity", value: "order-free globalThis + host WASM" },
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
      coldTitle: "Cold path & Tier 3 @unpeek-critical enclave",
      coldBody:
        "Auth checks, billing, API clients, and WebGPU shaders. Tier 2 applies a 92-char zero-escape O(1) vault, >=4-var semi-linear MBA + degree-3 Rivest QNR guards, and an in-place Uint8Array shader vault; Tier 3 / --aggressive adds a 43-opcode Micro-VM v2 and shared <1.2 KB host-coupled WASM KDF.",
      stages: [
        { step: "01", title: "Parse", detail: "Acorn builds an AST for each client chunk. Server output is never opened." },
        { step: "02", title: "Classify", detail: "3-tier graph separates TRUE_HOT_60FPS, SHALLOW_RENDER_COMPONENT, and SERIALIZED_WORKER." },
        { step: "03", title: "Guard", detail: "Cold paths receive >=4-var MBA, Rivest Z_2^32 QNR predicates, and neutral decoy bridges." },
        { step: "04", title: "Vault & VM", detail: "92-char / 64-bit salted vault + Uint8Array shaders (--aggressive adds 43-op Micro-VM v2 + singleton WASM)." },
        { step: "05", title: "Seal", detail: "Order-independent globalThis shield attests integrity; multi-pass maps move to .unpeek-maps/." },
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
        { metric: "Gzip bundle delta", value: "+4% to +8% (Tier 1/2)", where: "src/core/protect.ts" },
        { metric: "Cold function transform", value: "Rivest MBA + 43-op Micro-VM v2", where: "src/ast" },
        { metric: "Shader & WebGPU vault", value: "in-place re-encrypting Uint8Array", where: "src/ast/string-vault.ts" },
        { metric: "Runtime shield", value: "order-free globalThis + <1.2 KB WASM", where: "src/runtime & wasm-vault.ts" },
        { metric: "Client bundle scope", value: "static chunks only (workers isolated)", where: "src/core/detector.ts" },
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
          unpeek: "Order-free globalThis + singleton WASM",
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

#   ▛▀▀▜  unpeek 1.12.0
#   ▙▄▄▟  client bundle protection
#
#   PROJECT ──────────────────────────────────────
#   framework            next
#   postbuild            unpeek protect (added)
#   vault                .unpeek-maps/ (added)
#
#   postbuild wired. maps stay private from the first build.
#   run your build to protect the first bundle.`,
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

#   ▛▀▀▜  unpeek 1.12.0
#   ▙▄▄▟  client bundle protection
#
#   PROJECT ──────────────────────────────────────
#   framework            next
#   tier                 Tier 2 (recommended: string vault & cold-flow)
#   shield               passive (detectHeadless: off)
#   output               .next/static/chunks
#   bundles              18
#
#   CALL GRAPH ───────────────────────────────────
#   hot path exempt      24  0% tax
#   cold path protected  61
#
#   TRANSFORM ────────────────────────────────────
#   string vault         312 literals  O(1) memo
#   symbol mangling      489 bindings
#
#   OUTPUT ───────────────────────────────────────
#   source maps          18 moved -> .unpeek-maps/
#   gzip                 284.12 KB -> 302.36 KB  +6.42%
#   elapsed              142 ms
#
#   done. maps are private. hot path untouched.`,
              },
            ],
          },
          {
            title: "Project Configuration: unpeek.config.ts (defineConfig)",
            body: [
              "unpeek operates zero-config by default through automatic framework discovery. For custom hot-path heuristics, fine-grained string vault thresholds, mangler reservations, or private map paths, place an `unpeek.config.ts` (or `.js`, `.mjs`, `.cjs`, `.json`) at the project root.",
              "Use `defineConfig` imported from `unpeek` for full TypeScript autocomplete, inline schema documentation, and strict type verification:",
            ],
            codeBlocks: [
              {
                label: "unpeek.config.ts: Configuration File & Options",
                language: "typescript",
                code: `import { defineConfig } from "unpeek";

export default defineConfig({
  // Optional deterministic 32-bit build seed (finite number)
  seed: 0x42f00d,
  // Glob filters applied across CLI scanClientBundles & unplugin
  filter: {
    include: [],
    exclude: ["node_modules/**", "**/*.test.*", "**/*.spec.*"],
  },
  // Hot-path heuristics & caller propagation exemptions
  hotPath: {
    customAnimationCalls: ["requestAnimationFrame", "useFrame"],
    customHooks: ["useSpring", "useGesture"],
    maxPipelineCallers: 2,
  },
  // O(1) string vault & syntax noise filters
  vault: {
    minStringLength: 4,
    cssFramework: "tailwind",
    polymorphicDecoys: true,
  },
  // Runtime anti-tamper shield options
  shield: {
    deterrentMode: "passive",
    detectHeadless: false,
  },
  // Lexical binding & symbol mangler rules
  mangler: {
    reservedIdentifiers: ["__NEXT_DATA__", "process"],
  },
  // Private source map extraction vault
  sourcemaps: {
    keepPrivate: true,
    vaultDir: ".unpeek-maps",
  },
});`,
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
              "In Next.js projects, unpeek strictly targets `.next/static/chunks` (falling back to `.vercel/output/static/_next/static` when `.next/static` is empty, discovering entries from `.next/build-manifest.json`, and selectively exempting `globalThis.TURBOPACK.push` chunk headers while protecting module factory bodies) while leaving `.next/server` completely untouched. In browser and Worker contexts, async split chunks resolve cleanly even before the entry shield initializes.",
              "Both `postbuild` CLI execution and the `unpeek/next` Build Adapter (`withUnpeek` / `createUnpeekNextAdapter`, which auto-injects a deterministic `outputHashSalt` on production builds to prevent Vercel immutable chunk hash collisions) are supported.",
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
    "unpeek": "^1.12.0"
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
          deterrentMode: "passive",
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
              "For Vite applications, `unpeek/vite` hooks into `enforce: 'post'` `generateBundle` (after esbuild minification) and automatically wires `worker.plugins` for Web Worker bundles.",
            ],
            codeBlocks: [
              {
                label: "vite.config.ts: Native Vite Plugin Integration",
                language: "typescript",
                code: `import { defineConfig } from "vite";
import unpeek from "unpeek/vite";

export default defineConfig({
  build: {
    sourcemap: true, // Extracted to .unpeek-maps/ during postbuild
  },
  plugins: [
    unpeek({
      seed: 0x9fa21b,
      minStringLength: 4,
      injectRuntimeShield: true,
      deterrentMode: "passive",
    }),
  ],
});`,
              },
            ],
          },
          {
            title: "Webpack, Rspack & Vanilla JS Targets",
            body: [
              "Webpack 5 and Rspack plugins hook into `processAssets` (`PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE`), esbuild runs in `build.onEnd` (`write: false` and `write: true`), and Rollup handles hash placeholders in `renderChunk`. Service Workers (`sw.js`) and Web Workers (`*.worker.js`) are excluded by default unless `target: 'worker'` is set.",
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
        title: "Three-Tier Architecture & 3-Tier Hot-Path Engine",
        summary:
          "How unpeek combines 3-tier call-graph exemption, 92-char / 64-bit salted vaults, >=4-var Rivest MBA + QNR guards, order-independent globalThis shield, and Tier 3 Micro-VM v2 + singleton <1.2 KB host-coupled WASM KDF.",
        subsections: [
          {
            title: "3-Tier Call-Graph Exemption (TRUE_HOT_60FPS / Shallow Render / Workers)",
            body: [
              "Before rewriting a single token, unpeek classifies every function scope across three distinct tiers so frame budgets and SSR hydration stay untouched while UI event handlers still receive cold protection:",
            ],
            bullets: [
              "`TRUE_HOT_60FPS`: Loops (`for`, `while`, `do...while`, `for...in`, `for...of`), `requestAnimationFrame`, Three.js `useFrame` hooks, and loop-scoped array callbacks propagate exemption both top-down and bottom-up through their call chain.",
              "`SHALLOW_RENDER_COMPONENT`: PascalCase UI components carrying an explicit JSX (`createElement`/`_jsx`/`_jsxs`/`jsxDEV`), hook (`use*`), or HOC (`memo`/`forwardRef`) signal keep their direct render bodies exempt for 60fps rendering and React SSR hydration, while non-UI PascalCase helpers and nested async handlers (`onSubmit`, `handleSave`) stay in protected cold paths; Source Map v3 `sourcesContent`/`names` and VLQ mappings (`sourcemap-critical.ts`) preserve `/*! @unpeek-critical */` and `critical.include` targeting even when bundlers strip comments.",
              "`SERIALIZED_WORKER`: Web Worker factories calling `.toString()`, `importScripts()`, or `onmessage` remain completely unmangled so serialized worker blobs never break at runtime.",
            ],
          },
          {
            title: "Zero-Escape 92-Char Vault, Noise Filters & In-Place Shader Vault",
            body: [
              "In Tier 2 (`recommended`, default), cold literals (`>= minStringLength`, default `4`), static quasis inside interpolated `TemplateLiteral` nodes (`ToPrimitive(\"string\")` evaluation order preserved; tagged templates, dynamic `import()`, and hot paths exempted), and secret-bearing `RegExp` literals wrapped as `new RegExp(vault(...), flags)` (outside loops and `RegExp`-shadowed/`with` scopes via `secret-patterns.ts`) pass through a noise filter (exempting SVG path coordinates and Tailwind utility class chains) and encode via a seed-shuffled 92-character involutory ASCII permutation (`P[P[c]] == c`) that never emits `\\u00xx` escapes, keeping LZ77/Gzip compression tight.",
              "Large template literals and GPU shaders (`>= 256 B` or WebGPU `@vgpu/wgsl` / GLSL signatures outside direct loops, while exempting universal binary/Base64 WASM `AGFzbQE`, binary `data:` URIs, and large pure Base64 payloads) enter a shield-coupled, encrypted `Uint8Array` buffer decoded in-place via `TextDecoder` and immediately re-encrypted in `finally` across both Tier 2 (`recommended`) and Tier 3 (`strict` / `--aggressive`), preventing lingering heap plaintext and keeping React StrictMode remounts idempotent.",
            ],
          },
          {
            title: "Order-Independent Shield & Non-Linear Rivest MBA Guards",
            body: [
              "Entry chunks execute a single-line (`<2.3 KB`), `WorkerGlobalScope`-safe (`self`/`globalThis`) FNV-1a integrity IIFE with `Reflect.apply`, `Function.prototype.toString()`, `Error.prepareStackTrace`, and `Error.prototype.stack` descriptor, native-signature, cross-call, and V8 stack-trace `Proxy` trap checks, plus synchronous `detectHeadless: true` checks for `navigator.webdriver`, `HeadlessChrome`, `__playwright`, `__puppeteer_evaluation_script__`, `__nightmare`, `frida`, and `_frida_`. Async `sv === void 0` tolerance is narrowed to genuine loading DOM (`document.scripts.length > 0 && document.readyState !== 'complete'`) or Web Worker (`self.importScripts`) contexts without cache poisoning (`d = -1` removed), while bare non-browser VMs (`node:vm`, bare `{}`), already-complete documents without a shield, and active tampering fail closed.",
              "Cold functions (`coldFlow: true`) receive type-guarded `>=4`-variable semi-linear MBA predicates (safe across `Object.create(null)`, `Symbol`, and `BigInt` inputs) paired with degree-3 Rivest $\\mathbb{Z}_{2^{32}}$ permutation polynomials, a 256-entry seeded S-Box, 6 state-, shield-, and domain-coupled predicate forms (including Form 4 unsigned-domain MBA inequalities and Form 5 parameterized affine-inverse MBA identities via `modInverseUint32`) across 4 QNR modular residue families ($\\pmod 4, \\pmod 8, \\pmod{16}$) without fixed `=== R` suffixes, alias-table perturbation, and neutral return-domain-aligned decoy bridges without mutating application branches or leaking source identifiers; under `strict` / `--aggressive`, `applyColdBitwiseMba` substitutes up to 8 cold-path `^`/`|`/`&` expressions per chunk with `typeof`-guarded affine MBA (skipping chunks with `BigInt`, `with`, or local `Math` shadowing).",
            ],
          },
          {
            title: "Tier 3 Deep-Dive: Micro-VM v2, Singleton Host-Coupled WASM KDF & 64-Bit Vault",
            body: [
              "Passing `--aggressive` or `--profile strict` activates Tier 3 enclave defense (priority-scoring `@unpeek-critical` and submit/validation/auth handlers into `maxFunctionsPerChunk`, skipping duplicate `coldFlow` on virtualized bodies) without risking application crashes or violating strict CSP:",
            ],
            bullets: [
              "`Bytecode Micro-VM v2 (43 Opcodes)`: Pre-VM lowering supports `&&`/`||`/`??`, `?:`, `for`/`while`/`do..while`, `try`/`throw`, `this`, `new`, `obj.arguments`, and closures across an `[8, 400]` AST node window using a `globalThis`-shared singleton `$step` direct-threaded trampoline, inter-block `$f.ac` ratchet, per-`(seed, op)` non-zero semantic handler biases (`1..31`), 32-bit `sym_s[1]` (`expectedStateHash`) verification, dead post-`RET` epilogue pruning, and `_uVm*` pretty-print self-hashing—zero `eval()` or `new Function()`.",
              "`Singleton Host-Coupled WASM KDF (<1.2 KB)`: Synthesizes a `<512 B` WebAssembly binary with seed-derived 2–3 char polymorphic import/export ABI names and shuffled export order (`deriveWasmAbiNames`) over masked `env.g`/`env.m` host hooks (`gMask`, `pcMask`), compiled once into a shared `globalThis` singleton across split chunks, with a bit-identical non-linear Rivest + S-Box JavaScript fallback when WebAssembly is blocked by CSP.",
              "`64-Bit Call-Site Salted Vault`: Replaces sequential counters with 31-bit salts derived via 64-bit mixing (`_uD(stringIndex, callSiteSalt)`), covering literals, interpolated template static quasis, and secret-bearing `RegExp` instances with complete idempotence under React 19 Concurrent Mode and StrictMode.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Tier 3 Strict / Aggressive Protection Invocation",
                language: "bash",
                code: `# Activate Tier 3 Bytecode Micro-VM v2 & singleton host-coupled WASM KDF
npx unpeek protect --aggressive --seed 0x7f4a2c

#   ▛▀▀▜  unpeek 1.12.0
#   ▙▄▄▟  client bundle protection
#
#   PROJECT ──────────────────────────────────────
#   framework            next
#   tier                 Tier 3 (strict / --aggressive: Micro-VM & WASM KDF)
#   shield               passive (detectHeadless: off)
#   output               .next/static/chunks
#   bundles              18
#
#   CALL GRAPH ───────────────────────────────────
#   hot path exempt      24  0% tax
#   cold path protected  61
#
#   TRANSFORM ────────────────────────────────────
#   string vault         312 literals  O(1) memo
#   symbol mangling      489 bindings
#
#   OUTPUT ───────────────────────────────────────
#   source maps          18 moved -> .unpeek-maps/
#   gzip                 284.12 KB -> 316.50 KB  +11.39%
#   elapsed              186 ms
#
#   done. maps are private. hot path untouched.`,
              },
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
              "Scans the target build directory recursively for all `*.map` files, flattening ECMA-426 `.sections` index maps automatically.",
              "Composes multi-pass $M_1 \\circ M_2$ VLQ mappings (`chainSourceMaps`) with preamble line shifting and decodes URL-encoded Next.js segments (`%28public%29`, `%5Bparam%5D`) plus Windows paths.",
              "Automatically stamps an identical deterministic SHA-256 `debugId` onto both the protected JS bundle and vaulted `.map` whenever `keepPrivateMaps: true` (even if no pre-existing `debugId` existed, verified by `unpeek check` via `debugid-mismatch`), resolves `/*! @unpeek-critical */` Source Map v3 annotations across bundler comment stripping, relocates maps to `.unpeek-maps/`, and strips `//# sourceMappingURL=...` directives.",
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
          {
            title: "Docker Image Hardening & .dockerignore Advisory",
            body: [
              "When packaging applications with Docker using `COPY . .`, private debugging symbols inside `.unpeek-maps/` can leak into public container image layers if `.dockerignore` is missing or omits `.unpeek-maps/`.",
              "`unpeek protect` automatically inspects `.dockerignore`. If present, it appends `.unpeek-maps/`; if `.dockerignore` is missing or lacks the rule, it emits an advisory warning:",
            ],
            bullets: [
              "`[unpeek:advisory] .dockerignore is missing .unpeek-maps/. Private maps may leak into Docker image during 'COPY . .'.`",
              "Always ensure `.unpeek-maps/` is listed in `.dockerignore` alongside `.gitignore` before shipping Docker images.",
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
            title: "CLI Commands & Defense Tiers (Tier 1 / Tier 2 / Tier 3)",
            body: [
              "The `unpeek` binary supports `init`, `protect`, `check`, and `symbolicate` commands across three defense tiers:",
              "Tier 1 (`--profile minimal`): Fast baseline with `coldFlow: false`, `mangler.minLength: 1`, hot-path exemption, and order-independent `globalThis` shield (<2% CPU, <15% Gzip).",
              "Tier 2 (`--profile recommended` / Default): Adds 92-char zero-escape string vault (including interpolated `TemplateLiteral` static quasis and secret-bearing `RegExp` literals), `>=4`-var semi-linear MBA + degree-3 Rivest QNR & Form 4/5 unsigned/affine-inverse MBA guards, and in-place `Uint8Array` shader vaulting.",
              "Tier 3 (`--profile strict` / `--aggressive`): Targets `@unpeek-critical` enclaves and `critical.include` functions with the 43-opcode Micro-VM v2, shared `<1.2 KB` host-coupled WASM KDF (`deriveWasmAbiNames` polymorphic ABI + shuffled exports `<512 B`), 64-bit call-site salted decoders, cold-path `^`/`|`/`&` affine bitwise MBA (`applyColdBitwiseMba`, max 8/chunk), and CWE-540 path scrubbing.",
            ],
            codeBlocks: [
              {
                label: "CLI Reference",
                language: "bash",
                code: `  ▛▀▀▜  unpeek 3.0.0
  ▙▄▄▟  client bundle protection

  Usage:
    unpeek init [--dry-run] [--profile <name>]   wire postbuild and the .unpeek-maps/ vault
    unpeek protect [options]                     protect client bundles in place (Tier 2 default: <2% CPU, <15% Gzip)
    unpeek check [options]                       read-only CI gate for leaks, ignores, budget, CSP, and plaintext secrets
    unpeek symbolicate [options]                 resolve stack traces locally using .unpeek-maps/

  Options (protect):
    --profile <name>               preset profile: minimal | recommended | strict
    --dry-run                      compute transform & Gzip delta in memory without writing files
    --max-gzip-delta <num>         fail if Gzip delta exceeds percentage
    --out-dir <dir>                explicit client output directory
    --seed <number>                deterministic polymorphic seed
    --passive                      passive deterrent mode (default: marks tamper, keeps console)
    --gradual                      gradual deterrent mode (silences console on tamper)
    --detect-headless              treat webdriver/HeadlessChrome, Playwright, Puppeteer, Nightmare, and Frida markers as tamper
    --no-maps                      delete .map files instead of vaulting them
    --min-string-length <num>      minimum string length for the vault (default: 4)
    --private-maps-dir <dir>       vault directory (default: .unpeek-maps)
    --no-shield                    skip the runtime anti-tamper shield
    --aggressive                   enable Tier 3 strict protection (Micro-VM & WASM KDF)
    -h, --help                     show help
    -v, --version                  show version

  Options (check):
    --require-zero-eval            fail on unattributed/injected eval() or new Function() (warns on ES5 Function("return this"), node_modules maps & baseline)

  Tiers:
    Tier 1 (minimal)               call-graph hot-path exemption (<2% CPU, <15% Gzip)
    Tier 2 (recommended, default)  string vault & cold-flow protection (<2% CPU, <15% Gzip)
    Tier 3 (strict / --aggressive) zero plaintext exposure via Micro-VM & WASM KDF`,
              },
            ],
          },
          {
            title: "Programmatic Node.js API & TypeScript Types",
            body: [
              "Import `protectProject`, `transformJavaScript`, `checkProject`, `symbolicateStackTrace`, `PRESETS`, `isUnpeekError`, or bundler plugins directly from `unpeek` to build custom compilation pipelines. `checkProject(options)` also accepts `CheckOptions.failOnPlaintextSecrets` (`boolean`, default `false` -> `'warning'`) to audit bundles via Acorn AST for `'plaintext-secret'` hits (Shannon entropy, English bigram suppression, and secret-bearing regexes with redacted previews).",
            ],
            codeBlocks: [
              {
                label: "TypeScript: Programmatic Usage & Exported Interfaces",
                language: "typescript",
                code: `import {
  PRESETS,
  protectProject,
  transformJavaScript,
  checkProject,
  symbolicateStackTrace,
  isUnpeekError,
  type ProtectOptions,
  type ProtectSummary,
  type TransformOptions,
  type TransformResult,
  type UnpeekDiagnostic,
  type UnpeekProfile,
} from "unpeek";

// 1. Transform a single JavaScript module in memory
const result: TransformResult = transformJavaScript(sourceCode, {
  seed: 0x10b981,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: "passive",
  aggressive: true,
  scrubPaths: true,
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.virtualizedFunctionsCount);

// 2. Protect an entire framework build directory
const summary: ProtectSummary = await protectProject({
  cwd: process.cwd(),
  profile: "recommended",
  keepPrivateMaps: true,
  privateMapsDir: ".unpeek-maps",
  deterrentMode: "passive",
  aggressive: false,
});`,
              },
            ],
          },
          {
            title: "Configuration Schema & Options (UnpeekConfig)",
            body: [
              "The `UnpeekConfig` interface governs build heuristics, string encryption boundaries, symbol mangling rules, and source map storage. Configurations are resolved in hierarchical precedence: CLI flags > programmatic options > discovered config file > preset profile (`PRESETS`).",
              "Config files are automatically discovered across `unpeek.config.js`, `unpeek.config.mjs`, `unpeek.config.cjs`, and `unpeek.config.json` (or `unpeek.config.ts` with TypeScript loaders).",
            ],
            bullets: [
              "`seed` / `filter`: Set a finite numeric `seed` for deterministic polymorphic output and `filter.include` / `filter.exclude` glob patterns evaluated in both CLI `scanClientBundles` and `unplugin`.",
              "`hotPath`: Configure `customAnimationCalls` (e.g. `['requestAnimationFrame', 'useFrame']`), `customHooks` (e.g. `['useSpring', 'useGesture']`), `arrayHofMethods`, `hocWrappers`, and `maxPipelineCallers` (default `2`) for transitive exemption.",
              "`vault`: Configure `minStringLength` (default `4`), `cssFramework` (`'tailwind'` | `'unocss'` | `'none'`), `customDirectives`, `reservedProps`, `semanticAnchors`, `polymorphicDecoys` (default `true`), and `fragmented` / `fragmentCount`.",
              "`critical` / `tier` / `coldFlow`: Select `'Tier 1' | 'Tier 2' | 'Tier 3'`, toggle `coldFlow`, and target `/*! @unpeek-critical */` annotations (including via Source Map v3 when bundlers strip comments) or `critical.include` patterns (up to `maxFunctionsPerChunk`, default `12`).",
              "`shield`: Configure `deterrentMode` (`'passive'` | `'gradual'`) and `detectHeadless` (`navigator.webdriver`, `HeadlessChrome`, `__playwright`, `__puppeteer_evaluation_script__`, `__nightmare`, `frida`, `_frida_`, also reported in the CLI `shield` summary row and `ProtectSummary`).",
              "`mangler`: Set `minLength` (default `1` across presets) plus `reservedIdentifiers`, `excludePrefixes`, and `excludePatterns` (RegExp array) to protect critical runtime globals.",
              "`scrubPaths`: Strip local filesystem paths (`rootDir`, `[project]/`, `webpack://`, Windows `C:\\`) and residual dev metadata (CWE-540).",
              "`next` / `vite`: Specify `next.distDir` for custom Next.js output directories, or `vite.outDir` / `vite.assetsDir` for custom Vite distributions.",
            ],
            codeBlocks: [
              {
                label: "unpeek.config.ts: Complete Schema Example",
                language: "typescript",
                code: `import { defineConfig, type UnpeekConfig } from "unpeek";

export default defineConfig({
  target: "browser",
  seed: 0x42f00d,
  filter: {
    include: [],
    exclude: ["node_modules/**", "**/*.test.*", "**/*.spec.*"],
  },
  hotPath: {
    customAnimationCalls: ["requestAnimationFrame", "useFrame"],
    customHooks: ["useSpring", "useGesture"],
    arrayHofMethods: ["map", "filter", "forEach", "reduce"],
    maxPipelineCallers: 2,
  },
  vault: {
    minStringLength: 4,
    cssFramework: "tailwind",
    semanticAnchors: {
      excludeUiClasses: true,
    },
    polymorphicDecoys: true,
  },
  shield: {
    deterrentMode: "passive",
    detectHeadless: false,
  },
  mangler: {
    reservedIdentifiers: ["__NEXT_DATA__", "process"],
    excludePrefixes: ["$$"],
  },
  sourcemaps: {
    keepPrivate: true,
    vaultDir: ".unpeek-maps",
    stripComments: true,
  },
  next: {
    distDir: ".next",
  },
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
          "What Tier 2 (recommended) and Tier 3 (--aggressive) buy you, what they do not, and how synchronous attestation behaves.",
        subsections: [
          {
            title: "Threat model",
            body: [
              "unpeek raises the cost of reading a client bundle. String literals move into 92-char zero-escape or 64-bit call-site salted vaults, local bindings take compact `minLength: 1` polymorphic names, and cold functions receive `>=4`-var Rivest MBA QNR predicates or 43-opcode Micro-VM v2 bytecode compilation under `--aggressive` / `--profile strict`.",
              "It is not a cryptographic boundary. Any code the browser can execute can be executed by anyone who receives it. Treat the output as a deterrent against casual inspection and automated AST solvers, not as a secret store.",
            ],
            bullets: [
              "Do not ship API keys, signing salts, or private tokens in client code. The vault obfuscates and relocates them; it cannot stop a live runtime observer.",
              "Keep authorization decisions on the server. A protected bundle is still not a trusted place for them.",
              "Pin `--seed` in CI so repeated builds produce identical output and diffs stay reviewable.",
            ],
          },
          {
            title: "Order-independent shield & defense tiers",
            body: [
              "The injected entry shield hashes its own source via `Function.prototype.toString()` with `Reflect.apply` descriptor checks and writes `globalThis[sym]` safely across browsers and `WorkerGlobalScope`, without poisoning async split chunks that execute early.",
              "`--passive` dispatches `CustomEvent('unpeek:tamper')` without mutating `console`, while `deterrentMode: 'gradual'` fails closed and quiets console inspection. Add `--aggressive` or `--profile strict` when high-value `@unpeek-critical` enclaves justify Micro-VM v2 execution and singleton host-coupled WASM KDF.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Tiers & shield modes",
                language: "bash",
                code: `# Tier 2 default profile (deterministic seed)
unpeek protect --seed 0x7f4a2c

# Tier 3 strict / aggressive profile (Micro-VM v2 + WASM KDF + salted vault)
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
      version: "v4.2.0",
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
      metaRight: "v1.13.0 / MIT / npm",
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
        { label: "soğuk yol", value: "92-karakter / 64-bit kasa + Rivest MBA" },
        { label: "bütünlük", value: "sıra-bağımsız globalThis + konak WASM" },
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
      coldTitle: "Soğuk yol ve Tier 3 @unpeek-critical kalesi",
      coldBody:
        "Doğrulama, ödeme, API istemcileri ve WebGPU gölgelendiricileri. Tier 2 92 karakterli kaçışsız O(1) kasa, >=4-değişkenli yarı-lineer MBA + derece-3 Rivest QNR koruyucuları ve yerinde şifrelenen Uint8Array shader kasası uygular; Tier 3 / --aggressive ise 43-komutlu Micro-VM v2 ve paylaşımlı <1.2 KB konak-bağlı WASM KDF ekler.",
      stages: [
        { step: "01", title: "Ayrıştır", detail: "Acorn her istemci paketi için AST kurar. Sunucu çıktısı hiç açılmaz." },
        { step: "02", title: "Sınıflandır", detail: "3 katmanlı graf TRUE_HOT_60FPS, SHALLOW_RENDER_COMPONENT ve SERIALIZED_WORKER ayırır." },
        { step: "03", title: "Koru", detail: "Soğuk yollar >=4-değişkenli MBA, Rivest Z_2^32 QNR koşulları ve nötr tuzak köprüleri alır." },
        { step: "04", title: "Kasa & VM", detail: "92-karakter / 64-bit tuzlu kasa + Uint8Array shader kasası (--aggressive: 43-komut Micro-VM v2 + tekil WASM)." },
        { step: "05", title: "Mühürle", detail: "Sıra-bağımsız globalThis kalkanı bütünlüğü doğrular; çok geçişli haritalar .unpeek-maps/ içine alınır." },
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
        { metric: "Gzip paket artışı", value: "%4 ile %8 arası (Tier 1/2)", where: "src/core/protect.ts" },
        { metric: "Soğuk fonksiyon dönüşümü", value: "Rivest MBA + 43-komut Micro-VM v2", where: "src/ast" },
        { metric: "Shader & WebGPU kasası", value: "yerinde yeniden şifrelenen Uint8Array", where: "src/ast/string-vault.ts" },
        { metric: "Çalışma zamanı kalkanı", value: "sıra-bağımsız globalThis + <1.2 KB WASM", where: "src/runtime & wasm-vault.ts" },
        { metric: "İstemci paketi kapsamı", value: "yalnızca statik paketler (Worker ayrı)", where: "src/core/detector.ts" },
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
          unpeek: "Sıra-bağımsız globalThis + tekil WASM",
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

#   ▛▀▀▜  unpeek 1.12.0
#   ▙▄▄▟  client bundle protection
#
#   PROJECT ──────────────────────────────────────
#   framework            next
#   postbuild            unpeek protect (added)
#   vault                .unpeek-maps/ (added)
#
#   postbuild wired. maps stay private from the first build.
#   run your build to protect the first bundle.`,
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

#   ▛▀▀▜  unpeek 1.12.0
#   ▙▄▄▟  client bundle protection
#
#   PROJECT ──────────────────────────────────────
#   framework            next
#   tier                 Tier 2 (recommended: string vault & cold-flow)
#   shield               passive (detectHeadless: off)
#   output               .next/static/chunks
#   bundles              18
#
#   CALL GRAPH ───────────────────────────────────
#   hot path exempt      24  0% tax
#   cold path protected  61
#
#   TRANSFORM ────────────────────────────────────
#   string vault         312 literals  O(1) memo
#   symbol mangling      489 bindings
#
#   OUTPUT ───────────────────────────────────────
#   source maps          18 moved -> .unpeek-maps/
#   gzip                 284.12 KB -> 302.36 KB  +6.42%
#   elapsed              142 ms
#
#   done. maps are private. hot path untouched.`,
              },
            ],
          },
          {
            title: "Proje Yapılandırması: unpeek.config.ts (defineConfig)",
            body: [
              "unpeek, otomatik çatı tespiti (framework detection) sayesinde varsayılan olarak sıfır yapılandırmayla (zero-config) çalışır. Sıcak yol (hot path) sezgilerini özelleştirmek, metin kasası (string vault) sınırlarını belirlemek veya kaynak haritası (source map) klasörünü yapılandırmak için proje kök dizinine `unpeek.config.ts` (ya da `.js`, `.mjs`, `.cjs`, `.json`) dosyası ekleyebilirsiniz.",
              "TypeScript otomatik tamamlama (autocomplete) ve tip doğrulaması için `unpeek` paketinden `defineConfig` fonksiyonunu içe aktarın:",
            ],
            codeBlocks: [
              {
                label: "unpeek.config.ts: Yapılandırma Dosyası & Seçenekleri",
                language: "typescript",
                code: `import { defineConfig } from "unpeek";

export default defineConfig({
  // Opsiyonel deterministik 32-bit derleme tohumu (sonlu sayı)
  seed: 0x42f00d,
  // CLI scanClientBundles ve unplugin içinde uygulanan glob filtreleri
  filter: {
    include: [],
    exclude: ["node_modules/**", "**/*.test.*", "**/*.spec.*"],
  },
  // Sıcak yol sezgileri & çağrıcı yayılım muafiyetleri
  hotPath: {
    customAnimationCalls: ["requestAnimationFrame", "useFrame"],
    customHooks: ["useSpring", "useGesture"],
    maxPipelineCallers: 2,
  },
  // O(1) metin kasası & sözdizimi gürültü filtreleri
  vault: {
    minStringLength: 4,
    cssFramework: "tailwind",
    polymorphicDecoys: true,
  },
  // Çalışma zamanı anti-tamper kalkan seçenekleri
  shield: {
    deterrentMode: "passive",
    detectHeadless: false,
  },
  // Sözcüksel bağlama & sembol karmaşıklaştırma kuralları
  mangler: {
    reservedIdentifiers: ["__NEXT_DATA__", "process"],
  },
  // Özel kaynak haritası çıkarma kasası
  sourcemaps: {
    keepPrivate: true,
    vaultDir: ".unpeek-maps",
  },
});`,
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
              "Next.js projelerinde unpeek yalnızca `.next/static/chunks` dizinini hedef alır (`.next/static` boşsa `.vercel/output/static/_next/static` yoluna geçer, `.next/build-manifest.json` girişlerini okur ve `globalThis.TURBOPACK.push` başlıklarını seçici olarak muaf tutup modül fabrika gövdelerini korur), `.next/server` klasörüne kesinlikle dokunmaz. Tarayıcı ve Worker bağlamlarında asenkron yüklenen parçalar giriş kalkanından önce çalışsa bile zehirlenmeden düzgün çözülür.",
              "Hem `postbuild` CLI kullanımı hem de `unpeek/next` Build Adapter (`withUnpeek` / `createUnpeekNextAdapter` — üretim derlemelerinde Vercel değişmez chunk hash çakışmalarını önlemek için deterministik `outputHashSalt` enjekte eder) tam desteklenir.",
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
    "unpeek": "^1.12.0"
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
          deterrentMode: "passive",
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
              "Vite uygulamalarında `unpeek/vite`, esbuild küçültmesi sonrasındaki `enforce: 'post'` `generateBundle` kancasında çalışır ve Web Worker paketleri için `worker.plugins` ayarını otomatik bağlar.",
            ],
            codeBlocks: [
              {
                label: "vite.config.ts: Doğrudan Vite Eklenti Entegrasyonu",
                language: "typescript",
                code: `import { defineConfig } from "vite";
import unpeek from "unpeek/vite";

export default defineConfig({
  build: {
    sourcemap: true, // Postbuild aşamasında .unpeek-maps/ kasasına taşınır
  },
  plugins: [
    unpeek({
      seed: 0x9fa21b,
      minStringLength: 4,
      injectRuntimeShield: true,
      deterrentMode: "passive",
    }),
  ],
});`,
              },
            ],
          },
          {
            title: "Webpack, Rspack & Vanilla JS Hedefleri",
            body: [
              "Webpack 5 ve Rspack eklentileri `processAssets` (`PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE`) aşamasına bağlanır; esbuild `build.onEnd` (`write: false` ve `write: true`) üzerinde çalışır ve Rollup `renderChunk` içinde hash yer tutucularını yönetir. Service Worker (`sw.js`) ve Web Worker (`*.worker.js`) dosyaları `target: 'worker'` belirtilmedikçe varsayılan olarak ayrı tutulur.",
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
        title: "Üç Katmanlı Mimari & 3 Kademeli Hot-Path Motoru",
        summary:
          "3 katmanlı çağrı grafiği muafiyeti, 92-karakter / 64-bit tuzlu kasalar, >=4-değişkenli Rivest MBA + QNR koruyucuları, sıra-bağımsız globalThis kalkanı ve Tier 3 Micro-VM v2 + tekil <1.2 KB konak-bağlı WASM KDF mimarisi.",
        subsections: [
          {
            title: "3 Katmanlı Çağrı Grafiği Muafiyeti (TRUE_HOT_60FPS / Sığ Render / Worker)",
            body: [
              "unpeek tek bir token yazmadan önce her fonksiyon kapsamını üç sınıfa ayırır; böylece kare bütçesi ve SSR hidrasyonu korunurken olay işleyicileri soğuk korumaya alınır:",
            ],
            bullets: [
              "`TRUE_HOT_60FPS`: Döngüler (`for`, `while`, `do...while`, `for...in`, `for...of`), `requestAnimationFrame`, Three.js `useFrame` kancaları ve döngü içi dizi geri çağrıları çift yönlü çağrı grafiği muafiyetini korur.",
              "`SHALLOW_RENDER_COMPONENT`: Açık bir JSX (`createElement`/`_jsx`/`_jsxs`/`jsxDEV`), kanca (`use*`) veya HOC (`memo`/`forwardRef`) UI sinyali taşıyan PascalCase bileşenlerin doğrudan render gövdesi 60fps ve SSR uyumu için sıcak bırakılır; UI dışı PascalCase yardımcılar ile iç `async` olay işleyicileri (`onSubmit`, `handleSave`) korumalı soğuk yola aktarılır; Source Map v3 `sourcesContent`/`names` ve VLQ eşlemeleri (`sourcemap-critical.ts`) paketleyiciler yorumları temizlediğinde bile `/*! @unpeek-critical */` ve `critical.include` hedeflemesini korur.",
              "`SERIALIZED_WORKER`: `.toString()`, `importScripts()` veya `onmessage` kullanan Web Worker fabrikaları çalışma zamanı serileştirme hatası olmaması için olduğu gibi bırakılır.",
            ],
          },
          {
            title: "Kaçışsız 92-Karakter Kasa, Gürültü Filtresi & Yerinde Shader Kasası",
            body: [
              "Tier 2 (`recommended`, varsayılan) içinde soğuk string'ler (`>= minStringLength`, varsayılan `4`), enterpolasyonlu `TemplateLiteral` ifadelerindeki statik parçalar (`ToPrimitive(\"string\")` sırası korunarak; etiketli şablonlar, dinamik `import()` ve sıcak yollar muaf tutulur) ve `secret-patterns.ts` ile tespit edilip `new RegExp(vault(...), flags)` biçimine alınan sır taşıyan `RegExp` değişmezleri (döngüler ve `RegExp`-gölgeli/`with` kapsamları dışında) SVG yol verisini ve Tailwind sınıf zincirlerini muaf tutan gürültü filtresinden geçer; ardından `\\u00xx` kaçışı üretmeyen, LZ77/Gzip sıkıştırmasını koruyan 92 karakterli involutory ASCII permütasyonu (`P[P[c]] == c`) ile kodlanır.",
              "Doğrudan döngüler dışındaki büyük şablon metinleri ve GPU shader blokları (`>= 256 B` veya WebGPU `@vgpu/wgsl` / GLSL imzaları; evrensel ikili/Base64 WASM `AGFzbQE`, ikili `data:` URI'ları ve büyük saf Base64 blokları muaf tutularak) hem Tier 2 (`recommended`) hem Tier 3 (`strict` / `--aggressive`) modlarında kalkanla eşleşen (shield-coupled), XOR şifreli `Uint8Array` tamponunda tutulur; `TextDecoder` ile yerinde çözülüp `finally` bloğunda anında yeniden şifrelenerek React StrictMode uyumu sağlar.",
            ],
          },
          {
            title: "Sıra-Bağımsız Kalkan ve Non-Lineer Rivest MBA Koruyucuları",
            body: [
              "Giriş paketleri, tek satırlık (`<2.3 KB`), `WorkerGlobalScope` uyumlu (`self`/`globalThis`) FNV-1a bütünlük IIFE'i ile `Function.prototype.toString()`, `Reflect.apply`, `Error.prepareStackTrace` ve `Error.prototype.stack` tanımlayıcı, doğal imza, çapraz çağrı ve V8 yığın izi `Proxy` tuzak kontrollerini çalıştırır ve `detectHeadless: true` etkinken `navigator.webdriver`, `HeadlessChrome`, `__playwright`, `__puppeteer_evaluation_script__`, `__nightmare`, `frida` ve `_frida_` işaretçilerini senkron denetler. `sv === void 0` için asenkron tolerans yalnızca yüklenmekte olan gerçek DOM (`document.scripts.length > 0 && document.readyState !== 'complete'`) veya Web Worker (`self.importScripts`) bağlamlarıyla sınırlandırılıp önbelleği zehirlemeden (`d = -1` kaldırıldı) çözülür; çıplak tarayıcı-dışı VM bağlamları (`node:vm`, boş `{}`), kalkanı eksik tamamlanmış belgeler ve aktif kurcalamalar kapalı başarısız olur.",
              "Soğuk fonksiyonlar (`coldFlow: true`); `Object.create(null)`, `Symbol` ve `BigInt` girdilerinde tip güvenli `>=4`-değişkenli yarı-lineer MBA koşullarını derece-3 Rivest $\\mathbb{Z}_{2^{32}}$ permütasyon polinomları, 256-girişli tohum S-Box'ı, sabit `=== R` soneki taşımayan 6 durum-, kalkan- ve alan-bağlı koşul biçimi (Form 4 işaretsiz-alan MBA eşitsizliği ve `modInverseUint32` tabanlı Form 5 parametrik afin ters MBA özdeşliği dahil) ve 4 farklı modüler QNR rezidü ailesi ($\\pmod 4, \\pmod 8, \\pmod{16}$) + alias tablosu karıştırması ve kaynak değişken adı sızdırmayan nötr tuzak köprüleriyle birleştirir; `strict` / `--aggressive` modlarında `applyColdBitwiseMba`, parça başına en fazla 8 soğuk-yol `^`/`|`/`&` ifadesini `BigInt`, `with` ve `Math` gölgeleme kontrolü altında `typeof` korumalı afin MBA ile değiştirir.",
            ],
          },
          {
            title: "Tier 3 Derinlemesine: Micro-VM v2, Tekil Konak-Bağlı WASM KDF ve 64-Bit Kasa",
            body: [
              "`--aggressive` veya `--profile strict` etkinleştirildiğinde unpeek, `@unpeek-critical` işaretli fonksiyonları ve kritik form/doğrulama/yetki işleyicilerini öncelik puanıyla `maxFunctionsPerChunk` kotasına alır (sanallaştırılmış gövdelere çift `coldFlow` eklemez) ve katı CSP kurallarını bozmadan Tier 3 kalesiyle korur:",
            ],
            bullets: [
              "`Bytecode Micro-VM v2 (43 Komut)`: Pre-VM düşürmesiyle `&&`/`||`/`??`, `?:`, `for`/`while`/`do..while`, `try`/`throw`, `this`, `new`, `obj.arguments` ve kapanışları `[8, 400]` AST düğüm penceresinde `globalThis` üzerinde paylaşılan tekil `$step` trambolini, bloklar arası `$f.ac` çarkı, `(seed, op)` başına sıfır-olmayan semantik handler sapmaları (`1..31`), 32-bit `sym_s[1]` (`expectedStateHash`) doğrulaması, ölü post-`RET` epilog budaması ve `_uVm*` formatlama öz-karmasıyla çalıştırır (`eval()` veya `new Function()` yok).",
              "`Tekil Konak-Bağlı WASM KDF (<1.2 KB)`: Maskeli `env.g`/`env.m` konak kancaları (`gMask`, `pcMask`) üzerinde tohumdan türetilmiş 2–3 karakterli polimorfik içe/dışa aktarım ABI adları ve karıştırılmış export sırasıyla (`deriveWasmAbiNames`) `<512 B` boyutunda WebAssembly ikilisi sentezler ve ayrık parçalar arasında tek bir `globalThis` yuvasında paylaşır; CSP WebAssembly'i engellerse bit-özdeş non-lineer Rivest + S-Box JavaScript yedeğine geçer.",
              "`64-Bit Çağrı-Noktası Tuzlu Kasa`: Sıralı sayaçlar yerine 64-bit karıştırmadan türetilen 31-bit tuzlar (`_uD(stringIndex, callSiteSalt)`) kullanarak metin sabitlerini, enterpolasyonlu şablon parçalarını ve sır taşıyan `RegExp` değişmezlerini React 19 Eşzamanlı Mod ve StrictMode altında tam idempotent çözer.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Tier 3 Strict / Agresif Koruma Çağrısı",
                language: "bash",
                code: `# Tier 3 Bytecode Micro-VM v2 & tekil konak-bağlı WASM KDF'i etkinleştirin
npx unpeek protect --aggressive --seed 0x7f4a2c

#   ▛▀▀▜  unpeek 1.12.0
#   ▙▄▄▟  client bundle protection
#
#   PROJECT ──────────────────────────────────────
#   framework            next
#   tier                 Tier 3 (strict / --aggressive: Micro-VM & WASM KDF)
#   shield               passive (detectHeadless: off)
#   output               .next/static/chunks
#   bundles              18
#
#   CALL GRAPH ───────────────────────────────────
#   hot path exempt      24  0% tax
#   cold path protected  61
#
#   TRANSFORM ────────────────────────────────────
#   string vault         312 literals  O(1) memo
#   symbol mangling      489 bindings
#
#   OUTPUT ───────────────────────────────────────
#   source maps          18 moved -> .unpeek-maps/
#   gzip                 284.12 KB -> 316.50 KB  +11.39%
#   elapsed              186 ms
#
#   done. maps are private. hot path untouched.`,
              },
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
              "Hedef derleme dizinindeki tüm `*.map` dosyalarını tarar ve ECMA-426 `.sections` indeks haritalarını otomatik düzleştirir.",
              "Ön ek satır kaydırmalı çok geçişli $M_1 \\circ M_2$ VLQ bileşimini (`chainSourceMaps`) hesaplar; URL kodlu Next.js parçalarını (`%28public%29`, `%5Bsayi%5D`) ve Windows yollarını çözer.",
              "`keepPrivateMaps: true` iken (önceden `debugId` bulunmasa bile) korumalı JS paketine ve `.unpeek-maps/` kasasındaki `.map` dosyasına otomatik olarak aynı deterministik SHA-256 `debugId` imzasını basar (`unpeek check` `debugid-mismatch` kuralıyla doğrular), paketleyiciler yorumları temizlediğinde `/*! @unpeek-critical */` Source Map v3 hedeflerini çözümler ve `//# sourceMappingURL=...` direktiflerini temizler.",
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
          {
            title: "Docker İmaj Güvenliği & .dockerignore Uyarısı",
            body: [
              "`COPY . .` komutu kullanılan Docker derlemelerinde `.dockerignore` dosyası bulunmadığında veya `.unpeek-maps/` kuralı eksik olduğunda, gizli hata ayıklama sembolleri istem dışı olarak herkese açık Docker imaj katmanlarına sızabilir.",
              "`unpeek protect` çalıştığında mevcut `.dockerignore` dosyasını otomatik olarak `.unpeek-maps/` ile günceller. Eğer `.dockerignore` bulunmuyorsa veya kural eksikse unpeek açık bir advisory uyarısı verir:",
            ],
            bullets: [
              "`[unpeek:advisory] .dockerignore is missing .unpeek-maps/. Private maps may leak into Docker image during 'COPY . .'.`",
              "Docker konteyner imajlarını yayınlamadan önce `.unpeek-maps/` dizininin hem `.gitignore` hem de `.dockerignore` içinde yer aldığından emin olun.",
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
            title: "CLI Komutları & Savunma Kademeleri (Tier 1 / Tier 2 / Tier 3)",
            body: [
              "`unpeek` komut satırı aracı `init`, `protect`, `check` ve `symbolicate` komutlarını üç savunma kademesiyle sunar:",
              "Tier 1 (`--profile minimal`): `coldFlow: false`, `mangler.minLength: 1`, sıcak yol muafiyeti ve sıra-bağımsız `globalThis` kalkanıyla hızlı temel koruma (<%2 CPU, <%15 Gzip).",
              "Tier 2 (`--profile recommended` / Varsayılan): 92-karakter kaçışsız metin kasası (enterpolasyonlu `TemplateLiteral` statik parçaları ve sır taşıyan `RegExp` değişmezleri dahil), `>=4`-değişkenli yarı-lineer MBA + derece-3 Rivest QNR ile Form 4/5 işaretsiz/afin ters MBA koruması ve yerinde `Uint8Array` shader kasası ekler.",
              "Tier 3 (`--profile strict` / `--aggressive`): `@unpeek-critical` kalelerini ve `critical.include` desenlerini 43-komutlu Micro-VM v2, paylaşımlı `<1.2 KB` konak-bağlı WASM KDF (`deriveWasmAbiNames` polimorfik ABI + karıştırılmış export sırası `<512 B`), 64-bit çağrı-noktası tuzlu kasa, soğuk-yol `^`/`|`/`&` afin bit düzeyinde MBA (`applyColdBitwiseMba`, en fazla 8/parça) ve CWE-540 yol temizliğiyle korur.",
            ],
            codeBlocks: [
              {
                label: "CLI Referansı",
                language: "bash",
                code: `  ▛▀▀▜  unpeek 3.0.0
  ▙▄▄▟  client bundle protection

  Usage:
    unpeek init [--dry-run] [--profile <name>]   wire postbuild and the .unpeek-maps/ vault
    unpeek protect [options]                     protect client bundles in place (Tier 2 default: <2% CPU, <15% Gzip)
    unpeek check [options]                       read-only CI gate for leaks, ignores, budget, CSP, and plaintext secrets
    unpeek symbolicate [options]                 resolve stack traces locally using .unpeek-maps/

  Options (protect):
    --profile <name>               preset profile: minimal | recommended | strict
    --dry-run                      compute transform & Gzip delta in memory without writing files
    --max-gzip-delta <num>         fail if Gzip delta exceeds percentage
    --out-dir <dir>                explicit client output directory
    --seed <number>                deterministic polymorphic seed
    --passive                      passive deterrent mode (default: marks tamper, keeps console)
    --gradual                      gradual deterrent mode (silences console on tamper)
    --detect-headless              treat webdriver/HeadlessChrome, Playwright, Puppeteer, Nightmare, and Frida markers as tamper
    --no-maps                      delete .map files instead of vaulting them
    --min-string-length <num>      minimum string length for the vault (default: 4)
    --private-maps-dir <dir>       vault directory (default: .unpeek-maps)
    --no-shield                    skip the runtime anti-tamper shield
    --aggressive                   enable Tier 3 strict protection (Micro-VM & WASM KDF)
    -h, --help                     show help
    -v, --version                  show version

  Options (check):
    --require-zero-eval            fail on unattributed/injected eval() or new Function() (warns on ES5 Function("return this"), node_modules maps & baseline)

  Tiers:
    Tier 1 (minimal)               call-graph hot-path exemption (<2% CPU, <15% Gzip)
    Tier 2 (recommended, default)  string vault & cold-flow protection (<2% CPU, <15% Gzip)
    Tier 3 (strict / --aggressive) zero plaintext exposure via Micro-VM & WASM KDF`,
              },
            ],
          },
          {
            title: "Programatik Node.js API & TypeScript Tipleri",
            body: [
              "Özel derleme hatları oluşturmak için `protectProject`, `transformJavaScript`, `checkProject`, `symbolicateStackTrace`, `PRESETS`, `isUnpeekError` veya bundler eklentilerini doğrudan `unpeek` paketinden içe aktarabilirsiniz. `checkProject(options)` ayrıca Acorn AST üzerinden `'plaintext-secret'` denetimi için (Shannon entropi, İngilizce bigram süzgeci ve sır taşıyan regex taraması ile maskelenmiş önizlemeler) `CheckOptions.failOnPlaintextSecrets` (`boolean`, varsayılan `false` -> `'warning'`) seçeneğini kabul eder.",
            ],
            codeBlocks: [
              {
                label: "TypeScript: Programatik Kullanım & Arayüzler",
                language: "typescript",
                code: `import {
  PRESETS,
  protectProject,
  transformJavaScript,
  checkProject,
  symbolicateStackTrace,
  isUnpeekError,
  type ProtectOptions,
  type ProtectSummary,
  type TransformOptions,
  type TransformResult,
  type UnpeekDiagnostic,
  type UnpeekProfile,
} from "unpeek";

// 1. Tek bir JavaScript modülünü bellek içinde dönüştürme
const result: TransformResult = transformJavaScript(sourceCode, {
  seed: 0x10b981,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: "passive",
  aggressive: true,
  scrubPaths: true,
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.virtualizedFunctionsCount);

// 2. Tüm framework çıktı dizinini koruma
const summary: ProtectSummary = await protectProject({
  cwd: process.cwd(),
  profile: "recommended",
  keepPrivateMaps: true,
  privateMapsDir: ".unpeek-maps",
  deterrentMode: "passive",
  aggressive: false,
});`,
              },
            ],
          },
          {
            title: "Yapılandırma Şeması & Seçenekleri (UnpeekConfig)",
            body: [
              "`UnpeekConfig` arayüzü; sıcak yol (hot-path) sezgileri, metin kasası (string vault) sınırları, sembol karmaşıklaştırma (mangler) kuralları ve kaynak haritası (source map) depolamasını yönetir. Ayarlar hiyerarşik öncelik sırasına göre çözümlenir: CLI bayrakları > programatik seçenekler > keşfedilen yapılandırma dosyası > hazır profil (`PRESETS`).",
              "Yapılandırma dosyaları `unpeek.config.js`, `unpeek.config.mjs`, `unpeek.config.cjs` ve `unpeek.config.json` (veya TypeScript yükleyicileriyle `unpeek.config.ts`) isimleriyle proje kökünde otomatik olarak aranır.",
            ],
            bullets: [
              "`seed` / `filter`: Deterministik polimorfik çıktı için sonlu sayısal `seed` ve hem CLI `scanClientBundles` hem `unplugin` içinde değerlendirilen `filter.include` / `filter.exclude` glob desenlerini belirler.",
              "`hotPath`: Geçişken muafiyet için `customAnimationCalls` (ör. `['requestAnimationFrame', 'useFrame']`), `customHooks` (ör. `['useSpring', 'useGesture']`), `arrayHofMethods`, `hocWrappers` ve `maxPipelineCallers` (varsayılan `2`) seçeneklerini belirler.",
              "`vault`: `minStringLength` (varsayılan `4`), `cssFramework` (`'tailwind'` | `'unocss'` | `'none'`), `customDirectives`, `reservedProps`, `semanticAnchors`, `polymorphicDecoys` (varsayılan `true`) ve `fragmented` / `fragmentCount` kurallarını yapılandırır.",
              "`critical` / `tier` / `coldFlow`: `'Tier 1' | 'Tier 2' | 'Tier 3'` katmanını seçer, `coldFlow` geçişini ayarlar ve (paketleyiciler yorumları temizlediğinde Source Map v3 üzerinden de çözümlenen) `/*! @unpeek-critical */` veya `critical.include` desenlerini hedefler (`maxFunctionsPerChunk` varsayılan: `12`).",
              "`shield`: `deterrentMode` (`'passive'` | `'gradual'`) ve `detectHeadless` (`navigator.webdriver`, `HeadlessChrome`, `__playwright`, `__puppeteer_evaluation_script__`, `__nightmare`, `frida`, `_frida_`) ayarlarını yapılandırır (CLI `shield` özet satırında ve `ProtectSummary` çıktısında da raporlanır).",
              "`mangler`: `minLength` (tüm hazır profillerde varsayılan `1`) ile `reservedIdentifiers`, `excludePrefixes` ve `excludePatterns` (RegExp dizisi) kurallarını tanımlar.",
              "`scrubPaths`: Yerel dosya sistemi yollarını (`rootDir`, `[project]/`, `webpack://`, Windows `C:\\`) ve artık geliştirme meta verilerini temizler (CWE-540).",
              "`next` / `vite`: Özel Next.js çıktı dizinleri için `next.distDir`, özel Vite dağıtımları için `vite.outDir` / `vite.assetsDir` geçersiz kılmalarını tanımlar.",
            ],
            codeBlocks: [
              {
                label: "unpeek.config.ts: Eksiksiz Şema Örneği",
                language: "typescript",
                code: `import { defineConfig, type UnpeekConfig } from "unpeek";

export default defineConfig({
  target: "browser",
  seed: 0x42f00d,
  filter: {
    include: [],
    exclude: ["node_modules/**", "**/*.test.*", "**/*.spec.*"],
  },
  hotPath: {
    customAnimationCalls: ["requestAnimationFrame", "useFrame"],
    customHooks: ["useSpring", "useGesture"],
    arrayHofMethods: ["map", "filter", "forEach", "reduce"],
    maxPipelineCallers: 2,
  },
  vault: {
    minStringLength: 4,
    cssFramework: "tailwind",
    semanticAnchors: {
      excludeUiClasses: true,
    },
    polymorphicDecoys: true,
  },
  shield: {
    deterrentMode: "passive",
    detectHeadless: false,
  },
  mangler: {
    reservedIdentifiers: ["__NEXT_DATA__", "process"],
    excludePrefixes: ["$$"],
  },
  sourcemaps: {
    keepPrivate: true,
    vaultDir: ".unpeek-maps",
    stripComments: true,
  },
  next: {
    distDir: ".next",
  },
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
          "Tier 2 (recommended) ve Tier 3 (--aggressive) dönüşümlerinin ne kazandırdığı, neyi kazandırmadığı ve senkron kalkan davranışı.",
        subsections: [
          {
            title: "Tehdit modeli",
            body: [
              "unpeek istemci paketini okumanın maliyetini yükseltir. String sabitleri 92-karakter kaçışsız veya 64-bit çağrı-noktası tuzlu kasalara taşınır, yerel bağlar `minLength: 1` kompakt polimorfik adlar alır ve soğuk fonksiyonlar `>=4`-değişkenli Rivest MBA QNR koruyucuları veya `--aggressive` / `--profile strict` ile 43-komutlu Micro-VM v2 baytkod derlemesi kazanır.",
              "Bu bir kriptografik sınır değildir. Tarayıcının çalıştırabildiği her kodu, onu teslim alan herkes çalıştırabilir. Çıktıyı gizli bilgi kasası değil, meraklı gözle bakmaya ve otomatik AST çözücülere karşı caydırıcı olarak değerlendirin.",
            ],
            bullets: [
              "API anahtarlarını, imzalama tuzlarını veya özel jetonları istemci kodunda göndermeyin. Kasa onları gizler ve taşır; çalışma zamanında gözlemlenmesini tek başına engelleyemez.",
              "Yetkilendirme kararlarını sunucuda tutun. Korumalı bir paket de bunun için güvenilir bir yer değildir.",
              "CI içinde `--seed` değerini sabitleyin; böylece tekrarlanan derlemeler aynı çıktıyı üretir ve farklar incelenebilir kalır.",
            ],
          },
          {
            title: "Sıra-bağımsız kalkan & koruma katmanları",
            body: [
              "Enjekte edilen kalkan `Function.prototype.toString()` ve `Reflect.apply` tanımlayıcı kontrolleriyle kendi kaynağını doğrular ve `globalThis[sym]` üzerine tarayıcı ile `WorkerGlobalScope` uyumlu biçimde yazar; erken çalışan asenkron parçaları zehirlemez.",
              "`--passive` yalnızca `CustomEvent('unpeek:tamper')` olayını tetiklerken, `deterrentMode: 'gradual'` kapalı başarısız olur ve konsolu susturur. Yüksek değerli `@unpeek-critical` kaleleri için Micro-VM v2 ve tekil konak-bağlı WASM KDF'i `--aggressive` veya `--profile strict` ile açın.",
            ],
            codeBlocks: [
              {
                label: "Terminal: Katmanlar & kalkan modları",
                language: "bash",
                code: `# Tier 2 varsayılan profil (deterministik tohum)
unpeek protect --seed 0x7f4a2c

# Tier 3 strict / agresif profil (Micro-VM v2 + WASM KDF + tuzlu kasa)
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
