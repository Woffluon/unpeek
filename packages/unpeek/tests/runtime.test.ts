import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import { transformJavaScript } from '../src/ast/index.js';
import {
  computeIntegrityHash,
  verifyCodeIntegrity,
  createDeterrentSnippet,
  generateRuntimeShield,
} from '../src/runtime/index.js';

describe('Runtime Integrity Guard & DevTools Deterrent', () => {
  describe('computeIntegrityHash & verifyCodeIntegrity', () => {
    it('computes deterministic 32-bit unsigned FNV-1a hash and varies by seed', () => {
      const minifiedFn = 'function add(a,b){return a+b;}';
      const hash1 = computeIntegrityHash(minifiedFn, 101);
      const hash2 = computeIntegrityHash(minifiedFn, 101);
      const hash3 = computeIntegrityHash(minifiedFn, 202);

      expect(hash1).toBe(hash2);
      expect(hash1).toBeGreaterThanOrEqual(0);
      expect(hash1).toBeLessThanOrEqual(0xffffffff);
      expect(hash1).not.toBe(hash3);
    });

    it('returns true for unmodified single-line function and false when pretty-printed or monkeypatched', () => {
      const minifiedSource = 'function check(x){if(x>0){return x*2;}return 0;}';
      const seed = 42;
      const expectedHash = computeIntegrityHash(minifiedSource, seed);

      expect(verifyCodeIntegrity(minifiedSource, expectedHash, seed)).toBe(true);

      // Construct a real Function whose toString() has no newlines in body
      const realFn = new Function('a', 'b', 'return a+b');
      const realFnSource = Function.prototype.toString.call(realFn);
      const realFnHash = computeIntegrityHash(realFnSource, seed);
      expect(verifyCodeIntegrity(realFn, realFnHash, seed)).toBe(true);

      // Pretty-printed version of minifiedSource (with newlines and indentation)
      const prettyPrintedSource = `function check(x) {\n  if (x > 0) {\n    return x * 2;\n  }\n  return 0;\n}`;
      expect(verifyCodeIntegrity(prettyPrintedSource, expectedHash, seed)).toBe(false);

      // Monkeypatched function whose toString() was overridden or formatted
      const tamperedFn = function () {
        return 1;
      };
      expect(verifyCodeIntegrity(tamperedFn, realFnHash, seed)).toBe(false);
    });
  });

  describe('createDeterrentSnippet & generateRuntimeShield', () => {
    it('executes safely without throwing in Node.js / SSR environment where window is undefined', () => {
      const shield = generateRuntimeShield({
        seed: 1337,
        deterrentMode: 'gradual',
      });

      expect(shield.preambleCode).toContain("typeof window!=='undefined'");
      expect(shield.preambleCode.includes('\n')).toBe(false);
      expect(Buffer.byteLength(shield.preambleCode, 'utf8')).toBeLessThan(1536);
      expect(shield.preambleCode).not.toContain('outerWidth');
      expect(shield.preambleCode).not.toContain('innerWidth');

      // Execute in isolated VM context without window (SSR simulation)
      const ssrContext = vm.createContext({
        console: {
          log: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          table: vi.fn(),
          dir: vi.fn(),
        },
      });
      expect(() => vm.runInContext(shield.preambleCode, ssrContext)).not.toThrow();
    });

    it('generates polymorphic function and variable names for different seeds', () => {
      const shieldA = generateRuntimeShield({
        seed: 11111,
        deterrentMode: 'gradual',
      });
      const shieldB = generateRuntimeShield({
        seed: 99999,
        deterrentMode: 'gradual',
      });

      expect(shieldA.integrityCheckFnName).not.toBe(shieldB.integrityCheckFnName);
      expect(shieldA.expectedHash).not.toBe(shieldB.expectedHash);
      expect(shieldA.preambleCode).not.toBe(shieldB.preambleCode);
      expect(shieldA.preambleCode).toContain(shieldA.integrityCheckFnName);
      expect(shieldB.preambleCode).toContain(shieldB.integrityCheckFnName);

      const customDeltaShield = generateRuntimeShield({ seed: 42, expectedDelta: 15 });
      expect(customDeltaShield.expectedDelta).toBe(15);
    });

    it('leaves console intact when single-line snippet is untampered, and silences console + sets __unpeek_tampered on pretty-print or toString tampering in gradual mode', () => {
      const snippet = createDeterrentSnippet({
        seed: 777,
        deterrentMode: 'gradual',
      });

      // 1. Untampered execution in browser-like context
      const logSpy = vi.fn();
      const cleanWindow: Record<string, unknown> = {};
      const cleanContext = vm.createContext({
        window: cleanWindow,
        console: {
          log: logSpy,
          debug: logSpy,
          info: logSpy,
          table: logSpy,
          dir: logSpy,
        },
      });

      vm.runInContext(snippet, cleanContext);
      expect(cleanWindow.__unpeek_tampered).toBeFalsy();
      cleanContext.console.log('hello');
      expect(logSpy).toHaveBeenCalledWith('hello');

      // 2. Pretty-printed snippet execution (simulating DevTools Pretty-Print formatting)
      const prettySnippet = snippet.replace(/\{/g, '{\n  ').replace(/;/g, ';\n  ');
      const tamperedLogSpy = vi.fn();
      const tamperedWindow: Record<string, unknown> = {};
      const tamperedConsole = {
        log: tamperedLogSpy,
        debug: tamperedLogSpy,
        info: tamperedLogSpy,
        table: tamperedLogSpy,
        dir: tamperedLogSpy,
      };
      const prettyContext = vm.createContext({
        window: tamperedWindow,
        console: tamperedConsole,
      });

      vm.runInContext(prettySnippet, prettyContext);
      expect(tamperedWindow.__unpeek_tampered).toBe(true);
      prettyContext.console.log('secret');
      prettyContext.console.debug('secret');
      prettyContext.console.info('secret');
      prettyContext.console.table('secret');
      prettyContext.console.dir('secret');
      expect(tamperedLogSpy).not.toHaveBeenCalled();

      // 3. Passive mode marks __unpeek_tampered without overriding console methods
      const passiveSnippet = createDeterrentSnippet({
        seed: 777,
        deterrentMode: 'passive',
      });
      const passivePretty = passiveSnippet.replace(/\{/g, '{\n  ');
      const passiveLogSpy = vi.fn();
      const passiveWindow: Record<string, unknown> = {};
      const passiveContext = vm.createContext({
        window: passiveWindow,
        console: {
          log: passiveLogSpy,
          debug: passiveLogSpy,
          info: passiveLogSpy,
          table: passiveLogSpy,
          dir: passiveLogSpy,
        },
      });

      vm.runInContext(passivePretty, passiveContext);
      expect(passiveWindow.__unpeek_tampered).toBe(true);
      passiveContext.console.log('still-logged');
      expect(passiveLogSpy).toHaveBeenCalledWith('still-logged');
    });

    it('defaults deterrentMode to passive and dispatches unpeek:tamper CustomEvent on tamper detection', () => {
      // 1. Verify default deterrentMode is passive
      const defaultShield = generateRuntimeShield({ seed: 42 });
      expect(defaultShield.preambleCode).not.toContain("['log','debug','info','table','dir']");

      // 2. Verify window.dispatchEvent is called with CustomEvent
      const dispatchSpy = vi.fn();
      let dispatchedEvent: unknown = null;
      class MockCustomEvent {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      }

      const windowObj: Record<string, unknown> = {
        dispatchEvent: (evt: unknown) => {
          dispatchedEvent = evt;
          dispatchSpy(evt);
        },
      };

      const context = vm.createContext({
        window: windowObj,
        CustomEvent: MockCustomEvent,
        console: { log: vi.fn(), debug: vi.fn(), info: vi.fn(), table: vi.fn(), dir: vi.fn() },
      });

      // Pretty-printed snippet triggers tamper detection
      const tamperedSnippet = defaultShield.preambleCode.replace(/\{/g, '{\n  ');
      vm.runInContext(tamperedSnippet, context);

      expect(windowObj.__unpeek_tampered).toBe(true);
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect((dispatchedEvent as any)?.type).toBe('unpeek:tamper');
    });

    it('detects Function.prototype.toString monkeypatching for both tokenBit 0 and tokenBit 1 seeds', () => {
      // Seed 42 and Seed 43 represent different parity bits
      for (const seed of [42, 43]) {
        const snippet = createDeterrentSnippet({ seed });
        const windowObj: Record<string, unknown> = {};
        const context = vm.createContext({
          window: windowObj,
          Function: {
            prototype: {
              toString: function () {
                return 'function () { return "tampered"; }';
              },
            },
          },
        });

        vm.runInContext(snippet, context);
        expect(windowObj.__unpeek_tampered).toBe(true);
        expect(windowObj.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);
      }
    });

    it('leaves webdriver and HeadlessChrome unflagged by default (detectHeadless: false) and triggers tamper when detectHeadless: true', () => {
      const seed = 12345;
      const defaultSnippet = createDeterrentSnippet({ seed });
      const optInSnippet = createDeterrentSnippet({ seed, detectHeadless: true });

      // 1. Default (detectHeadless: false): navigator.webdriver === true is safe (no false positive in Playwright/Puppeteer)
      const defaultWebdriverWindow: Record<string, unknown> = {
        navigator: { webdriver: true, userAgent: 'Mozilla/5.0' },
      };
      vm.runInContext(defaultSnippet, vm.createContext({ window: defaultWebdriverWindow }));
      expect(defaultWebdriverWindow.__unpeek_tampered).toBeUndefined();
      expect(defaultWebdriverWindow.__unpeek_seed).toBeUndefined();

      // 2. Default (detectHeadless: false): HeadlessChrome userAgent is safe
      const defaultHeadlessWindow: Record<string, unknown> = {
        navigator: { webdriver: false, userAgent: 'Mozilla/5.0 HeadlessChrome/122.0.0.0 Safari/537.36' },
      };
      vm.runInContext(defaultSnippet, vm.createContext({ window: defaultHeadlessWindow }));
      expect(defaultHeadlessWindow.__unpeek_tampered).toBeUndefined();
      expect(defaultHeadlessWindow.__unpeek_seed).toBeUndefined();

      // 3. Opt-in (detectHeadless: true): navigator.webdriver === true triggers tamper + seed poisoning
      const webdriverWindow: Record<string, unknown> = {
        navigator: { webdriver: true, userAgent: 'Mozilla/5.0' },
      };
      vm.runInContext(optInSnippet, vm.createContext({ window: webdriverWindow }));
      expect(webdriverWindow.__unpeek_tampered).toBe(true);
      expect(webdriverWindow.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);

      // 4. Opt-in (detectHeadless: true): HeadlessChrome userAgent triggers tamper + seed poisoning
      const headlessWindow: Record<string, unknown> = {
        navigator: { webdriver: false, userAgent: 'Mozilla/5.0 HeadlessChrome/122.0.0.0 Safari/537.36' },
      };
      vm.runInContext(optInSnippet, vm.createContext({ window: headlessWindow }));
      expect(headlessWindow.__unpeek_tampered).toBe(true);
      expect(headlessWindow.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);
    });

    it('executes synchronous self-signature attestation and binds windowKeySymbol for string vault entanglement', () => {
      const seed = 999;
      const windowKeySymbol = '_z99';
      const snippet = createDeterrentSnippet({ seed, windowKeySymbol });

      const windowObj: Record<string, unknown> = {
        navigator: { webdriver: false },
      };

      const context = vm.createContext({
        window: windowObj,
      });

      vm.runInContext(snippet, context);

      // Synchronous attestation completes immediately without queueMicrotask race
      expect(windowObj.__unpeek_tampered).toBeUndefined();
      expect(typeof windowObj[windowKeySymbol]).toBe('number');
      const cleanDelta = windowObj[windowKeySymbol];

      // Tampered environment (pretty-printed code OR detectHeadless: true under webdriver) poisons key synchronously
      const tamperedWindow: Record<string, unknown> = {
        navigator: { webdriver: true },
      };
      const optInSnippet = createDeterrentSnippet({ seed, windowKeySymbol, detectHeadless: true });
      const tamperedContext = vm.createContext({
        window: tamperedWindow,
      });
      vm.runInContext(optInSnippet, tamperedContext);
      expect(tamperedWindow.__unpeek_tampered).toBe(true);
      expect(tamperedWindow.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);
      expect(typeof tamperedWindow[windowKeySymbol]).toBe('number');
      expect(tamperedWindow[windowKeySymbol]).not.toBe(cleanDelta);
    });

    it('detects arrow, bound, and spoofed Function.prototype.toString hooks via prototype/name/length/call(0) checks (UNP-02)', () => {
      const seed = 0x4242;
      const windowKeySymbol = '_zHook';
      const snippet = createDeterrentSnippet({ seed, windowKeySymbol });
      const cleanWindow: Record<string, unknown> = {};
      vm.runInContext(snippet, vm.createContext({ window: cleanWindow }));
      const cleanDelta = cleanWindow[windowKeySymbol];

      const hookFactories: Array<{ label: string; makeHook: () => unknown }> = [
        {
          label: 'arrow function returning [native code]',
          makeHook: () => () => 'function toString() { [native code] }',
        },
        {
          label: 'bound function returning [native code]',
          makeHook: () => (function () { return 'function toString() { [native code] }'; }).bind(null),
        },
        {
          label: 'named toString function with prototype',
          makeHook: () => function toString() { return 'function toString() { [native code] }'; },
        },
        {
          label: 'getter/object lacking call',
          makeHook: () => ({ call: () => 'function toString() { [native code] }' }),
        },
      ];

      for (const { makeHook } of hookFactories) {
        const w: Record<string, unknown> = {};
        const ctx = vm.createContext({
          window: w,
          Function: {
            prototype: {
              toString: makeHook(),
            },
          },
        });
        vm.runInContext(snippet, ctx);
        expect(w.__unpeek_tampered).toBe(true);
        expect(w.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);
        expect(w[windowKeySymbol]).not.toBe(cleanDelta);
      }
    });

    it('resists early-throw setter traps on __unpeek_tampered and windowKeySymbol without aborting poisoning (UNP-02)', () => {
      const seed = 0x7777;
      const windowKeySymbol = '_zTrap';
      const snippet = createDeterrentSnippet({ seed, windowKeySymbol });

      // 1. Setter trap on window.__unpeek_tampered must NOT prevent poisoning of window[sym], __unpeek_delta, String.prototype._u, __unpeek_seed
      const trapTamperedWin: Record<string, unknown> = {};
      Object.defineProperty(trapTamperedWin, '__unpeek_tampered', {
        configurable: true,
        get() { return false; },
        set() { throw new Error('early-throw tampered setter'); },
      });
      const trapCtx1 = vm.createContext({ window: trapTamperedWin });
      trapCtx1.globalThis = trapCtx1;
      expect(() => vm.runInContext(snippet, trapCtx1)).not.toThrow();
      expect(typeof trapCtx1.__unpeek_delta).toBe('number');
      expect(trapTamperedWin.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);
      expect(vm.runInContext('String.prototype._u', trapCtx1)).toBe(14);
      expect(typeof trapTamperedWin[windowKeySymbol]).toBe('number');

      // 2. Setter trap on window[windowKeySymbol] must be detected and still poison __unpeek_tampered, __unpeek_delta, String.prototype._u, __unpeek_seed
      const trapSymWin: Record<string, unknown> = {};
      Object.defineProperty(trapSymWin, windowKeySymbol, {
        configurable: true,
        get() { return 0; },
        set() { throw new Error('early-throw sym setter'); },
      });
      const trapCtx2 = vm.createContext({ window: trapSymWin });
      trapCtx2.globalThis = trapCtx2;
      expect(() => vm.runInContext(snippet, trapCtx2)).not.toThrow();
      expect(trapSymWin.__unpeek_tampered).toBe(true);
      expect(trapSymWin.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);
      expect(typeof trapSymWin.__unpeek_delta).toBe('number');
      expect(vm.runInContext('String.prototype._u', trapCtx2)).toBe(14);
    });

    it('defeats AST shield pruning by coupling string decryptor to runtime shield state such that removing the shield IIFE produces corrupt garbage strings', () => {
      const sourceCode = `
        function getCredentials() {
          return "SUPER_SECRET_DATABASE_CREDENTIAL";
        }
        globalThis.__secret = getCredentials();
      `;

      const result = transformJavaScript(sourceCode, {
        seed: 0x9e3779b9,
        minStringLength: 4,
        injectRuntimeShield: true,
      });

      expect(result.code).toContain('__unpeek_tampered');

      // 1. When executed in a browser-like context (window = {}), the strings decode cleanly
      const browserWindow: Record<string, unknown> = {};
      const cleanContext = vm.createContext({
        window: browserWindow,
        globalThis: {},
      });
      cleanContext.globalThis = cleanContext;
      cleanContext.window = browserWindow;

      vm.runInContext(result.code, cleanContext);
      expect(cleanContext.__secret).toBe('SUPER_SECRET_DATABASE_CREDENTIAL');

      // 2. When the deterrent snippet (shield IIFE) is stripped from the AST/code or when window[sym] is missing
      const codeLines = result.code.split('\n');
      const strippedCode = codeLines.slice(1).join('\n');

      const prunedWindow: Record<string, unknown> = {};
      const prunedContext = vm.createContext({
        window: prunedWindow,
        globalThis: {},
      });
      prunedContext.globalThis = prunedContext;
      prunedContext.window = prunedWindow;

      vm.runInContext(strippedCode, prunedContext);

      // The decryptor produces corrupted garbage data (does NOT fall back to working plain strings via expDelta)
      expect(prunedContext.__secret).not.toBe('SUPER_SECRET_DATABASE_CREDENTIAL');
      expect(typeof prunedContext.__secret).toBe('string');
      expect((prunedContext.__secret as string).length).toBeGreaterThan(0);
    });
  });
});
