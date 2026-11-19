import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { generate } from 'astring';
import {
  applyColdFlowGuard,
  createSotaMbaPredicate,
  MAX_COLD_GUARDS_PER_CHUNK,
} from '../src/ast/cold-flow-guard.js';
import {
  applyMicroVm,
  createInterpreterSource,
  generateOpcodeMap,
  type MicroVmExtraOptions,
} from '../src/ast/micro-vm.js';
import * as microVmModule from '../src/ast/micro-vm.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import { createDeterrentSnippet, deriveWindowKeySymbol } from '../src/runtime/devtools-deterrent.js';
import { generateRuntimeShield } from '../src/runtime/index.js';

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

describe('P2 Audit Remediation: Cold-Flow QNR Diversification & Micro-VM v2 Non-Zero Handler Offsets', () => {
  // =========================================================================
  // 1. P2a Cold-Flow Guard Diversification & State/Shield Coupling
  // =========================================================================
  describe('P2a: Cold-Flow QNR Diversification & Invariant-Preserving State Updates', () => {
    it('uses polymorphic _uDec<sfx> decoy identifier by default in applyColdFlowGuard and eliminates outer === literal QNR suffix', () => {
      const fns = Array.from({ length: 14 }, (_, i) =>
        `function fn${i}(x) { var r = x + ${i + 1}; return r * 2; }`
      ).join('\n');
      const ast = acorn.parse(fns, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      const seed = 0x51a7b3c9;
      const sfx = (seed >>> 0).toString(36).slice(0, 4);
      const sym = deriveWindowKeySymbol(seed);

      const guarded = (applyColdFlowGuard as any)(
        ast,
        coldSet,
        seed,
        undefined,
        sym,
        0x1234,
        true
      );
      expect(guarded).toBe(MAX_COLD_GUARDS_PER_CHUNK);

      const outCode = generateCompactJs(ast);
      expect(outCode).toContain(`_uDec${sfx}`);
      expect(outCode).not.toMatch(/\bvar _d=/);

      // Syntactic === <literal> QNR suffix extractor must find 0 matching outer IfStatements
      const outAst = acorn.parse(outCode, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
      let literalEqOuterTests = 0;
      let totalGuardIfs = 0;
      const outerOperators = new Set<string>();
      walk.simple(outAst, {
        IfStatement(node: any) {
          totalGuardIfs++;
          outerOperators.add(node.test.type === 'BinaryExpression' ? node.test.operator : node.test.type);
          if (
            node.test?.type === 'BinaryExpression' &&
            node.test.operator === '===' &&
            node.test.right?.type === 'Literal'
          ) {
            literalEqOuterTests++;
          }
        },
      });
      expect(totalGuardIfs).toBe(MAX_COLD_GUARDS_PER_CHUNK);
      expect(literalEqOuterTests).toBe(0);
      // Must diversify across multiple distinct AST predicate shapes
      expect(outerOperators.size).toBeGreaterThanOrEqual(3);
      // Must couple to globalThis[sym + '_s'] when shieldCoupled is true
      expect(outCode).toContain(`${sym}_s`);
      // Must NOT use naive (x & 0) update on _uAl
      expect(outCode).not.toMatch(new RegExp(`_uAl${sfx}\\[\\d+\\]=[^;]*&0`));
    });

    it('keeps all 4 predicate forms deterministically false in normal execution, fires decoy on shield tamper, and preserves _uAl state', () => {
      const seed = 0x9e3779b9;
      const sym = deriveWindowKeySymbol(seed);
      const sfx = (seed >>> 0).toString(36).slice(0, 4);
      const src = Array.from({ length: 8 }, (_, i) =>
        `function calc${i}(a, b) { return a + b + ${i}; }`
      ).join('\n');

      const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const coldSet = collectAllFunctions(ast);
      (applyColdFlowGuard as any)(ast, coldSet, seed, undefined, sym, 0x2222, true);
      const protectedCode = generateCompactJs(ast);

      // Clean execution across varied inputs
      const cleanCtx: Record<string, any> = {
        Math,
        String,
        [`${sym}_s`]: [1, 0, 0, 1, 0],
      };
      cleanCtx.globalThis = cleanCtx;
      vm.createContext(cleanCtx);
      vm.runInContext(protectedCode, cleanCtx);

      const initialAlias = [...cleanCtx[`_uAl${sfx}`]];
      for (let i = 0; i < 8; i++) {
        for (const [a, b] of [[0, 0], [-1, 5], [0x7fffffff, -3], [42, 99]]) {
          expect(cleanCtx[`calc${i}`](a, b)).toBe(a + b + i);
        }
      }
      // Double-applied state update must preserve _uAl invariant values
      expect(cleanCtx[`_uAl${sfx}`]).toEqual(initialAlias);

      // Tampered shield state (sym_s[0] === 2) must trigger shield-coupled guard decoy
      const tamperCtx: Record<string, any> = {
        Math,
        String,
        [`${sym}_s`]: [2, 0, 0, 1, 0],
      };
      tamperCtx.globalThis = tamperCtx;
      vm.createContext(tamperCtx);
      vm.runInContext(protectedCode, tamperCtx);
      let decoyTriggeredCount = 0;
      for (let i = 0; i < 8; i++) {
        if (tamperCtx[`calc${i}`](10, 20) !== 30 + i) {
          decoyTriggeredCount++;
        }
      }
      expect(decoyTriggeredCount).toBeGreaterThanOrEqual(1);

      // createSotaMbaPredicate explicit decoyIdent still works standalone without ctxOpts
      for (let idx = 0; idx < 8; idx++) {
        const stmt = createSotaMbaPredicate(seed, idx, 'arg', '_customDecoy');
        expect(stmt.test.type === 'BinaryExpression' && stmt.test.operator === '===' && stmt.test.right.type === 'Literal').toBe(false);
        const stmtCode = generate(stmt);
        const fn = new Function('arg', '_customDecoy', `${stmtCode}; return arg + 1;`);
        for (const v of [0, 1, -1, 17, 0x7fffffff]) {
          expect(fn(v, [() => ({}), () => ({}), () => ({})])).toBe(v + 1);
        }
      }
    });

    it('stays within <15% Gzip size delta on a representative client bundle', () => {
      // Build a realistic ~75KB non-repeating client bundle (~22KB+ gzipped)
      const blocks: string[] = [];
      for (let i = 0; i < 16; i++) {
        const tag = (i * 2654435761 >>> 0).toString(36);
        blocks.push(`
          function coldHandler_${tag}_${i}(payload, opts) {
            var rate = (opts && opts.rate_${i}) || ${(i % 9) + 1}.${(i * 7) % 10};
            var base = payload.value_${tag} * rate + ${i * 13 + 7};
            return { key: "evt_${tag}_${i}", val: base > 50 ? base : 0 };
          }
        `);
      }
      // Diverse realistic application state/data definitions (non-repeating entropy)
      const appSlices: string[] = [];
      for (let j = 0; j < 700; j++) {
        const h1 = ((j + 1) * 0x9e3779b1 >>> 0).toString(36);
        const h2 = ((j + 7) * 0x85ebca6b >>> 0).toString(36);
        const h3 = ((j + 13) * 0xc2b2ae35 >>> 0).toString(36);
        appSlices.push(
          `var _mod_${h1}_${j}={id:"${h1}-${h2}",weight:${(j * 37) % 1000},flags:[${j & 1},${(j >> 1) & 1},"${h3}"],fn_${h2}:function(v){var s=0;for(var k=0;k<v.length;k++)s+=v[k]^${j & 255};return s;}};`
        );
      }
      const bundleSrc = blocks.join('\n') + '\n' + appSlices.join('\n');
      const ast = acorn.parse(bundleSrc, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const baselineGzip = zlib.gzipSync(generateCompactJs(ast)).byteLength;
      expect(baselineGzip).toBeGreaterThan(15000);
      const coldSet = new WeakSet<acorn.Node>();
      for (const stmt of ast.body as any[]) {
        if (stmt.type === 'FunctionDeclaration') coldSet.add(stmt);
      }
      const guarded = (applyColdFlowGuard as any)(ast, coldSet, 0x13572468, undefined, '_wKey', 0x1111, true);
      expect(guarded).toBe(MAX_COLD_GUARDS_PER_CHUNK);

      const protectedCode = generateCompactJs(ast);
      const protectedGzip = zlib.gzipSync(protectedCode).byteLength;
      const deltaPct = ((protectedGzip - baselineGzip) / baselineGzip) * 100;
      expect(deltaPct).toBeLessThan(15);
    });
  });

  // =========================================================================
  // 2. P2a Micro-VM v2 Non-Zero Semantic Handler Offsets (43/43)
  // =========================================================================
  describe('P2a: Micro-VM v2 Non-Zero Semantic Handler Offsets (43/43)', () => {
    it('exports computeHandlerBias(seed, op) returning deterministic non-zero 1..31 and eliminates ($z0 - delta) cancellation across all 43 handlers', () => {
      const computeHandlerBias = (microVmModule as any).computeHandlerBias as
        | ((seed: number, op: number) => number)
        | undefined;
      expect(typeof computeHandlerBias).toBe('function');

      const seed = 0x44882211;
      for (let op = 0; op < 43; op++) {
        const bias = computeHandlerBias!(seed, op);
        expect(Number.isInteger(bias)).toBe(true);
        expect(bias).toBeGreaterThanOrEqual(1);
        expect(bias).toBeLessThanOrEqual(31);
      }

      const opMap = generateOpcodeMap(seed, 43);
      const interpSrc = createInterpreterSource('_uVmTest', opMap, seed);
      const vmAst = acorn.parse(interpSrc, { ecmaVersion: 'latest', sourceType: 'script' }) as any;

      let handlerArray: any = null;
      const longStrings: string[] = [];
      walk.simple(vmAst, {
        Literal(n: any) {
          if (typeof n.value === 'string' && n.value.length >= 4) {
            longStrings.push(n.value);
          }
        },
        VariableDeclarator(n: any) {
          if (n.id?.name === '$H' && n.init?.type === 'ArrayExpression') {
            handlerArray = n.init;
          }
        },
      });
      expect(longStrings).toEqual([]);
      expect(handlerArray).not.toBeNull();
      expect(handlerArray.elements).toHaveLength(43);

      // 1) No handler may contain the trivial ($z0 - bias) cancellation pattern
      // 2) Every handler's MBA init expression evaluates to a non-zero constant across 64 vectors
      for (let i = 0; i < 43; i++) {
        const handlerFn = handlerArray.elements[i];
        const handlerSrc = generate(handlerFn);
        const firstDecl = handlerFn.body.body[0];
        expect(firstDecl.type).toBe('VariableDeclaration');
        const zName = firstDecl.declarations[0].id.name as string;
        const initExpr = firstDecl.declarations[0].init;
        const evalMba = new Function('$f', `return (${generate(initExpr)});`);
        const observed = new Set<number>();
        let rng = 0x12345678 | 0;
        for (let v = 0; v < 64; v++) {
          rng = (Math.imul(rng ^ 0x9e3779b9, 0x45d9f3b) + 1) | 0;
          observed.add(evalMba({ ac: rng, p: (rng ^ (v * 0x27d4eb2d)) >>> 0 }) as number);
        }
        expect(observed.size).toBe(1);
        const biasVal = Array.from(observed)[0];
        expect(biasVal).toBeGreaterThanOrEqual(1);
        expect(biasVal).toBeLessThanOrEqual(31);

        // Must NOT contain ($z0 - biasVal) dead trick directly after declaring zVar
        expect(handlerSrc).not.toContain(`${zName} - ${biasVal}`);
      }
    });

    it('breaks execution when an attacker zeroes out $z0/$m0/$k0 in handlers, while clean execution matches original JS across arithmetic, loops, try/catch, closures, and async/await', async () => {
      const source = `
        var outerCounter = 10;
        function vmSuite(arr, obj, flag) {
          var sum = 0;
          for (var i = 0; i < arr.length; i++) {
            sum += arr[i];
          }
          var built = { ok: flag, arr: [sum, obj.val] };
          outerCounter += built.arr[0];
          try {
            if (!flag) {
              throw new Error("FAIL_" + outerCounter);
            }
          } catch (e) {
            return e.message + ":" + typeof built;
          }
          return built.arr[0] + built.arr[1] + outerCounter;
        }
        async function vmAsync(a, b) {
          var v = await Promise.resolve(a * 2 + b);
          return (v > 10 && !false) ? v + 1 : v - 1;
        }
      `;
      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const seed = 0xabcdef12;
      const vmRes = applyMicroVm(ast, undefined, undefined, seed);
      expect(vmRes.virtualizedCount).toBe(2);
      const outCode = generateCompactJs(ast);

      const cleanCtx: Record<string, any> = { Error, Promise, Math, String };
      cleanCtx.globalThis = cleanCtx;
      vm.createContext(cleanCtx);
      vm.runInContext(outCode, cleanCtx);

      expect(cleanCtx.vmSuite([1, 2, 3], { val: 5 }, true)).toBe(27);
      expect(cleanCtx.vmSuite([1, 2], { val: 5 }, false)).toBe('FAIL_19:object');
      expect(await cleanCtx.vmAsync(4, 5)).toBe(14);
      expect(await cleanCtx.vmAsync(2, 3)).toBe(6);

      // Semantic coupling check: replacing handler MBA declarations with 0 MUST break VM execution
      const zeroedCode = outCode.replace(/var \$(z0|m0|k0)=[^;]+;/g, 'var $$1=0;');
      expect(zeroedCode).not.toBe(outCode);
      const attackCtx: Record<string, any> = { Error, Promise, Math, String };
      attackCtx.globalThis = attackCtx;
      vm.createContext(attackCtx);
      let attackOut: unknown;
      try {
        vm.runInContext(zeroedCode, attackCtx);
        attackOut = attackCtx.vmSuite([1, 2, 3], { val: 5 }, true);
      } catch {
        attackOut = '__THROWN__';
      }
      expect(attackOut).not.toBe(27);
    });
  });

  // =========================================================================
  // 3. P2a Narrowed $sv === void 0 Gate & 32-bit sym_s[1] Verification
  // =========================================================================
  describe('P2a: Narrowed Browser/Worker Gate & 32-bit sym_s[1] Verification', () => {
    it('fails closed in window = {} or document.readyState === "complete" when sv === undefined, while allowing genuine loading DOM and Web Worker', () => {
      const seed = 0x77665544;
      const shield = generateRuntimeShield({ seed, deterrentMode: 'passive' });
      const source = `
        function secretOp(x) {
          var y = x * 3 + 7;
          if (y > 10) return y + 100;
          return y;
        }
        globalThis.__res = secretOp;
      `;
      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const vmRes = applyMicroVm(ast, undefined, undefined, seed, shield.windowKeySymbol, shield.expectedDelta);
      expect(vmRes.virtualizedCount).toBe(1);
      const vmCode = generateCompactJs(ast);

      // 1. Fake bare window = {} (no document, no Worker importScripts) -> MUST FAIL CLOSED
      const fakeWinCtx: Record<string, any> = { window: {}, Math, String, Promise };
      fakeWinCtx.globalThis = fakeWinCtx;
      vm.createContext(fakeWinCtx);
      let fakeWinOut: unknown;
      try {
        vm.runInContext(vmCode, fakeWinCtx);
        fakeWinOut = fakeWinCtx.__res(5);
      } catch {
        fakeWinOut = '__THROWN__';
      }
      expect(fakeWinOut).not.toBe(122);

      // 2. Completed DOM without shield having executed (sv === undefined) -> MUST FAIL CLOSED
      const completeDoc: any = { nodeType: 9, scripts: [{}], readyState: 'complete' };
      const completeWin: any = { document: completeDoc };
      const completeCtx: Record<string, any> = {
        window: completeWin,
        document: completeDoc,
        Math,
        String,
        Promise,
      };
      completeCtx.globalThis = completeCtx;
      vm.createContext(completeCtx);
      let completeOut: unknown;
      try {
        vm.runInContext(vmCode, completeCtx);
        completeOut = completeCtx.__res(5);
      } catch {
        completeOut = '__THROWN__';
      }
      expect(completeOut).not.toBe(122);

      // 3. Genuine loading DOM (document.readyState === 'loading' with scripts) -> async tolerance allowed
      const loadingDoc: any = { nodeType: 9, scripts: [{}], readyState: 'loading' };
      const loadingWin: any = { document: loadingDoc };
      const loadingCtx: Record<string, any> = {
        window: loadingWin,
        document: loadingDoc,
        Math,
        String,
        Promise,
      };
      loadingCtx.globalThis = loadingCtx;
      vm.createContext(loadingCtx);
      vm.runInContext(vmCode, loadingCtx);
      expect(loadingCtx.__res(5)).toBe(122);

      // 4. Genuine WorkerGlobalScope (self.importScripts === function) -> async tolerance allowed
      const workerCtx: Record<string, any> = {
        importScripts: () => {},
        Math,
        String,
        Promise,
      };
      workerCtx.self = workerCtx;
      workerCtx.globalThis = workerCtx;
      vm.createContext(workerCtx);
      vm.runInContext(vmCode, workerCtx);
      expect(workerCtx.__res(5)).toBe(122);
    });

    it('enforces 32-bit sym_s[1] (expectedStateHash) + sym_s[0] === 1 against 16-bit RQyw brute-force while remaining compatible with real runtime shield', () => {
      const seed = 0x31415926;
      const sym = deriveWindowKeySymbol(seed);
      const snippet = createDeterrentSnippet({ seed, windowKeySymbol: sym });

      // Execute real runtime shield in clean VM realm (without host Vitest Error.prepareStackTrace)
      const realWin: Record<string, any> = {};
      const realCtx: Record<string, any> = { window: realWin };
      realCtx.globalThis = realCtx;
      vm.createContext(realCtx);
      vm.runInContext(snippet, realCtx);

      const trueDelta = realWin[sym] as number;
      const trueStateTuple = realWin[`${sym}_s`] as number[];
      expect(trueStateTuple[0]).toBe(1);
      const trueStateHash = trueStateTuple[1] | 0;

      const source = `
        function authGate(code) {
          var base = code + 10;
          if (base > 15) return base * 2;
          return base;
        }
        globalThis.__auth = authGate;
      `;
      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      const extraOpts: MicroVmExtraOptions & { expectedStateHash?: number } = {
        expectedStateHash: trueStateHash,
      };
      const vmRes = applyMicroVm(ast, undefined, undefined, seed, sym, trueDelta, extraOpts as any);
      expect(vmRes.virtualizedCount).toBe(1);
      const vmCode = generateCompactJs(ast);

      // 1. Real shield + Micro-VM -> succeeds cleanly
      vm.runInContext(vmCode, realCtx);
      expect(realCtx.__auth(10)).toBe(40);
      expect(realCtx.__auth(2)).toBe(12);

      // 2. Attacker brute-forces ONLY 16-bit sym (trueDelta) without sym_s -> MUST FAIL CLOSED
      const noStateCtx: Record<string, any> = {
        window: { [sym]: trueDelta },
        [sym]: trueDelta,
        Math,
        String,
        Promise,
      };
      noStateCtx.globalThis = noStateCtx;
      vm.createContext(noStateCtx);
      let noStateOut: unknown;
      try {
        vm.runInContext(vmCode, noStateCtx);
        noStateOut = noStateCtx.__auth(10);
      } catch {
        noStateOut = '__THROWN__';
      }
      expect(noStateOut).not.toBe(40);

      // 3. Attacker sets sym = trueDelta and sym_s = [1, wrong32BitHash] -> MUST FAIL CLOSED
      const badHashCtx: Record<string, any> = {
        window: { [sym]: trueDelta, [`${sym}_s`]: [1, (trueStateHash ^ 1) | 0, 0, 1, 0] },
        [sym]: trueDelta,
        [`${sym}_s`]: [1, (trueStateHash ^ 1) | 0, 0, 1, 0],
        Math,
        String,
        Promise,
      };
      badHashCtx.globalThis = badHashCtx;
      vm.createContext(badHashCtx);
      let badHashOut: unknown;
      try {
        vm.runInContext(vmCode, badHashCtx);
        badHashOut = badHashCtx.__auth(10);
      } catch {
        badHashOut = '__THROWN__';
      }
      expect(badHashOut).not.toBe(40);

      // 4. Backward compatibility: expectedDelta-only (without expectedStateHash) still verifies with just sym === trueDelta
      const compatAst = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as acorn.Program;
      applyMicroVm(compatAst, undefined, undefined, seed, sym, trueDelta);
      const compatCtx: Record<string, any> = {
        window: { [sym]: trueDelta },
        [sym]: trueDelta,
        Math,
        String,
        Promise,
      };
      compatCtx.globalThis = compatCtx;
      vm.createContext(compatCtx);
      vm.runInContext(generateCompactJs(compatAst), compatCtx);
      expect(compatCtx.__auth(10)).toBe(40);

      // 5. Real Error.prepareStackTrace tampering in VM realm triggers sym_s[0] === 2 and fails closed
      const pstWin: Record<string, any> = {};
      const pstCtx: Record<string, any> = { window: pstWin };
      pstCtx.globalThis = pstCtx;
      vm.createContext(pstCtx);
      vm.runInContext('Error.prepareStackTrace = function() { return "spoofed"; };', pstCtx);
      vm.runInContext(snippet, pstCtx);
      expect(pstWin[`${sym}_s`][0]).toBe(2);
      vm.runInContext(vmCode, pstCtx);
      expect(pstCtx.__auth(10)).not.toBe(40);
    });
  });
});
