import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import * as acorn from 'acorn';
import { applyMicroVm, OP_TOSTR } from '../src/ast/micro-vm.js';
import { applyPolymorphicMangler } from '../src/ast/polymorphic-mangler.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import { transformJavaScript } from '../src/ast/index.js';

describe('P0 BLA Hardening: Micro-VM OP_TOSTR & Mangler Scope Safety', () => {
  describe('C1: Micro-VM TemplateLiteral OP_TOSTR semantics', () => {
    it('exports OP_TOSTR = 43 and invokes toString() before valueOf() in virtualized TemplateLiteral', () => {
      expect(OP_TOSTR).toBe(43);

      const src = `
        function formatMoney(item, extra) {
          var prefix = 'amt=';
          var label = item.label || 'n/a';
          return \`\${prefix}\${item}:\${extra}:\${label}\`;
        }
      `;

      const ast = acorn.parse(src, {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as unknown as acorn.Program;

      const vmRes = applyMicroVm(ast, undefined, undefined, 0x12345678);
      expect(vmRes.virtualizedCount).toBe(1);

      const outCode = generateCompactJs(ast);
      const ctx = vm.createContext({
        Array,
        Function,
        Math,
        Promise,
        String,
        Symbol,
      });
      vm.runInContext(outCode, ctx);

      const dualObj = {
        label: 'USD',
        toString() {
          return 'from-toString';
        },
        valueOf() {
          return 'from-valueOf';
        },
      };

      const secondObj = {
        toString() {
          return 'second-str';
        },
        valueOf() {
          return 999;
        },
      };

      expect(ctx.formatMoney(dualObj, secondObj)).toBe('amt=from-toString:second-str:USD');
    });

    it('throws TypeError when interpolating Symbol inside strict-virtualized TemplateLiteral', () => {
      const src = `
        function renderToken(val, tag) {
          var head = 'tok:';
          var sep = '-';
          var tail = tag ? tag : 'end';
          return \`\${head}\${val}\${sep}\${tail}\`;
        }
        function safeCatchSymbol(sym) {
          var status = 'ok';
          try {
            status = \`pre-\${sym}-post\`;
          } catch (err) {
            status = err && err.name ? err.name : 'caught';
          }
          return status;
        }
      `;

      const result = transformJavaScript(src, {
        aggressive: true,
        profile: 'strict',
        seed: 0x2468ace0,
      });
      expect(result.virtualizedFunctionsCount).toBeGreaterThanOrEqual(1);

      const ctx = vm.createContext({
        Array,
        Error,
        Function,
        Math,
        Promise,
        String,
        Symbol,
        TypeError,
        navigator: { userAgent: 'Mozilla/5.0' },
        window: undefined,
      });
      vm.runInContext(result.code, ctx);

      const dual = {
        toString() {
          return 'S';
        },
        valueOf() {
          return 'V';
        },
      };
      expect(ctx.renderToken(dual, 'ok')).toBe('tok:S-ok');
      let symbolErr: unknown;
      try {
        ctx.renderToken(Symbol('x'), 'ok');
      } catch (err) {
        symbolErr = err;
      }
      expect(symbolErr).toBeDefined();
      expect((symbolErr as Error).name).toBe('TypeError');
      expect((symbolErr as Error).message).toContain('Symbol');
      expect(ctx.safeCatchSymbol(Symbol('x'))).toBe('TypeError');
    });
  });

  describe('C6b: Polymorphic Mangler direct eval, WithStatement, and sloppy duplicate params', () => {
    it('protects scopes visible to direct eval() across nested functions while still mangling safe functions', () => {
      const src = `
        function outerEval(x) {
          var y = 15;
          function innerEval(z) {
            if (z > 0) {
              var localBonus = 5;
              return eval('x + y + z + localBonus');
            }
            return 0;
          }
          return innerEval(3);
        }
        function safeSum(alpha, beta) {
          var combined = alpha + beta;
          return combined * 2;
        }
      `;

      const ast = acorn.parse(src, {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as unknown as acorn.Program;

      const mangledCount = applyPolymorphicMangler(ast, 0x9e3779b9);
      expect(mangledCount).toBeGreaterThan(0);

      const outCode = generateCompactJs(ast);
      expect(outCode).toContain('outerEval(x)');
      expect(outCode).toContain('innerEval(z)');
      expect(outCode).toContain('localBonus');

      const ctx = vm.createContext({});
      vm.runInContext(outCode, ctx);

      expect(ctx.outerEval(10)).toBe(33);
      expect(ctx.safeSum(4, 6)).toBe(20);
      // safeSum parameters/locals should be mangled (not kept as alpha/beta/combined)
      expect(outCode).not.toContain('alpha');
      expect(outCode).not.toContain('combined');
    });

    it('still mangles locals when only indirect eval is used', () => {
      const src = `
        function indirectEvalFn(secretParam, secondParam) {
          var localResult = secretParam + secondParam;
          var globalEvalResult = (0, eval)('1 + 2');
          var memberEvalResult = window.eval('3 + 4');
          return localResult + globalEvalResult + memberEvalResult;
        }
      `;

      const ast = acorn.parse(src, {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as unknown as acorn.Program;

      const mangledCount = applyPolymorphicMangler(ast, 0x517cc1b7);
      expect(mangledCount).toBeGreaterThan(0);

      const outCode = generateCompactJs(ast);
      expect(outCode).not.toContain('secretParam');
      expect(outCode).not.toContain('localResult');

      const ctx: Record<string, any> = { eval };
      ctx.window = { eval: (s: string) => vm.runInContext(s, ctx) };
      vm.createContext(ctx);
      vm.runInContext(outCode, ctx);
      expect(ctx.indirectEvalFn(10, 20)).toBe(40);
    });

    it('protects bindings around and inside WithStatement so property vs local lookup stays exact', () => {
      const src = `
        function computeWith(scopeObj, outerFactor) {
          var localB = 10;
          with (scopeObj) {
            return a + localB + outerFactor;
          }
        }
        function normalMultiply(firstNum, secondNum) {
          var product = firstNum * secondNum;
          return product;
        }
      `;

      const ast = acorn.parse(src, {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as unknown as acorn.Program;

      const mangledCount = applyPolymorphicMangler(ast, 0xabcdef01);
      expect(mangledCount).toBeGreaterThan(0);

      const outCode = generateCompactJs(ast);
      expect(outCode).not.toContain('firstNum');
      expect(outCode).not.toContain('product');

      const ctx = vm.createContext({});
      vm.runInContext(outCode, ctx);

      // Uses localB = 10, outerFactor = 2 when scopeObj only defines a
      expect(ctx.computeWith({ a: 5 }, 2)).toBe(17);
      // Uses scopeObj.localB = 100 when scopeObj shadows localB
      expect(ctx.computeWith({ a: 5, localB: 100 }, 2)).toBe(107);
      expect(ctx.normalMultiply(3, 7)).toBe(21);
    });

    it('preserves sloppy-mode duplicate parameter semantics and still mangles normal functions', () => {
      const src = `
        function dup(a, a) {
          return a;
        }
        function dupWithExtra(a, a, extraParam) {
          var doubled = extraParam * 2;
          return a + doubled;
        }
        function regularFn(firstArg, secondArg) {
          var totalVal = firstArg + secondArg;
          return totalVal;
        }
      `;

      const ast = acorn.parse(src, {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as unknown as acorn.Program;

      const mangledCount = applyPolymorphicMangler(ast, 0x13579bdf);
      expect(mangledCount).toBeGreaterThan(0);

      const outCode = generateCompactJs(ast);
      expect(outCode).toContain('function dup(a,a)');
      expect(outCode).not.toContain('firstArg');
      expect(outCode).not.toContain('totalVal');

      const ctx = vm.createContext({});
      vm.runInContext(outCode, ctx);

      expect(ctx.dup(1, 2)).toBe(2);
      expect(ctx.dupWithExtra(1, 10, 4)).toBe(18);
      expect(ctx.regularFn(5, 8)).toBe(13);

      // End-to-end transformJavaScript recommended profile check
      const transformed = transformJavaScript(src, {
        profile: 'recommended',
        seed: 0x13579bdf,
      });
      expect(transformed.mangledSymbolsCount).toBeGreaterThan(0);
      const txCtx = vm.createContext({});
      vm.runInContext(transformed.code, txCtx);
      expect(txCtx.dup('first', 'second')).toBe('second');
      expect(txCtx.regularFn(2, 3)).toBe(5);
    });
  });
});
