import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { HotPathReport } from '../types.js';

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

const UI_HOOK_OR_RENDER_CALLS = new Set([
  'useState',
  'useEffect',
  'useMemo',
  'useCallback',
  'useRef',
  'useLayoutEffect',
  'jsx',
  'jsxs',
  '_jsx',
  '_jsxs',
  'createElement',
  'requestAnimationFrame',
  'cancelAnimationFrame',
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

function getFunctionLabel(node: any, ancestors: acorn.Node[]): string {
  if (node.id && typeof node.id.name === 'string') {
    return node.id.name;
  }
  const parent = ancestors[ancestors.length - 2] as any;
  if (parent) {
    if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
      return parent.id.name;
    }
    if (parent.type === 'Property' && parent.key?.type === 'Identifier') {
      return parent.key.name;
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
  }
  return `anonymous_${node.start}`;
}

function isPascalCaseComponent(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
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

export function analyzeAstHotPaths(ast: acorn.Program): HotPathAnalysis {
  const hotFunctionNodes = new WeakSet<acorn.Node>();
  const coldFunctionNodes = new WeakSet<acorn.Node>();
  const hotExemptNodes = new WeakSet<acorn.Node>();
  const directHotNodes = new Set<acorn.Node>();
  const serializedFunctionNodes = new Set<acorn.Node>();
  const serializerHelperNodes = new Set<acorn.Node>();
  const allFunctions: { node: acorn.Node; name: string }[] = [];
  const fnByName = new Map<string, acorn.Node>();
  const scopeFunctions = new Map<acorn.Node, Map<string, acorn.Node>>();
  const fnScopeChain = new Map<acorn.Node, acorn.Node[]>();
  const fnParams = new Map<acorn.Node, Set<string>>();
  const fnVarAliases = new Map<acorn.Node, Map<string, string>>();
  const callerToCallees = new Map<acorn.Node, Set<string>>();
  const pendingSerializedRefs: { scopeNode: acorn.Node; name: string }[] = [];
  const allCallSites: {
    scopeNode: acorn.Node;
    calleeKey: string;
    args: any[];
  }[] = [];

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
    serializedFunctionNodes.add(node);
    hotFunctionNodes.add(node);
    directHotNodes.add(node);
    hotExemptNodes.add(node);
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
    // In bundled chunks (Webpack/Rollup), fnList[0] may be the chunk/module factory wrapper
    // and fnList[1] is the top-level module function (e.g., DRACOWorker `function s()`).
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

  function registerFunctionNode(node: any, ancestors: acorn.Node[]): void {
    const name = getFunctionLabel(node, ancestors);
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

    // Also register object namespace method key (e.g. const mathObj = { step(x) {} } -> "mathObj.step")
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

    if (isPascalCaseComponent(name)) {
      hotFunctionNodes.add(node);
      directHotNodes.add(node);
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
          if (memberProp && !ARRAY_HOF_METHODS.has(memberProp)) {
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

      // Check if arguments are hot callbacks (.map, .filter, .reduce, .forEach, .flatMap, requestAnimationFrame)
      if (
        ARRAY_HOF_METHODS.has(memberProp) ||
        calleeName === 'requestAnimationFrame' ||
        memberProp === 'requestAnimationFrame' ||
        calleeName === 'cancelAnimationFrame' ||
        memberProp === 'cancelAnimationFrame'
      ) {
        for (const arg of node.arguments || []) {
          if (FUNCTION_NODE_TYPES.has(arg.type)) {
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
      }

      // Check if enclosing function calls React hooks / createElement / jsx
      if (
        UI_HOOK_OR_RENDER_CALLS.has(calleeName) ||
        UI_HOOK_OR_RENDER_CALLS.has(memberProp)
      ) {
        if (enclosingFn) {
          hotFunctionNodes.add(enclosingFn);
          directHotNodes.add(enclosingFn);
        }
      }
    },
    ForStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      markEnclosingFunctionHot(ancestors, hotFunctionNodes, directHotNodes);
    },
    ForInStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      markEnclosingFunctionHot(ancestors, hotFunctionNodes, directHotNodes);
    },
    ForOfStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      markEnclosingFunctionHot(ancestors, hotFunctionNodes, directHotNodes);
    },
    WhileStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      markEnclosingFunctionHot(ancestors, hotFunctionNodes, directHotNodes);
    },
    DoWhileStatement(node, _state, ancestors) {
      hotExemptNodes.add(node);
      markEnclosingFunctionHot(ancestors, hotFunctionNodes, directHotNodes);
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

  // 1. Propagate hotness & serialization exemption top-down (lexically to nested functions and along static call graph)
  const forwardHotSet = new Set<acorn.Node>(directHotNodes);
  let forwardChanged = true;
  while (forwardChanged) {
    forwardChanged = false;

    // 1A. Lexical downward propagation: any function nested inside a serialized or forward-hot function
    // inherits its hot/exempt status so inner callbacks (e.g. onmessage, .then(), IIFEs) are also exempt
    // and their own callees are traversed.
    for (const fn of allFunctions) {
      if (forwardHotSet.has(fn.node)) continue;
      const chain = fnScopeChain.get(fn.node);
      if (!chain) continue;
      for (const anc of chain) {
        if (anc !== fn.node && (serializedFunctionNodes.has(anc) || forwardHotSet.has(anc))) {
          forwardHotSet.add(fn.node);
          hotFunctionNodes.add(fn.node);
          hotExemptNodes.add(fn.node);
          if (serializedFunctionNodes.has(anc)) {
            serializedFunctionNodes.add(fn.node);
          }
          forwardChanged = true;
          break;
        }
      }
    }

    // 1B. Call-graph downward propagation: any helper called by a forward-hot or serialized function
    for (const callerNode of Array.from(forwardHotSet)) {
      const calleeNames = callerToCallees.get(callerNode);
      if (!calleeNames) continue;
      for (const cName of calleeNames) {
        const targetNode = resolveCalleeNode(callerNode, cName);
        if (targetNode && !forwardHotSet.has(targetNode)) {
          forwardHotSet.add(targetNode);
          hotFunctionNodes.add(targetNode);
          hotExemptNodes.add(targetNode);
          if (serializedFunctionNodes.has(callerNode)) {
            serializedFunctionNodes.add(targetNode);
          }
          forwardChanged = true;
        }
      }
    }
  }

  // 2. Propagate hotness bottom-up along the static call graph (caller -> hot callee)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [callerNode, calleeNames] of callerToCallees.entries()) {
      if (hotFunctionNodes.has(callerNode)) continue;
      for (const cName of calleeNames) {
        const targetNode = resolveCalleeNode(callerNode, cName);
        if (targetNode && hotFunctionNodes.has(targetNode)) {
          hotFunctionNodes.add(callerNode);
          changed = true;
          break;
        }
      }
    }
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

export function detectHotPaths(code: string): HotPathReport {
  const ast = parseJavaScriptAst(code);
  if (!ast) {
    return {
      totalFunctions: 0,
      hotFunctionsSkipped: [],
      coldFunctionsProtected: [],
    };
  }
  return analyzeAstHotPaths(ast).report;
}
