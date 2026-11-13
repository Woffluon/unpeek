import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {
  transformJavaScript,
  protectProject,
  loadUnpeekConfig,
} from '../src/index.js';
import { detectHotPaths } from '../src/ast/index.js';
import { scanClientBundles, SUPPORTED_EXTENSIONS } from '../src/bundler/detector.js';
import { unpeekPlugin } from '../src/bundler/unplugin.js';
import { resolveUnpeekConfigSync } from '../src/config.js';
import type { UnpeekConfig } from '../src/types.js';

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
});
