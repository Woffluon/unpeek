import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { HotPathReport, UnpeekConfig } from '../types.js';

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

const DEFAULT_HOOK_REGEX = /^use[A-Z0-9]/;

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
  'createElement',
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
}

export function parseJavaScriptAst(code: string): acorn.Program | null {
  try {
    return acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
    });
  } catch {
    try {
      return acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowReturnOutsideFunction: true,
      });
    } catch {
      return null;
    }
  }
}

function isHocCall(callNode: any, hocWrappers?: Set<string>): boolean {
  if (!callNode || callNode.type !== 'CallExpression') return false;
  const callee = callNode.callee;
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

function isPascalCaseComponent(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
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
  config?: UnpeekConfig
): HotPathAnalysis {
  const hotFunctionNodes = new WeakSet<acorn.Node>();
  const coldFunctionNodes = new WeakSet<acorn.Node>();
  const hotExemptNodes = new WeakSet<acorn.Node>();
  const serializedFunctionNodes = new WeakSet<acorn.Node>();

  const serializedWorkerNodes = new Set<acorn.Node>();
  const trueHotNodes = new Set<acorn.Node>();
  const shallowComponentNodes = new Set<acorn.Node>();
  const coldForcedNodes = new Set<acorn.Node>();
  const directHotNodes = new Set<acorn.Node>();

  const serializerHelperNodes = new Set<acorn.Node>();
  const allFunctions: { node: acorn.Node; name: string }[] = [];
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

  const eventHandlerRegex =
    config?.hotPath?.eventHandlerRegex ?? DEFAULT_EVENT_HANDLER_REGEX;

  const hookRegex = config?.hotPath?.hookPattern ?? DEFAULT_HOOK_REGEX;
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

  function registerFunctionNode(node: any, ancestors: acorn.Node[]): void {
    const name = getFunctionLabel(node, ancestors, hocWrappers);
    allFunctions.push({ node, name });
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

    if (isPascalCaseComponent(name) && !excludedComponents.has(name)) {
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
      const callee = node.callee;
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
    if (!trueHotNodes.has(fn.node) && !containsLoopOrAnimation(fn.node, animationCalls)) {
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
  // - SERIALIZED_WORKER: full subtree (1A + 1B)
  // - TRUE_HOT_60FPS: call-graph downward (1B: renderFrame -> lerp -> stepParticles) is fully preserved
  // - SHALLOW_RENDER_COMPONENT: 1A and 2 are turned off!
  let forwardChanged = true;
  while (forwardChanged) {
    forwardChanged = false;

    // 1A. Lexical downward propagation:
    for (const fn of allFunctions) {
      if (coldForcedNodes.has(fn.node)) continue;
      const chain = fnScopeChain.get(fn.node);
      if (!chain) continue;

      for (const anc of chain) {
        if (anc === fn.node) continue;

        // Serialized worker propagates downward 1A
        if (serializedWorkerNodes.has(anc)) {
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
    // Serialized worker callees
    for (const callerNode of Array.from(serializedWorkerNodes)) {
      const calleeNames = callerToCallees.get(callerNode);
      if (!calleeNames) continue;
      for (const cName of calleeNames) {
        const targetNode = resolveCalleeNode(callerNode, cName);
        if (
          targetNode &&
          !serializedWorkerNodes.has(targetNode) &&
          !coldForcedNodes.has(targetNode)
        ) {
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
