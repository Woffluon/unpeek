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

export function analyzeAstHotPaths(ast: acorn.Program): HotPathAnalysis {
  const hotFunctionNodes = new WeakSet<acorn.Node>();
  const coldFunctionNodes = new WeakSet<acorn.Node>();
  const allFunctions: { node: acorn.Node; name: string }[] = [];
  const fnByName = new Map<string, acorn.Node>();
  const callerToCallees = new Map<acorn.Node, Set<string>>();

  walk.ancestor(ast, {
    FunctionDeclaration(node, _state, ancestors) {
      const name = getFunctionLabel(node, ancestors);
      allFunctions.push({ node, name });
      fnByName.set(name, node);
      if (isPascalCaseComponent(name)) {
        hotFunctionNodes.add(node);
      }
    },
    FunctionExpression(node, _state, ancestors) {
      const name = getFunctionLabel(node, ancestors);
      allFunctions.push({ node, name });
      fnByName.set(name, node);
      if (isPascalCaseComponent(name)) {
        hotFunctionNodes.add(node);
      }
    },
    ArrowFunctionExpression(node, _state, ancestors) {
      const name = getFunctionLabel(node, ancestors);
      allFunctions.push({ node, name });
      fnByName.set(name, node);
      if (isPascalCaseComponent(name)) {
        hotFunctionNodes.add(node);
      }
    },
    CallExpression(node: any, _state, ancestors) {
      const callee = node.callee;
      let calleeName = '';
      let memberProp = '';

      if (callee?.type === 'Identifier') {
        calleeName = callee.name;
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (FUNCTION_NODE_TYPES.has(ancestors[i].type)) {
            let set = callerToCallees.get(ancestors[i]);
            if (!set) {
              set = new Set();
              callerToCallees.set(ancestors[i], set);
            }
            set.add(calleeName);
            break;
          }
        }
      } else if (
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property?.type === 'Identifier'
      ) {
        memberProp = callee.property.name;
      }

      // Check if arguments are hot callbacks (.map, .filter, .reduce, .forEach, .flatMap, requestAnimationFrame)
      if (
        ARRAY_HOF_METHODS.has(memberProp) ||
        calleeName === 'requestAnimationFrame' ||
        memberProp === 'requestAnimationFrame'
      ) {
        for (const arg of node.arguments || []) {
          if (FUNCTION_NODE_TYPES.has(arg.type)) {
            hotFunctionNodes.add(arg);
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
            break;
          }
        }
      }
    },
    ForStatement(_node, _state, ancestors) {
      markEnclosingFunctionHot(ancestors, hotFunctionNodes);
    },
    ForInStatement(_node, _state, ancestors) {
      markEnclosingFunctionHot(ancestors, hotFunctionNodes);
    },
    ForOfStatement(_node, _state, ancestors) {
      markEnclosingFunctionHot(ancestors, hotFunctionNodes);
    },
    WhileStatement(_node, _state, ancestors) {
      markEnclosingFunctionHot(ancestors, hotFunctionNodes);
    },
    DoWhileStatement(_node, _state, ancestors) {
      markEnclosingFunctionHot(ancestors, hotFunctionNodes);
    },
  });

  // Propagate hotness bottom-up along the static call graph (caller -> hot callee)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [callerNode, calleeNames] of callerToCallees.entries()) {
      if (hotFunctionNodes.has(callerNode)) continue;
      for (const cName of calleeNames) {
        const targetNode = fnByName.get(cName);
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
  };
}

function markEnclosingFunctionHot(
  ancestors: acorn.Node[],
  hotSet: WeakSet<acorn.Node>
): void {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (FUNCTION_NODE_TYPES.has(ancestors[i].type)) {
      hotSet.add(ancestors[i]);
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
