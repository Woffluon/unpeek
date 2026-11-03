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

export interface PipelineStage {
  step: string;
  title: string;
  metric: string;
  description: string;
  detail: string;
}

export interface ComparisonRow {
  metric: string;
  unpeek: string;
  legacyObfuscator: string;
  plainMinifier: string;
}

export interface Dictionary {
  meta: {
    version: string;
    license: string;
  };
  nav: {
    architecture: string;
    benchmarks: string;
    docs: string;
    fullDocsPage: string;
    github: string;
  };
  hero: {
    eyebrow: string;
    headlineLine1: string;
    headlineLine2: string;
    subtext: string;
    initCmd: string;
    copyLabel: string;
    copiedLabel: string;
    primaryCta: string;
    codeTabs: {
      beforeLabel: string;
      afterLabel: string;
      statusBadge: string;
      hotPathNote: string;
      coldPathNote: string;
    };
  };
  metricsStrip: {
    items: {
      value: string;
      label: string;
      detail: string;
    }[];
  };
  architectureSection: {
    eyebrow: string;
    title: string;
    subtitle: string;
    stages: PipelineStage[];
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
  };
  docsHeader: {
    title: string;
    subtitle: string;
    sidebarTitle: string;
    onPageLabel: string;
    openStandaloneLabel: string;
    backToHomeLabel: string;
  };
  docsSections: DocSection[];
  footer: {
    tagline: string;
    links: {
      docs: string;
      github: string;
      npm: string;
    };
  };
}

export const CODE_SAMPLES = {
  before: `// src/client/telemetry-engine.ts
export function stepPhysicsFrame(particles: Float32Array, dt: number): void {
  // Hot path: runs at 60fps inside requestAnimationFrame
  for (let i = 0; i < particles.length; i += 4) {
    particles[i] += particles[i + 2] * dt;
    particles[i + 1] += particles[i + 3] * dt;
  }
}

export async function verifyWorkspaceLicense(token: string) {
  const endpoint = "https://licensing.internal.acme.dev/v2/verify";
  const secretSalt = "unpeek_prod_hmac_v2_99481a";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Workspace-Signature": secretSalt + ":" + token,
      "Content-Type": "application/json",
    },
  });
  return res.json();
}`,
  after: `// dist/assets/telemetry-engine.js (Protected by unpeek --seed 0x7f4a2c)
const _u0x3d = [
  [119,88,69,89,72,21,84,21,67,64,74,69,88,72,72,71,78,23,66,71],
  [92,71,89,78,78,66,118,89,91,70,77,118,65,68,72,74,118,95,25],
  [121,102,110,93,20,126,70,89,66,88,89,72,74,78,20,122,66,78,71]
];
const _u0x9c = new Map();
function _u0x1f(i, k) {
  if (_u0x9c.has(i)) return _u0x9c.get(i);
  const b = _u0x3d[i];
  let s = "";
  for (let j = 0; j < b.length; j++) s += String.fromCharCode(b[j] ^ ((k + j * 17) & 0xff));
  _u0x9c.set(i, s);
  return s;
}

// [unpeek] Hot-path exempted via call-graph analysis (0.0% CPU overhead)
export function stepPhysicsFrame(particles, dt) {
  for (let i = 0; i < particles.length; i += 4) {
    particles[i] += particles[i + 2] * dt;
    particles[i + 1] += particles[i + 3] * dt;
  }
}

// [unpeek] Cold-path protected: O(1) lazy vault + lexical mangling + FNV-1a guard
export async function verifyWorkspaceLicense(_0x4a1) {
  const _0x8b2 = _u0x1f(0, 0x1b);
  const _0x9c4 = _u0x1f(1, 0x1b);
  const _0x2e1 = await fetch(_0x8b2, {
    method: _u0x1f(2, 0x1b),
    headers: {
      [_u0x1f(3, 0x1b)]: _0x9c4 + ":" + _0x4a1,
      "Content-Type": "application/json",
    },
  });
  return _0x2e1.json();
}`,
};

export const DICTIONARY: Record<Locale, Dictionary> = {
  en: {
    meta: {
      version: "v1.0.1",
      license: "MIT Licensed",
    },
    nav: {
      architecture: "Architecture",
      benchmarks: "Benchmarks",
      docs: "Documentation",
      fullDocsPage: "Full Reference",
      github: "GitHub",
    },
    hero: {
      eyebrow: "AST-GUIDED CLIENT JS PROTECTION",
      headlineLine1: "Harden production bundles.",
      headlineLine2: "Never tax the hot path.",
      subtext:
        "Zero-config JavaScript protection with call-graph hot-path exemption, O(1) string vaults, and private source-map extraction.",
      initCmd: "npx unpeek init",
      copyLabel: "Copy",
      copiedLabel: "Copied",
      primaryCta: "Read Documentation",
      codeTabs: {
        beforeLabel: "Input (TypeScript / JS)",
        afterLabel: "Protected Output (unpeek)",
        statusBadge: "Hot-Path Exempted · <2% CPU",
        hotPathNote: "60fps loop detected & skipped automatically",
        coldPathNote: "Strings encrypted in O(1) lazy cache + FNV-1a shield",
      },
    },
    metricsStrip: {
      items: [
        {
          value: "< 2%",
          label: "Hot-Path CPU Overhead",
          detail: "Loops, rAF callbacks, and Canvas/WebGL renderers are automatically exempted via static call-graph analysis.",
        },
        {
          value: "< 15%",
          label: "Gzip Bundle Size Delta",
          detail: "Compact byte tables and shared O(1) memoized string decoders keep network transfer budgets predictable.",
        },
        {
          value: "0 LOC",
          label: "Application Code Changes",
          detail: "Drop-in postbuild CLI or unplugin integration for Next.js, Vite, Webpack, and Vanilla JS outputs.",
        },
        {
          value: "100%",
          label: "Source Map Isolation",
          detail: "Extracts .map files into .unpeek-maps/ and strips sourceMappingURL comments from public assets.",
        },
      ],
    },
    architectureSection: {
      eyebrow: "COMPILER PIPELINE",
      title: "Engineered around runtime budgets, not blind AST bloat.",
      subtitle:
        "Traditional obfuscators wrap every expression in recursive state machines, tanking frame rates by 300-800%. unpeek models your call graph first and protects only what stays off the hot path.",
      stages: [
        {
          step: "STAGE 01",
          title: "Acorn AST & Call-Graph Construction",
          metric: "ECMA-2022 Module Parse",
          description:
            "Parses emitted client chunks into an Abstract Syntax Tree and builds an intra-module call graph mapping every function declaration, arrow expression, and method invocation.",
          detail: "Identifies entry points, exported symbols, and lexical scopes before touching a single token.",
        },
        {
          step: "STAGE 02",
          title: "Transitive Hot-Path Exemption",
          metric: "0% Loop Penalty",
          description:
            "Detects functions containing tight loops (for, while, do-while), requestAnimationFrame hooks, and high-frequency timers, then propagates hot status transitively to their callees.",
          detail: "Hot functions and the helpers they call are left untouched so V8/JavaScriptCore JIT inline caches remain optimal.",
        },
        {
          step: "STAGE 03",
          title: "Polymorphic String Vault & Lexical Mangling",
          metric: "O(1) Memoized Decode",
          description:
            "Extracts cold-path string literals into a polymorphic XOR/ADD/ROL byte array keyed by a per-build seed. First access decodes and caches into a Map; subsequent reads are O(1).",
          detail: "Simultaneously renames cold-path local bindings and parameters without breaking exported APIs or object properties.",
        },
        {
          step: "STAGE 04",
          title: "Source Map Vault & FNV-1a Integrity Shield",
          metric: "32-bit FNV-1a Checksum",
          description:
            "Relocates .js.map files into a private .unpeek-maps/ vault, strips //# sourceMappingURL directives, and injects a lightweight FNV-1a self-checksum and DevTools timing detector.",
          detail: "Supports gradual degradation or passive telemetry modes when beautification or tampering is detected.",
        },
      ],
    },
    comparisonSection: {
      title: "Measured against legacy obfuscation",
      subtitle:
        "Verified across production Next.js and Vite bundles using packages/unpeek/benchmarks/run.ts.",
      columns: {
        metric: "Engineering Dimension",
        unpeek: "unpeek (Default Profile)",
        legacy: "Legacy Obfuscator (High Preset)",
        minifier: "Standard Minifier (Terser / SWC)",
      },
      rows: [
        {
          metric: "Hot-Path Loop / Render CPU Overhead",
          unpeek: "< 2% (Auto-exempted via Call Graph)",
          legacyObfuscator: "+300% to +850% (JIT deoptimization)",
          plainMinifier: "0% (Baseline)",
        },
        {
          metric: "Gzipped Bundle Size Delta",
          unpeek: "+4% to +14% (<15% strict budget)",
          legacyObfuscator: "+120% to +340% (Control-flow bloat)",
          plainMinifier: "0% (Baseline)",
        },
        {
          metric: "String Literal Decoding Complexity",
          unpeek: "O(1) Lazy Map Memoization",
          legacyObfuscator: "O(N) Repeated RC4 / Base64 per call",
          plainMinifier: "Plaintext strings in bundle",
        },
        {
          metric: "Public Source Map Leak Prevention",
          unpeek: "Automated .unpeek-maps/ Vault + URL Strip",
          legacyObfuscator: "Manual configuration required",
          plainMinifier: "Often deployed alongside chunks by default",
        },
        {
          metric: "Runtime Self-Integrity Verification",
          unpeek: "32-bit FNV-1a Checksum + Gradual Deterrent",
          legacyObfuscator: "Heavy regex self-defending (breaks strict CSP)",
          plainMinifier: "None",
        },
      ],
    },
    docsHeader: {
      title: "Technical Documentation",
      subtitle:
        "Complete reference for CLI workflows, framework integrations, hot-path heuristics, source map vaults, programmatic APIs, and AI agent skills.",
      sidebarTitle: "Documentation Sections",
      onPageLabel: "Section Reference",
      openStandaloneLabel: "Open Dedicated /docs View",
      backToHomeLabel: "Back to Launch Overview",
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
                label: "Terminal — Interactive / Zero-Config Init",
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
                label: "Terminal — Postbuild Protection & Summary",
                language: "bash",
                code: `# Run manually or via npm/pnpm postbuild
npx unpeek protect --seed 482910 --deterrent gradual

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
              "Both `postbuild` CLI execution and the `unpeek/webpack` plugin are supported.",
            ],
            codeBlocks: [
              {
                label: "package.json — Recommended Next.js Postbuild Setup",
                language: "json",
                code: `{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "postbuild": "unpeek protect"
  },
  "devDependencies": {
    "unpeek": "^0.1.0"
  }
}`,
              },
            ],
          },
          {
            title: "Vite & Rollup (CLI or unplugin)",
            body: [
              "For Vite applications, unpeek automatically detects the `dist/` output directory. If you prefer in-memory bundle transformation during the Vite build phase rather than a postbuild pass, use the first-class `unpeek/vite` plugin.",
            ],
            codeBlocks: [
              {
                label: "vite.config.ts — Native Vite Plugin Integration",
                language: "typescript",
                code: `import { defineConfig } from "vite";
import { viteUnpeekPlugin } from "unpeek";

export default defineConfig({
  build: {
    sourcemap: true, // Extracted to .unpeek-maps/ during postbuild
  },
  plugins: [
    viteUnpeekPlugin({
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
              "For Webpack 5 builds, import `webpackUnpeekPlugin` from `unpeek` or pass `--out-dir build/static/js` to the CLI. For Vanilla JS projects, point `--out-dir` to your public asset folder.",
            ],
            codeBlocks: [
              {
                label: "webpack.config.js — Webpack Plugin",
                language: "javascript",
                code: `import { webpackUnpeekPlugin } from "unpeek";

export default {
  mode: "production",
  plugins: [
    webpackUnpeekPlugin({
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
          "Deep dive into how unpeek achieves <2% CPU overhead through static call-graph analysis, O(1) lazy string vaults, and FNV-1a integrity verification.",
        subsections: [
          {
            title: "Static Call-Graph & Transitive Hot-Path Exemption",
            body: [
              "Why do traditional JavaScript obfuscators ruin application responsiveness? Because they blindly transform every AST node—turning a 60fps animation loop or virtual DOM diffing helper into thousands of string-array lookups and switch-case state machines.",
              "unpeek solves this by constructing a static call graph of every module before applying any transformation:",
            ],
            bullets: [
              "Direct Hot Detection: Any function containing `for`, `while`, `do...while`, `for...in`, or `for...of` loops, or invoking `requestAnimationFrame`, `setInterval`, or typed-array math is flagged as directly hot.",
              "Transitive Propagation: If Function A is flagged as hot and calls Function B inside its body, Function B is transitively marked hot across the call graph.",
              "Zero-Overhead Bypass: All hot-marked functions bypass string encryption and control mutations completely, preserving native JIT compilation in V8, SpiderMonkey, and JavaScriptCore.",
            ],
          },
          {
            title: "O(1) Lazy String Vault & Polymorphic Seeds",
            body: [
              "In cold-path functions (authentication handshakes, license validators, API client builders, feature-flag evaluators), string literals of length >= `minStringLength` (default `4`) are extracted at build time.",
              "Each string is encoded using a polymorphic byte stream cipher parameterized by the build's 32-bit `seed`. At runtime, the injected `_u0x` vault helper decodes each string only on its first access and caches the plaintext in a `Map`. Subsequent calls resolve in O(1) constant time with zero allocation overhead.",
            ],
          },
          {
            title: "32-bit FNV-1a Integrity & DevTools Shield",
            body: [
              "Entry chunks receive a compact runtime shield (`injectRuntimeShield: true`). It computes a 32-bit FNV-1a hash (`offset_basis = 2166136261`) over normalized function source representations (`Function.prototype.toString()`) and monitors execution timing drift indicative of automated DevTools breakpoint stepping.",
              "Two deterrent modes are available: `gradual` (introduces subtle asynchronous jitter and state entropy when tampering is confirmed) and `passive` (records integrity telemetry flags without altering execution flow).",
            ],
          },
        ],
      },
      {
        id: "sourcemaps",
        number: "04",
        title: "Source Map Vault & Production Debugging",
        summary:
          "Never ship .js.map files to public users again—while retaining full stack-trace symbolication in Sentry, Datadog, or local crash triage.",
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
                label: "GitHub Actions — Upload .unpeek-maps to Sentry",
                language: "yaml",
                code: `- name: Build & Protect Client Bundles
  run: |
    pnpm build
    npx unpeek protect --private-maps-dir .unpeek-maps

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
                code: `unpeek init [--cwd <path>]
  Detects framework, configures package.json "postbuild", and updates .gitignore.

unpeek protect [options]
  --cwd <path>               Target project root directory (default: process.cwd())
  --out-dir <path>           Explicit client output directory override
  --seed <number>            Deterministic 32-bit polymorphic seed
  --deterrent <mode>         Runtime deterrent mode: "gradual" | "passive" (default: "gradual")
  --no-maps-vault            Delete .map files instead of moving to .unpeek-maps/
  --private-maps-dir <dir>   Custom vault folder name (default: ".unpeek-maps")
  --no-shield                Disable runtime FNV-1a integrity & DevTools shield injection
  --min-string-length <n>    Minimum string literal length to encrypt (default: 4)`,
              },
            ],
          },
          {
            title: "Programmatic Node.js API & TypeScript Types",
            body: [
              "Import `protectDirectory`, `transformCode`, or bundler plugins directly from `unpeek` to build custom compilation pipelines.",
            ],
            codeBlocks: [
              {
                label: "TypeScript — Programmatic Usage & Exported Interfaces",
                language: "typescript",
                code: `import {
  protectDirectory,
  transformCode,
  type ProtectOptions,
  type ProtectSummary,
  type TransformOptions,
  type TransformResult,
} from "unpeek";

// 1. Transform a single JavaScript module in memory
const result: TransformResult = transformCode(sourceCode, {
  seed: 0x10b981,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: "gradual",
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.mangledSymbolsCount);

// 2. Protect an entire framework build directory
const summary: ProtectSummary = await protectDirectory({
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
          "Equip Claude Code, Cursor, Codex, and Windsurf with the official unpeek skill so autonomous agents never break your hot-path budgets or leak source maps.",
        subsections: [
          {
            title: "Installing skills/unpeek/SKILL.md & AGENTS.md",
            body: [
              "This repository ships with a dedicated agent skill definition (`skills/unpeek/SKILL.md`) and root `AGENTS.md` operational contract. When AI coding agents work in your repository, these files instruct them on how to run `unpeek protect`, verify the `<2%` CPU and `<15%` Gzip budgets, and keep `.unpeek-maps/` out of public static directories.",
            ],
            codeBlocks: [
              {
                label: "Terminal — Copy Skill into Your Project or Global Agent Config",
                language: "bash",
                code: `# Copy the unpeek skill into your project's .claude/skills or skills/ directory
mkdir -p skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \\
  -o skills/unpeek/SKILL.md`,
              },
              {
                label: "Prompt Example for Claude Code / Cursor",
                language: "text",
                code: `"Read skills/unpeek/SKILL.md, integrate unpeek into our Vite build pipeline with gradual deterrent mode, and verify that our animation loop in src/canvas/renderer.ts is listed under hotFunctionsSkipped."`,
              },
            ],
          },
        ],
      },
    ],
    footer: {
      tagline: "Built with monochrome engineering discipline. Open-source under the MIT License.",
      links: {
        docs: "Documentation",
        github: "GitHub Repository",
        npm: "NPM Package",
      },
    },
  },
  tr: {
    meta: {
      version: "v1.0.1",
      license: "MIT Lisanslı",
    },
    nav: {
      architecture: "Mimari",
      benchmarks: "Karşılaştırma",
      docs: "Dokümantasyon",
      fullDocsPage: "Tam Referans",
      github: "GitHub",
    },
    hero: {
      eyebrow: "AST DESTEKLİ İSTEMCİ JS KORUMASI",
      headlineLine1: "İstemci kodunu zırhlayın.",
      headlineLine2: "Hot-path hızından ödün vermeyin.",
      subtext:
        "Call-graph hot-path muafiyeti, O(1) string kasası ve gizli source-map ayrıştırmasıyla sıfır ayar gerektiren JavaScript koruması.",
      initCmd: "npx unpeek init",
      copyLabel: "Kopyala",
      copiedLabel: "Kopyalandı",
      primaryCta: "Dokümantasyonu Oku",
      codeTabs: {
        beforeLabel: "Girdi (TypeScript / JS)",
        afterLabel: "Korunmuş Çıktı (unpeek)",
        statusBadge: "Hot-Path Muaf · <%2 CPU",
        hotPathNote: "60fps döngüsü algılandı ve otomatik muaf tutuldu",
        coldPathNote: "String'ler O(1) önbellekli kasada şifrelendi + FNV-1a kalkanı",
      },
    },
    metricsStrip: {
      items: [
        {
          value: "< %2",
          label: "Hot-Path CPU Ek Yükü",
          detail: "Döngüler, rAF çağrıları ve Canvas/WebGL çizim fonksiyonları statik call-graph analiziyle otomatik olarak muaf tutulur.",
        },
        {
          value: "< %15",
          label: "Gzip Paket Boyutu Farkı",
          detail: "Kompakt bayt tabloları ve paylaşımlı O(1) önbellekli string çözücüler ağ transfer bütçesini korur.",
        },
        {
          value: "0 Satır",
          label: "Uygulama Kodu Değişikliği",
          detail: "Next.js, Vite, Webpack ve Vanilla JS çıktıları için sıfır ayarlı postbuild CLI veya unplugin entegrasyonu.",
        },
        {
          value: "%100",
          label: "Source Map İzolasyonu",
          detail: ".map dosyalarını .unpeek-maps/ kasasına taşır ve genel (public) dosyalardaki sourceMappingURL satırlarını temizler.",
        },
      ],
    },
    architectureSection: {
      eyebrow: "DERLEYİCİ HATTI",
      title: "Körlemesine AST şişirmesi değil, çalışma zamanı bütçesi odaklı mühendislik.",
      subtitle:
        "Geleneksel obfuscator araçları her ifadeyi karmaşık durum makinelerine sararak kare hızlarını %300-%800 düşürür. unpeek önce çağrı grafiğinizi (call-graph) modeller ve yalnızca hot-path dışındaki kritik mantığı şifreler.",
      stages: [
        {
          step: "AŞAMA 01",
          title: "Acorn AST & Çağrı Grafiği (Call-Graph) İnşası",
          metric: "ECMA-2022 Modül Analizi",
          description:
            "Derlenmiş istemci paketlerini Soyut Sözdizimi Ağacına (AST) dönüştürür ve her fonksiyon tanımını, ok fonksiyonunu ve çağrı ilişkisini haritalayan modül içi çağrı grafiğini çıkarır.",
          detail: "Tek bir sembole dokunmadan önce dışa aktarılan (export) API'leri ve leksikal kapsamları belirler.",
        },
        {
          step: "AŞAMA 02",
          title: "Geçişken (Transitive) Hot-Path Muafiyeti",
          metric: "%0 Döngü Cezası",
          description:
            "Yoğun döngüler (for, while, do-while), requestAnimationFrame kancaları ve yüksek frekanslı zamanlayıcılar içeren fonksiyonları tespit eder; ardından bu fonksiyonların çağırdığı alt yardımcıları da geçişken olarak muaf işaretler.",
          detail: "Hot fonksiyonlar ve yardımcıları değiştirilmez; böylece V8/JavaScriptCore JIT inline önbellekleri tam hızda çalışır.",
        },
        {
          step: "AŞAMA 03",
          title: "Polimorfik String Kasası & Leksikal Karıştırma",
          metric: "O(1) Önbellekli Çözümleme",
          description:
            "Cold-path içindeki string sabitlerini derleme tohumu (seed) ile anahtarlanmış polimorfik XOR bayt dizilerine dönüştürür. İlk erişimde çözülen metin Map içine kaydedilir; sonraki tüm okumalar O(1) sürede döner.",
          detail: "Aynı anda dış API'leri bozmadan yerel değişken ve parametre isimlerini anlamsız onaltılık sembollerle yeniden adlandırır.",
        },
        {
          step: "AŞAMA 04",
          title: "Source Map Kasası & FNV-1a Bütünlük Kalkanı",
          metric: "32-bit FNV-1a Özeti",
          description:
            ".js.map dosyalarını gizli .unpeek-maps/ klasörüne taşır, //# sourceMappingURL yorumlarını siler ve giriş paketlerine hafif bir FNV-1a öz-doğrulama ile DevTools zamanlama kalkanı enjekte eder.",
          detail: "Kodun güzelleştirilmesi (beautify) veya değiştirilmesi algılandığında kademeli yavaşlatma (gradual) veya pasif telemetri uygular.",
        },
      ],
    },
    comparisonSection: {
      title: "Geleneksel obfuscator araçlarıyla ölçülmüş karşılaştırma",
      subtitle:
        "packages/unpeek/benchmarks/run.ts kullanılarak gerçek Next.js ve Vite üretim paketleri üzerinde doğrulanmıştır.",
      columns: {
        metric: "Mühendislik Boyutu",
        unpeek: "unpeek (Varsayılan Profil)",
        legacy: "Geleneksel Obfuscator (Yüksek Preset)",
        minifier: "Standart Minifier (Terser / SWC)",
      },
      rows: [
        {
          metric: "Hot-Path Döngü / Çizim CPU Ek Yükü",
          unpeek: "< %2 (Call-Graph ile otomatik muaf)",
          legacyObfuscator: "+%300 ila +%850 (JIT optimizasyon kaybı)",
          plainMinifier: "%0 (Referans)",
        },
        {
          metric: "Gzip Paket Boyutu Artışı",
          unpeek: "+%4 ila +%14 (<%15 sıkı bütçe)",
          legacyObfuscator: "+%120 ila +%340 (Kontrol akışı şişmesi)",
          plainMinifier: "%0 (Referans)",
        },
        {
          metric: "String Sabiti Çözümleme Karmaşıklığı",
          unpeek: "O(1) Lazy Map Önbellekleme",
          legacyObfuscator: "Her çağrıda O(N) tekrarlı RC4 / Base64",
          plainMinifier: "Pakette açık metin (plaintext)",
        },
        {
          metric: "Açık Source Map Sızıntısı Önleme",
          unpeek: "Otomatik .unpeek-maps/ Kasası + URL Silme",
          legacyObfuscator: "Manuel yapılandırma gerektirir",
          plainMinifier: "Genellikle üretim ortamına yanlışlıkla yüklenir",
        },
        {
          metric: "Çalışma Zamanı Öz-Bütünlük Doğrulaması",
          unpeek: "32-bit FNV-1a Özeti + Kademeli Caydırıcı",
          legacyObfuscator: "Ağır regex self-defending (CSP politikalarını bozar)",
          plainMinifier: "Yok",
        },
      ],
    },
    docsHeader: {
      title: "Teknik Dokümantasyon",
      subtitle:
        "CLI iş akışları, framework entegrasyonları, hot-path sezgiselleri, source map kasası, programatik API'ler ve AI ajan kurulumu için eksiksiz kılavuz.",
      sidebarTitle: "Dokümantasyon Bölümleri",
      onPageLabel: "Bölüm Referansı",
      openStandaloneLabel: "Tam Sayfa /docs Görünümünü Aç",
      backToHomeLabel: "Lansman Sayfasına Dön",
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
                label: "Terminal — Sıfır Ayarlı Başlatma",
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
                label: "Terminal — Postbuild Koruma & Özet Çıktısı",
                language: "bash",
                code: `# Manuel veya postbuild üzerinden çalıştırma
npx unpeek protect --seed 482910 --deterrent gradual

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
              "Hem `postbuild` CLI kullanımı hem de `unpeek/webpack` eklentisi tam desteklenir.",
            ],
            codeBlocks: [
              {
                label: "package.json — Önerilen Next.js Postbuild Yapılandırması",
                language: "json",
                code: `{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "postbuild": "unpeek protect"
  },
  "devDependencies": {
    "unpeek": "^0.1.0"
  }
}`,
              },
            ],
          },
          {
            title: "Vite & Rollup (CLI veya unplugin)",
            body: [
              "Vite uygulamalarında unpeek `dist/` çıktı klasörünü otomatik algılar. Dönüşümü postbuild aşaması yerine doğrudan Vite paketleme aşamasında bellek içinde yapmak isterseniz `viteUnpeekPlugin` eklentisini kullanabilirsiniz.",
            ],
            codeBlocks: [
              {
                label: "vite.config.ts — Doğrudan Vite Eklenti Entegrasyonu",
                language: "typescript",
                code: `import { defineConfig } from "vite";
import { viteUnpeekPlugin } from "unpeek";

export default defineConfig({
  build: {
    sourcemap: true, // Postbuild aşamasında .unpeek-maps/ kasasına taşınır
  },
  plugins: [
    viteUnpeekPlugin({
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
              "Webpack 5 projelerinde `webpackUnpeekPlugin` eklentisini içe aktarabilir veya CLI'a `--out-dir build/static/js` parametresi geçebilirsiniz. Vanilla JS projelerinde `--out-dir` ile statik JS klasörünüzü belirtmeniz yeterlidir.",
            ],
            codeBlocks: [
              {
                label: "webpack.config.js — Webpack Eklentisi",
                language: "javascript",
                code: `import { webpackUnpeekPlugin } from "unpeek";

export default {
  mode: "production",
  plugins: [
    webpackUnpeekPlugin({
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
          "Statik çağrı grafiği analizi, O(1) lazy string kasası ve FNV-1a bütünlük doğrulaması ile <%2 CPU ek yükü hedefinin teknik detayları.",
        subsections: [
          {
            title: "Statik Çağrı Grafiği (Call-Graph) & Geçişken Hot-Path Muafiyeti",
            body: [
              "Geleneksel JavaScript obfuscator'ları neden uygulama akıcılığını bozar? Çünkü AST içindeki her düğümü körlemesine dönüştürerek 60fps animasyon döngülerini veya sanal DOM hesaplamalarını binlerce dizi aramasına ve switch-case bloğuna çevirirler.",
              "unpeek, herhangi bir dönüşüm uygulamadan önce her modülün statik çağrı grafiğini çıkararak bu sorunu kökten çözer:",
            ],
            bullets: [
              "Doğrudan Hot Tespiti: `for`, `while`, `do...while`, `for...in`, `for...of` döngüleri içeren veya `requestAnimationFrame`, `setInterval` çağıran her fonksiyon doğrudan 'hot' olarak işaretlenir.",
              "Geçişken (Transitive) Yayılım: Hot olarak işaretlenen A fonksiyonu gövdesi içinde B fonksiyonunu çağırıyorsa, B fonksiyonu da çağrı grafiği boyunca otomatik olarak hot statüsü kazanır.",
              "Sıfır Ek Yüklü Bypass: Hot işaretli tüm fonksiyonlar string şifreleme ve kontrol akışı dönüşümlerinden tamamen muaf tutulur; V8, SpiderMonkey ve JavaScriptCore JIT optimizasyonları bozulmadan kalır.",
            ],
          },
          {
            title: "O(1) Lazy String Kasası & Polimorfik Tohumlama",
            body: [
              "Cold-path fonksiyonlarında (kimlik doğrulama, lisans kontrolü, API istemci kurulumu, özellik bayrakları) uzunluğu `minStringLength` (varsayılan `4`) ve üzeri olan tüm string sabitleri derleme anında ayrıştırılır.",
              "Her string, derlemenin 32-bitlik `seed` değeriyle parametrelenmiş polimorfik bir bayt akış şifresiyle kodlanır. Çalışma zamanında `_u0x` kasa yardımcısı her string'i yalnızca ilk erişimde çözer ve düz metni bir `Map` nesnesinde önbelleğe alır. Sonraki tüm çağrılar bellek tahsisi yapmadan O(1) sabit zamanda sonuç döndürür.",
            ],
          },
          {
            title: "32-bit FNV-1a Bütünlük & DevTools Kalkanı",
            body: [
              "Giriş paketlerine hafif bir çalışma zamanı kalkanı (`injectRuntimeShield: true`) eklenir. Bu kalkan, normalize edilmiş fonksiyon kaynak metinleri (`Function.prototype.toString()`) üzerinde 32-bit FNV-1a özeti (`offset_basis = 2166136261`) hesaplar ve DevTools breakpoint adımlamasına işaret eden zaman sapmalarını izler.",
              "İki caydırıcı mod sunulur: `gradual` (müdahale doğrulandığında kademeli asenkron gecikme ve durum entropisi uygular) ve `passive` (çalışma akışını bozmadan yalnızca bütünlük telemetri bayrağını kaydeder).",
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
                label: "GitHub Actions — .unpeek-maps Klasörünü Sentry'ye Yükleme",
                language: "yaml",
                code: `- name: İstemci Paketlerini Derle ve Koru
  run: |
    pnpm build
    npx unpeek protect --private-maps-dir .unpeek-maps

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
                code: `unpeek init [--cwd <path>]
  Framework'ü algılar, package.json "postbuild" betiğini ekler ve .gitignore'u günceller.

unpeek protect [options]
  --cwd <path>               Hedef proje kök dizini (varsayılan: process.cwd())
  --out-dir <path>           İstemci çıktı klasörünü manuel geçersiz kılma
  --seed <number>            Deterministik 32-bit polimorfik tohum (seed)
  --deterrent <mode>         Caydırıcı mod: "gradual" | "passive" (varsayılan: "gradual")
  --no-maps-vault            .map dosyalarını .unpeek-maps/ yerine kalıcı olarak sil
  --private-maps-dir <dir>   Özel source map kasa klasörü (varsayılan: ".unpeek-maps")
  --no-shield                Çalışma zamanı FNV-1a ve DevTools kalkanını devre dışı bırak
  --min-string-length <n>    Şifrelenecek minimum string uzunluğu (varsayılan: 4)`,
              },
            ],
          },
          {
            title: "Programatik Node.js API & TypeScript Tipleri",
            body: [
              "Özel derleme hatları oluşturmak için `protectDirectory`, `transformCode` veya bundler eklentilerini doğrudan `unpeek` paketinden içe aktarabilirsiniz.",
            ],
            codeBlocks: [
              {
                label: "TypeScript — Programatik Kullanım & Arayüzler",
                language: "typescript",
                code: `import {
  protectDirectory,
  transformCode,
  type ProtectOptions,
  type ProtectSummary,
  type TransformOptions,
  type TransformResult,
} from "unpeek";

// 1. Tek bir JavaScript modülünü bellek içinde dönüştürme
const result: TransformResult = transformCode(sourceCode, {
  seed: 0x10b981,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: "gradual",
});

console.log(result.hotPathReport.hotFunctionsSkipped);
console.log(result.encryptedStringsCount, result.mangledSymbolsCount);

// 2. Tüm framework çıktı dizinini koruma
const summary: ProtectSummary = await protectDirectory({
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
        title: "AI Ajanlarla Kullanım (Claude Code, Cursor, Codex)",
        summary:
          "Otonom kodlama ajanlarının hot-path bütçenizi bozmaması ve source map sızdırmaması için resmi unpeek skill dosyasını projelerinize ekleyin.",
        subsections: [
          {
            title: "skills/unpeek/SKILL.md & AGENTS.md Kurulumu",
            body: [
              "Bu monorepo, yapay zeka kodlama ajanları için özel olarak hazırlanmış `skills/unpeek/SKILL.md` yetenek tanımı ve kök `AGENTS.md` operasyonel sözleşmesiyle birlikte gelir. AI ajanları deponuzda çalışırken bu dosyalar sayesinde `unpeek protect` komutunu nasıl çalıştıracaklarını, `<%2` CPU ve `<%15` Gzip bütçesini nasıl doğrulayacaklarını ve `.unpeek-maps/` klasörünü genel dağıtım dışında tutmayı öğrenir.",
            ],
            codeBlocks: [
              {
                label: "Terminal — Skill Dosyasını Projenize Kopyalayın",
                language: "bash",
                code: `# unpeek skill dosyasını projenizin skills/ dizinine indirin
mkdir -p skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \\
  -o skills/unpeek/SKILL.md`,
              },
              {
                label: "Claude Code / Cursor İçin Örnek İstem (Prompt)",
                language: "text",
                code: `"skills/unpeek/SKILL.md dosyasını oku, unpeek'i gradual caydırıcı mod ile Vite derleme hattımıza entegre et ve src/canvas/renderer.ts içindeki animasyon döngümüzün hotFunctionsSkipped listesinde yer aldığını doğrula."`,
              },
            ],
          },
        ],
      },
    ],
    footer: {
      tagline: "Monokrom mühendislik disipliniyle geliştirildi. MIT Lisansı altında açık kaynak.",
      links: {
        docs: "Dokümantasyon",
        github: "GitHub Deposu",
        npm: "NPM Paketi",
      },
    },
  },
};
