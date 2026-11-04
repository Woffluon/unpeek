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

    it('preserves directives, object property keys, and uses O(1) lazy inline caching on repeated string accesses', () => {
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
  });
});
