import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {
  transformJavaScript,
  protectProject,
  checkProject,
  loadUnpeekConfig,
} from '../src/index.js';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { generate } from 'astring';
import { detectHotPaths } from '../src/ast/index.js';
import { derivePolymorphicIdent, generateCompactJs } from '../src/ast/codegen.js';
import { createSotaMbaPredicate, applyColdFlowGuard } from '../src/ast/cold-flow-guard.js';
import {
  compileFunctionToBytecode,
  generateOpcodeMap,
  OP_LDC,
  OP_RET,
  OP_THROW,
} from '../src/ast/micro-vm.js';
import {
  createDeterrentSnippet,
  generateRuntimeShield,
} from '../src/runtime/index.js';
import { createUnpeekNextAdapter } from '../src/adapters/next/index.js';
import { detectTargetFramework, scanClientBundles, SUPPORTED_EXTENSIONS } from '../src/core/detector.js';
import { encodeMappings } from '../src/core/vlq.js';
import { unpeekPlugin } from '../src/plugins/unplugin.js';
import { resolveUnpeekConfigSync } from '../src/internal/config.js';
import type { InternalTransformOptions, InternalTransformResult } from '../src/internal/types.js';
import type { UnpeekConfig } from '../src/config.js';

describe('Audit Remediation Verification Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-audit-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('1. Import Alias & Hot-Path Detection', () => {
    it('detects aliased Three.js / R3F useFrame (useFrame as onTick) and exempts its callback and caller', () => {
      const source = `
        import { useFrame as onTick } from '@react-three/fiber';

        function CanvasMesh(props) {
          onTick(function renderStep(state, delta) {
            return state.clock.getElapsedTime() + delta;
          });
          return props.visible;
        }

        function validateUserToken(token) {
          const secret = "AUTH_BEARER_TOKEN_9999";
          return token === secret;
        }
      `;

      const report = detectHotPaths(source);
      expect(report.hotFunctionsSkipped).toContain('CanvasMesh');
      expect(report.hotFunctionsSkipped).toContain('renderStep');
      expect(report.coldFunctionsProtected).toContain('validateUserToken');
    });

    it('detects aliased Lenis scroll hook (useLenis as useSmooth) and exempts smooth scroll callbacks', () => {
      const source = `
        import { useLenis as useSmooth } from 'lenis/react';

        function SmoothPageScroller() {
          useSmooth(function onScrollStep(lenis) {
            return lenis.scroll * 0.5;
          });
        }

        function computeBillingHash(secret, payload) {
          return secret + ":" + payload;
        }
      `;

      const report = detectHotPaths(source);
      expect(report.hotFunctionsSkipped).toContain('SmoothPageScroller');
      expect(report.hotFunctionsSkipped).toContain('onScrollStep');
      expect(report.coldFunctionsProtected).toContain('computeBillingHash');
    });

    it('supports custom hotPath.importSources and customAnimationCalls from config', () => {
      const customConfig: UnpeekConfig = {
        hotPath: {
          importSources: {
            'custom-physics-engine': ['stepSimulation'],
          },
          customAnimationCalls: ['onCanvasFlush'],
        },
      };

      const source = `
        import { stepSimulation as runStep } from 'custom-physics-engine';

        function PhysicsWorld() {
          runStep(function subStep(dt) {
            return dt * 60;
          });
        }

        function FlushController() {
          onCanvasFlush(function flushCb() {
            return true;
          });
        }

        function paymentGateway(card) {
          return card.cvv === "999";
        }
      `;

      const report = detectHotPaths(source, customConfig);
      expect(report.hotFunctionsSkipped).toContain('PhysicsWorld');
      expect(report.hotFunctionsSkipped).toContain('subStep');
      expect(report.hotFunctionsSkipped).toContain('FlushController');
      expect(report.hotFunctionsSkipped).toContain('flushCb');
      expect(report.coldFunctionsProtected).toContain('paymentGateway');
    });

    it('exempts frame functions from being classified as cold event handlers via negative lookahead', () => {
      const source = `
        function onTick(delta) {
          return delta * 2;
        }
        function onRender(gl) {
          return gl.viewport;
        }
        function onUpdate(dt) {
          return dt;
        }
        function onFrame(time) {
          return time;
        }
        function onAnimate(alpha) {
          return alpha;
        }
        function handlePhysicsStep(t) {
          return t;
        }
        function onClick(event) {
          return event.target;
        }
        function handleSubmit(e) {
          return e.preventDefault();
        }

        // Passed to animation loop caller: frame functions should retain hot status
        requestAnimationFrame(onTick);
        requestAnimationFrame(onRender);
        requestAnimationFrame(onUpdate);
        requestAnimationFrame(onFrame);
        requestAnimationFrame(onAnimate);
        requestAnimationFrame(handlePhysicsStep);
      `;

      const report = detectHotPaths(source);
      // Standard event handlers are identified as cold
      expect(report.coldFunctionsProtected).toContain('onClick');
      expect(report.coldFunctionsProtected).toContain('handleSubmit');
      // Frame functions should retain hot status
      expect(report.hotFunctionsSkipped).toContain('onTick');
      expect(report.hotFunctionsSkipped).toContain('onRender');
      expect(report.hotFunctionsSkipped).toContain('onUpdate');
      expect(report.hotFunctionsSkipped).toContain('onFrame');
      expect(report.hotFunctionsSkipped).toContain('onAnimate');
      expect(report.hotFunctionsSkipped).toContain('handlePhysicsStep');
    });
  });

  describe('2. React 19 "use cache" & Directives Exemption', () => {
    it('exempts top-level "use cache" directive and preserves it at the file header before vault helpers', () => {
      const source = `'use cache';
export function getProductCatalog() {
  const secretKey = "CATALOG_API_KEY_SECRET_2026";
  return secretKey;
}`;

      const transformed = transformJavaScript(source, {
        minStringLength: 4,
        seed: 0x1234,
      });

      // 'use cache' must stay in plaintext and not encrypted into vault array
      expect(transformed.code).toContain("'use cache'");
      expect(transformed.code).not.toContain('CATALOG_API_KEY_SECRET_2026');

      // Vault helper must NOT be inserted before 'use cache'
      const trimmed = transformed.code.trim();
      expect(trimmed.startsWith("'use cache';")).toBe(true);
    });

    it('exempts function-level "use cache" and other modern directives ("use worklet", "use worker")', () => {
      const source = `
        export async function fetchUserData(userId) {
          'use cache';
          const authBearer = "BEARER_SECRET_TOKEN_VALUE";
          return authBearer + ":" + userId;
        }

        export function createWorkletHandler() {
          'use worklet';
          const workletTag = "WORKLET_SECRET_TAG";
          return workletTag;
        }
      `;

      const transformed = transformJavaScript(source, {
        minStringLength: 4,
        seed: 0x55aa,
      });

      expect(transformed.code).toContain("'use cache'");
      expect(transformed.code).toContain("'use worklet'");
      expect(transformed.code).not.toContain('BEARER_SECRET_TOKEN_VALUE');
      expect(transformed.code).not.toContain('WORKLET_SECRET_TAG');
    });

    it('respects config.vault.customDirectives', () => {
      const customConfig: UnpeekConfig = {
        vault: {
          customDirectives: ['use custom_domain_directive'],
        },
      };

      const source = `'use custom_domain_directive';
export function runDomainService() {
  return "HIGHLY_CONFIDENTIAL_KEY";
}`;

      const transformed = transformJavaScript(source, {
        minStringLength: 4,
        config: customConfig,
      });

      expect(transformed.code).toContain("'use custom_domain_directive'");
      expect(transformed.code).not.toContain('HIGHLY_CONFIDENTIAL_KEY');
      expect(transformed.code.trim().startsWith("'use custom_domain_directive';")).toBe(true);
    });
  });

  describe('3. Vue / Svelte & DOM Standard Props Preservation', () => {
    it('preserves standard Vue/Svelte props (class, part, slot, is, innerHTML, disabled, title)', () => {
      const source = `
        const templateNode = {
          class: "container active-theme",
          part: "modal-backdrop",
          slot: "dialog-footer",
          is: "custom-wc-element",
          innerHTML: "<div class='injected'></div>",
          disabled: "true",
          title: "Tooltip label info"
        };
        const sensitiveValue = "SUPER_SECRET_PAYLOAD_12345";
        return templateNode.class + ":" + sensitiveValue;
      `;

      const transformed = transformJavaScript(source, {
        minStringLength: 4,
        seed: 0x9999,
      });

      // Standard prop keys must remain untouched
      expect(transformed.code).toContain('class:');
      expect(transformed.code).toContain('part:');
      expect(transformed.code).toContain('slot:');
      expect(transformed.code).toContain('is:');
      expect(transformed.code).toContain('innerHTML:');
      expect(transformed.code).toContain('disabled:');
      expect(transformed.code).toContain('title:');

      // Sensitive value must be encrypted
      expect(transformed.code).not.toContain('SUPER_SECRET_PAYLOAD_12345');

      const fn = new Function(transformed.code);
      expect(fn()).toBe('container active-theme:SUPER_SECRET_PAYLOAD_12345');
    });

    it('preserves framework attribute prefixes: data-, aria-, v-, bind:', () => {
      const source = `
        const svelteVueBindings = {
          "data-testid": "submit-checkout-btn",
          "aria-label": "Close Modal Window",
          "v-model": "currentUserEmailAddress",
          "bind:value": "sliderNumericValue"
        };
        const privateSecret = "INTERNAL_CREDENTIAL_DATA";
        return svelteVueBindings["data-testid"] + ":" + privateSecret;
      `;

      const transformed = transformJavaScript(source, {
        minStringLength: 4,
        seed: 0x4321,
      });

      expect(transformed.code).toContain('data-testid');
      expect(transformed.code).toContain('aria-label');
      expect(transformed.code).toContain('v-model');
      expect(transformed.code).toContain('bind:value');
      expect(transformed.code).not.toContain('INTERNAL_CREDENTIAL_DATA');

      const fn = new Function(transformed.code);
      expect(fn()).toBe('submit-checkout-btn:INTERNAL_CREDENTIAL_DATA');
    });
  });

  describe('4. Web Worker globalThis Decryptor & Runtime Compatibility', () => {
    it('executes decryptor and runtime shield safely in Web Worker context where window is undefined', () => {
      const originalCode = `
        function workerTask(input) {
          const secretWorkerSalt = "WORKER_EXCLUSIVE_SHARED_SECRET_KEY";
          return secretWorkerSalt + ":" + input;
        }
        return workerTask(42);
      `;

      // Transform with runtime shield and salted/standard vault
      const transformed = transformJavaScript(originalCode, {
        seed: 0x77bb11,
        minStringLength: 4,
        injectRuntimeShield: true,
      });

      expect(transformed.code).not.toContain('WORKER_EXCLUSIVE_SHARED_SECRET_KEY');

      // Setup Web Worker isolated VM sandbox without `window`
      const workerScope: Record<string, any> = {
        Function,
        String,
        Math,
        JSON,
        CustomEvent: class CustomEvent {
          type: string;
          constructor(t: string) {
            this.type = t;
          }
        },
        navigator: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 WebWorker',
          webdriver: false,
        },
      };
      // In WorkerGlobalScope: self and globalThis exist, window is undefined
      workerScope.self = workerScope;
      workerScope.globalThis = workerScope;

      const ctx = vm.createContext(workerScope);

      // Verify execution does not throw ReferenceError: window is not defined
      const wrapped = `(function() { ${transformed.code} })()`;
      let res: any;
      expect(() => {
        res = vm.runInContext(wrapped, ctx);
      }).not.toThrow();

      expect(res).toBe('WORKER_EXCLUSIVE_SHARED_SECRET_KEY:42');
    });

    it('executes aggressive mode (Tier 2) in Web Worker global scope without window', () => {
      const originalCode = `
        function computeWorkerHash(seed) {
          const secretSalt = "WORKER_TIER2_CONFIDENTIAL_KEY";
          return secretSalt + "_" + seed;
        }
        return computeWorkerHash(100);
      `;

      const transformed = transformJavaScript(originalCode, {
        seed: 0x33aa55,
        minStringLength: 4,
        aggressive: true,
        injectRuntimeShield: true,
      });

      expect(transformed.code).not.toContain('WORKER_TIER2_CONFIDENTIAL_KEY');

      const workerScope: Record<string, any> = {
        Function,
        String,
        Math,
        JSON,
        Uint8Array,
        WebAssembly,
        CustomEvent: class {},
        navigator: {
          userAgent: 'Mozilla/5.0 Chrome Worker',
          webdriver: false,
        },
      };
      workerScope.self = workerScope;
      workerScope.globalThis = workerScope;

      const ctx = vm.createContext(workerScope);
      const wrapped = `(function() { ${transformed.code} })()`;
      let res: any;
      expect(() => {
        res = vm.runInContext(wrapped, ctx);
      }).not.toThrow();

      expect(res).toBe('WORKER_TIER2_CONFIDENTIAL_KEY_100');
    });
  });

  describe('5. Client Route With "server" in Name (.next/static/chunks/app/server/dashboard.js)', () => {
    it('scans and protects client route containing "server" in route path while keeping .next/server untouched', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'next-app-with-server-route',
          dependencies: { next: '15.2.0', react: '19.0.0' },
        }),
        'utf8'
      );

      const clientDir = path.join(tmpDir, '.next', 'static', 'chunks', 'app', 'server');
      const ssrServerDir = path.join(tmpDir, '.next', 'server', 'app');
      fs.mkdirSync(clientDir, { recursive: true });
      fs.mkdirSync(ssrServerDir, { recursive: true });

      const clientRouteFile = path.join(clientDir, 'dashboard.js');
      const clientSettingsFile = path.join(clientDir, 'settings.js');
      const ssrPageFile = path.join(ssrServerDir, 'page.js');

      const originalClientCode = `
        export function ServerDashboard() {
          const clientSecret = "CLIENT_ROUTE_PROTECTED_SECRET";
          return clientSecret;
        }
      `;
      const originalSsrCode = `
        export function SsrPage() {
          const serverDbSecret = "DATABASE_URL_POSTGRES_SERVER_ONLY";
          return serverDbSecret;
        }
      `;

      fs.writeFileSync(clientRouteFile, originalClientCode, 'utf8');
      fs.writeFileSync(clientSettingsFile, originalClientCode, 'utf8');
      fs.writeFileSync(ssrPageFile, originalSsrCode, 'utf8');

      // 1. scanClientBundles must find the files inside .next/static/chunks/app/server
      const chunksDir = path.join(tmpDir, '.next', 'static', 'chunks');
      const scanned = scanClientBundles(chunksDir);
      const normalizedScanned = scanned.map((p) => path.relative(tmpDir, p).replace(/\\/g, '/'));

      expect(normalizedScanned).toContain('.next/static/chunks/app/server/dashboard.js');
      expect(normalizedScanned).toContain('.next/static/chunks/app/server/settings.js');
      expect(normalizedScanned.some((p) => p.includes('.next/server'))).toBe(false);

      // 2. protectProject must protect client routes and leave SSR page untouched
      const summary = await protectProject({
        cwd: tmpDir,
        keepPrivateMaps: false,
      });

      expect(summary.processedFiles).toBe(2);

      const protectedClient = fs.readFileSync(clientRouteFile, 'utf8');
      expect(protectedClient).not.toContain('CLIENT_ROUTE_PROTECTED_SECRET');

      const untouchedServer = fs.readFileSync(ssrPageFile, 'utf8');
      expect(untouchedServer).toBe(originalSsrCode);
      expect(untouchedServer).toContain('DATABASE_URL_POSTGRES_SERVER_ONLY');
    });
  });

  describe('6. .cjs Bundle Scanning and Protection', () => {
    it('recognizes .cjs in SUPPORTED_EXTENSIONS and scans/protects .cjs files', async () => {
      expect(SUPPORTED_EXTENSIONS.has('.cjs')).toBe(true);

      const distDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const cjsFile = path.join(distDir, 'legacy-lib.cjs');
      const mjsFile = path.join(distDir, 'modern-lib.mjs');
      const jsFile = path.join(distDir, 'standard-lib.js');

      fs.writeFileSync(
        cjsFile,
        'const CJS_SECRET = "LEGACY_COMMONJS_SECRET_VALUE"; module.exports = { secret: CJS_SECRET };',
        'utf8'
      );
      fs.writeFileSync(
        mjsFile,
        'export const MJS_SECRET = "ESM_MODULE_SECRET_VALUE";',
        'utf8'
      );
      fs.writeFileSync(
        jsFile,
        'export const JS_SECRET = "STANDARD_JS_SECRET_VALUE";',
        'utf8'
      );

      const scanned = scanClientBundles(distDir);
      const filenames = scanned.map((f) => path.basename(f));
      expect(filenames).toContain('legacy-lib.cjs');
      expect(filenames).toContain('modern-lib.mjs');
      expect(filenames).toContain('standard-lib.js');

      const summary = await protectProject({
        cwd: tmpDir,
        outDir: distDir,
        keepPrivateMaps: false,
      });

      expect(summary.processedFiles).toBe(3);

      const protectedCjs = fs.readFileSync(cjsFile, 'utf8');
      expect(protectedCjs).not.toContain('LEGACY_COMMONJS_SECRET_VALUE');
    });
  });

  describe('7. Windows Backslash Normalization in Unplugin', () => {
    it('normalizes Windows backslashes so client assets are protected and server/node_modules excluded', () => {
      const plugin = (unpeekPlugin as any).raw({
        injectRuntimeShield: false,
      });

      const clientJsCode = 'export const API = "https://client.api.io/v1/auth";';
      const serverJsCode = 'export const DB = "postgres://root:password@localhost";';

      // 1. Windows path separator: dist\assets\index.js -> must be processed
      const clientRes = plugin.renderChunk(clientJsCode, {
        fileName: 'dist\\assets\\index.js',
      });
      expect(clientRes).not.toBeNull();
      const code = typeof clientRes === 'string' ? clientRes : clientRes.code;
      expect(code).not.toContain('https://client.api.io/v1/auth');

      // 2. Windows path separator: dist\assets\legacy.cjs -> must be processed
      const cjsRes = plugin.renderChunk(clientJsCode, {
        fileName: 'dist\\assets\\legacy.cjs',
      });
      expect(cjsRes).not.toBeNull();

      // 3. Windows path separator: server\api.js -> must be excluded (returns null)
      const serverRes = plugin.renderChunk(serverJsCode, {
        fileName: 'server\\api.js',
      });
      expect(serverRes).toBeNull();

      // 4. Windows path separator: node_modules\some-pkg\index.js -> must be excluded
      const nodeModulesRes = plugin.renderChunk(clientJsCode, {
        fileName: 'node_modules\\some-pkg\\index.js',
      });
      expect(nodeModulesRes).toBeNull();

      // 5. Non-JS extension -> must be excluded
      const cssRes = plugin.renderChunk('.body { color: red; }', {
        fileName: 'dist\\assets\\styles.css',
      });
      expect(cssRes).toBeNull();
    });
  });

  describe('8. unpeek.config Loading and Overrides', () => {
    it('loads and resolves unpeek.config.json with custom overrides', async () => {
      const configJsonPath = path.join(tmpDir, 'unpeek.config.json');
      fs.writeFileSync(
        configJsonPath,
        JSON.stringify({
          framework: 'vite',
          target: 'universal',
          vault: {
            minStringLength: 12,
            reservedProps: ['customPropA', 'customPropB'],
          },
          hotPath: {
            customHooks: ['useCustomAnimationHook'],
          },
        }),
        'utf8'
      );

      const loaded = await loadUnpeekConfig(tmpDir);
      expect(loaded.framework).toBe('vite');
      expect(loaded.target).toBe('universal');
      expect(loaded.vault?.minStringLength).toBe(12);
      expect(loaded.vault?.reservedProps).toContain('customPropA');
      expect(loaded.hotPath?.customHooks).toContain('useCustomAnimationHook');

      const synced = resolveUnpeekConfigSync(tmpDir);
      expect(synced.vault?.minStringLength).toBe(12);
    });

    it('enforces loaded unpeek.config.json overrides during protectProject execution', async () => {
      const configJsonPath = path.join(tmpDir, 'unpeek.config.json');
      fs.writeFileSync(
        configJsonPath,
        JSON.stringify({
          vault: {
            minStringLength: 10,
          },
        }),
        'utf8'
      );

      const distDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      const bundlePath = path.join(distDir, 'main.js');

      // 'short_str' is 9 chars (< 10) -> stays plaintext
      // 'very_long_secret_value' is 22 chars (>= 10) -> encrypted
      fs.writeFileSync(
        bundlePath,
        `
        const shortVal = "short_str";
        const longVal = "very_long_secret_value";
        console.log(shortVal, longVal);
        `,
        'utf8'
      );

      await protectProject({
        cwd: tmpDir,
        outDir: distDir,
        keepPrivateMaps: false,
      });

      const protectedCode = fs.readFileSync(bundlePath, 'utf8');
      expect(protectedCode).toContain('short_str');
      expect(protectedCode).not.toContain('very_long_secret_value');
    });
  });

  describe('9. v1.13.0 Tier 2 Aggressive & Rolling Salted Vault End-to-End', () => {
    it('encodes salted strings with non-repeating per-character rolling keystream and executes aggressive mode cleanly under strict CSP', async () => {
      const { encodeSaltedString, decodeSaltedString } = await import('../src/ast/salted-vault.js');

      const repeatedPlain = 'AAAAAAAAAAAAAAAAAAAA';
      const enc = encodeSaltedString(repeatedPlain, 0x13572468);
      expect(decodeSaltedString(enc, 0x13572468)).toBe(repeatedPlain);
      // Keystream must vary across characters rather than repeating every 24 bytes / single char
      expect(new Set(enc.split('')).size).toBeGreaterThan(4);

      const source = `
        'use strict';
        function checkAccess(role, factor) {
          var secretPrefix = "TIER2_STRICT_CSP_KEY_";
          if (factor > 10) {
            return secretPrefix + role + ":" + (factor * 2);
          } else {
            return secretPrefix + role + ":" + (factor + 1);
          }
        }
        return [checkAccess("admin", 12), checkAccess("guest", 3)];
      `;

      const transformedNoShield = transformJavaScript(source, {
        seed: 0x2468ace0,
        minStringLength: 4,
        aggressive: true,
        injectRuntimeShield: false,
      });
      expect(transformedNoShield.code.trim().startsWith("'use strict';")).toBe(true);

      const transformed = transformJavaScript(source, {
        seed: 0x2468ace0,
        minStringLength: 4,
        aggressive: true,
        injectRuntimeShield: true,
      });

      expect(transformed.code).toContain("'use strict';");
      expect(transformed.code).not.toContain('TIER2_STRICT_CSP_KEY_');
      expect(transformed.code).not.toMatch(/\bswitch\s*\(/);

      // Test under strict CSP (WebAssembly unavailable)
      const cspScope: Record<string, any> = {
        Function,
        String,
        Math,
        JSON,
        Uint8Array,
        Promise,
        WebAssembly: undefined,
        CustomEvent: class {},
        navigator: { userAgent: 'Mozilla/5.0 Chrome', webdriver: false },
      };
      cspScope.self = cspScope;
      cspScope.globalThis = cspScope;
      const ctx = vm.createContext(cspScope);
      const result = vm.runInContext(`(function(){${transformed.code}})()`, ctx);
      expect(result).toEqual(['TIER2_STRICT_CSP_KEY_admin:24', 'TIER2_STRICT_CSP_KEY_guest:4']);
    });
  });

  describe('10. Live Red-Team Audit Remediation (Findings 1-9)', () => {
    it('Finding 1 (P0): coldFlow handles Object.create(null), Symbol.toStringTag, and BigInt params without TypeError and skips already-virtualized functions', () => {
      // Case A: Full strict + aggressive transform where vmTarget is virtualized and nonVmTarget gets coldFlow guard
      const source = `
        function vmTarget(x, y) {
          var sum = x + y;
          if (sum > 5) return sum * 2;
          return sum + 1;
        }
        function nonVmTarget(obj, key, desc) {
          // Uses arguments so Micro-VM skips it and coldFlow guards it directly
          if (arguments.length < 2) return null;
          if (typeof key === 'symbol') return Object.defineProperty(obj, key, desc);
          if (typeof obj === 'bigint') return obj + 1n;
          return Object.getPrototypeOf(obj) === null ? 'null-proto' : 'normal';
        }
        globalThis.__vmOut = vmTarget(4, 3);
        globalThis.__nullProtoOut = nonVmTarget(Object.create(null), 'k', {});
        const tagged = {};
        nonVmTarget(tagged, Symbol.toStringTag, { value: 'TurbopackModule', configurable: true });
        globalThis.__symTagOut = Object.prototype.toString.call(tagged);
        globalThis.__bigIntOut = nonVmTarget(41n, 'b', {});
      `;

      const res = transformJavaScript(source, {
        profile: 'strict',
        aggressive: true,
        coldFlow: true,
        injectRuntimeShield: false,
        seed: 0x11223344,
      });

      expect(res.virtualizedFunctionsCount).toBeGreaterThanOrEqual(1);

      // Verify virtualized function wrapper does NOT receive a duplicate coldFlow IfStatement guard
      const ast = acorn.parse(res.code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
      const vmTargetNode = ast.body.find(
        (s: any) => s.type === 'FunctionDeclaration' && s.id?.name === 'vmTarget'
      );
      expect(vmTargetNode).toBeDefined();
      expect(vmTargetNode.body.body).toHaveLength(1);
      expect(vmTargetNode.body.body[0].type).toBe('ReturnStatement');
      expect(vmTargetNode.body.body[0].argument?.callee?.name).toMatch(/^_uVm/);

      // Verify nonVmTarget received coldFlow guard and runs cleanly with Object.create(null), Symbol, BigInt
      const nonVmNode = ast.body.find(
        (s: any) => s.type === 'FunctionDeclaration' && s.id?.name === 'nonVmTarget'
      );
      expect(nonVmNode).toBeDefined();
      expect(nonVmNode.body.body[0].type).toBe('IfStatement');

      const ctx: Record<string, any> = { Object, Symbol };
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      expect(() => vm.runInContext(res.code, ctx)).not.toThrow();
      expect(ctx.__vmOut).toBe(14);
      expect(ctx.__nullProtoOut).toBe('null-proto');
      expect(ctx.__symTagOut).toBe('[object TurbopackModule]');
      expect(ctx.__bigIntOut).toBe(42n);

      // Case B: Direct applyColdFlowGuard on rest/destructured/null-proto/Symbol/BigInt parameters
      const directAst = acorn.parse(
        `function exportNs(a, b, ...rest) {
          if (typeof b === 'symbol') return Object.defineProperty(a, b, { value: rest[0], configurable: true });
          if (typeof a === 'bigint') return a * 2n;
          return Object.getPrototypeOf(a) === null ? 'null-obj' : String(a);
        }`,
        { ecmaVersion: 'latest' }
      ) as any;
      const coldSet = new WeakSet<acorn.Node>();
      coldSet.add(directAst.body[0]);
      const guarded = applyColdFlowGuard(directAst, coldSet, 0x998877);
      expect(guarded).toBe(1);

      const directOut = generateCompactJs(directAst);
      const directCtx: Record<string, any> = { Object, Symbol, String };
      directCtx.globalThis = directCtx;
      vm.createContext(directCtx);
      vm.runInContext(directOut, directCtx);

      expect(directCtx.exportNs(Object.create(null), 'k')).toBe('null-obj');
      const nsObj: Record<PropertyKey, unknown> = {};
      directCtx.exportNs(nsObj, Symbol.toStringTag, 'Module');
      expect(nsObj[Symbol.toStringTag]).toBe('Module');
      expect(directCtx.exportNs(21n, 'x')).toBe(42n);
    });

    it('Finding 2 (P0): TURBOPACK.push([...]) exempts chunk metadata header while encrypting module factory strings', () => {
      const turboBundle = `
        (globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([
          typeof document === "object" ? document.currentScript : void 0,
          12345,
          (e, t, r) => {
            const apiToken = "TURBOPACK_FLAT_FACTORY_SECRET_991";
            return apiToken + ":" + r;
          },
          {
            98765: function(e, t, r) {
              const mapToken = "TURBOPACK_MAP_FACTORY_SECRET_882";
              return mapToken;
            }
          }
        ]);
      `;

      for (const opts of [
        { profile: 'recommended' as const, aggressive: false },
        { profile: 'strict' as const, aggressive: true },
      ]) {
        const res = transformJavaScript(turboBundle, {
          ...opts,
          seed: 0x22334455,
          minStringLength: 4,
          injectRuntimeShield: false,
        });

        expect(res.encryptedStringsCount).toBeGreaterThan(0);
        expect(res.code).not.toContain('TURBOPACK_FLAT_FACTORY_SECRET_991');
        expect(res.code).not.toContain('TURBOPACK_MAP_FACTORY_SECRET_882');
        expect(res.code).toContain('document.currentScript');

        const pushed: any[] = [];
        const ctx: Record<string, any> = {
          document: { currentScript: { src: '/_next/static/chunks/app.js' } },
          TURBOPACK: pushed,
          Uint8Array,
          WebAssembly,
          Math,
          String,
          Promise,
        };
        ctx.window = ctx;
        ctx.self = ctx;
        ctx.globalThis = ctx;
        vm.createContext(ctx);
        vm.runInContext(res.code, ctx);

        expect(pushed).toHaveLength(1);
        expect(pushed[0][0]).toEqual({ src: '/_next/static/chunks/app.js' });
        expect(pushed[0][1]).toBe(12345);
        expect(pushed[0][2](null, null, 'ok')).toBe('TURBOPACK_FLAT_FACTORY_SECRET_991:ok');
        expect(pushed[0][3][98765](null, null, null)).toBe('TURBOPACK_MAP_FACTORY_SECRET_882');
      }
    });

    it('Finding 3 (P0): protects WGSL/GLSL shader templates with Uint8Array + TextDecoder + finally Shader Vault in both recommended and strict/aggressive modes alongside rAF and TURBOPACK.push', () => {
      const wgslShader =
        'struct Frame { time: f32 }; @vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }';
      const glslShader =
        'precision highp float; uniform float uTime; void main() { gl_Position = vec4(uTime, 0.0, 0.0, 1.0); }';

      const source = `
        (globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([
          typeof document === "object" ? document.currentScript : void 0,
          4455,
          (e, t, r) => {
            const SHARD_SHADER = \`${wgslShader}\`;
            const TUNNEL_GLSL = \`${glslShader}\`;
            function renderLoop(ts) {
              requestAnimationFrame(renderLoop);
              return ts;
            }
            globalThis.__getShaders = () => ({ wgsl: SHARD_SHADER, glsl: TUNNEL_GLSL, raf: renderLoop });
          }
        ]);
      `;

      for (const opts of [
        { profile: 'recommended' as const, aggressive: false },
        { profile: 'strict' as const, aggressive: true },
      ]) {
        const res = transformJavaScript(source, {
          ...opts,
          seed: 0x33445566,
          minStringLength: 4,
          injectRuntimeShield: false,
        }) as InternalTransformResult;

        expect(res.shaderBuffersCount).toBeGreaterThanOrEqual(2);
        expect(res.code).toContain('Uint8Array');
        expect(res.code).toContain('TextDecoder');
        expect(res.code).toContain('finally');
        expect(res.code).not.toContain('struct Frame');
        expect(res.code).not.toContain('@vertex');
        expect(res.code).not.toContain('gl_Position');

        const pushed: any[] = [];
        const ctx: Record<string, any> = {
          document: { currentScript: null },
          TURBOPACK: pushed,
          Uint8Array,
          TextDecoder,
          WebAssembly,
          Math,
          String,
          Promise,
          atob: (b64: string) => Buffer.from(b64, 'base64').toString('binary'),
          requestAnimationFrame: () => 1,
        };
        ctx.window = ctx;
        ctx.self = ctx;
        ctx.globalThis = ctx;
        vm.createContext(ctx);
        vm.runInContext(res.code, ctx);
        pushed[0][2](null, null, null);

        const shaders = ctx.__getShaders();
        expect(shaders.wgsl).toBe(wgslShader);
        expect(shaders.glsl).toBe(glslShader);
      }
    });

    it('Finding 4 (P1): Next.js adapter modifyConfig auto-injects outputHashSalt and detector supports .vercel/output/static/_next/static', async () => {
      const prevDep = process.env.VERCEL_DEPLOYMENT_ID;
      const prevSha = process.env.VERCEL_GIT_COMMIT_SHA;
      try {
        process.env.VERCEL_DEPLOYMENT_ID = 'dpl_redteam_test_123';
        delete process.env.VERCEL_GIT_COMMIT_SHA;

        const adapter = createUnpeekNextAdapter({
          profile: 'strict',
          aggressive: true,
        });
        const modEmpty = await adapter.modifyConfig!({});
        expect(typeof modEmpty.outputHashSalt).toBe('string');
        expect(String(modEmpty.outputHashSalt)).toContain('unpeek:');
        expect(String(modEmpty.outputHashSalt)).toContain('strict');
        expect(String(modEmpty.outputHashSalt)).toContain('dpl_redteam_test_123');

        // Preserves existing salt and stays idempotent when unpeek: is already present
        const modMerged = await adapter.modifyConfig!({ outputHashSalt: 'user-salt' });
        expect(String(modMerged.outputHashSalt)).toContain('user-salt');
        expect(String(modMerged.outputHashSalt)).toContain('unpeek:');
        const modIdempotent = await adapter.modifyConfig!(modMerged);
        expect(modIdempotent.outputHashSalt).toBe(modMerged.outputHashSalt);
      } finally {
        if (prevDep === undefined) delete process.env.VERCEL_DEPLOYMENT_ID;
        else process.env.VERCEL_DEPLOYMENT_ID = prevDep;
        if (prevSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
        else process.env.VERCEL_GIT_COMMIT_SHA = prevSha;
      }

      // Vercel build output fallback (.vercel/output/static/_next/static) when .next/static is empty/absent
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'vercel-next16-app', dependencies: { next: '16.4.5' } }),
        'utf8'
      );
      fs.mkdirSync(path.join(tmpDir, '.next', 'static'), { recursive: true });
      const vercelChunksDir = path.join(
        tmpDir,
        '.vercel',
        'output',
        'static',
        '_next',
        'static',
        'chunks'
      );
      fs.mkdirSync(vercelChunksDir, { recursive: true });
      const vercelChunk = path.join(vercelChunksDir, 'app-vercel.js');
      fs.writeFileSync(
        vercelChunk,
        'export function readVercelSecret() { return "VERCEL_OUTPUT_STATIC_SECRET"; }',
        'utf8'
      );

      const detected = detectTargetFramework(tmpDir);
      expect(detected.framework).toBe('nextjs');
      expect(detected.outDir.replace(/\\/g, '/')).toContain(
        '.vercel/output/static/_next/static'
      );

      const summary = await protectProject({
        cwd: tmpDir,
        keepPrivateMaps: false,
      });
      expect(summary.processedFiles).toBe(1);
      expect(fs.readFileSync(vercelChunk, 'utf8')).not.toContain('VERCEL_OUTPUT_STATIC_SECRET');
    });

    it('Finding 5 (P1): derivePolymorphicIdent never produces "undefined" for seed 2574799107 or negative/boundary seeds', () => {
      const target = derivePolymorphicIdent(2574799107, 'windowKey');
      expect(target).not.toContain('undefined');
      expect(target).toMatch(/^[a-zA-Z_$][0-9a-zA-Z_$]{3}$/);

      const boundarySeeds = [
        0,
        1,
        -1,
        -2032694735,
        2574799107,
        0x7fffffff,
        0x80000000,
        0xffffffff,
        -0x80000000,
        0x9e3779b9,
        0xdeadbeef,
      ];
      const roles = ['windowKey', 'shield', 'vault', 'shader', 'salted', 'vm', 'wasm'] as const;
      for (const s of boundarySeeds) {
        for (const role of roles) {
          const ident = derivePolymorphicIdent(s, role);
          expect(ident).not.toContain('undefined');
          expect(ident).not.toContain('NaN');
          expect(ident).toMatch(/^[a-zA-Z_$][0-9a-zA-Z_$]{3}$/);
        }
      }

      // Fuzz 3,000 sequential/mixed 32-bit seeds across windowKey
      for (let i = 0; i < 3000; i++) {
        const s = (Math.imul(i + 1, 0x9e3779b9) ^ (i << 19)) | 0;
        const ident = derivePolymorphicIdent(s, 'windowKey');
        expect(ident).not.toContain('undefined');
        expect(ident).toMatch(/^[a-zA-Z_$][0-9a-zA-Z_$]{3}$/);
      }
    });

    it('Finding 6 (P1): v8_V shield detects naive & smart Proxy(Function.prototype.toString) and Proxy(Reflect.apply), and _uVm* self-hashes against pretty-printing', () => {
      const seed = 0x61626364;
      const windowKeySymbol = '_zPxy';
      const snippet = createDeterrentSnippet({ seed, windowKeySymbol });

      // Control: clean browser-like context must pass with s[0] === 1
      const cleanWin: Record<string, unknown> = {};
      const cleanCtx = vm.createContext({ window: cleanWin });
      vm.runInContext(snippet, cleanCtx);
      expect(cleanWin.__unpeek_tampered).toBeUndefined();
      expect((cleanWin[`${windowKeySymbol}_s`] as number[])[0]).toBe(1);
      const cleanDelta = cleanWin[windowKeySymbol];

      const proxySetupScripts: Array<{ label: string; setup: string }> = [
        {
          label: 'naive Proxy(Function.prototype.toString)',
          setup: `
            const origToString = Function.prototype.toString;
            Function.prototype.toString = new Proxy(origToString, {
              apply(target, thisArg, args) {
                return Reflect.apply(target, thisArg, args);
              }
            });
          `,
        },
        {
          label: 'smart self-spoofing Proxy(Function.prototype.toString)',
          setup: `
            const origToString = Function.prototype.toString;
            const proxyToString = new Proxy(origToString, {
              apply(target, thisArg, args) {
                if (thisArg === proxyToString) {
                  return 'function toString() { [native code] }';
                }
                return Reflect.apply(target, thisArg, args);
              }
            });
            Function.prototype.toString = proxyToString;
          `,
        },
        {
          label: 'naive Proxy(Reflect.apply)',
          setup: `
            const origApply = Reflect.apply;
            Reflect.apply = new Proxy(origApply, {
              apply(target, thisArg, args) {
                return origApply(target, thisArg, args);
              }
            });
          `,
        },
        {
          label: 'smart self-spoofing Proxy(Reflect.apply)',
          setup: `
            const origApply = Reflect.apply;
            const origToString = Function.prototype.toString;
            const proxyApply = new Proxy(origApply, {
              apply(target, thisArg, args) {
                if (args && args[0] === origToString && args[1] === proxyApply) {
                  return 'function apply() { [native code] }';
                }
                return origApply(target, thisArg, args);
              }
            });
            Reflect.apply = proxyApply;
          `,
        },
      ];

      for (const { label, setup } of proxySetupScripts) {
        const w: Record<string, unknown> = {};
        const ctx = vm.createContext({ window: w });
        vm.runInContext(setup, ctx);
        vm.runInContext(snippet, ctx);
        expect(w.__unpeek_tampered, `Failed to detect ${label}`).toBe(true);
        expect((w[`${windowKeySymbol}_s`] as number[])[0], `Expected s[0]=2 for ${label}`).toBe(2);
        expect(w[windowKeySymbol], `Expected poisoned delta for ${label}`).not.toBe(cleanDelta);
      }

      // 6C: _uVm* self-integrity hash detects pretty-printing / newline formatting
      const vmSource = `
        function computeSecretTier(x, y) {
          var score = (x * 3) + y;
          if (score > 10) {
            return "VM_PASS_" + score;
          }
          return "VM_FAIL_" + score;
        }
        globalThis.__vmSelfHashOut = computeSecretTier(4, 2);
      `;
      const vmRes = transformJavaScript(vmSource, {
        profile: 'strict',
        aggressive: true,
        injectRuntimeShield: false,
        seed: 0x55aa1122,
      });
      expect(vmRes.virtualizedFunctionsCount).toBe(1);

      // Clean minified VM runs accurately
      const cleanVmCtx: Record<string, any> = { window: {} };
      cleanVmCtx.globalThis = cleanVmCtx;
      vm.createContext(cleanVmCtx);
      vm.runInContext(vmRes.code, cleanVmCtx);
      expect(cleanVmCtx.__vmSelfHashOut).toBe('VM_PASS_14');

      // Pretty-printing _uVm* (both outer factory $I and inner 6-param $vm runner) triggers self-hash fail-closed
      const vmParsed = acorn.parse(vmRes.code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
      let outerBodyStart = -1;
      let innerBodyStart = -1;
      walk.simple(vmParsed, {
        VariableDeclarator(decl: any) {
          if (decl.id?.type === 'Identifier' && /^_uVm/.test(decl.id.name) && decl.init?.callee?.body) {
            outerBodyStart = decl.init.callee.body.start;
            walk.simple(decl.init.callee.body, {
              FunctionExpression(fn: any) {
                if (fn.params?.length === 6 && fn.body) {
                  innerBodyStart = fn.body.start;
                }
              },
            });
          }
        },
      });
      expect(outerBodyStart).toBeGreaterThan(-1);
      expect(innerBodyStart).toBeGreaterThan(-1);
      const formattedOuterVm = `${vmRes.code.slice(0, outerBodyStart + 1)}\n  ${vmRes.code.slice(outerBodyStart + 1)}`;
      const formattedInnerVm = `${vmRes.code.slice(0, innerBodyStart + 1)}\n  ${vmRes.code.slice(innerBodyStart + 1)}`;
      expect(formattedOuterVm).not.toBe(vmRes.code);
      expect(formattedInnerVm).not.toBe(vmRes.code);
      for (const tamperedVmCode of [formattedOuterVm, formattedInnerVm]) {
        const prettyVmCtx: Record<string, any> = { window: {} };
        prettyVmCtx.globalThis = prettyVmCtx;
        vm.createContext(prettyVmCtx);
        let prettyResult: unknown;
        try {
          vm.runInContext(tamperedVmCode, prettyVmCtx);
          prettyResult = prettyVmCtx.__vmSelfHashOut;
        } catch {
          prettyResult = '__THROWN__';
        }
        expect(prettyResult).not.toBe('VM_PASS_14');
      }
    });

    it('Finding 7 (P2): QNR branches span diverse modular residue families (mod 4, mod 8, mod 16) with alias perturbation, and VM handler MBA expressions do not collapse to 0', () => {
      // 7A: Diverse QNR families across fnIndex + alias write-read perturbation + always false
      const predicates: string[] = [];
      for (let i = 0; i < 8; i++) {
        const guard = createSotaMbaPredicate(0x77112233, i, 'arg0', '_d', false, {
          liveVars: ['arg0'],
          sboxIdent: '_uSb1234',
          aliasIdentA: '_uAl1234',
          aliasIdentB: '_uAm1234',
          scratchVarIdent: '_uZt1234',
          returnDomain: 'number',
        });
        const code = generate(guard);
        predicates.push(code);

        // Runtime execution must always evaluate predicate to false across varying inputs
        const ctx = vm.createContext({
          Math,
          String,
          _uSb1234: Array.from({ length: 256 }, (_, k) => (k * 73 + 19) & 255),
          _uAl1234: [11, 22, 33, 44],
          _uAm1234: [11, 22, 33, 44],
          _uZt1234: 0,
          _d: [() => ({ a: 1 }), () => ({ b: 2 }), () => ({ c: 3 })],
        });
        for (let k = -5; k < 25; k++) {
          const out = vm.runInContext(`(function(arg0){ ${code} return "OK"; })(${k})`, ctx);
          expect(out).toBe('OK');
        }
      }

      const joined = predicates.join('\n');
      expect(joined).toContain('& 3');
      expect(joined).toContain('& 7');
      expect(joined).toContain('& 15');
      // Must include alias table perturbation inside test sequence
      expect(joined).toMatch(/_uAl1234\[\d+\]\s*=/);

      // 7B: VM handler MBA expressions stay invariant non-zero constants (not collapsing to 0) across 64 test vectors
      const vmRes = transformJavaScript(
        `function sumCheck(a, b) { var c = a + b; if (c > 0) return c * 2; return c - 1; }`,
        { profile: 'strict', aggressive: true, injectRuntimeShield: false, seed: 0x44882211 }
      );
      expect(vmRes.virtualizedFunctionsCount).toBe(1);

      const vmAst = acorn.parse(vmRes.code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
      let handlerArrayNode: any = null;
      walk.simple(vmAst, {
        VariableDeclarator(node: any) {
          if (
            node.id?.type === 'Identifier' &&
            node.id.name === '$H' &&
            node.init?.type === 'ArrayExpression'
          ) {
            handlerArrayNode = node.init;
          }
        },
      });
      expect(handlerArrayNode).not.toBeNull();
      expect(handlerArrayNode.elements).toHaveLength(43);

      let nonZeroConstantCount = 0;
      for (const handlerFn of handlerArrayNode.elements) {
        const firstDecl = handlerFn?.body?.body?.[0];
        if (firstDecl?.type !== 'VariableDeclaration') continue;
        const initExpr = firstDecl.declarations?.[0]?.init;
        if (!initExpr) continue;
        const exprCode = generate(initExpr);
        const evalFn = new Function('$f', `return (${exprCode});`);
        const observed = new Set<number>();
        let rng = 0x12345678 | 0;
        for (let v = 0; v < 64; v++) {
          rng = (Math.imul(rng ^ 0x9e3779b9, 0x45d9f3b) + 1) | 0;
          const ac = rng;
          const p = (rng ^ (v * 0x27d4eb2d)) >>> 0;
          observed.add(evalFn({ ac, p }) as number);
        }
        // Must evaluate to a single deterministic constant != 0 across all 64 vectors
        expect(observed.size).toBe(1);
        const val = Array.from(observed)[0];
        expect(val).not.toBe(0);
        if (val !== 0) nonZeroConstantCount++;
      }
      expect(nonZeroConstantCount).toBe(43);
    });

    it('Finding 8 (P2): hybrid browser context lock fails closed in bare node:vm while preserving browser async order-independence, and prunes dead post-RET epilogue', () => {
      const seed = 0x81828384;
      const shield = generateRuntimeShield({ seed, deterrentMode: 'passive' });
      const source = `
        function getCoupledSecret(n) {
          var prefix = "HYBRID_LOCK_SECRET_";
          if (n > 0) {
            return prefix + (n + 5);
          }
          return prefix + "ZERO";
        }
        globalThis.__getCoupled = getCoupledSecret;
      `;

      const coupled = transformJavaScript(source, {
        seed,
        profile: 'strict',
        aggressive: true,
        minStringLength: 4,
        injectRuntimeShield: false,
        ...( {
          shieldCoupled: true,
          windowKeySymbol: shield.windowKeySymbol,
          expectedDelta: shield.expectedDelta,
        } as Partial<InternalTransformOptions> ),
      });
      expect(coupled.virtualizedFunctionsCount).toBe(1);
      expect(coupled.encryptedStringsCount).toBeGreaterThan(0);

      // 1. Bare node:vm context (no window, no document, no self, sv === undefined) -> MUST FAIL CLOSED
      const bareCtx: Record<string, any> = {
        Uint8Array,
        WebAssembly,
        Math,
        String,
        Promise,
      };
      bareCtx.globalThis = bareCtx;
      vm.createContext(bareCtx);
      let bareResult: unknown;
      try {
        vm.runInContext(coupled.code, bareCtx);
        bareResult = bareCtx.__getCoupled(5);
      } catch {
        bareResult = '__THROWN__';
      }
      expect(bareResult).not.toBe('HYBRID_LOCK_SECRET_10');

      // Bare window = {} (without genuine loading document) fails closed when shield is missing
      const bareWindowCtx: Record<string, any> = {
        window: {},
        Uint8Array,
        WebAssembly,
        Math,
        String,
        Promise,
      };
      bareWindowCtx.globalThis = bareWindowCtx;
      vm.createContext(bareWindowCtx);
      let bareWindowResult: unknown;
      try {
        vm.runInContext(coupled.code, bareWindowCtx);
        bareWindowResult = bareWindowCtx.__getCoupled(5);
      } catch {
        bareWindowResult = '__THROWN__';
      }
      expect(bareWindowResult).not.toBe('HYBRID_LOCK_SECRET_10');

      // 2. Genuine loading DOM context BEFORE shield loads (sv === undefined) -> works (order-independent)
      const doc = { nodeType: 9, scripts: [{}], readyState: 'loading' };
      const browserCtx: Record<string, any> = {
        document: doc,
        Uint8Array,
        WebAssembly,
        Math,
        String,
        Promise,
      };
      browserCtx.window = browserCtx;
      browserCtx.self = browserCtx;
      browserCtx.globalThis = browserCtx;
      vm.createContext(browserCtx);
      vm.runInContext(coupled.code, browserCtx);
      expect(browserCtx[shield.windowKeySymbol]).toBeUndefined();
      expect(browserCtx.__getCoupled(5)).toBe('HYBRID_LOCK_SECRET_10');

      // Shield loads afterward -> continues working cleanly
      vm.runInContext(shield.preambleCode, browserCtx);
      expect(browserCtx[shield.windowKeySymbol]).toBe(shield.expectedDelta);
      expect(browserCtx.__getCoupled(0)).toBe('HYBRID_LOCK_SECRET_ZERO');

      // 8B: Dead post-RET / post-THROW epilogue pruning in compileFunctionToBytecode
      const opMap = generateOpcodeMap(seed);
      const retAst = acorn.parse('function addVals(a, b) { return a + b; }', {
        ecmaVersion: 'latest',
      }) as any;
      const compiledRet = compileFunctionToBytecode(retAst.body[0], opMap);
      expect(compiledRet).not.toBeNull();
      expect(compiledRet!.consts).toEqual([]);
      expect(compiledRet!.bytecode).toHaveLength(6);
      expect(compiledRet!.bytecode[compiledRet!.bytecode.length - 1]).toBe(opMap[OP_RET]);

      const throwAst = acorn.parse('function failFast(err) { throw err; }', {
        ecmaVersion: 'latest',
      }) as any;
      const compiledThrow = compileFunctionToBytecode(throwAst.body[0], opMap);
      expect(compiledThrow).not.toBeNull();
      expect(compiledThrow!.consts).toEqual([]);
      expect(compiledThrow!.bytecode).toHaveLength(3);
      expect(compiledThrow!.bytecode[compiledThrow!.bytecode.length - 1]).toBe(opMap[OP_THROW]);

      // Non-terminal function still gets the undefined RET epilogue
      const voidAst = acorn.parse('function sideEffect(a) { var x = a + 1; }', {
        ecmaVersion: 'latest',
      }) as any;
      const compiledVoid = compileFunctionToBytecode(voidAst.body[0], opMap);
      expect(compiledVoid).not.toBeNull();
      expect(compiledVoid!.consts).toContain(undefined);
      expect(compiledVoid!.bytecode[compiledVoid!.bytecode.length - 1]).toBe(opMap[OP_RET]);
      expect(compiledVoid!.bytecode[compiledVoid!.bytecode.length - 3]).toBe(opMap[OP_LDC]);
    });

    it('Finding 9 (P2): maxFunctionsPerChunk prioritizes onSubmit/critical handlers over early trivial helpers, and checkProject requireZeroEval uses zero-hardcode baseline delta + sourcemap node_modules attribution', async () => {
      // 9A: Priority queue for maxFunctionsPerChunk
      const manyFnsSource = `
        function tinyHelper0(x) { var a = x + 1; return a * 2; }
        function tinyHelper1(x) { var a = x + 2; return a * 2; }
        function tinyHelper2(x) { var a = x + 3; return a * 2; }
        function tinyHelper3(x) { var a = x + 4; return a * 2; }
        async function onSubmit(event) {
          event.preventDefault();
          var token = "CRITICAL_SUBMIT_TOKEN_9A";
          var payload = { token: token, ok: true };
          return await fetch("/api/submit", { method: "POST", body: JSON.stringify(payload) });
        }
        function validatePaymentForm(card) {
          var cvv = card.cvv;
          var num = card.number;
          if (!cvv || !num) return false;
          return cvv.length >= 3 && num.length >= 12;
        }
      `;

      const vmPriorityRes = transformJavaScript(manyFnsSource, {
        profile: 'strict',
        aggressive: true,
        injectRuntimeShield: false,
        seed: 0x9a9a9a9a,
        critical: { maxFunctionsPerChunk: 2 },
      });
      expect(vmPriorityRes.virtualizedFunctionsCount).toBe(2);

      const parsedOut = acorn.parse(vmPriorityRes.code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as any;
      const getFnNode = (name: string) =>
        parsedOut.body.find((s: any) => s.type === 'FunctionDeclaration' && s.id?.name === name);

      const onSubmitNode = getFnNode('onSubmit');
      const validateNode = getFnNode('validatePaymentForm');
      const helper0Node = getFnNode('tinyHelper0');

      expect(onSubmitNode.body.body).toHaveLength(1);
      expect(onSubmitNode.body.body[0].argument?.callee?.name).toMatch(/^_uVm/);
      expect(validateNode.body.body).toHaveLength(1);
      expect(validateNode.body.body[0].argument?.callee?.name).toMatch(/^_uVm/);
      // Early tiny helper was NOT virtualized ahead of critical handlers
      expect(generate(helper0Node)).not.toMatch(/_uVm/);

      // 9B: globalThis singleton VM sharing across multi-chunk builds with same seed, isolated across different seeds
      const chunkSeedA = 0x51525354;
      const chunkSeedB = 0x61626364;
      const chunk1 = transformJavaScript(
        `function chunkOneFn(a, b) { var r = a * 2 + b; if (r > 5) return r + 10; return r; } globalThis.__c1 = chunkOneFn;`,
        { profile: 'strict', aggressive: true, injectRuntimeShield: false, seed: chunkSeedA }
      );
      const chunk2 = transformJavaScript(
        `function chunkTwoFn(a, b) { var r = a + b * 3; if (r > 8) return r + 20; return r; } globalThis.__c2 = chunkTwoFn;`,
        { profile: 'strict', aggressive: true, injectRuntimeShield: false, seed: chunkSeedA }
      );
      const chunk3DiffSeed = transformJavaScript(
        `function chunkThreeFn(a, b) { var r = a * 4 + b; if (r > 6) return r + 30; return r; } globalThis.__c3 = chunkThreeFn;`,
        { profile: 'strict', aggressive: true, injectRuntimeShield: false, seed: chunkSeedB }
      );
      const sharedVmCtx: Record<string, any> = { window: {} };
      sharedVmCtx.globalThis = sharedVmCtx;
      vm.createContext(sharedVmCtx);
      vm.runInContext(chunk1.code, sharedVmCtx);
      const vmHelperMatch1 = chunk1.code.match(/var (_uVm[a-z0-9]+)=/);
      expect(vmHelperMatch1).not.toBeNull();
      const firstVmInstance = sharedVmCtx[vmHelperMatch1![1]];
      expect(typeof firstVmInstance).toBe('function');

      vm.runInContext(chunk2.code, sharedVmCtx);
      const vmHelperMatch2 = chunk2.code.match(/var (_uVm[a-z0-9]+)=/);
      expect(vmHelperMatch2).not.toBeNull();
      expect(sharedVmCtx[vmHelperMatch2![1]]).toBe(firstVmInstance);

      vm.runInContext(chunk3DiffSeed.code, sharedVmCtx);
      const vmHelperMatch3 = chunk3DiffSeed.code.match(/var (_uVm[a-z0-9]+)=/);
      expect(vmHelperMatch3).not.toBeNull();
      expect(sharedVmCtx[vmHelperMatch3![1]]).not.toBe(firstVmInstance);

      expect(sharedVmCtx.__c1(3, 1)).toBe(17);
      expect(sharedVmCtx.__c2(2, 3)).toBe(31);
      expect(sharedVmCtx.__c3(2, 1)).toBe(39);

      // 9C: Zero-hardcode checkProject({ requireZeroEval: true })
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'zero-eval-check-app' }),
        'utf8'
      );
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.unpeek-maps/\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, '.dockerignore'), '.unpeek-maps/\n', 'utf8');

      const distDir = path.join(tmpDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      // 1. ES5 globalThis polyfill Function("return this") -> warning, NOT error under requireZeroEval
      const es5File = path.join(distDir, 'es5-polyfill.js');
      fs.writeFileSync(es5File, 'var g = Function("return this")();', 'utf8');
      const es5Check = await checkProject({ cwd: tmpDir, outDir: 'dist', requireZeroEval: true });
      expect(es5Check.passed).toBe(true);
      expect(es5Check.violations.some((v) => v.rule === 'eval-csp')).toBe(false);
      expect(es5Check.warnings.some((w) => w.rule === 'eval-csp')).toBe(true);

      // 2. SourceMap node_modules/ attribution -> warning, NOT error under requireZeroEval
      fs.rmSync(es5File, { force: true });
      const vendorMappedFile = path.join(distDir, 'vendor-mapped.js');
      const vendorJs = 'var compiled = new Function("a", "return a + 1");';
      const colOfNewFn = vendorJs.indexOf('new Function');
      const vaultMapsDir = path.join(tmpDir, '.unpeek-maps');
      fs.mkdirSync(vaultMapsDir, { recursive: true });
      const vendorMap = {
        version: 3,
        file: 'vendor-mapped.js',
        sources: ['node_modules/some-arbitrary-vendor/dist/index.js'],
        names: [],
        mappings: encodeMappings([
          {
            generatedLine: 0,
            generatedColumn: colOfNewFn,
            sourceIndex: 0,
            originalLine: 10,
            originalColumn: 2,
          },
        ]),
      };
      fs.writeFileSync(vendorMappedFile, vendorJs, 'utf8');
      fs.writeFileSync(
        path.join(vaultMapsDir, 'vendor-mapped.js.map'),
        JSON.stringify(vendorMap),
        'utf8'
      );
      const mapCheck = await checkProject({ cwd: tmpDir, outDir: 'dist', requireZeroEval: true });
      expect(mapCheck.passed).toBe(true);
      expect(mapCheck.violations.some((v) => v.rule === 'eval-csp')).toBe(false);
      expect(mapCheck.warnings.some((w) => w.rule === 'eval-csp')).toBe(true);

      // 3. Manifest pre-existing baseline delta via protectProject -> pre-existing stays warning, NEW eval fails
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.rmSync(vaultMapsDir, { recursive: true, force: true });
      fs.mkdirSync(distDir, { recursive: true });

      const appBundle = path.join(distDir, 'app-vendor.js');
      fs.writeFileSync(
        appBundle,
        'function vendorJit(x) { return Function("v", "return v * 2")(x); }\nfunction appSecret() { return "BASELINE_SECRET_STR"; }\nconsole.log(vendorJit(3), appSecret());',
        'utf8'
      );
      await protectProject({ cwd: tmpDir, outDir: 'dist', seed: 0x123456 });

      const baselineCheck = await checkProject({
        cwd: tmpDir,
        outDir: 'dist',
        requireZeroEval: true,
      });
      expect(baselineCheck.passed).toBe(true);
      expect(baselineCheck.violations.some((v) => v.rule === 'eval-csp')).toBe(false);
      expect(baselineCheck.warnings.some((w) => w.rule === 'eval-csp')).toBe(true);

      // Injecting a NEW eval() after protection must fail requireZeroEval with error violation
      fs.appendFileSync(appBundle, '\neval("1 + 1");', 'utf8');
      const postTamperCheck = await checkProject({
        cwd: tmpDir,
        outDir: 'dist',
        requireZeroEval: true,
      });
      expect(postTamperCheck.passed).toBe(false);
      expect(postTamperCheck.violations.some((v) => v.rule === 'eval-csp' && v.severity === 'error')).toBe(
        true
      );
    });
  });
});
