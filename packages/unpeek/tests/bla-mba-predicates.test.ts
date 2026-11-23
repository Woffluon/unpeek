import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { generate } from 'astring';
import {
  modInverseUint32,
  deriveAffineMbaParams,
  createSotaMbaPredicate,
  applyColdFlowGuard,
  applyColdBitwiseMba,
  MAX_COLD_GUARDS_PER_CHUNK,
  MAX_COLD_BITWISE_MBA_PER_CHUNK,
} from '../src/ast/cold-flow-guard.js';
import { transformJavaScript } from '../src/ast/index.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import { deriveWindowKeySymbol } from '../src/runtime/devtools-deterrent.js';

function collectAllFunctions(ast: acorn.Program): WeakSet<acorn.Node> {
  const set = new WeakSet<acorn.Node>();
  walk.simple(ast, {
    FunctionDeclaration(n) {
      set.add(n);
    },
    FunctionExpression(n) {
      set.add(n);
    },
    ArrowFunctionExpression(n) {
      set.add(n);
    },
  });
  return set;
}

describe('bla MBA Integration: modInverseUint32, Unsigned & Affine Predicates, and O1 Cold Bitwise MBA', () => {
  // =========================================================================
  // 1. modInverseUint32 & deriveAffineMbaParams
  // =========================================================================
  describe('modInverseUint32 & deriveAffineMbaParams', () => {
    it('computes exact multiplicative inverse mod 2^32 across boundary odd and even inputs', () => {
      const boundaryOdds = [
        1,
        3,
        5,
        7,
        0x11111111,
        0x5bd1e995,
        0x85ebca6b,
        0x9e3779b9,
        0xc2b2ae35,
        0x7fffffff,
        0x80000001,
        0xfffffffe | 1,
        0xffffffff,
      ];

      for (const odd of boundaryOdds) {
        const inv = modInverseUint32(odd);
        expect(Number.isInteger(inv)).toBe(true);
        expect(inv).toBeGreaterThanOrEqual(0);
        expect(inv).toBeLessThanOrEqual(0xffffffff);
        expect(Math.imul(odd, inv) >>> 0).toBe(1);
      }

      // Even inputs are forced odd via (oddValue | 1) >>> 0
      for (const evenVal of [0, 2, 4, 0x80000000, -2]) {
        const forcedOdd = (evenVal | 1) >>> 0;
        const inv = modInverseUint32(evenVal);
        expect(Math.imul(forcedOdd, inv) >>> 0).toBe(1);
      }
    });

    it('derives non-canonical affine MBA parameters satisfying m*mInv === 1 and mInv*c + d === 0 mod 2^32', () => {
      for (const seed of [0, 1, 0x9e3779b9, 0xdeadbeef, 0xffffffff]) {
        for (let salt = 0; salt < 16; salt++) {
          const { m, m2, mInv, c, d } = deriveAffineMbaParams(seed, salt);
          expect(m & 1).toBe(1);
          expect(m).not.toBe(1);
          expect(m).not.toBe(0xffffffff);
          expect(m).not.toBe(0x9e3779b9);
          expect(m2).toBe(Math.imul(m, 2) >>> 0);
          expect(Math.imul(m, mInv) >>> 0).toBe(1);
          expect(c).not.toBe(0);
          expect((Math.imul(mInv, c) + d) | 0).toBe(0);
        }
      }
    });
  });

  // =========================================================================
  // 2. Unsigned-Domain MBA & Parameterized Affine-Inverse Opaque Predicates
  // =========================================================================
  describe('Unsigned-Domain MBA & Parameterized Affine-Inverse Opaque Predicates', () => {
    const EDGE_INPUTS = [
      0,
      1,
      -1,
      2,
      -2,
      0x7fffffff,
      -0x80000000,
      0x80000000,
      0xffffffff,
      0xdeadbeef | 0,
      0xdeadbeef,
      'str',
      undefined,
      null,
    ];

    it('diversifies across all 6 predicate forms and keeps Forms 4 & 5 strictly false across boundary int32/uint32 inputs', () => {
      const seed = 0x13579bdf;
      const standaloneTests: string[] = [];

      for (let fnIndex = 0; fnIndex < 6; fnIndex++) {
        // Standalone mode (Branch C)
        const guard = createSotaMbaPredicate(seed, fnIndex, 'arg0', '_dec');
        expect(guard.test.type === 'BinaryExpression' && guard.test.operator === '===' && guard.test.right?.type === 'Literal').toBe(false);
        const testCode = generate(guard.test);
        standaloneTests.push(testCode);

        const fn = new Function('arg0', `return Boolean(${testCode});`);
        for (const val of EDGE_INPUTS) {
          expect(fn(val)).toBe(false);
        }

        // Full context mode (Branch B with sbox/alias/scratch)
        const ctxGuard = createSotaMbaPredicate(seed, fnIndex, 'arg0', '_dec', false, {
          liveVars: ['arg0'],
          sboxIdent: '_uSbTest',
          aliasIdentA: '_uAlTest',
          aliasIdentB: '_uAmTest',
          scratchVarIdent: '_uZtTest',
          returnDomain: 'number',
        });
        const ctxCode = generate(ctxGuard);
        const ctx = vm.createContext({
          Math,
          String,
          _uSbTest: Array.from({ length: 256 }, (_, k) => (k * 73 + 19) & 255),
          _uAlTest: [111, 222, 333, 444],
          _uAmTest: [111, 222, 333, 444],
          _uZtTest: 0,
          _dec: [() => 1, () => 2, () => 3],
        });
        for (const val of EDGE_INPUTS) {
          const out = vm.runInContext(
            `(function(arg0){ ${ctxCode}; return "PASS"; })(${JSON.stringify(val)})`,
            ctx
          );
          expect(out).toBe('PASS');
        }
        // Alias array invariant must be preserved across every predicate form
        expect(Array.from(ctx._uAlTest)).toEqual([111, 222, 333, 444]);
      }

      const joined = standaloneTests.join('\n');
      // Unsigned-Domain MBA form marker
      expect(joined).toContain('>>> 0');
      expect(joined).toContain('<');
      // Parameterized Affine-Inverse MBA form marker
      expect(joined).toContain('Math.imul');
      expect(joined).toContain('!==');
    });

    it('preserves MAX_COLD_GUARDS_PER_CHUNK=12 and exact runtime outputs in applyColdFlowGuard across boundary inputs', () => {
      const fns = Array.from({ length: 14 }, (_, i) =>
        `function coldOp${i}(x) { return (x ^ ${i + 1}) | 0; }`
      ).join('\n');
      const ast = acorn.parse(fns, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const seed = 0x9e3779b9;
      const sym = deriveWindowKeySymbol(seed);
      const sfx = (seed >>> 0).toString(36).slice(0, 4);

      const guarded = applyColdFlowGuard(ast, coldSet, seed, undefined, sym, 0x4242, true);
      expect(guarded).toBe(MAX_COLD_GUARDS_PER_CHUNK);

      const outCode = generateCompactJs(ast);
      const ctx: Record<string, any> = {
        Math,
        String,
        [`${sym}_s`]: [1, 0, 0, 1, 0],
      };
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(outCode, ctx);

      const initialAl = [...ctx[`_uAl${sfx}`]];
      for (let i = 0; i < 14; i++) {
        for (const input of [0, -1, 0x80000000, 0x7fffffff, 0xffffffff]) {
          expect(ctx[`coldOp${i}`](input)).toBe((input ^ (i + 1)) | 0);
        }
      }
      expect(ctx[`_uAl${sfx}`]).toEqual(initialAl);
    });
  });

  // =========================================================================
  // 3. O1 Cold-Path Bitwise MBA Substitution
  // =========================================================================
  describe('O1 Cold-Path Bitwise MBA (applyColdBitwiseMba & strict/aggressive gating)', () => {
    const SAMPLE_SOURCE = `
      function coldBitwise(a, b) {
        var r1 = a ^ b;
        var r2 = a | b;
        var r3 = a & b;
        var r4 = a ^ 0x55aa;
        var r5 = b & 0xff;
        var coerced = r1 | 0;
        return [r1, r2, r3, r4, r5, coerced];
      }
      function hotLoopFn(arr, mask) {
        var acc = 0;
        for (var i = 0; i < arr.length; i++) {
          acc = (acc + (arr[i] ^ mask)) | 0;
        }
        return acc;
      }
    `;

    it('is NEVER applied in minimal or recommended profiles', () => {
      const countBitwiseConditionals = (code: string): number => {
        const parsed = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
        const fnNode = parsed.body.find(
          (s: any) => s.type === 'FunctionDeclaration' && s.id?.name === 'coldBitwise'
        );
        expect(fnNode).toBeDefined();
        let count = 0;
        walk.simple(fnNode, {
          ConditionalExpression(cond: any) {
            // Exclude makeSafeNumericParam (`typeof x === "number" ? x | 0 : 0`) inside the guard test
            if (cond.alternate?.type === 'BinaryExpression') {
              count++;
            }
          },
        });
        return count;
      };

      const minRes = transformJavaScript(SAMPLE_SOURCE, {
        profile: 'minimal',
        seed: 0x2468ace1,
        injectRuntimeShield: false,
      });
      expect(countBitwiseConditionals(minRes.code)).toBe(0);

      const recRes = transformJavaScript(SAMPLE_SOURCE, {
        profile: 'recommended',
        seed: 0x2468ace1,
        injectRuntimeShield: false,
      });
      expect(countBitwiseConditionals(recRes.code)).toBe(0);

      const defaultRes = transformJavaScript(SAMPLE_SOURCE, {
        seed: 0x2468ace1,
        injectRuntimeShield: false,
      });
      expect(countBitwiseConditionals(defaultRes.code)).toBe(0);
    });

    it('is applied in strict and aggressive profiles while exempting hot loops, virtualized fns, and keeping "number" literals unencrypted', () => {
      // 1. Strict profile (non-VM): coldBitwise receives O1 bitwise MBA directly
      const strictRes = transformJavaScript(SAMPLE_SOURCE, {
        profile: 'strict',
        injectRuntimeShield: false,
        seed: 0x71727374,
      });
      expect(strictRes.code).toMatch(/typeof\s+\w+\s*===\s*["']number["']\s*&&\s*typeof\s+\w+\s*===\s*["']number["']\?/);

      const strictCtx: Record<string, any> = { Math, Array, Object };
      strictCtx.globalThis = strictCtx;
      vm.createContext(strictCtx);
      vm.runInContext(strictRes.code, strictCtx);

      for (const [a, b] of [
        [0, 0],
        [-1, 0x7fffffff],
        [0x80000000, 0xffffffff],
        [123456789, -987654321],
        [5.7, 3.2],
        [NaN, Infinity],
      ]) {
        expect(strictCtx.coldBitwise(a, b)).toEqual([
          a ^ b,
          a | b,
          a & b,
          a ^ 0x55aa,
          b & 0xff,
          (a ^ b) | 0,
        ]);
      }
      expect(strictCtx.hotLoopFn([10, 20, 30], 0x0f)).toBe(
        ((10 ^ 0x0f) + (20 ^ 0x0f) + (30 ^ 0x0f)) | 0
      );

      // Hot loop body must remain free of typeof number guards
      const strictAst = acorn.parse(strictRes.code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
      const strictHot = strictAst.body.find(
        (s: any) => s.type === 'FunctionDeclaration' && s.id?.name === 'hotLoopFn'
      );
      expect(strictHot).toBeDefined();
      let hasNumberCheckInLoop = false;
      walk.simple(strictHot, {
        Literal(lit: any) {
          if (lit.value === 'number') hasNumberCheckInLoop = true;
        },
      });
      expect(hasNumberCheckInLoop).toBe(false);

      // 2. Aggressive / strict+aggressive profile: virtualized cold fns are skipped,
      //    non-virtualized cold fns (e.g. using `arguments`) receive O1 bitwise MBA
      const aggSource = `
        function vmTarget(x, y) {
          var v = x ^ y;
          return v + 1;
        }
        function nonVmCold(a, b) {
          if (arguments.length > 99) return null;
          var r1 = a ^ b;
          var r2 = a | b;
          var r3 = a & b;
          return [r1, r2, r3];
        }
        function hotLoopFn(arr, mask) {
          var acc = 0;
          for (var i = 0; i < arr.length; i++) {
            acc = (acc + (arr[i] ^ mask)) | 0;
          }
          return acc;
        }
      `;
      for (const opts of [
        { aggressive: true, injectRuntimeShield: false, seed: 0x71727374 },
        { profile: 'strict' as const, aggressive: true, injectRuntimeShield: false, seed: 0x71727374 },
      ]) {
        const aggRes = transformJavaScript(aggSource, opts);
        expect(aggRes.virtualizedFunctionsCount).toBeGreaterThanOrEqual(1);
        expect(aggRes.code).toMatch(/typeof\s+\w+\s*===\s*["']number["']\s*&&\s*typeof\s+\w+\s*===\s*["']number["']\?/);

        const aggCtx: Record<string, any> = { Math, Array, Object };
        aggCtx.globalThis = aggCtx;
        vm.createContext(aggCtx);
        vm.runInContext(aggRes.code, aggCtx);

        expect(aggCtx.vmTarget(10, 6)).toBe((10 ^ 6) + 1);
        expect(aggCtx.nonVmCold(0x55aa, 0x0f0f)).toEqual([
          0x55aa ^ 0x0f0f,
          0x55aa | 0x0f0f,
          0x55aa & 0x0f0f,
        ]);
        expect(aggCtx.hotLoopFn([10, 20, 30], 0x0f)).toBe(
          ((10 ^ 0x0f) + (20 ^ 0x0f) + (30 ^ 0x0f)) | 0
        );
      }
    });

    it('preserves BigInt fallback and exact single-evaluation ToNumber side effects on objects', () => {
      const bigIntSafeCode = `
        function bitPair(x, y) {
          return {
            xorV: x ^ y,
            orV: x | y,
            andV: x & y
          };
        }
      `;
      const res = transformJavaScript(bigIntSafeCode, {
        profile: 'strict',
        injectRuntimeShield: false,
        seed: 0x33445566,
      });
      expect(res.code).toMatch(/typeof\s+\w+\s*===\s*["']number["']/);

      const ctx: Record<string, any> = { Math, Object };
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(res.code, ctx);

      // Runtime BigInt operands take fallback path seamlessly
      expect(ctx.bitPair(0x123456789abcdef0n, 0x0fedcba987654321n)).toEqual({
        xorV: 0x123456789abcdef0n ^ 0x0fedcba987654321n,
        orV: 0x123456789abcdef0n | 0x0fedcba987654321n,
        andV: 0x123456789abcdef0n & 0x0fedcba987654321n,
      });

      // Object valueOf must be invoked EXACTLY ONCE per operation (not duplicated by MBA)
      let leftCalls = 0;
      let rightCalls = 0;
      const objA = {
        valueOf() {
          leftCalls++;
          return 0b1010;
        },
      };
      const objB = {
        valueOf() {
          rightCalls++;
          return 0b1100;
        },
      };
      expect(ctx.bitPair(objA, objB)).toEqual({
        xorV: 0b1010 ^ 0b1100,
        orV: 0b1010 | 0b1100,
        andV: 0b1010 & 0b1100,
      });
      expect(leftCalls).toBe(3);
      expect(rightCalls).toBe(3);

      // Mixed number + object: number typeof succeeds, object typeof fails -> fallback calls valueOf once
      rightCalls = 0;
      expect(ctx.bitPair(0b1010, objB)).toEqual({
        xorV: 0b1010 ^ 0b1100,
        orV: 0b1010 | 0b1100,
        andV: 0b1010 & 0b1100,
      });
      expect(rightCalls).toBe(3);
    });

    it('bails out safely on BigInt literals, BigInt identifiers, WithStatement, and locally shadowed Math', () => {
      const bailoutCases = [
        `function f(a, b) { var z = 1n; return a ^ b; }`,
        `function f(a, b) { var z = BigInt(a); return a ^ b; }`,
        `function f(a, b, o) { with (o) { return a ^ b; } }`,
        `function f(a, b) { const Math = { imul: (x, y) => x * y }; return a ^ b; }`,
        `function f(a, b, Math) { return a ^ b; }`,
      ];

      for (const src of bailoutCases) {
        const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
        const coldSet = collectAllFunctions(ast);
        const count = applyColdBitwiseMba(ast, coldSet, 0x11223344);
        expect(count).toBe(0);
      }
    });

    it('exempts hotExemptNodes, loops, _unpeekSerialized, _unpeekVirtualized, globals/program vars, x | 0, and caps at MAX_COLD_BITWISE_MBA_PER_CHUNK=8', () => {
      // 1. Exemptions & global/x|0 exclusions
      const src = `
        var progGlobal = 7;
        function coldFn(a, b) {
          var g = a ^ progGlobal;
          var u = a ^ undeclaredGlobal;
          var c = a | 0;
          var k = 3 ^ 5;
          var ok = a ^ b;
          return g + u + c + k + ok;
        }
        function hotExemptFn(a, b) { return a ^ b; }
        function serializedFn(a, b) { return a ^ b; }
        function virtualizedFn(a, b) { return a ^ b; }
        function loopFn(a, b) {
          while (a > 0) { a = a ^ b; break; }
          do { b = b | a; } while (false);
          for (var i = 0; i < 1; i++) { a = a & b; }
          for (var k in { x: 1 }) { a = a ^ b; }
          for (var v of [1]) { a = a | b; }
          return a;
        }
      `;
      const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const body = ast.body as any[];
      const coldFn = body[1];
      const hotExemptFn = body[2];
      const serializedFn = body[3];
      const virtualizedFn = body[4];
      const loopFn = body[5];

      (serializedFn as any)._unpeekSerialized = true;
      (virtualizedFn as any)._unpeekVirtualized = true;

      const coldSet = new WeakSet<acorn.Node>([coldFn, hotExemptFn, serializedFn, virtualizedFn, loopFn]);
      const hotExempt = new WeakSet<acorn.Node>([hotExemptFn]);

      const replaced = applyColdBitwiseMba(ast, coldSet, 0x9e3779b9, hotExempt);
      // Only `var ok = a ^ b` in coldFn is eligible!
      expect(replaced).toBe(1);

      // 2. Per-chunk quota cap = 8
      const manyOps = Array.from({ length: 12 }, (_, i) => `var v${i} = a ^ ${i + 1};`).join('\n');
      const quotaSrc = `function bigCold(a) {\n${manyOps}\nreturn v11;\n}`;
      const quotaAst = acorn.parse(quotaSrc, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const quotaCold = collectAllFunctions(quotaAst);
      const quotaCount = applyColdBitwiseMba(quotaAst, quotaCold, 0x55667788);
      expect(quotaCount).toBe(MAX_COLD_BITWISE_MBA_PER_CHUNK);
    });
  });
});
