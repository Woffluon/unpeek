import { describe, it, expect, vi } from 'vitest';
import * as vm from 'node:vm';
import {
  transformJavaScript,
  detectHotPaths,
} from '../src/ast/index.js';
import {
  analyzeAstHotPaths,
  parseJavaScriptAst,
} from '../src/ast/hot-path-detector.js';
import * as vlq from '../src/core/vlq.js';
import type { AnySourceMap } from '../src/core/vlq.js';
import { resolveSourceMapCriticalNodes } from '../src/ast/sourcemap-critical.js';

function encodeTestMappings(
  entries: Array<{
    genLine: number;
    genCol: number;
    sourceIndex: number;
    origLine: number;
    origCol: number;
    nameIndex?: number;
  }>
): string {
  return vlq.encodeMappings(
    entries.map((e) => ({
      generatedLine: e.genLine,
      generatedColumn: e.genCol,
      sourceIndex: e.sourceIndex,
      originalLine: e.origLine,
      originalColumn: e.origCol,
      ...(e.nameIndex !== undefined ? { nameIndex: e.nameIndex } : {}),
    }))
  );
}

describe('Audit P0 & P1b: Critical Function Protection & Already-Protected False Positives', () => {
  describe('P0 isPascalCaseComponent + hasUiComponentSignal', () => {
    it('does NOT exempt minified PascalCase business-logic functions (Xo, Ps, Pt, Ko, Go) lacking UI signals', () => {
      const code = `
        function Xo(e, t) {
          var secret = "TIER_MULTIPLIER_SECRET";
          return e > 10 ? e * t + secret.length : e;
        }
        const Ps = function(a, b) {
          var token = "INTERNAL_PRICING_KEY";
          return a + b + token.length;
        };
        const Pt = (x) => {
          var salt = "SALT_VALUE_ALPHA";
          return x ^ salt.length;
        };
        function Ko(n) {
          var mode = "STRICT_AUTH_GATE";
          return n ? mode.length : 0;
        }
        function Go(v) {
          var code = "CHECKOUT_SIGNATURE";
          return v + code.length;
        }
      `;

      const ast = parseJavaScriptAst(code)!;
      const analysis = analyzeAstHotPaths(ast);

      expect(analysis.report.coldFunctionsProtected).toEqual(
        expect.arrayContaining(['Xo', 'Ps', 'Pt', 'Ko', 'Go'])
      );
      expect(analysis.report.hotFunctionsSkipped).not.toContain('Xo');
      expect(analysis.report.hotFunctionsSkipped).not.toContain('Ps');
      expect(analysis.report.hotFunctionsSkipped).not.toContain('Pt');
      expect(analysis.report.hotFunctionsSkipped).not.toContain('Ko');
      expect(analysis.report.hotFunctionsSkipped).not.toContain('Go');

      for (const stmt of ast.body as any[]) {
        const fnNode =
          stmt.type === 'FunctionDeclaration'
            ? stmt
            : stmt.declarations?.[0]?.init;
        expect(analysis.coldFunctionNodes.has(fnNode)).toBe(true);
        expect(analysis.hotExemptNodes.has(fnNode)).toBe(false);
        expect(fnNode._unpeekIsComponent).not.toBe(true);
      }

      const res = transformJavaScript(code, { seed: 0x13572468 });
      expect(res.encryptedStringsCount).toBeGreaterThanOrEqual(5);
      expect(res.code).not.toContain('TIER_MULTIPLIER_SECRET');
      expect(res.code).not.toContain('INTERNAL_PRICING_KEY');
    });

    it('does NOT bleed UI component signals from unrelated nested inner functions to outer PascalCase business functions', () => {
      const code = `
        function OuterBusinessNamespace(config) {
          function InnerWidget(props) {
            return jsx("div", { id: props.id });
          }
          var key = "OUTER_BUSINESS_SECRET";
          return config.flag ? key.length : InnerWidget({ id: "x" });
        }
      `;

      const ast = parseJavaScriptAst(code)!;
      const analysis = analyzeAstHotPaths(ast);

      expect(analysis.report.coldFunctionsProtected).toContain('OuterBusinessNamespace');
      expect(analysis.report.hotFunctionsSkipped).toContain('InnerWidget');
      expect(analysis.report.hotFunctionsSkipped).not.toContain('OuterBusinessNamespace');
    });

    it('verifies real UI components via JSX factories, React hooks, and HOC wrappers and marks _unpeekIsComponent = true', () => {
      const code = `
        function JsxCard(props) {
          return _jsx("div", { children: props.title });
        }
        function JsxDevPanel(props) {
          return _jsxDEV("section", { children: props.body }, void 0, false);
        }
        function SequenceJsxBadge(props) {
          return (0, rt.jsxs)("span", { children: [props.label] });
        }
        function CloneWrapper(el) {
          return React.cloneElement(el, { active: true });
        }
        function PreactBox(props) {
          return h("div", { className: "box" }, props.text);
        }
        function HookedWidget() {
          const [count, setCount] = useState(0);
          return count;
        }
        const MemoPanel = React.memo(function(props) {
          return props.label;
        });
        const RefInput = forwardRef((props, ref) => {
          return props.value;
        });
        const ObservedView = observer((props) => {
          return props.state;
        });
        const ConnectedView = connect(mapState)((props) => {
          return props.user;
        });
        function MinifiedHelperCaller(x) {
          return h(x);
        }
      `;

      const ast = parseJavaScriptAst(code)!;
      const analysis = analyzeAstHotPaths(ast);

      const expectedHot = [
        'JsxCard',
        'JsxDevPanel',
        'SequenceJsxBadge',
        'CloneWrapper',
        'PreactBox',
        'HookedWidget',
        'MemoPanel',
        'RefInput',
        'ObservedView',
        'ConnectedView',
      ];
      for (const name of expectedHot) {
        expect(analysis.report.hotFunctionsSkipped).toContain(name);
      }
      expect(analysis.report.coldFunctionsProtected).toContain('MinifiedHelperCaller');
      expect(analysis.report.hotFunctionsSkipped).not.toContain('MinifiedHelperCaller');
    });
  });

  describe('P0 /*! @unpeek-critical */ & Source Map v3 Critical Targeting', () => {
    it('supports /*! @unpeek-critical */ preserve block comments even with ASI semicolons / EmptyStatement', () => {
      const code = `
        function regularCold(x) {
          var r = "REGULAR_PLAIN_TEXT";
          return x + r.length;
        }
        /*! @unpeek-critical */
        ;function VerifyLicense(key) {
          var s = "CRITICAL_LICENSE_TOKEN";
          return key === s ? 1 : 0;
        }
      `;

      const ast = parseJavaScriptAst(code)!;
      const analysis = analyzeAstHotPaths(ast);
      expect(analysis.report.coldFunctionsProtected).toContain('VerifyLicense');

      const verifyFn = (ast.body as any[]).find(
        (s) => s.type === 'FunctionDeclaration' && s.id?.name === 'VerifyLicense'
      );
      expect(analysis.criticalFunctionNodes?.has(verifyFn)).toBe(true);

      const res = transformJavaScript(code, {
        seed: 0x24681357,
        aggressive: true,
        critical: { annotation: '@unpeek-critical', maxFunctionsPerChunk: 1 },
      });
      expect(res.virtualizedFunctionsCount).toBe(1);
      expect(res.code).not.toContain('CRITICAL_LICENSE_TOKEN');

      const ctx: Record<string, any> = {};
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(res.code, ctx);
      expect(ctx.VerifyLicense('CRITICAL_LICENSE_TOKEN')).toBe(1);
      expect(ctx.VerifyLicense('WRONG')).toBe(0);
    });

    it('resolves @unpeek-critical and critical.include via Source Map v3 (names + sourcesContent + 5-line window) and prioritizes Micro-VM v2', () => {
      const originalSource = [
        'export function regularHelper(n: number) {', // 0
        '  return n + 1;', // 1
        '}', // 2
        '', // 3
        '// @unpeek-critical', // 4 (3 lines above line 7 via comment + blank line)
        '// Validates enterprise seat entitlement', // 5
        '', // 6
        'export function Xo(key: string) {', // 7
        '  const secret = "ENTITLEMENT_MASTER_KEY";', // 8
        '  return key === secret ? 42 : 0;', // 9
        '}', // 10
        '', // 11
        'export function Ps(amount: number) {', // 12
        '  const tag = "DISCOUNT_SECRET_TAG";', // 13
        '  return amount > 100 ? amount - tag.length : amount;', // 14
        '}', // 15
      ].join('\n');

      const generatedCode = [
        'function regularHelper(n){return n+1}',
        'function Xo(e){var t="ENTITLEMENT_MASTER_KEY";return e===t?42:0}',
        'function a(e){var t="DISCOUNT_SECRET_TAG";return e>100?e-t.length:e}',
      ].join('\n');

      const sourceMap: AnySourceMap = {
        version: 3,
        sources: ['src/licensing.ts'],
        sourcesContent: [originalSource],
        names: ['regularHelper', 'Xo', 'calculateEnterpriseDiscount'],
        mappings: encodeTestMappings([
          { genLine: 0, genCol: 0, sourceIndex: 0, origLine: 0, origCol: 7 },
          { genLine: 0, genCol: 9, sourceIndex: 0, origLine: 0, origCol: 16, nameIndex: 0 },
          { genLine: 1, genCol: 0, sourceIndex: 0, origLine: 7, origCol: 7 },
          { genLine: 1, genCol: 9, sourceIndex: 0, origLine: 7, origCol: 16, nameIndex: 1 },
          { genLine: 2, genCol: 0, sourceIndex: 0, origLine: 12, origCol: 7 },
          { genLine: 2, genCol: 9, sourceIndex: 0, origLine: 12, origCol: 16, nameIndex: 2 },
        ]),
      };

      const ast = parseJavaScriptAst(generatedCode)!;
      const analysis = analyzeAstHotPaths(
        ast,
        { critical: { include: ['calculateEnterpriseDiscount'] } },
        sourceMap
      );

      const xoNode = (ast.body as any[])[1];
      const aNode = (ast.body as any[])[2];
      const regNode = (ast.body as any[])[0];

      expect(analysis.criticalFunctionNodes?.has(xoNode)).toBe(true);
      expect(analysis.criticalFunctionNodes?.has(aNode)).toBe(true);
      expect(analysis.criticalFunctionNodes?.has(regNode)).toBe(false);

      const res = transformJavaScript(generatedCode, {
        seed: 0xdeadbeef,
        aggressive: true,
        critical: { maxFunctionsPerChunk: 1 },
        originalSourceMap: sourceMap,
      } as any);
      expect(res.virtualizedFunctionsCount).toBe(1);
      expect(res.code).not.toContain('ENTITLEMENT_MASTER_KEY');

      const ctx: Record<string, any> = {};
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(res.code, ctx);
      expect(ctx.Xo('ENTITLEMENT_MASTER_KEY')).toBe(42);
      expect(ctx.Xo('BAD')).toBe(0);
    });

    it('supports indexed Source Map sections via flattenSourceMapSections and skips VLQ in O(1) when pre-filter misses', () => {
      const code = 'function alpha(x){return x+1}';
      const ast = parseJavaScriptAst(code)!;

      // O(1) pre-filter miss: no @unpeek-critical in sourcesContent, no match in names
      const decodeSpy = vi.spyOn(vlq, 'decodeVlq');
      const missMap: AnySourceMap = {
        version: 3,
        sources: ['src/a.ts'],
        sourcesContent: ['export function alpha(x) { return x + 1; }'],
        names: ['alpha'],
        mappings: 'AAAA',
      };
      const missResult = resolveSourceMapCriticalNodes(
        [{ node: (ast.body as any[])[0], name: 'alpha', idNode: (ast.body as any[])[0].id }],
        missMap,
        {
          criticalAnnotation: '@unpeek-critical',
          criticalIncludeMatchers: [(n) => n === 'nonExistentTarget'],
          rawIncludePatterns: ['nonExistentTarget'],
        }
      );
      expect(missResult.size).toBe(0);
      expect(decodeSpy).not.toHaveBeenCalled();
      decodeSpy.mockRestore();

      // Indexed section map match
      const indexedMap: AnySourceMap = {
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ['src/sec.ts'],
              sourcesContent: ['// @unpeek-critical\nexport function secretAlpha(x) { return x + 1; }'],
              names: ['secretAlpha'],
              mappings: encodeTestMappings([
                { genLine: 0, genCol: 0, sourceIndex: 0, origLine: 1, origCol: 7 },
                { genLine: 0, genCol: 9, sourceIndex: 0, origLine: 1, origCol: 16, nameIndex: 0 },
              ]),
            },
          },
        ],
      };

      const analysis = analyzeAstHotPaths(ast, undefined, indexedMap);
      expect(analysis.criticalFunctionNodes?.has((ast.body as any[])[0])).toBe(true);
    });

    it('does NOT bleed @unpeek-critical across non-comment code statements or beyond 5 lines above', () => {
      const originalSource = [
        '// @unpeek-critical', // 0
        'const separator = 1;', // 1 (code statement blocks upward scan)
        'export function blockedFn(x) { return x; }', // 2
        '', // 3
        '// @unpeek-critical', // 4 (6 lines above line 10)
        '// line 5', // 5
        '// line 6', // 6
        '// line 7', // 7
        '// line 8', // 8
        '// line 9', // 9
        'export function tooFarFn(y) { return y; }', // 10
      ].join('\n');

      const generated = [
        'function a(x){return x}',
        'function b(y){return y}',
      ].join('\n');

      const sourceMap: AnySourceMap = {
        version: 3,
        sources: ['src/edge.ts'],
        sourcesContent: [originalSource],
        names: ['blockedFn', 'tooFarFn'],
        mappings: encodeTestMappings([
          { genLine: 0, genCol: 9, sourceIndex: 0, origLine: 2, origCol: 16, nameIndex: 0 },
          { genLine: 1, genCol: 9, sourceIndex: 0, origLine: 10, origCol: 16, nameIndex: 1 },
        ]),
      };

      const ast = parseJavaScriptAst(generated)!;
      const analysis = analyzeAstHotPaths(ast, undefined, sourceMap);
      expect(analysis.criticalFunctionNodes?.has((ast.body as any[])[0])).toBe(false);
      expect(analysis.criticalFunctionNodes?.has((ast.body as any[])[1])).toBe(false);
    });

    it('overrides SHALLOW_RENDER_COMPONENT for critical functions, but NEVER overrides TRUE_HOT_60FPS or SERIALIZED_WORKER', () => {
      const code = `
        // @unpeek-critical
        function CriticalComponent(props) {
          const [ok] = useState(true);
          return jsx("div", { ok, label: props.label });
        }

        // @unpeek-critical
        function HotLoopFunction(arr) {
          let sum = 0;
          for (let i = 0; i < arr.length; i++) {
            sum += arr[i];
          }
          return sum;
        }

        // @unpeek-critical
        function WorkerEntry(ev) {
          return ev.data * 2;
        }
        self.onmessage = WorkerEntry;
      `;

      const ast = parseJavaScriptAst(code)!;
      const analysis = analyzeAstHotPaths(ast);

      const compNode = (ast.body as any[])[0];
      const hotNode = (ast.body as any[])[1];
      const workerNode = (ast.body as any[])[2];

      // Critical overrides SHALLOW_RENDER_COMPONENT
      expect(analysis.coldFunctionNodes.has(compNode)).toBe(true);
      expect(analysis.criticalFunctionNodes?.has(compNode)).toBe(true);
      expect(analysis.hotFunctionNodes.has(compNode)).toBe(false);
      expect(analysis.hotExemptNodes.has(compNode)).toBe(false);
      expect(analysis.report.coldFunctionsProtected).toContain('CriticalComponent');
      expect(analysis.report.hotFunctionsSkipped).not.toContain('CriticalComponent');

      // TRUE_HOT_60FPS and SERIALIZED_WORKER remain exempt and NEVER forced into critical/cold
      expect(analysis.hotFunctionNodes.has(hotNode)).toBe(true);
      expect(analysis.coldFunctionNodes.has(hotNode)).toBe(false);
      expect(analysis.criticalFunctionNodes?.has(hotNode)).toBe(false);

      expect(analysis.serializedFunctionNodes.has(workerNode)).toBe(true);
      expect(analysis.hotExemptNodes.has(workerNode)).toBe(true);
      expect(analysis.coldFunctionNodes.has(workerNode)).toBe(false);
      expect(analysis.criticalFunctionNodes?.has(workerNode)).toBe(false);
    });
  });

  describe('P1b isAstAlreadyProtected false-positive removal', () => {
    it('does NOT falsely skip minified Rollup/esbuild/Terser bundles using _d, _m, _w, _k, _$, _s, $b', () => {
      const minifiedBundle = `
        var _d = 10, _m = 20, _w = 30, _k = 40;
        (function _$() { return _d + _m; })();
        (function _s() { return _w + _k; })();
        (function $b() { return 42; })();
        function checkSecret(token) {
          return token === "ACTUAL_PROTECTABLE_SECRET";
        }
      `;

      const res = transformJavaScript(minifiedBundle, { seed: 0x42424242 });
      expect(res.skippedReason).toBeUndefined();
      expect(res.encryptedStringsCount).toBeGreaterThanOrEqual(1);
      expect(res.code).not.toContain('ACTUAL_PROTECTABLE_SECRET');
    });

    it('still skips genuinely unpeek-protected ASTs containing unpeek-specific markers', () => {
      const sample = `
        function checkAuth(k) {
          return k === "SUPER_SECRET_TOKEN";
        }
      `;
      const first = transformJavaScript(sample, {
        seed: 0x77777777,
        injectRuntimeShield: true,
      } as any);
      expect(first.skippedReason).toBeUndefined();

      const second = transformJavaScript(first.code, { seed: 0x77777777 });
      expect(second.skippedReason).toBe('already-protected');

      // Also verify _uSb / _uAl / _uAm / _uZt / Symbol.for('__upk_v4_...') markers
      const coldFlowMarked = `var _uSb1a = [1, 2]; function a() {}`;
      expect(transformJavaScript(coldFlowMarked).skippedReason).toBe('already-protected');

      const symbolMarked = `var s = Symbol.for("__upk_v4_abc"); function a() {}`;
      expect(transformJavaScript(symbolMarked).skippedReason).toBe('already-protected');
    });
  });
});
