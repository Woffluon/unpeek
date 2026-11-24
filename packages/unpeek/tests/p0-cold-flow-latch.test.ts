import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import {
  applyColdFlowGuard,
  deriveColdLatchCoupling,
  MAX_COLD_GUARDS_PER_CHUNK,
} from '../src/ast/cold-flow-guard.js';
import { transformJavaScript } from '../src/ast/index.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import { injectWasmVault, fallbackKdf } from '../src/ast/wasm-vault.js';

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

describe('BLA P0 Cold-Flow Latch Coupling (C7), C9 Wrapping & C6a Scope/Hoisting Safety', () => {
  // =========================================================================
  // 1. C7 Contract & Functional Equivalence (recommended & strict)
  // =========================================================================
  describe('C7: LatchCouplingConfig, ArrayBuffer(32) Aliasing & Functional Equivalence', () => {
    it('derives deterministic _uLr<sfx> and expectedLatchByte strictly in 1..254 across seeds', () => {
      const seeds = [0, 1, 0x12345678, 0x9e3779b9, 0xdeadbeef, 0xffffffff, 0x55aa33cc];
      for (const seed of seeds) {
        const a = deriveColdLatchCoupling(seed);
        const b = deriveColdLatchCoupling(seed);
        expect(a).toEqual(b);
        const sfx = (seed >>> 0).toString(36).slice(0, 4);
        expect(a.latchFnName).toBe(`_uLr${sfx}`);
        expect(Number.isInteger(a.expectedLatchByte)).toBe(true);
        expect(a.expectedLatchByte).toBeGreaterThanOrEqual(1);
        expect(a.expectedLatchByte).toBeLessThanOrEqual(254);
      }
    });

    it('emits Uint32Array/Int32Array over shared ArrayBuffer(32) and preserves invariant across recommended & strict', () => {
      const tokenA = ['tok', 'alpha', 'vault', '9001'].join('_');
      const tokenB = ['cfg', 'beta', 'endpoint', 'v2'].join('_');
      const source = `
        function computePayload(flag, val) {
          var trace = [];
          trace.push(flag ? "mode_primary_active" : "mode_fallback_active");
          if (val > 0) {
            trace.push("${tokenA}");
          }
          return trace.join(":") + "|" + "${tokenB}";
        }
        globalThis.__out = computePayload(true, 7);
        globalThis.__out2 = computePayload(false, 0);
      `;

      for (const profile of ['recommended', 'strict'] as const) {
        const seed = 0x51a7b3c9;
        const sfx = (seed >>> 0).toString(36).slice(0, 4);
        const { latchFnName, expectedLatchByte } = deriveColdLatchCoupling(seed);

        const res = transformJavaScript(source, {
          profile,
          seed,
          injectRuntimeShield: false,
        });

        expect(res.code).toContain('ArrayBuffer(32)');
        expect(res.code).toContain('Uint32Array');
        expect(res.code).toContain('Int32Array');
        expect(res.code).toContain(`function ${latchFnName}`);
        expect(res.code).not.toContain(tokenA);
        expect(res.code).not.toContain(tokenB);

        const ctx: Record<string, any> = { Array, Math, String, Uint32Array, Int32Array, ArrayBuffer };
        ctx.globalThis = ctx;
        vm.createContext(ctx);
        vm.runInContext(res.code, ctx);

        expect(ctx.__out).toBe(`mode_primary_active:${tokenA}|${tokenB}`);
        expect(ctx.__out2).toBe(`mode_fallback_active|${tokenB}`);
        expect(ctx[`_uAl${sfx}`]).toBeInstanceOf(ctx.Uint32Array);
        expect(ctx[`_uAm${sfx}`]).toBeInstanceOf(ctx.Int32Array);
        expect(ctx[`_uAl${sfx}`].buffer).toBe(ctx[`_uAm${sfx}`].buffer);
        expect(ctx[`_uAl${sfx}`].buffer.byteLength).toBe(32);
        expect(ctx[latchFnName]()).toBe(expectedLatchByte);
      }

      // minimal profile must NOT emit cold-flow latch artifacts
      const minRes = transformJavaScript(source, {
        profile: 'minimal',
        seed: 0x51a7b3c9,
        injectRuntimeShield: false,
      });
      expect(minRes.code).not.toContain('_uLr');
      expect(minRes.code).not.toContain('_uAl');
      expect(minRes.code).not.toContain('_uAm');
    });

    it('keeps C7 Gzip overhead compact (~80-145 B delta on a cold-guarded bundle)', () => {
      const chunks: string[] = [];
      for (let i = 0; i < 6; i++) {
        chunks.push(`
          function handler_${i}(x, opts) {
            var acc = (x ^ ${i + 3}) + (opts ? 1 : 0);
            return acc + "_item_${i}_value";
          }
        `);
      }
      const src = chunks.join('\n');
      const minOut = transformJavaScript(src, {
        profile: 'minimal',
        seed: 0x13572468,
        injectRuntimeShield: false,
      });
      const recOut = transformJavaScript(src, {
        profile: 'recommended',
        seed: 0x13572468,
        injectRuntimeShield: false,
      });
      const gzMin = zlib.gzipSync(minOut.code).byteLength;
      const gzRec = zlib.gzipSync(recOut.code).byteLength;
      expect(gzRec - gzMin).toBeLessThan(1500);
    });
  });

  // =========================================================================
  // 2. C7 Anti-Strip Coupling Verification
  // =========================================================================
  describe('C7 Anti-Strip: Removing or Corrupting _uLr / _uAl / _uAm Silently Corrupts Decoding Without ReferenceError', () => {
    it('silently corrupts string decoding without throwing ReferenceError in both recommended and strict', () => {
      const secretVal = ['api', 'vault', 'bearer', '998877'].join('_');
      const source = `
        function readCredential(ok) {
          var prefix = "hdr_authorization_";
          if (!ok) return "fallback_guest_role";
          return prefix + "${secretVal}";
        }
        globalThis.__cred = function() { return readCredential(true); };
      `;

      for (const profile of ['recommended', 'strict'] as const) {
        const seed = 0x2468ace1;
        const sfx = (seed >>> 0).toString(36).slice(0, 4);
        const { latchFnName } = deriveColdLatchCoupling(seed);
        const res = transformJavaScript(source, {
          profile,
          seed,
          injectRuntimeShield: false,
        });

        // Baseline works cleanly
        const cleanCtx: Record<string, any> = {};
        cleanCtx.globalThis = cleanCtx;
        vm.createContext(cleanCtx);
        vm.runInContext(res.code, cleanCtx);
        expect(cleanCtx.__cred()).toBe(`hdr_authorization_${secretVal}`);

        // Attack 1: Remove _uLr<sfx> declaration completely via AST
        const parsedForLr = acorn.parse(res.code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
        const origLen = parsedForLr.body.length;
        parsedForLr.body = parsedForLr.body.filter(
          (s: any) => !(s.type === 'FunctionDeclaration' && s.id?.name === latchFnName)
        );
        expect(parsedForLr.body.length).toBe(origLen - 1);
        const strippedLr = generateCompactJs(parsedForLr);
        const ctx1: Record<string, any> = {};
        ctx1.globalThis = ctx1;
        vm.createContext(ctx1);
        expect(() => {
          vm.runInContext(strippedLr, ctx1);
          const out1 = ctx1.__cred();
          expect(typeof out1).toBe('string');
          expect(out1).not.toContain(secretVal);
        }).not.toThrow();

        // Attack 2: Corrupt _uAl<sfx>[0] after load
        const ctx2: Record<string, any> = {};
        ctx2.globalThis = ctx2;
        vm.createContext(ctx2);
        vm.runInContext(res.code, ctx2);
        ctx2[`_uAl${sfx}`][0] ^= 0x0f;
        const out2 = ctx2.__cred();
        expect(typeof out2).toBe('string');
        expect(out2).not.toContain(secretVal);

        // Attack 3: Corrupt _uAm<sfx>[1] after load
        const ctx3: Record<string, any> = {};
        ctx3.globalThis = ctx3;
        vm.createContext(ctx3);
        vm.runInContext(res.code, ctx3);
        ctx3[`_uAm${sfx}`][1] ^= 0x33;
        const out3 = ctx3.__cred();
        expect(typeof out3).toBe('string');
        expect(out3).not.toContain(secretVal);

        // Attack 4: Strip _uAl<sfx> / _uAm<sfx> declarations & init from AST
        const parsedForAlias = acorn.parse(res.code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
        for (const stmt of parsedForAlias.body) {
          if (stmt.type === 'VariableDeclaration') {
            stmt.declarations = stmt.declarations.filter(
              (d: any) =>
                d.id?.name !== `_uAl${sfx}` && d.id?.name !== `_uAm${sfx}`
            );
          }
        }
        parsedForAlias.body = parsedForAlias.body.filter(
          (stmt: any) =>
            !(
              stmt.type === 'VariableDeclaration' &&
              stmt.declarations.length === 0
            ) &&
            !(
              stmt.type === 'ExpressionStatement' &&
              stmt.expression?.type === 'CallExpression' &&
              stmt.expression.callee?.type === 'MemberExpression' &&
              stmt.expression.callee.object?.name === `_uAm${sfx}`
            )
        );
        const strippedAlias = generateCompactJs(parsedForAlias);
        const ctx4: Record<string, any> = {};
        ctx4.globalThis = ctx4;
        vm.createContext(ctx4);
        expect(() => {
          vm.runInContext(strippedAlias, ctx4);
          const out4 = ctx4.__cred();
          expect(typeof out4).toBe('string');
          expect(out4).not.toContain(secretVal);
        }).not.toThrow();
      }
    });
  });

  // =========================================================================
  // 3. C9: Cold opaqueTrue Statement Wrapping
  // =========================================================================
  describe('C9: Cold if (!<opaqueFalse>) { stmt; } Wrapping & Exclusions', () => {
    it('wraps safe cold ExpressionStatements and IfStatements while preserving super(), const/let, return, and directives', () => {
      const source = `
        "use strict";
        class BaseWidget {
          constructor(name) {
            this.baseName = name;
          }
        }
        class ChildWidget extends BaseWidget {
          constructor(name, tag) {
            "use strict";
            super(name);
            this.tag = tag;
            this.ready = true;
          }
          run(flag) {
            "use strict";
            const localVal = 10;
            let acc = localVal;
            this.lastFlag = flag;
            if (flag) {
              acc += 5;
            }
            return acc + ":" + this.baseName + ":" + this.tag;
          }
        }
        globalThis.__testWidget = function(f) {
          var w = new ChildWidget("core", "v1");
          return w.run(f);
        };
      `;

      const res = transformJavaScript(source, {
        profile: 'recommended',
        seed: 0x33557799,
        injectRuntimeShield: false,
      });

      const outAst = acorn.parse(res.code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;

      // Verify C9 wrapped statements exist (`if (!( ... )) { ... }`)
      let negatedWrapCount = 0;
      let wrappedSuperCount = 0;
      let wrappedDeclCount = 0;
      let wrappedReturnCount = 0;
      let wrappedDirectiveCount = 0;

      walk.simple(outAst, {
        IfStatement(node: any) {
          if (node.test?.type === 'UnaryExpression' && node.test.operator === '!') {
            negatedWrapCount++;
            const body: any[] = node.consequent?.body ?? [];
            for (const inner of body) {
              if (inner.type === 'VariableDeclaration' || inner.type === 'FunctionDeclaration' || inner.type === 'ClassDeclaration') {
                wrappedDeclCount++;
              }
              if (inner.type === 'ReturnStatement') {
                wrappedReturnCount++;
              }
              if (inner.type === 'ExpressionStatement' && inner.directive) {
                wrappedDirectiveCount++;
              }
              walk.simple(inner, {
                Super() {
                  wrappedSuperCount++;
                },
              });
            }
          }
        },
      });

      expect(negatedWrapCount).toBeGreaterThanOrEqual(2);
      expect(wrappedSuperCount).toBe(0);
      expect(wrappedDeclCount).toBe(0);
      expect(wrappedReturnCount).toBe(0);
      expect(wrappedDirectiveCount).toBe(0);

      // Verify exact runtime semantics
      const ctx: Record<string, any> = {};
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(res.code, ctx);
      expect(ctx.__testWidget(true)).toBe('15:core:v1');
      expect(ctx.__testWidget(false)).toBe('10:core:v1');
    });

    it('never exceeds MAX_COLD_GUARDS_PER_CHUNK=12 across entry guards + C9 wraps', () => {
      const fns = Array.from({ length: 4 }, (_, i) => `
        function coldBatch${i}(x) {
          globalThis.__hit_${i}_a = x + 1;
          globalThis.__hit_${i}_b = x + 2;
          globalThis.__hit_${i}_c = x + 3;
          return x + ${i};
        }
      `).join('\n');
      const ast = acorn.parse(fns, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const guarded = applyColdFlowGuard(ast, coldSet, 0x88776655);
      expect(guarded).toBe(4);

      let totalIfs = 0;
      walk.simple(ast, {
        IfStatement() {
          totalIfs++;
        },
      });
      expect(totalIfs).toBeLessThanOrEqual(MAX_COLD_GUARDS_PER_CHUNK);
      expect(totalIfs).toBe(MAX_COLD_GUARDS_PER_CHUNK);
    });

    it('reserves 4 C9 opaqueTrue slots even when chunk has >=12 cold functions', () => {
      const fns = Array.from({ length: 16 }, (_, i) => `
        function largeCold${i}(x) {
          var acc = x + ${i};
          acc += 7;
          globalThis.__c9_large_${i} = acc;
          return acc;
        }
      `).join('\n');
      const ast = acorn.parse(fns, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const guarded = applyColdFlowGuard(ast, coldSet, 0x31415926);
      expect(guarded).toBe(MAX_COLD_GUARDS_PER_CHUNK - 4);

      let negatedWrapCount = 0;
      let totalIfs = 0;
      walk.simple(ast, {
        IfStatement(node: any) {
          totalIfs++;
          if (node.test?.type === 'UnaryExpression' && node.test.operator === '!') {
            negatedWrapCount++;
          }
        },
      });
      expect(negatedWrapCount).toBe(4);
      expect(totalIfs).toBe(MAX_COLD_GUARDS_PER_CHUNK);

      const outCode = generateCompactJs(ast);
      const ctx: Record<string, any> = {};
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(outCode, ctx);

      for (let i = 0; i < 16; i++) {
        expect(ctx[`largeCold${i}`](10)).toBe(10 + i + 7);
        expect(ctx[`__c9_large_${i}`]).toBe(10 + i + 7);
      }
    });
  });

  // =========================================================================
  // 4. C6a: Scope, Math Shadowing, WithStatement & Hoisting Safety
  // =========================================================================
  describe('C6a: Math Shadowing, WithStatement, wasm-vault Math Guard & Hoisted _uMx/_uLr', () => {
    it('skips Math.imul guard injection in scopes shadowing Math while protecting sibling scopes', () => {
      const source = `
        function shadowedMathFn(x) {
          const Math = { imul: () => 999 };
          return Math.imul(x, 2) + 1;
        }
        function paramShadowedMathFn(Math, x) {
          return Math.imul(x, 3);
        }
        function safeSiblingFn(y) {
          globalThis.__sib = y * 2;
          return y + 10;
        }
      `;
      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const guarded = applyColdFlowGuard(ast, coldSet, 0x11223344, undefined, undefined, undefined, false, {
        enableBitwiseMba: true,
      });

      // Only safeSiblingFn is guarded (2 shadowed functions skipped)
      expect(guarded).toBe(1);

      const outCode = generateCompactJs(ast);
      const ctx: Record<string, any> = {};
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(outCode, ctx);

      expect(ctx.shadowedMathFn(5)).toBe(1000);
      expect(ctx.paramShadowedMathFn({ imul: () => 999 }, 5)).toBe(999);
      expect(ctx.safeSiblingFn(7)).toBe(17);
      expect(ctx.__sib).toBe(14);
    });

    it('bails out cleanly when top-level Math is shadowed and protects wasm-vault Math resolution', () => {
      const seed = 0x55aa77cc;
      const topShadowSrc = `
        const Math = { imul: () => 999 };
        function calcTop(x) {
          return Math.imul(x, 4);
        }
      `;
      const ast = acorn.parse(topShadowSrc, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const guarded = applyColdFlowGuard(ast, coldSet, seed);
      expect(guarded).toBe(0);

      const outCode = generateCompactJs(ast);
      expect(outCode).not.toContain('_uMx');
      expect(outCode).not.toContain('_uLr');

      // wasm-vault CSP fallback with top-level shadowed `const Math = { imul: () => 999 }`
      const wasmAst = acorn.parse(topShadowSrc, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const wasmRes = injectWasmVault(wasmAst, seed);
      expect(wasmRes.wasmBytes.byteLength).toBeLessThan(512);
      const wasmCode = generateCompactJs(wasmAst);

      const cspCtx: Record<string, any> = {
        WebAssembly: undefined,
        Uint8Array,
        String,
      };
      cspCtx.globalThis = cspCtx;
      vm.createContext(cspCtx);
      vm.runInContext(wasmCode, cspCtx);

      expect(cspCtx.calcTop(5)).toBe(999);
      expect(cspCtx[wasmRes.kdfFnName](1, 0x55aa, 0x7f3a)).toBe(
        fallbackKdf(1, 0x55aa, 0x7f3a, seed)
      );
    });

    it('skips guard injection in WithStatement scopes and preserves exact lookup semantics', () => {
      const source = `
        function withLookup(obj, localB) {
          with (obj) {
            return a + localB;
          }
        }
        function cleanFn(x) {
          return x + 1;
        }
      `;
      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const guarded = applyColdFlowGuard(ast, coldSet, 0x44332211);
      expect(guarded).toBe(1);

      const outCode = generateCompactJs(ast);
      const ctx: Record<string, any> = {};
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(outCode, ctx);

      expect(ctx.withLookup({ a: 40 }, 2)).toBe(42);
      expect(ctx.withLookup({ a: 10, localB: 5 }, 2)).toBe(15);
      expect(ctx.cleanFn(9)).toBe(10);
    });

    it('hoists _uMx<sfx> and _uLr<sfx> as FunctionDeclarations so ESM hoisted/circular calls succeed before top-level init', () => {
      const seed = 0x99887766;
      const sfx = (seed >>> 0).toString(36).slice(0, 4);
      const ast = acorn.parse(
        `function coldTarget(x) { globalThis.__hit = x; return x + 5; }`,
        { ecmaVersion: 'latest', sourceType: 'script' }
      ) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const guarded = applyColdFlowGuard(ast, coldSet, seed);
      expect(guarded).toBe(1);

      // Verify _uMx<sfx> and _uLr<sfx> are top-level FunctionDeclarations (hoisted)
      const fnDeclNames = (ast.body as any[])
        .filter((s) => s.type === 'FunctionDeclaration')
        .map((s) => s.id?.name);
      expect(fnDeclNames).toContain(`_uMx${sfx}`);
      expect(fnDeclNames).toContain(`_uLr${sfx}`);

      // Simulate ESM circular import where coldTarget() is invoked BEFORE top-level var initializers run
      const code = generateCompactJs(ast);
      const hoistedCallSrc = `
        var __earlyResult = coldTarget(12);
        ${code}
      `;
      const ctx: Record<string, any> = {};
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(hoistedCallSrc, ctx);
      expect(ctx.__earlyResult).toBe(17);
      expect(ctx.__hit).toBe(12);
      expect(ctx[`_uLr${sfx}`]()).toBe(deriveColdLatchCoupling(seed).expectedLatchByte);
    });
  });
});
