import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { HotPathReport } from './types.js';
import type { UnpeekConfig } from '../config.js';
import type { AnySourceMap } from '../core/vlq.js';
import {
  resolveSourceMapCriticalNodes,
  type FunctionLocationEntry,
} from './sourcemap-critical.js';

const LOOP_NODE_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

const ARRAY_HOF_METHODS = new Set([
  'map',
  'filter',
  'reduce',
  'forEach',
  'flatMap',
  'find',
  'findIndex',
  'some',
  'every',
]);

const ANIMATION_FRAME_CALLS = new Set([
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'useFrame',
  'useLenis',
  'setAnimationLoop',
  'onBeforeRender',
  'updateMatrixWorld',
  'raf',
]);

const DEFAULT_IMPORT_SOURCES: Record<string, string[]> = {
  '@react-three/fiber': ['useFrame'],
  lenis: ['useLenis', 'raf'],
  'lenis/react': ['useLenis'],
  three: ['onBeforeRender', 'updateMatrixWorld', 'useFrame'],
  gsap: ['ticker'],
};

const DEFAULT_HOC_WRAPPERS = new Set([
  'memo',
  'forwardRef',
  'React.memo',
  'React.forwardRef',
  'observer',
  'connect',
]);

const DEFAULT_EVENT_HANDLER_REGEX =
  /^(?:on|handle)(?!Tick|Render|Update|Frame|Animate|Physics)[A-Z]/;

const CRITICAL_COLD_HANDLER_REGEX =
  /^(?:onSubmit|handleSubmit|submit[A-Z0-9_]*|validate[A-Z0-9_]*|login|signIn|register|checkout)$/i;

const CRITICAL_COLD_CALLEE_REGEX =
  /^(?:onSubmit|handleSubmit|submit[A-Z0-9_]*|validate[A-Z0-9_]*|login|signIn|register|checkout|createServerReference|fetch)$/i;

const DEFAULT_HOOK_REGEX = /^use[A-Z0-9]/;

const JSX_FACTORY_CALLS = new Set([
  'jsx',
  'jsxs',
  '_jsx',
  '_jsxs',
  'jsxDEV',
  '_jsxDEV',
  'createElement',
  'cloneElement',
]);

const REACT_HOOK_OR_RENDER_CALLS = new Set([
  'useState',
  'useEffect',
  'useMemo',
  'useCallback',
  'useRef',
  'useLayoutEffect',
  'useActionState',
  'useFormStatus',
  'useOptimistic',
  'jsx',
  'jsxs',
  '_jsx',
  '_jsxs',
  'jsxDEV',
  '_jsxDEV',
  'createElement',
  'cloneElement',
]);

const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

export interface HotPathAnalysis {
  report: HotPathReport;
  hotFunctionNodes: WeakSet<acorn.Node>;
  coldFunctionNodes: WeakSet<acorn.Node>;
  hotExemptNodes: WeakSet<acorn.Node>;
  serializedFunctionNodes: WeakSet<acorn.Node>;
  criticalFunctionNodes?: WeakSet<acorn.Node>;
}

export interface ParseAstOptions {
  locations?: boolean;
}

export function parseJavaScriptAst(
  code: string,
  comments?: acorn.Comment[],
  opts?: ParseAstOptions
): acorn.Program | null {
  const locations = opts?.locations !== false;
  const collectedComments: acorn.Comment[] = comments ?? [];
  let ast: acorn.Program | null = null;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      locations,
      onComment: collectedComments,
    });
  } catch {
    collectedComments.length = 0;
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowReturnOutsideFunction: true,
        locations,
        onComment: collectedComments,
      });
    } catch {
      return null;
    }
  }
  if (ast) {
    Object.defineProperty(ast, '__unpeekComments', {
      value: collectedComments,
      enumerable: false,
      configurable: true,
    });
  }
  return ast;
}

function unwrapCallee(callee: any): any {
  let cur = callee;
  while (cur?.type === 'SequenceExpression' && Array.isArray(cur.expressions) && cur.expressions.length > 0) {
    cur = cur.expressions[cur.expressions.length - 1];
  }
  return cur;
}

function isHocCall(callNode: any, hocWrappers?: Set<string>, depth = 0): boolean {
  if (!callNode || callNode.type !== 'CallExpression' || depth > 4) return false;
  const callee = unwrapCallee(callNode.callee);
  if (!callee) return false;
  const wrappers = hocWrappers ?? DEFAULT_HOC_WRAPPERS;
  if (callee.type === 'Identifier') {
    return wrappers.has(callee.name);
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier'
  ) {
    if (wrappers.has(callee.property.name)) return true;
    if (callee.object?.type === 'Identifier') {
      const full = `${callee.object.name}.${callee.property.name}`;
      if (wrappers.has(full)) return true;
    }
  }
  if (callee.type === 'CallExpression') {
    return isHocCall(callee, wrappers, depth + 1);
  }
  return false;
}

function getFunctionLabel(
  node: any,
  ancestors: acorn.Node[],
  hocWrappers?: Set<string>
): string {
  if (node.id && typeof node.id.name === 'string') {
    return node.id.name;
  }
  const parent = ancestors[ancestors.length - 2] as any;
  if (parent) {
    if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
      return parent.id.name;
    }
    if (parent.type === 'Property') {
      if (parent.key?.type === 'Identifier') {
        return parent.key.name;
      }
      if (parent.key?.type === 'Literal' && typeof parent.key.value === 'string') {
        return parent.key.value;
      }
    }
    if (parent.type === 'MethodDefinition' && parent.key?.type === 'Identifier') {
      return parent.key.name;
    }
    if (
      parent.type === 'AssignmentExpression' &&
      parent.left?.type === 'Identifier'
    ) {
      return parent.left.name;
    }
    // HOC & forwardRef detection: when node is inside CallExpression (e.g. React.memo, forwardRef, or hocWrappers)
    if (parent.type === 'CallExpression') {
      let idx = ancestors.length - 2;
      let matchedHoc = false;
      while (idx >= 0 && ancestors[idx].type === 'CallExpression') {
        if (isHocCall(ancestors[idx], hocWrappers)) {
          matchedHoc = true;
          idx--;
        } else {
          break;
        }
      }
      if (matchedHoc && idx >= 0) {
        const outer = ancestors[idx] as any;
        if (outer.type === 'VariableDeclarator' && outer.id?.type === 'Identifier') {
          return outer.id.name;
        }
        if (outer.type === 'AssignmentExpression' && outer.left?.type === 'Identifier') {
          return outer.left.name;
        }
      }
    }
  }
  return `anonymous_${node.start}`;
}

function hasUiComponentSignal(
  node: any,
  ancestors: acorn.Node[],
  hocWrappers: Set<string>,
  isHookFn: (name: string) => boolean
): boolean {
  if (!node) return false;

  // 1. HOC wrapping in ancestor chain (memo, forwardRef, React.memo, React.forwardRef, observer, connect, etc.)
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const anc = ancestors[i];
    if (anc.type === 'CallExpression') {
      if (isHocCall(anc, hocWrappers)) {
        return true;
      }
    } else {
      break;
    }
  }

  if (!node.body) return false;

  // 2. Own-body scan without descending into unrelated nested inner functions
  const stack: any[] = [node.body];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;

    if (cur.type === 'JSXElement' || cur.type === 'JSXFragment') {
      return true;
    }

    if (cur.type === 'CallExpression') {
      const callee = unwrapCallee(cur.callee);
      let calleeName = '';
      let memberProp = '';
      let qualifiedCall = '';
      if (callee?.type === 'Identifier') {
        calleeName = callee.name;
        qualifiedCall = calleeName;
      } else if (
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property?.type === 'Identifier'
      ) {
        memberProp = callee.property.name;
        if (callee.object?.type === 'Identifier') {
          qualifiedCall = `${callee.object.name}.${memberProp}`;
        }
      }

      if (
        JSX_FACTORY_CALLS.has(calleeName) ||
        JSX_FACTORY_CALLS.has(memberProp) ||
        qualifiedCall === 'React.createElement' ||
        qualifiedCall === 'React.cloneElement' ||
        REACT_HOOK_OR_RENDER_CALLS.has(calleeName) ||
        REACT_HOOK_OR_RENDER_CALLS.has(memberProp) ||
        isHookFn(calleeName) ||
        isHookFn(memberProp)
      ) {
        return true;
      }

      if (
        calleeName === 'h' &&
        Array.isArray(cur.arguments) &&
        (cur.arguments.length >= 2 ||
          (cur.arguments.length === 1 &&
            cur.arguments[0]?.type === 'Literal' &&
            typeof cur.arguments[0].value === 'string'))
      ) {
        return true;
      }
    }

    for (const key of Object.keys(cur)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const val = cur[key];
      if (Array.isArray(val)) {
        for (let i = val.length - 1; i >= 0; i--) {
          const item = val[i];
          if (
            item &&
            typeof item === 'object' &&
            typeof item.type === 'string' &&
            !FUNCTION_NODE_TYPES.has(item.type)
          ) {
            stack.push(item);
          }
        }
      } else if (
        val &&
        typeof val === 'object' &&
        typeof val.type === 'string' &&
        !FUNCTION_NODE_TYPES.has(val.type)
      ) {
        stack.push(val);
      }
    }
  }

  return false;
}

function isPascalCaseComponent(
  name: string,
  node?: any,
  ancestors?: acorn.Node[],
  hocWrappers?: Set<string>,
  isHookFn?: (name: string) => boolean
): boolean {
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) return false;
  if (!node || !ancestors) return false;
  return hasUiComponentSignal(
    node,
    ancestors,
    hocWrappers ?? DEFAULT_HOC_WRAPPERS,
    isHookFn ?? ((n) => DEFAULT_HOOK_REGEX.test(n))
  );
}

function isEventHandlerName(
  name: string,
  regex: RegExp = DEFAULT_EVENT_HANDLER_REGEX
): boolean {
  return regex.test(name);
}

function findEnclosingScopeNode(ancestors: acorn.Node[], selfNode: acorn.Node): acorn.Node {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const anc = ancestors[i];
    if (anc !== selfNode && (FUNCTION_NODE_TYPES.has(anc.type) || anc.type === 'Program')) {
      return anc;
    }
  }
  return ancestors[0];
}

function findEnclosingFunction(
  ancestors: acorn.Node[],
  selfNode?: acorn.Node
): acorn.Node | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i] !== selfNode && FUNCTION_NODE_TYPES.has(ancestors[i].type)) {
      return ancestors[i];
    }
  }
  return null;
}

function findOutermostModuleFunction(ancestors: acorn.Node[]): acorn.Node | null {
  const fnList: acorn.Node[] = [];
  for (let i = 0; i < ancestors.length; i++) {
    if (FUNCTION_NODE_TYPES.has(ancestors[i].type)) {
      fnList.push(ancestors[i]);
    }
  }
  if (fnList.length === 0) return null;
  if (fnList.length === 1) return fnList[0];
  return fnList[1];
}

function isZeroArgIifeFactoryFunction(node: any): boolean {
  if (!node || (node.params && node.params.length > 0)) return false;
  if (!node.body || node.body.type !== 'BlockStatement') return false;
  const stmts = (node.body.body || []).filter(
    (s: any) => !(s.type === 'ExpressionStatement' && s.directive)
  );
  if (stmts.length !== 1 || stmts[0].type !== 'ReturnStatement') return false;
  const retArg = stmts[0].argument;
  if (!retArg || retArg.type !== 'CallExpression') return false;
  const callee = retArg.callee;
  return (
    callee &&
    (callee.type === 'FunctionExpression' ||
      callee.type === 'ArrowFunctionExpression') &&
    callee.body?.type === 'BlockStatement'
  );
}

function containsLoopOrAnimation(
  fnNode: acorn.Node,
  animationCalls: Set<string> = ANIMATION_FRAME_CALLS
): boolean {
  let found = false;
  walk.simple(fnNode, {
    ForStatement() {
      found = true;
    },
    ForInStatement() {
      found = true;
    },
    ForOfStatement() {
      found = true;
    },
    WhileStatement() {
      found = true;
    },
    DoWhileStatement() {
      found = true;
    },
    CallExpression(callNode: any) {
      let cName = '';
      let mProp = '';
      if (callNode.callee?.type === 'Identifier') {
        cName = callNode.callee.name;
      } else if (
        callNode.callee?.type === 'MemberExpression' &&
        !callNode.callee.computed &&
        callNode.callee.property?.type === 'Identifier'
      ) {
        mProp = callNode.callee.property.name;
      }
      const isTickerAdd =
        mProp === 'add' &&
        (callNode.callee?.object?.name === 'ticker' ||
          callNode.callee?.object?.property?.name === 'ticker');
      if (
        animationCalls.has(cName) ||
        animationCalls.has(mProp) ||
        isTickerAdd
      ) {
        found = true;
      }
    },
  });
  return found;
}

export function analyzeAstHotPaths(
  ast: acorn.Program,
  config?: UnpeekConfig,
  originalSourceMap?: AnySourceMap
): HotPathAnalysis {
  const hotFunctionNodes = new WeakSet<acorn.Node>();
  const coldFunctionNodes = new WeakSet<acorn.Node>();
  const hotExemptNodes = new WeakSet<acorn.Node>();
  const serializedFunctionNodes = new WeakSet<acorn.Node>();
  const criticalFunctionNodes = new WeakSet<acorn.Node>();

  const serializedWorkerNodes = new Set<acorn.Node>();
  const trueHotNodes = new Set<acorn.Node>();
  const shallowComponentNodes = new Set<acorn.Node>();
  const coldForcedNodes = new Set<acorn.Node>();
  const directHotNodes = new Set<acorn.Node>();

  const serializerHelperNodes = new Set<acorn.Node>();
  const allFunctions: {
    node: acorn.Node;
    name: string;
    anchorStart: number;
    idNode?: acorn.Node | null;
  }[] = [];
  const fnByName = new Map<string, acorn.Node>();
  const scopeFunctions = new Map<acorn.Node, Map<string, acorn.Node>>();
  const fnScopeChain = new Map<acorn.Node, acorn.Node[]>();
  const fnParams = new Map<acorn.Node, Set<string>>();
  const fnVarAliases = new Map<acorn.Node, Map<string, string>>();
  const callerToCallees = new Map<acorn.Node, Set<string>>();
  const pendingSerializedRefs: { scopeNode: acorn.Node; name: string }[] = [];
  const pendingHotRefs: { scopeNode: acorn.Node; name: string }[] = [];
  const allCallSites: {
    scopeNode: acorn.Node;
    calleeKey: string;
    args: any[];
  }[] = [];

  const animationCalls = new Set(ANIMATION_FRAME_CALLS);
  if (config?.hotPath?.customAnimationCalls) {
    for (const c of config.hotPath.customAnimationCalls) {
      animationCalls.add(c);
    }
  }

  const mergedImportSources: Record<string, string[]> = {
    ...DEFAULT_IMPORT_SOURCES,
    ...(config?.hotPath?.importSources ?? {}),
  };

  // Pre-scan ImportDeclarations to track aliased animation calls and imported identifiers
  if (ast && Array.isArray((ast as any).body)) {
    for (const stmt of (ast as any).body) {
      if (stmt.type === 'ImportDeclaration' && stmt.source?.value) {
        const sourcePkg = String(stmt.source.value);
        const sourceMethods = mergedImportSources[sourcePkg];
        for (const spec of stmt.specifiers || []) {
          if (spec.type === 'ImportSpecifier') {
            const importedName = spec.imported?.name ?? spec.imported?.value;
            const localName = spec.local?.name;
            if (localName && importedName) {
              const isKnownSource = sourceMethods !== undefined;
              const isListedMethod =
                sourceMethods &&
                (sourceMethods.includes(importedName) ||
                  sourceMethods.includes('*'));
              const isKnownAnimCall = ANIMATION_FRAME_CALLS.has(importedName);

              if ((isKnownSource && isListedMethod) || isKnownAnimCall) {
                animationCalls.add(localName);
              }
            }
          }
        }
      }
    }
  }

  const hocWrappers = new Set(DEFAULT_HOC_WRAPPERS);
  if (config?.hotPath?.hocWrappers) {
    for (const h of config.hotPath.hocWrappers) {
      hocWrappers.add(h);
    }
  }

  const arrayHofMethods = new Set(ARRAY_HOF_METHODS);
  if (config?.hotPath?.arrayHofMethods) {
    for (const m of config.hotPath.arrayHofMethods) {
      arrayHofMethods.add(m);
    }
  }

  const rawEventRegex = config?.hotPath?.eventHandlerRegex;
  const eventHandlerRegex =
    typeof rawEventRegex === 'string'
      ? new RegExp(rawEventRegex)
      : (rawEventRegex ?? DEFAULT_EVENT_HANDLER_REGEX);

  const rawHookRegex = config?.hotPath?.hookPattern;
  const hookRegex =
    typeof rawHookRegex === 'string'
      ? new RegExp(rawHookRegex)
      : (rawHookRegex ?? DEFAULT_HOOK_REGEX);
  const customHooksSet = new Set(config?.hotPath?.customHooks ?? []);

  function isHookName(name: string): boolean {
    if (!name) return false;
    return customHooksSet.has(name) || hookRegex.test(name);
  }

  const excludedComponents = new Set(config?.hotPath?.excludeComponents ?? []);
  const maxPipelineCallers = config?.hotPath?.maxPipelineCallers ?? 2;

  function ensureFnParams(fnNode: any): Set<string> {
    let paramSet = fnParams.get(fnNode);
    if (!paramSet) {
      paramSet = new Set<string>();
      for (const p of fnNode.params || []) {
        if (p?.type === 'Identifier') {
          paramSet.add(p.name);
        } else if (
          p?.type === 'AssignmentPattern' &&
          p.left?.type === 'Identifier'
        ) {
          paramSet.add(p.left.name);
        }
      }
      fnParams.set(fnNode, paramSet);
    }
    return paramSet;
  }

  function recordVarAlias(
    scopeNode: acorn.Node,
    varName: string,
    rhsName: string
  ): void {
    let map = fnVarAliases.get(scopeNode);
    if (!map) {
      map = new Map<string, string>();
      fnVarAliases.set(scopeNode, map);
    }
    map.set(varName, rhsName);
  }

  function resolveAliasTarget(scopeNode: acorn.Node, identName: string): string {
    const map = fnVarAliases.get(scopeNode);
    let cur = identName;
    const seen = new Set<string>();
    while (map && map.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = map.get(cur)!;
    }
    return cur;
  }

  function markSerializedFunction(node: acorn.Node): void {
    (node as any)._unpeekSerialized = true;
    serializedWorkerNodes.add(node);
    serializedFunctionNodes.add(node);
    hotFunctionNodes.add(node);
    directHotNodes.add(node);
    hotExemptNodes.add(node);
  }

  function computeFunctionAnchorStart(node: any, ancestors: acorn.Node[]): number {
    let anchorStart = typeof node.start === 'number' ? node.start : 0;
    for (let i = ancestors.length - 2; i >= 0; i--) {
      const anc = ancestors[i] as any;
      const child = ancestors[i + 1] as any;
      if (!anc || typeof anc.start !== 'number') break;
      if (anc.type === 'VariableDeclarator' && anc.init === child) {
        anchorStart = Math.min(anchorStart, anc.start);
      } else if (anc.type === 'VariableDeclaration' && anc.declarations?.[0] === child) {
        anchorStart = Math.min(anchorStart, anc.start);
      } else if (
        (anc.type === 'ExportNamedDeclaration' || anc.type === 'ExportDefaultDeclaration') &&
        anc.declaration === child
      ) {
        anchorStart = Math.min(anchorStart, anc.start);
      } else if ((anc.type === 'Property' || anc.type === 'MethodDefinition') && anc.value === child) {
        anchorStart = Math.min(anchorStart, anc.start);
      } else if (anc.type === 'AssignmentExpression' && anc.right === child) {
        anchorStart = Math.min(anchorStart, anc.start);
      } else if (anc.type === 'ExpressionStatement' && anc.expression === child) {
        anchorStart = Math.min(anchorStart, anc.start);
      } else {
        break;
      }
    }
    return anchorStart;
  }

  function getFunctionIdNode(node: any, ancestors: acorn.Node[]): acorn.Node | null {
    if (node.id) return node.id;
    const parent = ancestors[ancestors.length - 2] as any;
    if (!parent) return null;
    if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
      return parent.id;
    }
    if (parent.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') {
      return parent.left;
    }
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key?.type === 'Identifier') {
      return parent.key;
    }
    if (parent.type === 'CallExpression') {
      let idx = ancestors.length - 2;
      let matchedHoc = false;
      while (idx >= 0 && ancestors[idx].type === 'CallExpression') {
        if (isHocCall(ancestors[idx], hocWrappers)) {
          matchedHoc = true;
          idx--;
        } else {
          break;
        }
      }
      if (matchedHoc && idx >= 0) {
        const outer = ancestors[idx] as any;
        if (outer.type === 'VariableDeclarator' && outer.id?.type === 'Identifier') {
          return outer.id;
        }
        if (outer.type === 'AssignmentExpression' && outer.left?.type === 'Identifier') {
          return outer.left;
        }
      }
    }
    return null;
  }

  function registerFunctionNode(node: any, ancestors: acorn.Node[]): void {
    const name = getFunctionLabel(node, ancestors, hocWrappers);
    allFunctions.push({
      node,
      name,
      anchorStart: computeFunctionAnchorStart(node, ancestors),
      idNode: getFunctionIdNode(node, ancestors),
    });
    fnByName.set(name, node);

    const paramSet = new Set<string>();
    for (const p of node.params || []) {
      if (p?.type === 'Identifier') {
        paramSet.add(p.name);
      } else if (p?.type === 'AssignmentPattern' && p.left?.type === 'Identifier') {
        paramSet.add(p.left.name);
      }
    }
    fnParams.set(node, paramSet);

    const enclosingScope = findEnclosingScopeNode(ancestors, node);
    let localMap = scopeFunctions.get(enclosingScope);
    if (!localMap) {
      localMap = new Map<string, acorn.Node>();
      scopeFunctions.set(enclosingScope, localMap);
    }
    localMap.set(name, node);

    const parent = ancestors[ancestors.length - 2] as any;
    if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
      fnByName.set(parent.id.name, node);
      localMap.set(parent.id.name, node);
    } else if (
      parent?.type === 'AssignmentExpression' &&
      parent.left?.type === 'Identifier'
    ) {
      fnByName.set(parent.left.name, node);
      localMap.set(parent.left.name, node);
    } else if (
      parent?.type === 'AssignmentExpression' &&
      parent.left?.type === 'MemberExpression' &&
      !parent.left.computed &&
      parent.left.property?.type === 'Identifier'
    ) {
      const propName = parent.left.property.name;
      fnByName.set(propName, node);
      localMap.set(propName, node);
      if (parent.left.object?.type === 'Identifier') {
        const qual = `${parent.left.object.name}.${propName}`;
        fnByName.set(qual, node);
        localMap.set(qual, node);
      }
    }

    const grandParent = ancestors[ancestors.length - 3] as any;
    const greatGrandParent = ancestors[ancestors.length - 4] as any;
    if (
      parent?.type === 'Property' &&
      parent.key?.type === 'Identifier' &&
      grandParent?.type === 'ObjectExpression' &&
      greatGrandParent?.type === 'VariableDeclarator' &&
      greatGrandParent.id?.type === 'Identifier'
    ) {
      const qualified = `${greatGrandParent.id.name}.${parent.key.name}`;
      fnByName.set(qualified, node);
      localMap.set(qualified, node);
    }

    const chain: acorn.Node[] = [];
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (
        ancestors[i] !== node &&
        (FUNCTION_NODE_TYPES.has(ancestors[i].type) || ancestors[i].type === 'Program')
      ) {
        chain.push(ancestors[i]);
      }
    }
    fnScopeChain.set(node, chain);

    if (
      isPascalCaseComponent(name, node, ancestors, hocWrappers, isHookName) &&
      !excludedComponents.has(name)
    ) {
      (node as any)._unpeekIsComponent = true;
      shallowComponentNodes.add(node);
      hotFunctionNodes.add(node);
      directHotNodes.add(node);
      hotExemptNodes.add(node);
    }

    if (isHookName(name)) {
      shallowComponentNodes.add(node);
      hotFunctionNodes.add(node);
      directHotNodes.add(node);
      hotExemptNodes.add(node);
    }

    if (isZeroArgIifeFactoryFunction(node)) {
      markSerializedFunction(node);
    }
  }

  function resolveCalleeNode(callerNode: acorn.Node, calleeKey: string): acorn.Node | undefined {
    const directLocal = scopeFunctions.get(callerNode)?.get(calleeKey);
    if (directLocal) return directLocal;
    const chain = fnScopeChain.get(callerNode);
    if (chain) {
      for (const scopeNode of chain) {
        const localMap = scopeFunctions.get(scopeNode);
        const found = localMap?.get(calleeKey);
        if (found) return found;
      }
    }
    return fnByName.get(calleeKey);
  }

  function queueSerializedTarget(target: any, enclosingScope: acorn.Node): void {
    if (!target) return;
    if (FUNCTION_NODE_TYPES.has(target.type)) {
      markSerializedFunction(target);
    } else if (target.type === 'Identifier') {
      pendingSerializedRefs.push({ scopeNode: enclosingScope, name: target.name });
    } else if (
      target.type === 'MemberExpression' &&
      !target.computed &&
      target.property?.type === 'Identifier'
    ) {
      pendingSerializedRefs.push({
        scopeNode: enclosingScope,
        name: target.property.name,
      });
      if (target.object?.type === 'Identifier') {
        pendingSerializedRefs.push({
          scopeNode: enclosingScope,
          name: `${target.object.name}.${target.property.name}`,
        });
      }
    }
  }

  walk.ancestor(ast, {
    FunctionDeclaration(node, _state, ancestors) {
      registerFunctionNode(node, ancestors);
    },
    FunctionExpression(node, _state, ancestors) {
      registerFunctionNode(node, ancestors);
    },
    ArrowFunctionExpression(node, _state, ancestors) {
      registerFunctionNode(node, ancestors);
    },
    VariableDeclarator(node: any, _state, ancestors) {
      if (
        node.id?.type === 'Identifier' &&
        node.init?.type === 'Identifier'
      ) {
        const scopeNode = findEnclosingFunction(ancestors) ?? ast;
        recordVarAlias(scopeNode, node.id.name, node.init.name);
      }
    },
    AssignmentExpression(node: any, _state, ancestors) {
      const left = node.left;
      if (left?.type === 'Identifier' && node.right?.type === 'Identifier') {
        const scopeNode = findEnclosingFunction(ancestors) ?? ast;
        recordVarAlias(scopeNode, left.name, node.right.name);
      }
      const isBareOnMessage =
        left?.type === 'Identifier' && left.name === 'onmessage';
      const isSelfOnMessage =
        left?.type === 'MemberExpression' &&
        !left.computed &&
        left.object?.type === 'Identifier' &&
        left.object.name === 'self' &&
        left.property?.type === 'Identifier' &&
        left.property.name === 'onmessage';

      if (isBareOnMessage || isSelfOnMessage) {
        const enclosingFn = findEnclosingFunction(ancestors);
        if (enclosingFn) {
          markSerializedFunction(enclosingFn);
        }
        const outerFn = findOutermostModuleFunction(ancestors);
        if (outerFn) {
          markSerializedFunction(outerFn);
        }
        const scopeNode = enclosingFn ?? ast;
        queueSerializedTarget(node.right, scopeNode);
      }
    },
    ObjectExpression(node: any, _state, ancestors) {
      const props = node.properties || [];
      const propMap = new Map<string, any>();
      for (const p of props) {
        if (p?.type === 'Property' && !p.computed) {
          const keyName =
            p.key?.type === 'Identifier'
              ? p.key.name
              : p.key?.type === 'Literal'
                ? String(p.key.value)
                : '';
          if (keyName) {
            propMap.set(keyName, p.value);
          }
        }
      }

      const hasWorkerDescriptorShape =
        (propMap.has('init') && propMap.has('dependencies')) ||
        propMap.has('isWorkerModule') ||
        (propMap.has('getTransferables') &&
          (propMap.has('init') || propMap.has('dependencies')));

      if (hasWorkerDescriptorShape) {
        const scopeNode = findEnclosingFunction(ancestors) ?? ast;
        for (const key of ['init', 'getTransferables', 'worker']) {
          const val = propMap.get(key);
          if (val) queueSerializedTarget(val, scopeNode);
        }
        const deps = propMap.get('dependencies');
        if (deps?.type === 'ArrayExpression') {
          for (const el of deps.elements || []) {
            if (el) queueSerializedTarget(el, scopeNode);
          }
        }
      }
    },
    CallExpression(node: any, _state, ancestors) {
      const callee = unwrapCallee(node.callee);
      let calleeName = '';
      let memberProp = '';
      let qualifiedCall = '';

      if (callee?.type === 'Identifier') {
        calleeName = callee.name;
        qualifiedCall = calleeName;
      } else if (
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property?.type === 'Identifier'
      ) {
        memberProp = callee.property.name;
        if (callee.object?.type === 'Identifier') {
          qualifiedCall = `${callee.object.name}.${memberProp}`;
        } else if (callee.object?.type === 'ThisExpression') {
          qualifiedCall = memberProp;
        }
      }

      const enclosingFn = findEnclosingFunction(ancestors);
      const currentScope = enclosingFn ?? ast;

      if (qualifiedCall || memberProp) {
        allCallSites.push({
          scopeNode: currentScope,
          calleeKey: qualifiedCall || memberProp,
          args: node.arguments || [],
        });
        if (enclosingFn) {
          let set = callerToCallees.get(enclosingFn);
          if (!set) {
            set = new Set();
            callerToCallees.set(enclosingFn, set);
          }
          if (qualifiedCall) set.add(qualifiedCall);
          if (memberProp && !arrayHofMethods.has(memberProp)) {
            set.add(memberProp);
          }
        }
      }

      // Pattern 1A: Zero-arg .toString() on a function / identifier / parameter
      if (
        memberProp === 'toString' &&
        (!node.arguments || node.arguments.length === 0) &&
        callee?.type === 'MemberExpression'
      ) {
        const targetObj = callee.object;
        queueSerializedTarget(targetObj, currentScope);
        if (targetObj?.type === 'Identifier' && enclosingFn) {
          const resolvedName = resolveAliasTarget(enclosingFn, targetObj.name);
          if (ensureFnParams(enclosingFn).has(resolvedName)) {
            serializerHelperNodes.add(enclosingFn);
          }
          if (resolvedName !== targetObj.name) {
            queueSerializedTarget({ type: 'Identifier', name: resolvedName }, currentScope);
          }
        }
      }

      // Pattern 1B: Function.prototype.toString.call(fn) / .apply(fn)
      if (
        (memberProp === 'call' || memberProp === 'apply') &&
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'MemberExpression' &&
        callee.object.property?.type === 'Identifier' &&
        callee.object.property.name === 'toString' &&
        node.arguments?.length > 0
      ) {
        const firstArg = node.arguments[0];
        queueSerializedTarget(firstArg, currentScope);
        if (firstArg?.type === 'Identifier' && enclosingFn) {
          const resolvedName = resolveAliasTarget(enclosingFn, firstArg.name);
          if (ensureFnParams(enclosingFn).has(resolvedName)) {
            serializerHelperNodes.add(enclosingFn);
          }
          if (resolvedName !== firstArg.name) {
            queueSerializedTarget({ type: 'Identifier', name: resolvedName }, currentScope);
          }
        }
      }

      // Pattern 3: importScripts(...) inside a worker entry function
      if (
        calleeName === 'importScripts' ||
        (memberProp === 'importScripts' &&
          callee?.object?.type === 'Identifier' &&
          callee.object.name === 'self')
      ) {
        if (enclosingFn) markSerializedFunction(enclosingFn);
        const outerFn = findOutermostModuleFunction(ancestors);
        if (outerFn) markSerializedFunction(outerFn);
      }

      // Category: ANIMATION_FRAME_CALLS (requestAnimationFrame, cancelAnimationFrame, useFrame, GSAP ticker, Lenis, WebGPU/Three.js)
      // Classified as TRUE_HOT_60FPS
      const isTickerAdd =
        memberProp === 'add' &&
        (callee?.object?.name === 'ticker' ||
          callee?.object?.property?.name === 'ticker');
      if (
        animationCalls.has(calleeName) ||
        animationCalls.has(memberProp) ||
        isTickerAdd
      ) {
        if (enclosingFn) {
          trueHotNodes.add(enclosingFn);
          hotFunctionNodes.add(enclosingFn);
          directHotNodes.add(enclosingFn);
        }
        for (const arg of node.arguments || []) {
          if (FUNCTION_NODE_TYPES.has(arg.type)) {
            trueHotNodes.add(arg);
            hotFunctionNodes.add(arg);
            directHotNodes.add(arg);
            hotExemptNodes.add(arg);
          } else if (arg?.type === 'Identifier') {
            pendingHotRefs.push({ scopeNode: currentScope, name: arg.name });
            allCallSites.push({
              scopeNode: currentScope,
              calleeKey: arg.name,
              args: [arg],
            });
          }
        }
      }

      // Category: ARRAY_HOF_METHODS (.map, .filter, .reduce, .forEach, .flatMap, .find, .findIndex, .some, .every)
      if (arrayHofMethods.has(memberProp)) {
        if (enclosingFn !== null) {
          // Inside a function or loop: classified as TRUE_HOT_60FPS
          for (const arg of node.arguments || []) {
            if (FUNCTION_NODE_TYPES.has(arg.type)) {
              trueHotNodes.add(arg);
              hotFunctionNodes.add(arg);
              directHotNodes.add(arg);
              hotExemptNodes.add(arg);
            } else if (arg?.type === 'Identifier') {
              allCallSites.push({
                scopeNode: currentScope,
                calleeKey: arg.name,
                args: [arg],
              });
            }
          }
        } else {
          // Module top-level (Program scope, enclosingFn === null): 1-time run initializer
          // Only force cold if node is an anonymous function expression / arrow function,
          // not a standalone named/exported function.
          for (const arg of node.arguments || []) {
            const isAnonymousFunction =
              (arg.type === 'FunctionExpression' && !arg.id) ||
              arg.type === 'ArrowFunctionExpression';
            if (isAnonymousFunction) {
              coldForcedNodes.add(arg);
            }
          }
        }
      }

      // Category: Loop-free useEffect / useLayoutEffect setup callbacks
      if (
        calleeName === 'useEffect' ||
        memberProp === 'useEffect' ||
        calleeName === 'useLayoutEffect' ||
        memberProp === 'useLayoutEffect'
      ) {
        const effectArg = node.arguments?.[0];
        if (effectArg && FUNCTION_NODE_TYPES.has(effectArg.type)) {
          if (!containsLoopOrAnimation(effectArg, animationCalls)) {
            coldForcedNodes.add(effectArg);
            // Also check if effect callback returns a loop-free cleanup function
            if (effectArg.body?.type === 'BlockStatement') {
              for (const s of effectArg.body.body || []) {
                if (
                  s.type === 'ReturnStatement' &&
                  s.argument &&
                  FUNCTION_NODE_TYPES.has(s.argument.type) &&
                  !containsLoopOrAnimation(s.argument, animationCalls)
                ) {
                  coldForcedNodes.add(s.argument);
                }
              }
            }
          }
        }
      }

      // Category: SHALLOW_RENDER_COMPONENT (React hooks / createElement / jsx / custom hooks)
      if (
        REACT_HOOK_OR_RENDER_CALLS.has(calleeName) ||
        REACT_HOOK_OR_RENDER_CALLS.has(memberProp) ||
        isHookName(calleeName) ||
        isHookName(memberProp)
      ) {
        if (enclosingFn) {
          if (
            JSX_FACTORY_CALLS.has(calleeName) ||
            JSX_FACTORY_CALLS.has(memberProp) ||
            REACT_HOOK_OR_RENDER_CALLS.has(calleeName) ||
            REACT_HOOK_OR_RENDER_CALLS.has(memberProp)
          ) {
            (enclosingFn as any)._unpeekIsComponent = true;
          }
          shallowComponentNodes.add(enclosingFn);
          hotFunctionNodes.add(enclosingFn);
          directHotNodes.add(enclosingFn);
          hotExemptNodes.add(enclosingFn);
        }
      }
    },
    ForStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      const enc = findEnclosingFunction(ancestors);
      if (enc) {
        trueHotNodes.add(enc);
        hotFunctionNodes.add(enc);
        directHotNodes.add(enc);
      }
    },
    ForInStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      const enc = findEnclosingFunction(ancestors);
      if (enc) {
        trueHotNodes.add(enc);
        hotFunctionNodes.add(enc);
        directHotNodes.add(enc);
      }
    },
    ForOfStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      const enc = findEnclosingFunction(ancestors);
      if (enc) {
        trueHotNodes.add(enc);
        hotFunctionNodes.add(enc);
        directHotNodes.add(enc);
      }
    },
    WhileStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      const enc = findEnclosingFunction(ancestors);
      if (enc) {
        trueHotNodes.add(enc);
        hotFunctionNodes.add(enc);
        directHotNodes.add(enc);
      }
    },
    DoWhileStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      const enc = findEnclosingFunction(ancestors);
      if (enc) {
        trueHotNodes.add(enc);
        hotFunctionNodes.add(enc);
        directHotNodes.add(enc);
      }
    },
  });

  // Resolve deferred serialized function references and serializer helper calls (e.g. f(n))
  for (const callSite of allCallSites) {
    const resolvedCallee = resolveCalleeNode(callSite.scopeNode, callSite.calleeKey);
    if (resolvedCallee && serializerHelperNodes.has(resolvedCallee)) {
      for (const arg of callSite.args) {
        queueSerializedTarget(arg, callSite.scopeNode);
      }
    }
  }

  for (const ref of pendingSerializedRefs) {
    const targetNode = resolveCalleeNode(ref.scopeNode, ref.name);
    if (targetNode) {
      markSerializedFunction(targetNode);
    }
  }

  for (const ref of pendingHotRefs) {
    const targetNode = resolveCalleeNode(ref.scopeNode, ref.name);
    if (targetNode) {
      trueHotNodes.add(targetNode);
      hotFunctionNodes.add(targetNode);
      directHotNodes.add(targetNode);
      hotExemptNodes.add(targetNode);
    }
  }

  // Identify cold candidates:
  // - async functions (node.async === true)
  // - event handlers (isEventHandlerName(fn.name, eventHandlerRegex))
  // unless they contain loops or 60fps animation frames or are shallow components/hooks
  for (const fn of allFunctions) {
    if (
      !serializedWorkerNodes.has(fn.node) &&
      !trueHotNodes.has(fn.node) &&
      !containsLoopOrAnimation(fn.node, animationCalls)
    ) {
      if (!shallowComponentNodes.has(fn.node)) {
        if (
          (fn.node as any).async === true ||
          isEventHandlerName(fn.name, eventHandlerRegex)
        ) {
          coldForcedNodes.add(fn.node);
        }
      }
    }
  }

  // 1. Top-down propagation (1A lexical downward and 1B call-graph downward):
  // - SERIALIZED_WORKER: full subtree (1A + 1B), never overridden by coldForcedNodes
  // - TRUE_HOT_60FPS: call-graph downward (1B: renderFrame -> lerp -> stepParticles) is fully preserved
  // - SHALLOW_RENDER_COMPONENT: 1A and 2 are turned off!
  let forwardChanged = true;
  while (forwardChanged) {
    forwardChanged = false;

    // 1A. Lexical downward propagation:
    for (const fn of allFunctions) {
      const chain = fnScopeChain.get(fn.node);
      if (!chain) continue;

      for (const anc of chain) {
        if (anc === fn.node) continue;

        // Serialized worker propagates downward 1A regardless of coldForcedNodes
        if (serializedWorkerNodes.has(anc)) {
          coldForcedNodes.delete(fn.node);
          if (!serializedWorkerNodes.has(fn.node)) {
            (fn.node as any)._unpeekSerialized = true;
            serializedWorkerNodes.add(fn.node);
            serializedFunctionNodes.add(fn.node);
            hotFunctionNodes.add(fn.node);
            hotExemptNodes.add(fn.node);
            forwardChanged = true;
          }
          break;
        }

        if (coldForcedNodes.has(fn.node)) continue;

        // True hot 60fps propagates downward 1A only if not inside a component
        // and not from a module container / root bundle function (chain length <= 1)
        const isModuleContainer = (fnScopeChain.get(anc)?.length ?? 0) <= 1;
        if (trueHotNodes.has(anc) && !shallowComponentNodes.has(anc) && !isModuleContainer) {
          if (!trueHotNodes.has(fn.node)) {
            trueHotNodes.add(fn.node);
            hotFunctionNodes.add(fn.node);
            hotExemptNodes.add(fn.node);
            forwardChanged = true;
          }
          break;
        }
      }
    }

    // 1B. Call-graph downward propagation:
    // Serialized worker callees (never blocked by coldForcedNodes)
    for (const callerNode of Array.from(serializedWorkerNodes)) {
      const calleeNames = callerToCallees.get(callerNode);
      if (!calleeNames) continue;
      for (const cName of calleeNames) {
        const targetNode = resolveCalleeNode(callerNode, cName);
        if (targetNode && !serializedWorkerNodes.has(targetNode)) {
          coldForcedNodes.delete(targetNode);
          (targetNode as any)._unpeekSerialized = true;
          serializedWorkerNodes.add(targetNode);
          serializedFunctionNodes.add(targetNode);
          hotFunctionNodes.add(targetNode);
          hotExemptNodes.add(targetNode);
          forwardChanged = true;
        }
      }
    }

    // True hot 60fps callees (e.g. renderFrame -> lerp -> stepParticles)
    for (const callerNode of Array.from(trueHotNodes)) {
      const calleeNames = callerToCallees.get(callerNode);
      if (!calleeNames) continue;
      for (const cName of calleeNames) {
        const targetNode = resolveCalleeNode(callerNode, cName);
        if (
          targetNode &&
          !trueHotNodes.has(targetNode) &&
          !coldForcedNodes.has(targetNode)
        ) {
          trueHotNodes.add(targetNode);
          hotFunctionNodes.add(targetNode);
          hotExemptNodes.add(targetNode);
          forwardChanged = true;
        }
      }
    }
  }

  // Protect critical cold handlers (form submission, validation, auth, checkout, server actions, fetch)
  // from bottom-up hot propagation when not already called inside a hot 60fps loop or render component.
  for (const fn of allFunctions) {
    if (
      !serializedWorkerNodes.has(fn.node) &&
      !trueHotNodes.has(fn.node) &&
      !shallowComponentNodes.has(fn.node) &&
      !containsLoopOrAnimation(fn.node, animationCalls)
    ) {
      let isCriticalHandler = CRITICAL_COLD_HANDLER_REGEX.test(fn.name);
      if (!isCriticalHandler) {
        const callees = callerToCallees.get(fn.node);
        if (callees) {
          for (const cName of callees) {
            const bare = cName.includes('.') ? cName.split('.').pop()! : cName;
            if (CRITICAL_COLD_CALLEE_REGEX.test(bare)) {
              isCriticalHandler = true;
              break;
            }
          }
        }
      }
      if (isCriticalHandler) {
        coldForcedNodes.add(fn.node);
      }
    }
  }

  const criticalAnnotation =
    typeof (config as any)?.critical?.annotation === 'string' &&
    (config as any).critical.annotation.length > 0
      ? (config as any).critical.annotation
      : '@unpeek-critical';
  const astComments: acorn.Comment[] =
    ((ast as any)?.__unpeekComments as acorn.Comment[] | undefined) ??
    ((ast as any)?.comments as acorn.Comment[] | undefined) ??
    [];
  const criticalComments = astComments.filter(
    (c) => typeof c?.value === 'string' && c.value.includes(criticalAnnotation)
  );
  const criticalCommentNodes = new Set<acorn.Node>();
  if (criticalComments.length > 0 && allFunctions.length > 0) {
    const stmtRanges: { start: number; end: number }[] = [];
    walk.full(ast, (n: any) => {
      if (
        n &&
        typeof n.start === 'number' &&
        typeof n.end === 'number' &&
        n.type !== 'Program' &&
        n.type !== 'BlockStatement' &&
        n.type !== 'EmptyStatement' &&
        (n.type.endsWith('Statement') ||
          n.type === 'VariableDeclaration' ||
          n.type === 'FunctionDeclaration' ||
          n.type === 'ClassDeclaration' ||
          n.type === 'ImportDeclaration' ||
          n.type === 'ExportNamedDeclaration' ||
          n.type === 'ExportDefaultDeclaration')
      ) {
        stmtRanges.push({ start: n.start, end: n.end });
      }
    });
    const sortedFns = [...allFunctions].sort(
      (a, b) => ((a.node as any).start ?? 0) - ((b.node as any).start ?? 0)
    );
    for (const c of criticalComments) {
      const cStart = typeof c.start === 'number' ? c.start : 0;
      const cEnd = typeof c.end === 'number' ? c.end : 0;

      // Find innermost function enclosing this comment, if any
      let enclosingFnEntry: (typeof sortedFns)[number] | undefined;
      for (const fn of sortedFns) {
        const s = (fn.node as any).start;
        const e = (fn.node as any).end;
        if (typeof s === 'number' && typeof e === 'number' && s <= cStart && cEnd <= e) {
          enclosingFnEntry = fn;
        }
      }

      const target = sortedFns.find(
        (fn) => typeof (fn.node as any).start === 'number' && (fn.node as any).start >= cEnd
      );
      const enclosingEnd = enclosingFnEntry
        ? ((enclosingFnEntry.node as any).end as number)
        : Infinity;

      if (target && ((target.node as any).end as number) <= enclosingEnd) {
        const fnStart = (target.node as any).start as number;
        const fnEnd = (target.node as any).end as number;
        const blockedByStmt = stmtRanges.some(
          (s) =>
            !(s.start <= fnStart && fnEnd <= s.end) &&
            s.end > cEnd &&
            s.end <= target.anchorStart
        );
        if (!blockedByStmt) {
          criticalCommentNodes.add(target.node);
          continue;
        }
      }

      // Support leading /*! @unpeek-critical */ inside a function body (before any statement in that body)
      if (enclosingFnEntry) {
        const body = (enclosingFnEntry.node as any).body;
        if (body && typeof body.start === 'number' && cStart >= body.start) {
          const hasPriorStmtInBody = stmtRanges.some(
            (s) => s.start >= body.start && s.end <= cStart
          );
          if (!hasPriorStmtInBody) {
            criticalCommentNodes.add(enclosingFnEntry.node);
          }
        }
      }
    }
  }

  const rawCriticalInclude = (config as any)?.critical?.include;
  const criticalIncludeList = Array.isArray(rawCriticalInclude)
    ? rawCriticalInclude
    : rawCriticalInclude !== undefined
      ? [rawCriticalInclude]
      : [];
  const criticalIncludeMatchers: ((name: string) => boolean)[] = [];
  for (const pat of criticalIncludeList) {
    if (pat instanceof RegExp) {
      criticalIncludeMatchers.push((name) => pat.test(name));
    } else if (typeof pat === 'string' && pat.length > 0) {
      try {
        const re = new RegExp(pat);
        criticalIncludeMatchers.push((name) => re.test(name));
      } catch {
        criticalIncludeMatchers.push((name) => name.includes(pat));
      }
    }
  }

  const sourceMapCriticalNodes = resolveSourceMapCriticalNodes(
    allFunctions as FunctionLocationEntry[],
    originalSourceMap,
    {
      criticalAnnotation,
      criticalIncludeMatchers,
      rawIncludePatterns: criticalIncludeList,
    }
  );

  const matchedCriticalNodes = new Set<acorn.Node>();
  for (const fn of allFunctions) {
    if (
      criticalCommentNodes.has(fn.node) ||
      sourceMapCriticalNodes.has(fn.node) ||
      criticalIncludeMatchers.some((match) => match(fn.name))
    ) {
      matchedCriticalNodes.add(fn.node);
      if (!trueHotNodes.has(fn.node) && !serializedWorkerNodes.has(fn.node)) {
        shallowComponentNodes.delete(fn.node);
        hotFunctionNodes.delete(fn.node);
        directHotNodes.delete(fn.node);
        hotExemptNodes.delete(fn.node);
        delete (fn.node as any)._unpeekIsComponent;
        coldForcedNodes.add(fn.node);
      }
    }
  }

  // Count callers per callee to distinguish dedicated pipeline sub-functions from shared utility loops
  const calleeToCallers = new Map<acorn.Node, Set<acorn.Node>>();
  for (const [callerNode, calleeNames] of callerToCallees.entries()) {
    for (const cName of calleeNames) {
      const targetNode = resolveCalleeNode(callerNode, cName);
      if (targetNode) {
        let set = calleeToCallers.get(targetNode);
        if (!set) {
          set = new Set();
          calleeToCallers.set(targetNode, set);
        }
        set.add(callerNode);
      }
    }
  }

  // 2. Propagate hotness bottom-up along the static call graph (caller -> hot callee)
  // NOTE: Bottom-Up propagation is explicitly DISABLED for SHALLOW_RENDER_COMPONENT and coldForcedNodes!
  // To avoid utility loop caller contagion, only propagate if callee is a dedicated pipeline callee (<=2 callers)
  // or callee was marked hot by animation frame calls.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [callerNode, calleeNames] of callerToCallees.entries()) {
      if (
        hotFunctionNodes.has(callerNode) ||
        shallowComponentNodes.has(callerNode) ||
        coldForcedNodes.has(callerNode)
      ) {
        continue;
      }
      for (const cName of calleeNames) {
        const targetNode = resolveCalleeNode(callerNode, cName);
        if (targetNode && trueHotNodes.has(targetNode)) {
          const callers = calleeToCallers.get(targetNode);
          const isDedicatedPipeline = callers && callers.size <= maxPipelineCallers;
          if (isDedicatedPipeline) {
            trueHotNodes.add(callerNode);
            hotFunctionNodes.add(callerNode);
            hotExemptNodes.add(callerNode);
            changed = true;
            break;
          }
        }
      }
    }
  }

  // Sanitize cold-forced nodes: ensure they are completely removed from hot and hotExempt sets
  for (const node of coldForcedNodes) {
    shallowComponentNodes.delete(node);
    hotFunctionNodes.delete(node);
    hotExemptNodes.delete(node);
  }

  const hotFunctionsSkipped: string[] = [];
  const coldFunctionsProtected: string[] = [];

  for (const fn of allFunctions) {
    if (hotFunctionNodes.has(fn.node)) {
      hotFunctionsSkipped.push(fn.name);
    } else {
      coldFunctionNodes.add(fn.node);
      coldFunctionsProtected.push(fn.name);
      if (
        matchedCriticalNodes.has(fn.node) &&
        !trueHotNodes.has(fn.node) &&
        !serializedWorkerNodes.has(fn.node)
      ) {
        criticalFunctionNodes.add(fn.node);
      }
    }
  }

  return {
    report: {
      totalFunctions: allFunctions.length,
      hotFunctionsSkipped,
      coldFunctionsProtected,
    },
    hotFunctionNodes,
    coldFunctionNodes,
    hotExemptNodes,
    serializedFunctionNodes,
    criticalFunctionNodes,
  };
}

function markEnclosingFunctionHot(
  ancestors: acorn.Node[],
  hotSet: WeakSet<acorn.Node>,
  directHotSet?: Set<acorn.Node>
): void {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (FUNCTION_NODE_TYPES.has(ancestors[i].type)) {
      hotSet.add(ancestors[i]);
      if (directHotSet) {
        directHotSet.add(ancestors[i]);
      }
      break;
    }
  }
}

export function detectHotPaths(
  code: string,
  config?: UnpeekConfig
): HotPathReport {
  const ast = parseJavaScriptAst(code);
  if (!ast) {
    return {
      totalFunctions: 0,
      hotFunctionsSkipped: [],
      coldFunctionsProtected: [],
    };
  }
  return analyzeAstHotPaths(ast, config).report;
}
