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
  const allFunctions: { node: acorn.Node; name: string }[] = [];
  const fnByName = new Map<string, acorn.Node>();
  const scopeFunctions = new Map<acorn.Node, Map<string, acorn.Node>>();
  const fnScopeChain = new Map<acorn.Node, acorn.Node[]>();
  const callerToCallees = new Map<acorn.Node, Set<string>>();

  function registerFunctionNode(node: acorn.Node, ancestors: acorn.Node[]): void {
    const name = getFunctionLabel(node, ancestors);
    allFunctions.push({ node, name });
    fnByName.set(name, node);

    const enclosingScope = findEnclosingScopeNode(ancestors, node);
    let localMap = scopeFunctions.get(enclosingScope);
    if (!localMap) {
      localMap = new Map<string, acorn.Node>();
      scopeFunctions.set(enclosingScope, localMap);
    }
    localMap.set(name, node);

    // Also register object namespace method key (e.g. const mathObj = { step(x) {} } -> "mathObj.step")
    const parent = ancestors[ancestors.length - 2] as any;
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
      if (FUNCTION_NODE_TYPES.has(ancestors[i].type) || ancestors[i].type === 'Program') {
        chain.push(ancestors[i]);
      }
    }
    fnScopeChain.set(node, chain);

    if (isPascalCaseComponent(name)) {
      hotFunctionNodes.add(node);
      directHotNodes.add(node);
    }
  }

  function resolveCalleeNode(callerNode: acorn.Node, calleeKey: string): acorn.Node | undefined {
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

      if (qualifiedCall || memberProp) {
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (FUNCTION_NODE_TYPES.has(ancestors[i].type)) {
            let set = callerToCallees.get(ancestors[i]);
            if (!set) {
              set = new Set();
              callerToCallees.set(ancestors[i], set);
            }
            if (qualifiedCall) set.add(qualifiedCall);
            if (memberProp && !ARRAY_HOF_METHODS.has(memberProp)) {
              set.add(memberProp);
            }
            break;
          }
        }
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
          }
        }
      }

      // Check if enclosing function calls React hooks / createElement / jsx
      if (
        UI_HOOK_OR_RENDER_CALLS.has(calleeName) ||
        UI_HOOK_OR_RENDER_CALLS.has(memberProp)
      ) {
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (FUNCTION_NODE_TYPES.has(ancestors[i].type)) {
            hotFunctionNodes.add(ancestors[i]);
            directHotNodes.add(ancestors[i]);
            break;
          }
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

  // 1. Propagate hotness top-down from direct hot roots to their callees (hot caller -> callee)
  const forwardHotSet = new Set<acorn.Node>(directHotNodes);
  let forwardChanged = true;
  while (forwardChanged) {
    forwardChanged = false;
    for (const callerNode of Array.from(forwardHotSet)) {
      const calleeNames = callerToCallees.get(callerNode);
      if (!calleeNames) continue;
      for (const cName of calleeNames) {
        const targetNode = resolveCalleeNode(callerNode, cName);
        if (targetNode && !forwardHotSet.has(targetNode)) {
          forwardHotSet.add(targetNode);
          hotFunctionNodes.add(targetNode);
          hotExemptNodes.add(targetNode);
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
