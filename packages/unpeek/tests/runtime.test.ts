import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
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

    it('triggers tamper flag and seed poisoning on navigator.webdriver and HeadlessChrome user agent', () => {
      const seed = 12345;
      const snippet = createDeterrentSnippet({ seed });

      // 1. navigator.webdriver === true
      const webdriverWindow: Record<string, unknown> = {
        navigator: { webdriver: true, userAgent: 'Mozilla/5.0' },
      };
      const webdriverContext = vm.createContext({
        window: webdriverWindow,
      });
      vm.runInContext(snippet, webdriverContext);
      expect(webdriverWindow.__unpeek_tampered).toBe(true);
      expect(webdriverWindow.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);

      // 2. HeadlessChrome userAgent
      const headlessWindow: Record<string, unknown> = {
        navigator: { webdriver: false, userAgent: 'Mozilla/5.0 HeadlessChrome/122.0.0.0 Safari/537.36' },
      };
      const headlessContext = vm.createContext({
        window: headlessWindow,
      });
      vm.runInContext(snippet, headlessContext);
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

      // Tampered environment poisons key synchronously
      const tamperedWindow: Record<string, unknown> = {
        navigator: { webdriver: true },
      };
      const tamperedContext = vm.createContext({
        window: tamperedWindow,
      });
      vm.runInContext(snippet, tamperedContext);
      expect(tamperedWindow.__unpeek_tampered).toBe(true);
      expect(tamperedWindow.__unpeek_seed).toBe(((seed) ^ 1) >>> 0);
      expect(typeof tamperedWindow[windowKeySymbol]).toBe('number');
    });
  });
});
