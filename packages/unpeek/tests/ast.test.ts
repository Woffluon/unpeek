import { describe, it, expect } from 'vitest';
import { generate } from 'astring';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { createSotaMbaPredicate } from '../src/ast/cold-flow-guard.js';
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

    it('RFC-002: exempts UFSKAL WebGPU/Three.js render loops, GSAP ticker callbacks, Lenis raf, and React 19 hooks from protection', () => {
      const sample = `
        function onGsapTick(time) {
          return time * 1000;
        }
        gsap.ticker.add(onGsapTick);

        function lenisScrollStep(delta) {
          return delta * 0.5;
        }
        lenis.raf(lenisScrollStep);

        function webgpuRenderPass(device, queue) {
          queue.submit([]);
        }
        renderer.setAnimationLoop(webgpuRenderPass);

        function FormStatusComponent() {
          const status = useFormStatus();
          return status.pending;
        }

        function verifyPaymentSignature(secret, payload) {
          return secret + ":" + payload;
        }
      `;

      const report = detectHotPaths(sample);
      expect(report.hotFunctionsSkipped).toContain('onGsapTick');
      expect(report.hotFunctionsSkipped).toContain('lenisScrollStep');
      expect(report.hotFunctionsSkipped).toContain('webgpuRenderPass');
      expect(report.hotFunctionsSkipped).toContain('FormStatusComponent');
      expect(report.coldFunctionsProtected).toContain('verifyPaymentSignature');
    });

    it('tracks aliased animation imports and custom animation calls as hot paths', () => {
      const code = `
        import { useFrame as onTick } from '@react-three/fiber';
        import { useLenis as useSmoothScroll } from 'lenis/react';

        function ThreeScene() {
          onTick(function rotateMesh(state, delta) {
            return delta * 0.01;
          });
        }

        function ScrollContainer() {
          useSmoothScroll(function onScroll(lenis) {
            return lenis.scroll;
          });
        }

        function CustomEngine() {
          customTick(function stepEngine(t) {
            return t;
          });
        }

        function coldAuthCheck(user) {
          return user.isAdmin;
        }
      `;

      const report = detectHotPaths(code, {
        hotPath: {
          customAnimationCalls: ['customTick'],
        },
      });

      expect(report.hotFunctionsSkipped).toContain('ThreeScene');
      expect(report.hotFunctionsSkipped).toContain('rotateMesh');
      expect(report.hotFunctionsSkipped).toContain('ScrollContainer');
      expect(report.hotFunctionsSkipped).toContain('onScroll');
      expect(report.hotFunctionsSkipped).toContain('CustomEngine');
      expect(report.hotFunctionsSkipped).toContain('stepEngine');
      expect(report.coldFunctionsProtected).toContain('coldAuthCheck');
    });

    it('does not classify frame/render functions (onTick, onRender, onUpdate, onFrame, onAnimate, handlePhysicsStep) as cold event handlers', () => {
      const code = `
        function onTick(state, delta) {
          return delta * 2;
        }
        function onRender(renderer) {
          return renderer.time;
        }
        function onUpdate(delta) {
          return delta;
        }
        function onFrame(timestamp) {
          return timestamp;
        }
        function onAnimate(alpha) {
          return alpha;
        }
        function handlePhysicsStep(dt) {
          return dt;
        }
        function onClick(event) {
          return event.target;
        }
        function handleSubmit(e) {
          e.preventDefault();
        }

        // Pass them into an animation loop or call to test exemption retention
        requestAnimationFrame(onTick);
        requestAnimationFrame(onRender);
        requestAnimationFrame(onUpdate);
        requestAnimationFrame(onFrame);
        requestAnimationFrame(onAnimate);
        requestAnimationFrame(handlePhysicsStep);
      `;

      const report = detectHotPaths(code);
      expect(report.hotFunctionsSkipped).toContain('onTick');
      expect(report.hotFunctionsSkipped).toContain('onRender');
      expect(report.hotFunctionsSkipped).toContain('onUpdate');
      expect(report.hotFunctionsSkipped).toContain('onFrame');
      expect(report.hotFunctionsSkipped).toContain('onAnimate');
      expect(report.hotFunctionsSkipped).toContain('handlePhysicsStep');
      expect(report.coldFunctionsProtected).toContain('onClick');
      expect(report.coldFunctionsProtected).toContain('handleSubmit');
    });

    it('respects custom eventHandlerRegex override', () => {
      const code = `
        function onCustomAction(data) {
          return data;
        }
        function handleSomething(evt) {
          return evt;
        }
      `;
      const report = detectHotPaths(code, {
        hotPath: {
          eventHandlerRegex: /^onCustom[A-Z]/,
        },
      });
      expect(report.coldFunctionsProtected).toContain('onCustomAction');
    });

    it('detects component names wrapped in HOCs and forwardRef and exempts them', () => {
      const code = `
        const Button = React.memo(function(props) {
          return createElement("button", null, props.label);
        });

        const Input = forwardRef((props, ref) => {
          return createElement("input", { ref });
        });

        const ModalDialog = React.memo(forwardRef(function(props, ref) {
          return createElement("div", { ref });
        }));

        const CustomCard = customWrapper((props) => {
          return createElement("div", null, props.title);
        });

        function ValidateJwtToken(token) {
          return token.valid;
        }
      `;

      const report = detectHotPaths(code, {
        hotPath: {
          hocWrappers: ['customWrapper'],
          excludeComponents: ['ValidateJwtToken'],
        },
      });

      expect(report.hotFunctionsSkipped).toContain('Button');
      expect(report.hotFunctionsSkipped).toContain('Input');
      expect(report.hotFunctionsSkipped).toContain('ModalDialog');
      expect(report.hotFunctionsSkipped).toContain('CustomCard');
      expect(report.coldFunctionsProtected).toContain('ValidateJwtToken');
    });

    it('exempts custom hooks matching hook pattern or customHooks list', () => {
      const code = `
        function usePhysics(bodyRef, config) {
          const step = () => {
            return bodyRef.x + config.gravity;
          };
          return { step };
        }

        const useGameLoop = (callback) => {
          return callback();
        };

        function attachPhysicsEngine(body) {
          return body.id;
        }

        function UserComponent() {
          const { step } = usePhysics({}, { gravity: 9.8 });
          return createElement("div", null);
        }

        function coldBillingService(account) {
          return account.balance;
        }
      `;

      const report = detectHotPaths(code, {
        hotPath: {
          customHooks: ['attachPhysicsEngine'],
        },
      });

      expect(report.hotFunctionsSkipped).toContain('usePhysics');
      expect(report.hotFunctionsSkipped).toContain('useGameLoop');
      expect(report.hotFunctionsSkipped).toContain('attachPhysicsEngine');
      expect(report.hotFunctionsSkipped).toContain('UserComponent');
      expect(report.coldFunctionsProtected).toContain('coldBillingService');
    });

    it('only forces cold on anonymous top-level HOF callbacks, preserving named/exported functions', () => {
      const code = `
        // Standalone named function that contains a loop
        function transformEntity(item) {
          let sum = 0;
          for (let i = 0; i < item.length; i++) {
            sum += item[i];
          }
          return sum;
        }

        // Top level HOF using named standalone function
        const PRELOADED = [[1, 2], [3, 4]].map(transformEntity);

        // Top level HOF using anonymous function
        const IDS = [10, 20].map(function(x) {
          return x * 2;
        });

        // Top level HOF using arrow function
        const DOUBLED = [10, 20].map((x) => x * 3);
      `;

      const report = detectHotPaths(code);
      // transformEntity has a loop and was passed as named function, so it must stay hot
      expect(report.hotFunctionsSkipped).toContain('transformEntity');
      // Anonymous functions passed to top-level HOF should be forced cold
      expect(report.coldFunctionsProtected.length).toBeGreaterThanOrEqual(2);
    });

    it('supports custom arrayHofMethods in config', () => {
      const code = `
        function processBatch(items) {
          return items.times(function worker(x) {
            return x + 1;
          });
        }
      `;
      const report = detectHotPaths(code, {
        hotPath: {
          arrayHofMethods: ['times'],
        },
      });
      expect(report.hotFunctionsSkipped).toContain('worker');
    });

    it('propagates hotness through call-graph based on maxPipelineCallers threshold', () => {
      const code = `
        function solveIK(joints) {
          let total = 0;
          for (let i = 0; i < joints.length; i++) {
            total += joints[i];
          }
          return total;
        }

        function animateArm() { return solveIK([1, 2]); }
        function animateLeg() { return solveIK([3, 4]); }
        function animateSpine() { return solveIK([5, 6]); }
      `;

      // With default maxPipelineCallers = 2, solveIK has 3 callers so callers do not propagate
      const defaultReport = detectHotPaths(code);
      expect(defaultReport.hotFunctionsSkipped).toContain('solveIK');
      expect(defaultReport.coldFunctionsProtected).toContain('animateArm');
      expect(defaultReport.coldFunctionsProtected).toContain('animateLeg');
      expect(defaultReport.coldFunctionsProtected).toContain('animateSpine');

      // With maxPipelineCallers = 3, solveIK's 3 callers propagate hotness
      const relaxedReport = detectHotPaths(code, {
        hotPath: {
          maxPipelineCallers: 3,
        },
      });
      expect(relaxedReport.hotFunctionsSkipped).toContain('solveIK');
      expect(relaxedReport.hotFunctionsSkipped).toContain('animateArm');
      expect(relaxedReport.hotFunctionsSkipped).toContain('animateLeg');
      expect(relaxedReport.hotFunctionsSkipped).toContain('animateSpine');
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

    it('transforms string literal object keys into computed member expressions while preserving runtime semantics and identifier keys', () => {
      const code = `
        function getCredentials() {
          const payload = {
            "authToken": "super_secret_token_123",
            "emailAddress": "admin@unpeek.internal",
            staticKey: "unmangled_key_value"
          };
          const dynamicAccess = payload["authToken"];
          const dotAccess = payload.emailAddress;
          return {
            token: dynamicAccess,
            email: dotAccess,
            static: payload.staticKey
          };
        }
        return getCredentials();
      `;

      const res = transformJavaScript(code, {
        seed: 0x8899aa,
        minStringLength: 4,
      });

      // String literal keys must not appear in plaintext
      expect(res.code).not.toContain('"authToken"');
      expect(res.code).not.toContain('"emailAddress"');

      // Identifier keys like staticKey: must remain as identifier keys
      expect(res.code).toContain('staticKey:');

      // String literal keys must be transformed into computed expressions with salted lazy resolution
      expect(res.code).toMatch(/\[(_a[a-z0-9]+|_uC[a-z0-9]+|_uD[a-z0-9]*)(\[\d+\]|\(\d+,\s*\d+\))\]:/);

      // Verify that the code executes with 100% semantic equivalence
      const result = new Function(res.code)();
      expect(result).toEqual({
        token: 'super_secret_token_123',
        email: 'admin@unpeek.internal',
        static: 'unmangled_key_value',
      });
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

  describe('Non-Linear MBA Opaque Invariants (JIT-friendly algebraic invariants)', () => {
    it('generates algebraically sound 32-bit MBA predicates evaluating to 0 and comparing to 0x7fffffff', () => {
      for (const seed of [0, 42, 0x9e3779b9, 0xdeadbeef, 0x12345678]) {
        for (let fnIndex = 0; fnIndex < 10; fnIndex++) {
          const guard = createSotaMbaPredicate(seed, fnIndex);
          expect(guard.type).toBe('IfStatement');
          expect(guard.test.type).toBe('BinaryExpression');
          expect(guard.test.operator).toBe('===');
          expect(guard.test.right.type).toBe('Literal');
          expect(typeof guard.test.right.value).toBe('number');
          expect(guard.test.right.value).toBeGreaterThan(0);

          let foundString = false;
          walk.simple(guard.test, {
            Identifier(idNode: any) {
              if (idNode.name === 'String') foundString = true;
            },
          });
          expect(foundString).toBe(true);

          let foundImul = false;
          walk.simple(guard.test, {
            CallExpression(call: any) {
              if (
                call.callee?.type === 'MemberExpression' &&
                call.callee.object?.name === 'Math' &&
                call.callee.property?.name === 'imul'
              ) {
                foundImul = true;
              }
            },
          });
          expect(foundImul).toBe(true);

          const evalCode = `(function() { return (${generate(guard.test.left)}); })()`;
          const evalResult = new Function('String', 'return ' + evalCode)(String);
          expect(evalResult | 0).toBe(0);
          expect(evalResult === guard.test.right.value).toBe(false);
        }
      }

    });

    it('generates 3 distinct adversarial decoy models across modulated fnIndex', () => {
      // Model 0: Fake authorization bypass (/api/v2/auth/admin-bypass, superadmin_token, elevate)
      const guard0 = createSotaMbaPredicate(42, 0);
      const code0 = generate(guard0.consequent);
      expect(code0).toContain('/api/v2/auth/admin-bypass');
      expect(code0).toContain('superadmin_token');
      expect(code0).toContain('elevate');

      // Model 1: Fake master JWT verification (_verifyMasterToken, mock_jwt_bypass_signature, authorized: true)
      const guard1 = createSotaMbaPredicate(42, 1);
      const code1 = generate(guard1.consequent);
      expect(code1).toContain('_verifyMasterToken');
      expect(code1).toContain('mock_jwt_bypass_signature');
      expect(code1).toContain('authorized');

      // Model 2: Fake telemetry debug and supervisor key (debug_supervisor_override, mfa_bypassed: true)
      const guard2 = createSotaMbaPredicate(42, 2);
      const code2 = generate(guard2.consequent);
      expect(code2).toContain('debug_supervisor_override');
      expect(code2).toContain('mfa_bypassed');

      // Periodic modulation: fnIndex = 3 maps back to Model 0
      const guard3 = createSotaMbaPredicate(42, 3);
      expect(generate(guard3.consequent)).toBe(code0);
    });

    it('injects MBA opaque guard into cold functions, preserves exact runtime semantics, and never executes guard branch', () => {
      const source = `
        "use strict";
        function verifyToken(token, expected) {
          "use strict";
          return token === expected ? "TOKEN_VALID" : "TOKEN_INVALID";
        }
        function hotCompute(arr) {
          let sum = 0;
          for (let i = 0; i < arr.length; i++) {
            sum += arr[i];
          }
          return sum;
        }
        return verifyToken("SECRET_JWT", "SECRET_JWT") + ":" + hotCompute([10, 20, 30]);
      `;

      const res = transformJavaScript(source, { seed: 0x9e3779b9 });
      expect(res.hotPathReport.coldFunctionsProtected).toContain('verifyToken');
      expect(res.hotPathReport.hotFunctionsSkipped).toContain('hotCompute');

      const ast = acorn.parse(res.code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
      let coldGuardFound = false;
      let stringIdentifierFound = false;
      let maxSmiComparisonFound = false;

      walk.simple(ast, {
        IfStatement(node: any) {
          if (
            node.test?.type === 'BinaryExpression' &&
            node.test.operator === '===' &&
            node.test.right?.type === 'Literal' &&
            typeof node.test.right.value === 'number'
          ) {
            coldGuardFound = true;
            maxSmiComparisonFound = true;
            walk.simple(node.test, {
              Identifier(id: any) {
                if (id.name === 'String') stringIdentifierFound = true;
              },
            });
          }
        },
      });

      expect(coldGuardFound).toBe(true);
      expect(stringIdentifierFound).toBe(true);
      expect(maxSmiComparisonFound).toBe(true);

      const fn = new Function(res.code);
      expect(fn()).toBe('TOKEN_VALID:60');

      const instrumentedCode = res.code.replace(
        /\{return\{endpoint:"\/api\/v2\/auth\/admin-bypass",superadmin_token:1,elevate:1\};?\}/g,
        '{throw new Error("GUARD_BRANCH_EXECUTED");}'
      );
      const instrumentedFn = new Function(instrumentedCode);
      expect(() => instrumentedFn()).not.toThrow();
      expect(instrumentedFn()).toBe('TOKEN_VALID:60');
    });

    it('injects non-linear quadratic MBA opaque predicates in cold functions that resist 1-bit algebraic simplification while preserving 100% semantic fidelity', () => {
      const source = `
        function fn0(a) { return "fn0:" + a; }
        function fn1(b) { return "fn1:" + b; }
        function fn2(c) { return "fn2:" + c; }
        function fn3(d) { return "fn3:" + d; }
        function hotLoop(arr) {
          let sum = 0;
          for (let i = 0; i < arr.length; i++) sum += arr[i];
          return sum;
        }
        return [fn0(1), fn1(2), fn2(3), fn3(4), hotLoop([10, 20])].join(";");
      `;

      const transformed = transformJavaScript(source, { seed: 0x12345678 });
      expect(transformed.hotPathReport.coldFunctionsProtected).toContain('fn0');
      expect(transformed.hotPathReport.coldFunctionsProtected).toContain('fn1');
      expect(transformed.hotPathReport.coldFunctionsProtected).toContain('fn2');
      expect(transformed.hotPathReport.coldFunctionsProtected).toContain('fn3');
      expect(transformed.hotPathReport.hotFunctionsSkipped).toContain('hotLoop');

      const ast = acorn.parse(transformed.code, {
        ecmaVersion: 'latest',
        allowReturnOutsideFunction: true,
      });

      const mathImulCalls: any[] = [];
      const ifStatementsInColdFns: any[] = [];

      walk.simple(ast, {
        FunctionDeclaration(node: any) {
          if (node.id?.name === 'hotLoop') {
            for (const stmt of node.body.body) {
              if (stmt.type === 'IfStatement') {
                let hasImul = false;
                walk.simple(stmt.test, {
                  CallExpression(call: any) {
                    if (
                      call.callee?.type === 'MemberExpression' &&
                      call.callee.object?.name === 'Math' &&
                      call.callee.property?.name === 'imul'
                    ) {
                      hasImul = true;
                    }
                  },
                });
                expect(hasImul).toBe(false);
              }
            }
          }
          if (['fn0', 'fn1', 'fn2', 'fn3'].includes(node.id?.name)) {
            const firstStmt = node.body.body[0];
            expect(firstStmt?.type).toBe('IfStatement');
            ifStatementsInColdFns.push(firstStmt);

            let imulCount = 0;
            walk.simple(firstStmt.test, {
              CallExpression(call: any) {
                if (
                  call.callee?.type === 'MemberExpression' &&
                  call.callee.object?.name === 'Math' &&
                  call.callee.property?.name === 'imul'
                ) {
                  imulCount++;
                  mathImulCalls.push(call);
                }
              },
            });
            // Must contain quadratic non-linear structures using Math.imul
            // (at least 2 Math.imul multiplications per quadratic family)
            expect(imulCount).toBeGreaterThanOrEqual(2);
          }
        },
      });

      expect(ifStatementsInColdFns.length).toBe(4);
      expect(mathImulCalls.length).toBeGreaterThanOrEqual(8);

      // Verify that runtime execution preserves 100% semantic fidelity
      const fn = new Function(transformed.code);
      const res = fn();
      expect(res).toBe('fn0:1;fn1:2;fn2:3;fn3:4;30');
    });
  });

  describe('v1.13.0 Vault & Shield Hardening', () => {
    it('enforces 16-bit shield delta, zero-escape 92-char SAFE_ALPHA payloads, unicode preservation, and O(1) memoization', async () => {
      const { createPermutationTable, encodeStringWithSeed, computeFnv1aHash } = await import('../src/ast/string-vault.js');
      const { createSaltedDecryptorFnAst, computeCallSiteSalt } = await import('../src/ast/salted-vault.js');
      const { generateRuntimeShield } = await import('../src/runtime/index.js');

      const seed = 0x7a3b91c5;
      const shield = generateRuntimeShield({ seed, deterrentMode: 'passive' });
      expect(shield.expectedDelta).toBeGreaterThan(31);
      expect(shield.expectedDelta).toBeLessThanOrEqual(0xffff);

      const source = `
        function getEndpoints() {
          const a = "https://vault.internal.example/v1/keys?mode=prod";
          const b = "Unicode_ğüşiöç_🚀_payload";
          return [a, a, b, b];
        }
        return getEndpoints();
      `;

      const res = transformJavaScript(source, {
        seed,
        minStringLength: 4,
        injectRuntimeShield: true,
      });

      expect(res.code).not.toContain('vault.internal.example');
      expect(res.code).not.toContain('Unicode_');

      // Check encrypted array contains zero backslash/quote/backtick escapes inside encrypted SAFE_ALPHA strings
      const P = createPermutationTable(seed);
      const ast = createSaltedDecryptorFnAst(seed, P, shield.expectedDelta!, '_zTest');
      const compactFn = generate(ast);
      const key = (computeFnv1aHash(compactFn, 0) ^ (shield.expectedDelta! & 0xffff)) >>> 0;
      const samplePlain = 'API_SECRET_TOKEN_XYZ_12345';
      const enc = encodeStringWithSeed(samplePlain, P, key, computeCallSiteSalt(seed, 0), 0);
      expect(enc).not.toContain('\\');
      expect(enc).not.toContain('"');
      expect(enc).not.toContain('`');
      expect(enc.length).toBe(samplePlain.length);

      // Runtime execution with O(1) repeated access returns exact strings including unicode
      const fn = new Function(res.code);
      expect(fn()).toEqual([
        'https://vault.internal.example/v1/keys?mode=prod',
        'https://vault.internal.example/v1/keys?mode=prod',
        'Unicode_ğüşiöç_🚀_payload',
        'Unicode_ğüşiöç_🚀_payload',
      ]);
    });
  });
});
