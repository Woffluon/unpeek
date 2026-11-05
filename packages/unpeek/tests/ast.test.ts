import { describe, it, expect } from 'vitest';
import {
  transformJavaScript,
  detectHotPaths,
  computeFnv1aHash,
} from '../src/ast/index.js';

describe('AST & Call-Graph Transformation Engine', () => {
  describe('computeFnv1aHash', () => {
    it('computes deterministic 32-bit unsigned FNV-1a hashes', () => {
      const h1 = computeFnv1aHash('hello world');
      const h2 = computeFnv1aHash('hello world');
      const h3 = computeFnv1aHash('hello world', 0x9999);
      expect(h1).toBe(h2);
      expect(h1).toBeGreaterThanOrEqual(0);
      expect(h1).not.toBe(h3);
    });
  });

  describe('detectHotPaths', () => {
    it('classifies loop-containing functions, array HOF callbacks, rAF callbacks, and UI render components as hot paths', () => {
      const sample = `
        function coldValidator(token) {
          if (!token) return false;
          return token.startsWith("Bearer ");
        }

        function sumLoop(items) {
          let total = 0;
          for (let i = 0; i < items.length; i++) {
            total += items[i];
          }
          return total;
        }

        function mapProcessor(arr) {
          return arr.map(function mapper(x) {
            return x * 2;
          });
        }

        function animateScene() {
          requestAnimationFrame(function tick(ts) {
            return ts;
          });
        }

        function UserProfileCard(props) {
          const [state] = useState(0);
          return createElement("div", null, props.name, state);
        }
      `;

      const report = detectHotPaths(sample);
      expect(report.totalFunctions).toBeGreaterThanOrEqual(7);
      expect(report.hotFunctionsSkipped).toContain('sumLoop');
      expect(report.hotFunctionsSkipped).toContain('mapper');
      expect(report.hotFunctionsSkipped).toContain('tick');
      expect(report.hotFunctionsSkipped).toContain('UserProfileCard');
      expect(report.coldFunctionsProtected).toContain('coldValidator');
    });

    it('propagates hot status top-down from hot loops/frames to their helper callees (e.g. renderFrame -> lerp -> stepParticles)', () => {
      const sample = `
        function stepParticles(px, velocity) {
          return px + velocity;
        }
        function lerp(a, b, t) {
          return stepParticles(a, (b - a) * t);
        }
        function renderFrame(particles, t) {
          for (let i = 0; i < particles.length; i++) {
            particles[i] = lerp(particles[i], 100, t);
          }
          return particles;
        }
        function validateLicense(key) {
          return key === "SECRET_PROD_KEY_2026";
        }
      `;

      const report = detectHotPaths(sample);
      expect(report.hotFunctionsSkipped).toContain('renderFrame');
      expect(report.hotFunctionsSkipped).toContain('lerp');
      expect(report.hotFunctionsSkipped).toContain('stepParticles');
      expect(report.coldFunctionsProtected).toContain('validateLicense');
    });
  });

  describe('transformJavaScript semantic preservation & obfuscation', () => {
    it('preserves exact runtime semantics for arithmetic, string concatenation, object/JSON access, and loops', () => {
      const originalCode = `
        function calculateInvoice(items, customerName, discountCode) {
          const prefix = "INV-2026-SPECIAL";
          const validCode = "SUPER_SECRET_PROMO";
          let subtotal = 0;
          for (let i = 0; i < items.length; i++) {
            subtotal += items[i].price * items[i].qty;
          }
          const discount = discountCode === validCode ? 25 : 0;
          const finalTotal = subtotal - discount;
          const payload = {
            header: prefix + ":" + customerName,
            total: finalTotal,
            status: finalTotal > 100 ? "HIGH_VALUE_ORDER" : "STANDARD_ORDER"
          };
          return JSON.stringify(payload);
        }
        return calculateInvoice(
          [{ price: 50, qty: 2 }, { price: 35, qty: 1 }],
          "Alice Wonderland",
          "SUPER_SECRET_PROMO"
        );
      `;

      const transformed = transformJavaScript(originalCode, {
        seed: 0xdeadbeef,
        minStringLength: 4,
      });

      // Plaintext long string constants must be encrypted into the vault
      expect(transformed.code).not.toContain('INV-2026-SPECIAL');
      expect(transformed.code).not.toContain('SUPER_SECRET_PROMO');
      expect(transformed.code).not.toContain('HIGH_VALUE_ORDER');
      expect(transformed.encryptedStringsCount).toBeGreaterThanOrEqual(4);
      expect(transformed.mangledSymbolsCount).toBeGreaterThan(0);

      // Local parameters/variables must be mangled while object properties (.price, .qty) remain intact
      expect(transformed.code).not.toContain('customerName');
      expect(transformed.code).not.toContain('discountCode');
      expect(transformed.code).toContain('.price');
      expect(transformed.code).toContain('.qty');

      // Execute both original and transformed code via new Function
      const origFn = new Function(originalCode);
      const transFn = new Function(transformed.code);

      const expectedOutput = origFn();
      const actualOutput = transFn();
      expect(actualOutput).toBe(expectedOutput);
      expect(JSON.parse(actualOutput)).toEqual({
        header: 'INV-2026-SPECIAL:Alice Wonderland',
        total: 110,
        status: 'HIGH_VALUE_ORDER',
      });
    });

    it('exempts hot paths from cold-flow guard injection while protecting cold functions', () => {
      const source = `
        function checkLicenseKey(secretInput) {
          const masterKey = "UNPEEK-ENTERPRISE-KEY-9999";
          return secretInput === masterKey ? "AUTHORIZED_USER" : "DENIED_ACCESS";
        }
        function hotMatrixMultiply(vec) {
          let acc = 0;
          for (let idx = 0; idx < vec.length; idx++) {
            acc += vec[idx] * 3;
          }
          return acc;
        }
        return checkLicenseKey("UNPEEK-ENTERPRISE-KEY-9999") + ":" + hotMatrixMultiply([1, 2, 3, 4]);
      `;

      const res = transformJavaScript(source, { seed: 42 });
      expect(res.hotPathReport.coldFunctionsProtected).toContain('checkLicenseKey');
      expect(res.hotPathReport.hotFunctionsSkipped).toContain('hotMatrixMultiply');

      const out = new Function(res.code)();
      expect(out).toBe('AUTHORIZED_USER:30');
    });

    it('gracefully returns original code when input is empty or unparseable syntax', () => {
      expect(transformJavaScript('').code).toBe('');
      const broken = 'function broken( { return 123;';
      const res = transformJavaScript(broken);
      expect(res.code).toBe(broken);
      expect(res.encryptedStringsCount).toBe(0);
    });

    it('preserves directives, object property keys, and uses O(1) kConst array caching on repeated string accesses', () => {
      const code = `
        "use strict";
        function buildConfig(envName) {
          const obj = {
            staticKey: "REPEATED_VAULT_SECRET",
            backupKey: "REPEATED_VAULT_SECRET",
            env: envName
          };
          return obj.staticKey === obj.backupKey && obj.staticKey === "REPEATED_VAULT_SECRET";
        }
        return buildConfig("production_cluster");
      `;
      const res = transformJavaScript(code, { seed: 777 });
      expect(res.code).toContain('"use strict"');
      expect(res.code).toContain('staticKey:');
      expect(res.code).toContain('backupKey:');
      expect(res.code).not.toContain('REPEATED_VAULT_SECRET');
      expect(res.code).not.toContain('production_cluster');
      // Repeated identical strings share a single vault entry
      expect(res.encryptedStringsCount).toBe(2);
      expect(new Function(res.code)()).toBe(true);
    });

    it('injects runtime shield preamble when injectRuntimeShield option is true', () => {
      const code = 'function hello() { return "world"; } hello();';
      const withoutShield = transformJavaScript(code, {
        injectRuntimeShield: false,
      });
      const withShield = transformJavaScript(code, {
        injectRuntimeShield: true,
      });

      expect(withoutShield.code).not.toContain('__unpeek');
      expect(withShield.code).toContain('__unpeek');
      expect(withShield.code.endsWith(withoutShield.code)).toBe(true);
    });

    it('is idempotent when transformJavaScript is called multiple times on already-protected code', () => {
      const code = `
        function verifyToken(inputKey) {
          const expected = "UNPEEK_IDEMPOTENT_SECRET_2026";
          return inputKey === expected ? "VALID_TOKEN" : "INVALID_TOKEN";
        }
        return verifyToken("UNPEEK_IDEMPOTENT_SECRET_2026");
      `;
      const firstPass = transformJavaScript(code, {
        seed: 0x112233,
        injectRuntimeShield: true,
      });
      const secondPassSameSeed = transformJavaScript(firstPass.code, {
        seed: 0x112233,
        injectRuntimeShield: true,
      });
      const secondPassDiffSeed = transformJavaScript(firstPass.code, {
        seed: 0x998877,
        injectRuntimeShield: true,
      });

      expect(secondPassSameSeed.code).toBe(firstPass.code);
      expect(secondPassSameSeed.encryptedStringsCount).toBe(0);
      expect(secondPassDiffSeed.code).toBe(firstPass.code);
      expect(new Function(secondPassDiffSeed.code)()).toBe('VALID_TOKEN');
    });

    it('preserves lexical block scoping for let/const in loops, catch clauses, recursive named FunctionExpressions, local classes, and shorthand properties', () => {
      const complexScopedCode = `
        const outerModuleApi = {
          handleMutable(v) {
            return "MUTABLE_OK:" + v;
          }
        };

        function runComplexScopeSuite(e, items) {
          const o = outerModuleApi;
          let acc = 0;

          // 1. Block-scoped let inside for-of with same original name 'o' must not corrupt outer 'o'
          for (const entry of items) {
            const { tree: o = 10 } = entry;
            acc += o;
          }

          // 2. try/catch with block-scoped 'let e' inside try and 'catch (e)' parameter
          let caughtMsg = "";
          try {
            const e = "TRY_BLOCK_LOCAL_STRING";
            if (e.length > 0) {
              throw new Error("CATCH_CLAUSE_PAYLOAD");
            }
          } catch (e) {
            caughtMsg = e.message;
          }

          // 3. Recursive named FunctionExpression with id 'e' shadowing outer parameter 'e'
          const factorial = function e(n) {
            return n <= 1 ? 1 : n * e(n - 1);
          };

          // 4. Local class 't' with method containing 'for (let t of ...)' returning 'new t(...)'
          class t {
            constructor(vals) {
              this.vals = vals;
            }
            filterPositive() {
              const out = [];
              for (const t of this.vals) {
                if (t > 0) out.push(t);
              }
              return new t(out);
            }
          }

          // 5. Shorthand object literal property { acc } must keep key 'acc'
          const summaryObj = { acc };
          const filtered = new t([-1, 2, 3]).filterPositive();

          return [
            o.handleMutable(e),
            summaryObj.acc,
            caughtMsg,
            factorial(5),
            filtered.vals.join(",")
          ].join("|");
        }

        return runComplexScopeSuite("INIT_ARG", [{ tree: 5 }, { tree: 7 }, {}]);
      `;

      const transformed = transformJavaScript(complexScopedCode, {
        seed: 0xabcdef,
        minStringLength: 4,
      });

      const expected = new Function(complexScopedCode)();
      const actual = new Function(transformed.code)();
      expect(actual).toBe(expected);
      expect(actual).toBe('MUTABLE_OK:INIT_ARG|22|CATCH_CLAUSE_PAYLOAD|120|2,3');
    });

    it('prevents inner function parameter mangled names from colliding with outer scope mangled variables (React Scheduler pattern)', () => {
      const schedulerPatternCode = `
        function createSchedulerModule() {
          var queue = [],
            timers = [],
            idCounter = 1,
            currentTask = null,
            priority = 3,
            isPerformingWork = false,
            isHostCallbackScheduled = false,
            isHostTimeoutScheduled = false;

          function advanceTimers(currentTime) {
            if (currentTime > 0) {
              queue.push(currentTime + idCounter + priority);
            }
          }

          function handleTimeout(currentTime) {
            isHostTimeoutScheduled = false;
            advanceTimers(currentTime);
            if (!isHostCallbackScheduled && queue.length > 0) {
              isHostCallbackScheduled = true;
            }
            return {
              receivedTime: currentTime,
              timeoutFlag: isHostTimeoutScheduled,
              callbackFlag: isHostCallbackScheduled,
              workFlag: isPerformingWork,
              task: currentTask,
              timersCount: timers.length
            };
          }

          isHostTimeoutScheduled = true;
          return handleTimeout(4200);
        }
        return JSON.stringify(createSchedulerModule());
      `;

      const transformed = transformJavaScript(schedulerPatternCode, {
        seed: 0x743beef,
      });

      const origRes = JSON.parse(new Function(schedulerPatternCode)());
      const transRes = JSON.parse(new Function(transformed.code)());
      expect(transRes).toEqual(origRes);
      expect(transRes.receivedTime).toBe(4200);
      expect(transRes.timeoutFlag).toBe(false);
      expect(transRes.callbackFlag).toBe(true);
    });

    it('exempts Web Worker functions serialized via .toString() and body-extracted (DRACOLoader pattern) from vault references and illegal top-level return', () => {
      const dracoWorkerPattern = `
        function initDecoderModule() {
          const wrapperHeader = "var decoderState = { initialized: false };";
          const fnStr = DracoWorkerEntry.toString();
          const workerBody = [
            "/* draco decoder */",
            wrapperHeader,
            "/* worker */",
            fnStr.substring(fnStr.indexOf("{") + 1, fnStr.lastIndexOf("}"))
          ].join("\\n");
          return workerBody;
        }

        function DracoWorkerEntry() {
          let decoderConfig;
          let wasmPending;
          onmessage = function (e) {
            const message = e.data;
            switch (message.type) {
              case "init":
                decoderConfig = message.decoderConfig;
                return "INITIALIZED_WORKER:" + decoderConfig.mode;
              case "decode":
                return "DECODED_MESH_OK";
              default:
                throw new Error("THREE.DRACOLoader: Unexpected message type.");
            }
          };
        }

        return initDecoderModule();
      `;

      const transformed = transformJavaScript(dracoWorkerPattern, {
        seed: 0x226beef,
        minStringLength: 4,
      });

      const workerScript = new Function(transformed.code)();
      // Must not contain any out-of-context _uC vault reference inside the extracted worker script
      expect(workerScript).not.toMatch(/_uC[0-9a-z]+/);
      // Must parse and execute at top-level script scope without 'Illegal return statement' or ReferenceError
      const workerEval = new Function(
        'let onmessage; ' +
          workerScript +
          '\nreturn onmessage({ data: { type: "init", decoderConfig: { mode: "WASM_FAST" } } });'
      );
      expect(workerEval()).toBe('INITIALIZED_WORKER:WASM_FAST');
    });

    it('exempts functions serialized via helper wrapper f(n) and worker module descriptors (Troika defineWorkerModule & 0-arg IIFE factory patterns)', () => {
      const troikaWorkerPattern = `
        function createWorkerSuite() {
          function stringifyFunction(fn) {
            var str = fn.toString();
            return str;
          }

          function workerBootstrap() {
            var modules = {};
            function handleMessage(evt) {
              var action = evt.action;
              if (action === "registerModule") {
                modules[evt.name] = evt.init();
                return "REGISTERED:" + evt.name;
              }
              if (action === "callModule") {
                return modules[evt.name](evt.payload);
              }
              throw new Error("Unknown worker action: " + action);
            }
            return handleMessage;
          }

          function bidiFactory() {
            return (function (exports) {
              var bidiTable = {
                STRONG_RTL: "RTL_CHAR_TABLE_DATA",
                WEAK_NUM: "NUMERIC_CHAR_TABLE_DATA"
              };
              exports.lookup = function (key) {
                return bidiTable[key] || "DEFAULT_CLASS";
              };
              return exports;
            })({});
          }

          function defineWorkerModule(options) {
            return {
              bootstrapSource: "(" + stringifyFunction(workerBootstrap) + ")()",
              initSource: "(" + stringifyFunction(options.init) + ")",
              depSources: options.dependencies.map(stringifyFunction)
            };
          }

          var registered = defineWorkerModule({
            name: "Typesetter",
            dependencies: [
              bidiFactory,
              function inlineFontParser() {
                return "FONT_PARSER_READY";
              }
            ],
            init: function (bidi, parser) {
              return function (text) {
                return parser + ":" + bidi.lookup("STRONG_RTL") + ":" + text;
              };
            }
          });

          return registered;
        }

        return createWorkerSuite();
      `;

      const transformed = transformJavaScript(troikaWorkerPattern, {
        seed: 0xfaddde6c,
        minStringLength: 4,
      });

      const bundle = new Function(transformed.code)();
      expect(bundle.bootstrapSource).not.toMatch(/_uC[0-9a-z]+/);
      expect(bundle.initSource).not.toMatch(/_uC[0-9a-z]+/);
      for (const depSrc of bundle.depSources) {
        expect(depSrc).not.toMatch(/_uC[0-9a-z]+/);
      }

      // Evaluate each serialized piece in a completely isolated Function scope
      const handleMessage = new Function('return ' + bundle.bootstrapSource)();
      const dep0 = new Function('return (' + bundle.depSources[0] + ')()')();
      const dep1 = new Function('return (' + bundle.depSources[1] + ')()')();
      const initFn = new Function('return ' + bundle.initSource)();

      expect(
        handleMessage({
          action: 'registerModule',
          name: 'Typesetter',
          init: () => initFn(dep0, dep1),
        })
      ).toBe('REGISTERED:Typesetter');
      expect(
        handleMessage({
          action: 'callModule',
          name: 'Typesetter',
          payload: 'HELLO_3D_TEXT',
        })
      ).toBe('FONT_PARSER_READY:RTL_CHAR_TABLE_DATA:HELLO_3D_TEXT');
    });
  });
});
