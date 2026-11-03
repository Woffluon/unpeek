import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { computeFnv1aHash } from './string-vault.js';

const RESERVED_IDENTIFIERS = new Set([
  'arguments',
  'undefined',
  'NaN',
  'Infinity',
  'window',
  'document',
  'globalThis',
  'self',
  'console',
  'Math',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'RegExp',
  'Date',
  'Reflect',
  'Proxy',
  'Intl',
  'eval',
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  'React',
]);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

function collectPatternIdentifiers(pattern: any, out: any[]): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern);
      break;
    case 'AssignmentPattern':
      collectPatternIdentifiers(pattern.left, out);
      break;
    case 'RestElement':
      collectPatternIdentifiers(pattern.argument, out);
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements || []) {
        if (el) collectPatternIdentifiers(el, out);
      }
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties || []) {
        if (prop.type === 'Property') {
          if (prop.shorthand) {
            prop.shorthand = false;
            prop.key = { ...prop.key };
          }
          collectPatternIdentifiers(prop.value, out);
        } else if (prop.type === 'RestElement') {
          collectPatternIdentifiers(prop.argument, out);
        }
      }
      break;
  }
}

export function applyPolymorphicMangler(
  ast: acorn.Program,
  seed = 0x9e3779b9
): number {
  const scopeMap = new Map<acorn.Node, Map<string, string>>();
  const scopeDepthMap = new Map<acorn.Node, number>();
  let counter = 0;

  function makeScopedMangledName(
    scopeDepth: number,
    localIndex: number,
    usedValues: Set<string>
  ): string {
    counter++;
    let salt = 0;
    while (true) {
      const h = computeFnv1aHash(`s${scopeDepth}:i${localIndex}:${salt}`, seed);
      const candidate = `_0x${((h & 0x1f) + localIndex + salt).toString(36)}`;
      if (!usedValues.has(candidate)) {
        return candidate;
      }
      salt++;
    }
  }

  function countFunctionDepth(ancestors: acorn.Node[]): number {
    let depth = 0;
    for (let i = 0; i < ancestors.length; i++) {
      if (FUNCTION_TYPES.has(ancestors[i].type)) {
        depth++;
      }
    }
    return Math.max(1, depth);
  }

  function findEnclosingFunction(ancestors: acorn.Node[]): acorn.Node | null {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (FUNCTION_TYPES.has(ancestors[i].type)) {
        return ancestors[i];
      }
    }
    return null;
  }

  function registerBindingAndMutateDeclSite(
    idNode: any,
    bindings: Map<string, string>,
    scopeDepth: number
  ): void {
    const origName: string = idNode.name;
    if (RESERVED_IDENTIFIERS.has(origName) || origName.startsWith('_u') || origName.startsWith('_0x')) {
      return;
    }
    let mangled = bindings.get(origName);
    if (!mangled) {
      const usedValues = new Set(bindings.values());
      mangled = makeScopedMangledName(scopeDepth, bindings.size, usedValues);
      bindings.set(origName, mangled);
    }
    idNode.name = mangled;
  }

  function registerFunctionParams(fnNode: any, ancestors: acorn.Node[]): void {
    let bindings = scopeMap.get(fnNode);
    const depth = countFunctionDepth(ancestors);
    scopeDepthMap.set(fnNode, depth);
    if (!bindings) {
      bindings = new Map();
      scopeMap.set(fnNode, bindings);
    }
    for (const param of fnNode.params || []) {
      const idNodes: any[] = [];
      collectPatternIdentifiers(param, idNodes);
      for (const idNode of idNodes) {
        registerBindingAndMutateDeclSite(idNode, bindings, depth);
      }
    }
  }

  // Pass 1: Collect and rename local function parameters and local variable declarations inside functions
  walk.ancestor(ast, {
    FunctionDeclaration(node: any, _state, ancestors) {
      registerFunctionParams(node, ancestors);
    },
    FunctionExpression(node: any, _state, ancestors) {
      registerFunctionParams(node, ancestors);
    },
    ArrowFunctionExpression(node: any, _state, ancestors) {
      registerFunctionParams(node, ancestors);
    },
    VariableDeclaration(node: any, _state, ancestors) {
      const fnScope = findEnclosingFunction(ancestors);
      if (!fnScope) return; // Never mangle top-level / module-scope variables
      let bindings = scopeMap.get(fnScope);
      const depth = scopeDepthMap.get(fnScope) ?? countFunctionDepth(ancestors);
      if (!bindings) {
        bindings = new Map();
        scopeMap.set(fnScope, bindings);
      }
      for (const decl of node.declarations || []) {
        const idNodes: any[] = [];
        collectPatternIdentifiers(decl.id, idNodes);
        for (const idNode of idNodes) {
          registerBindingAndMutateDeclSite(idNode, bindings, depth);
        }
      }
    },
  });

  if (counter === 0) return 0;

  // Pass 2: Rename all matching identifier references and assignment LHS patterns within their lexical function scope
  walk.ancestor(ast, {
    AssignmentExpression(node: any, _state, ancestors) {
      const idNodes: any[] = [];
      collectPatternIdentifiers(node.left, idNodes);
      for (const idNode of idNodes) {
        const resolved = resolveMangledName(idNode.name, ancestors, scopeMap);
        if (resolved) {
          idNode.name = resolved;
        }
      }
    },
    ForInStatement(node: any, _state, ancestors) {
      if (node.left && node.left.type !== 'VariableDeclaration') {
        const idNodes: any[] = [];
        collectPatternIdentifiers(node.left, idNodes);
        for (const idNode of idNodes) {
          const resolved = resolveMangledName(idNode.name, ancestors, scopeMap);
          if (resolved) idNode.name = resolved;
        }
      }
    },
    ForOfStatement(node: any, _state, ancestors) {
      if (node.left && node.left.type !== 'VariableDeclaration') {
        const idNodes: any[] = [];
        collectPatternIdentifiers(node.left, idNodes);
        for (const idNode of idNodes) {
          const resolved = resolveMangledName(idNode.name, ancestors, scopeMap);
          if (resolved) idNode.name = resolved;
        }
      }
    },
    Property(node: any, _state, ancestors) {
      if (node.shorthand && node.value?.type === 'Identifier') {
        const resolved = resolveMangledName(node.value.name, ancestors, scopeMap);
        if (resolved) {
          node.shorthand = false;
          node.key = { type: 'Identifier', name: node.value.name };
        }
      }
    },
    Identifier(node: any, _state, ancestors) {
      const parent = ancestors[ancestors.length - 2] as any;
      if (!parent) return;

      if (
        (parent.type === 'FunctionDeclaration' ||
          parent.type === 'FunctionExpression' ||
          parent.type === 'ClassDeclaration' ||
          parent.type === 'ClassExpression') &&
        parent.id === node
      ) {
        return;
      }

      if (
        parent.type === 'MemberExpression' &&
        parent.property === node &&
        !parent.computed
      ) {
        return;
      }

      if (
        (parent.type === 'Property' ||
          parent.type === 'MethodDefinition' ||
          parent.type === 'PropertyDefinition') &&
        parent.key === node &&
        !parent.computed
      ) {
        return;
      }

      if (
        parent.type === 'LabeledStatement' ||
        parent.type === 'BreakStatement' ||
        parent.type === 'ContinueStatement' ||
        parent.type === 'ImportSpecifier' ||
        parent.type === 'ImportDefaultSpecifier' ||
        parent.type === 'ImportNamespaceSpecifier' ||
        parent.type === 'ExportSpecifier'
      ) {
        return;
      }

      const resolved = resolveMangledName(node.name, ancestors, scopeMap);
      if (resolved) {
        node.name = resolved;
      }
    },
  });

  return counter;
}

function resolveMangledName(
  name: string,
  ancestors: acorn.Node[],
  scopeMap: Map<acorn.Node, Map<string, string>>
): string | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const anc = ancestors[i];
    const bindings = scopeMap.get(anc);
    if (bindings && bindings.has(name)) {
      return bindings.get(name)!;
    }
  }
  return null;
}
