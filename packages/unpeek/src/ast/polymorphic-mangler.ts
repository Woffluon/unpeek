import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { ManglerConfig, UnpeekConfig } from '../types.js';
import { computeFnv1aHash } from './string-vault.js';

export const RESERVED_IDENTIFIERS = new Set([
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
  'navigator',
  'crypto',
  'location',
  'history',
  'indexedDB',
  'fetch',
  'WebSocket',
  'Worker',
  'AudioContext',
  'performance',
]);

const JS_KEYWORDS = new Set([
  'as',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const LEXICAL_SCOPE_TYPES = new Set([
  'Program',
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'BlockStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'SwitchStatement',
  'CatchClause',
  'ClassDeclaration',
  'ClassExpression',
]);

interface PatternTarget {
  idNode: any;
  shorthandProp?: any;
}

interface BindingEntry {
  origName: string;
  shouldMangle: boolean;
  targets: PatternTarget[];
  mangledName: string;
}

interface ScopeRecord {
  node: acorn.Node;
  parent: ScopeRecord | null;
  children: ScopeRecord[];
  depth: number;
  bindings: Map<string, BindingEntry>;
  usedNames: Set<string>;
}

function collectPatternTargets(
  pattern: any,
  out: PatternTarget[],
  shorthandProp?: any
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      out.push({ idNode: pattern, shorthandProp });
      break;
    case 'AssignmentPattern':
      collectPatternTargets(pattern.left, out, shorthandProp);
      break;
    case 'RestElement':
      collectPatternTargets(pattern.argument, out);
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements || []) {
        if (el) collectPatternTargets(el, out);
      }
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties || []) {
        if (prop.type === 'Property') {
          collectPatternTargets(
            prop.value,
            out,
            prop.shorthand ? prop : undefined
          );
        } else if (prop.type === 'RestElement') {
          collectPatternTargets(prop.argument, out);
        }
      }
      break;
  }
}

export function isMangleableName(
  origName: string,
  reservedSet: Set<string> = RESERVED_IDENTIFIERS,
  manglerConfig?: ManglerConfig
): boolean {
  const minLength = manglerConfig?.minLength ?? 3;
  return (
    origName.length >= minLength &&
    !reservedSet.has(origName) &&
    !JS_KEYWORDS.has(origName) &&
    !origName.startsWith('$') &&
    !origName.startsWith('__') &&
    !origName.startsWith('_u') &&
    !origName.startsWith('_0x') &&
    (!manglerConfig?.excludePrefixes ||
      !manglerConfig.excludePrefixes.some((p) => origName.startsWith(p))) &&
    (!manglerConfig?.excludePatterns ||
      !manglerConfig.excludePatterns.some((re) => re.test(origName)))
  );
}

function shuffleAlphabet(chars: string, seed: number): string[] {
  const arr = chars.split('');
  let s = (seed || 0x13572468) >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const j = (s >>> 0) % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function applyPolymorphicMangler(
  ast: acorn.Program,
  seed = 0x9e3779b9,
  serializedFunctionNodes?: WeakSet<acorn.Node>,
  config?: UnpeekConfig
): number {
  const activeReserved = new Set(RESERVED_IDENTIFIERS);
  if (config?.mangler?.reservedIdentifiers) {
    for (const id of config.mangler.reservedIdentifiers) {
      activeReserved.add(id);
    }
  }
  const manglerConfig = config?.mangler;
  const scopeRecords = new Map<acorn.Node, ScopeRecord>();
  const barrierOrFreeIds = new Set<string>();
  const renamedTargetNodes = new WeakSet<any>();
  let counter = 0;

  function ensureScopeChain(ancestors: acorn.Node[]): ScopeRecord {
    let prevScope: ScopeRecord | null = null;
    for (let i = 0; i < ancestors.length; i++) {
      const node = ancestors[i];
      if (!LEXICAL_SCOPE_TYPES.has(node.type)) continue;
      let record = scopeRecords.get(node);
      if (!record) {
        const isFn = FUNCTION_TYPES.has(node.type);
        const depth: number = prevScope
          ? prevScope.depth + (isFn ? 1 : 0)
          : 0;
        record = {
          node,
          parent: prevScope,
          children: [],
          depth: Math.max(1, depth),
          bindings: new Map(),
          usedNames: new Set(),
        };
        scopeRecords.set(node, record);
        if (prevScope) {
          prevScope.children.push(record);
        }
      }
      prevScope = record;
    }
    return prevScope!;
  }

  function findEnclosingFunctionNode(ancestors: acorn.Node[]): acorn.Node | null {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (FUNCTION_TYPES.has(ancestors[i].type)) {
        return ancestors[i];
      }
    }
    return null;
  }

  function findEnclosingLexicalNode(ancestors: acorn.Node[]): acorn.Node {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (LEXICAL_SCOPE_TYPES.has(ancestors[i].type)) {
        return ancestors[i];
      }
    }
    return ancestors[0];
  }

  function registerBindingTarget(
    scopeNode: acorn.Node,
    target: PatternTarget,
    shouldMangle: boolean,
    fnScope?: acorn.Node | null
  ): void {
    const scope = scopeRecords.get(scopeNode);
    if (!scope) return;
    const origName: string = target.idNode.name;
    let canMangle =
      shouldMangle && isMangleableName(origName, activeReserved, manglerConfig);
    if (canMangle && fnScope) {
      if (serializedFunctionNodes && serializedFunctionNodes.has(fnScope)) {
        canMangle = false;
      }
    }
    renamedTargetNodes.add(target.idNode);
    let entry = scope.bindings.get(origName);
    if (!entry) {
      entry = {
        origName,
        shouldMangle: canMangle,
        targets: [target],
        mangledName: origName,
      };
      scope.bindings.set(origName, entry);
    } else {
      if (!canMangle) {
        entry.shouldMangle = false;
      }
      entry.targets.push(target);
    }
    if (!entry.shouldMangle) {
      barrierOrFreeIds.add(origName);
    }
  }

  function registerBarrierName(scopeNode: acorn.Node, origName: string): void {
    barrierOrFreeIds.add(origName);
    const scope = scopeRecords.get(scopeNode);
    if (!scope) return;
    let entry = scope.bindings.get(origName);
    if (!entry) {
      entry = {
        origName,
        shouldMangle: false,
        targets: [],
        mangledName: origName,
      };
      scope.bindings.set(origName, entry);
    } else {
      entry.shouldMangle = false;
    }
  }

  function registerFunctionParams(fnNode: any, ancestors: acorn.Node[]): void {
    ensureScopeChain(ancestors);
    for (const param of fnNode.params || []) {
      const targets: PatternTarget[] = [];
      collectPatternTargets(param, targets);
      for (const target of targets) {
        registerBindingTarget(fnNode, target, true, fnNode);
      }
    }
  }

  // Pass 1A: Build lexical scope tree and collect all declarations
  ensureScopeChain([ast]);
  walk.ancestor(ast, {
    BlockStatement(_node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
    },
    ForStatement(_node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
    },
    ForInStatement(_node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
    },
    ForOfStatement(_node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
    },
    SwitchStatement(_node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
    },
    ImportSpecifier(node: any) {
      if (node.local?.name) barrierOrFreeIds.add(node.local.name);
    },
    ImportDefaultSpecifier(node: any) {
      if (node.local?.name) barrierOrFreeIds.add(node.local.name);
    },
    ImportNamespaceSpecifier(node: any) {
      if (node.local?.name) barrierOrFreeIds.add(node.local.name);
    },
    FunctionDeclaration(node: any, _state, ancestors) {
      registerFunctionParams(node, ancestors);
      if (node.id?.type === 'Identifier') {
        const parentAncestors = ancestors.slice(0, -1);
        const lexNode = findEnclosingLexicalNode(parentAncestors);
        const fnNode = findEnclosingFunctionNode(parentAncestors) ?? ast;
        registerBarrierName(lexNode, node.id.name);
        if (lexNode === (fnNode as any).body || fnNode === ast) {
          registerBarrierName(fnNode, node.id.name);
        }
        if (!scopeRecords.get(node)?.bindings.has(node.id.name)) {
          registerBarrierName(node, node.id.name);
        }
      }
    },
    FunctionExpression(node: any, _state, ancestors) {
      registerFunctionParams(node, ancestors);
      if (node.id?.type === 'Identifier') {
        if (!scopeRecords.get(node)?.bindings.has(node.id.name)) {
          registerBarrierName(node, node.id.name);
        }
      }
    },
    ArrowFunctionExpression(node: any, _state, ancestors) {
      registerFunctionParams(node, ancestors);
    },
    ClassDeclaration(node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
      if (node.id?.type === 'Identifier') {
        const parentAncestors = ancestors.slice(0, -1);
        const lexNode = findEnclosingLexicalNode(parentAncestors);
        registerBarrierName(lexNode, node.id.name);
        registerBarrierName(node, node.id.name);
      }
    },
    ClassExpression(node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
      if (node.id?.type === 'Identifier') {
        registerBarrierName(node, node.id.name);
      }
    },
    CatchClause(node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
      if (node.param) {
        const fnScope = findEnclosingFunctionNode(ancestors);
        const targets: PatternTarget[] = [];
        collectPatternTargets(node.param, targets);
        for (const target of targets) {
          registerBindingTarget(node, target, true, fnScope);
        }
      }
    },
    VariableDeclaration(node: any, _state, ancestors) {
      ensureScopeChain(ancestors);
      const fnScope = findEnclosingFunctionNode(ancestors);
      if (!fnScope) {
        for (const decl of node.declarations || []) {
          const targets: PatternTarget[] = [];
          collectPatternTargets(decl.id, targets);
          for (const target of targets) {
            registerBarrierName(ast, target.idNode.name);
          }
        }
        return;
      }

      const targetScopeNode =
        node.kind === 'var' ? fnScope : findEnclosingLexicalNode(ancestors);

      for (const decl of node.declarations || []) {
        const targets: PatternTarget[] = [];
        collectPatternTargets(decl.id, targets);
        for (const target of targets) {
          const origName = target.idNode.name;
          // Annex B.3.5 guard: if `var x` is declared inside a `catch (x)` of the same name, keep both unmangled
          if (node.kind === 'var') {
            for (let i = ancestors.length - 1; i >= 0; i--) {
              if (ancestors[i] === fnScope) break;
              if (ancestors[i].type === 'CatchClause') {
                const catchScope = scopeRecords.get(ancestors[i]);
                if (catchScope?.bindings.has(origName)) {
                  registerBarrierName(ancestors[i], origName);
                  registerBarrierName(fnScope, origName);
                }
              }
            }
          }
          registerBindingTarget(targetScopeNode, target, true, fnScope);
        }
      }
    },
  });

  function resolveBinding(
    name: string,
    ancestors: acorn.Node[]
  ): BindingEntry | null {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const scope = scopeRecords.get(ancestors[i]);
      if (scope && scope.bindings.has(name)) {
        return scope.bindings.get(name)!;
      }
    }
    return null;
  }

  function isNonVarIdentifierPosition(node: any, parent: any): boolean {
    if (!parent) return true;
    if (
      (parent.type === 'FunctionDeclaration' ||
        parent.type === 'FunctionExpression' ||
        parent.type === 'ClassDeclaration' ||
        parent.type === 'ClassExpression') &&
      parent.id === node
    ) {
      return true;
    }
    if (
      parent.type === 'MemberExpression' &&
      parent.property === node &&
      !parent.computed
    ) {
      return true;
    }
    if (
      (parent.type === 'Property' ||
        parent.type === 'MethodDefinition' ||
        parent.type === 'PropertyDefinition') &&
      parent.key === node &&
      !parent.computed
    ) {
      return true;
    }
    if (
      parent.type === 'LabeledStatement' ||
      parent.type === 'BreakStatement' ||
      parent.type === 'ContinueStatement' ||
      parent.type === 'ImportSpecifier' ||
      parent.type === 'ImportDefaultSpecifier' ||
      parent.type === 'ImportNamespaceSpecifier' ||
      parent.type === 'ExportSpecifier' ||
      parent.type === 'MetaProperty'
    ) {
      return true;
    }
    return false;
  }

  // Pass 1.5: Collect all unbound (global) or unmangleable variable-position identifiers
  // so that 1-2 char mangled names never shadow globals, imports, or barrier declarations.
  walk.ancestor(ast, {
    Identifier(node: any, _state, ancestors) {
      if (renamedTargetNodes.has(node)) return;
      const parent = ancestors[ancestors.length - 2] as any;
      if (isNonVarIdentifierPosition(node, parent)) return;
      const entry = resolveBinding(node.name, ancestors);
      if (!entry || !entry.shouldMangle) {
        barrierOrFreeIds.add(node.name);
      }
    },
  });

  function isNameUsedInScopeOrAncestors(
    candidate: string,
    scope: ScopeRecord
  ): boolean {
    if (
      JS_KEYWORDS.has(candidate) ||
      activeReserved.has(candidate) ||
      barrierOrFreeIds.has(candidate)
    ) {
      return true;
    }
    let curr: ScopeRecord | null = scope;
    while (curr) {
      if (curr.usedNames.has(candidate)) {
        return true;
      }
      curr = curr.parent;
    }
    return false;
  }

  const p1 = shuffleAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', seed);
  const p2a = shuffleAlphabet(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    (seed ^ 0x517cc1b7) >>> 0
  );
  const p2b = shuffleAlphabet(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_',
    (seed ^ 0x9e3779b9) >>> 0
  );

  function candidateAtSlot(slot: number): string {
    if (slot < p1.length) {
      return p1[slot];
    }
    const rem = slot - p1.length;
    const twoCharSpace = p2a.length * p2b.length;
    if (rem < twoCharSpace) {
      return `${p2a[rem % p2a.length]}${p2b[Math.floor(rem / p2a.length)]}`;
    }
    const rem3 = rem - twoCharSpace;
    return `${p2a[rem3 % p2a.length]}${p2b[Math.floor(rem3 / p2a.length) % p2b.length]}${p2b[Math.floor(rem3 / twoCharSpace) % p2b.length]}`;
  }

  function makeScopedMangledName(
    scope: ScopeRecord,
    origName: string
  ): string {
    let slot = 0;
    while (true) {
      const candidate = candidateAtSlot(slot);
      slot++;
      if (candidate === origName) continue;
      if (!isNameUsedInScopeOrAncestors(candidate, scope)) {
        return candidate;
      }
    }
  }

  // Pass 1B: Traverse scope tree top-down (outermost to innermost) to assign collision-free mangled names
  function assignScopeNamesTopDown(scope: ScopeRecord): void {
    for (const entry of scope.bindings.values()) {
      if (!entry.shouldMangle) {
        entry.mangledName = entry.origName;
        scope.usedNames.add(entry.origName);
        continue;
      }
      const mangled = makeScopedMangledName(scope, entry.origName);
      counter++;
      entry.mangledName = mangled;
      scope.usedNames.add(mangled);
      for (const target of entry.targets) {
        if (target.shorthandProp && target.shorthandProp.shorthand) {
          target.shorthandProp.shorthand = false;
          target.shorthandProp.key = {
            type: 'Identifier',
            name: entry.origName,
          };
        }
        target.idNode.name = mangled;
      }
    }
    for (const child of scope.children) {
      assignScopeNamesTopDown(child);
    }
  }

  const rootScope = scopeRecords.get(ast);
  if (rootScope) {
    assignScopeNamesTopDown(rootScope);
  }

  if (counter === 0) return 0;

  function renamePatternTargetsInScope(
    pattern: any,
    ancestors: acorn.Node[]
  ): void {
    const targets: PatternTarget[] = [];
    collectPatternTargets(pattern, targets);
    for (const target of targets) {
      if (renamedTargetNodes.has(target.idNode)) continue;
      const origName = target.idNode.name;
      const entry = resolveBinding(origName, ancestors);
      if (entry && entry.shouldMangle && entry.mangledName !== origName) {
        if (target.shorthandProp && target.shorthandProp.shorthand) {
          target.shorthandProp.shorthand = false;
          target.shorthandProp.key = {
            type: 'Identifier',
            name: origName,
          };
        }
        target.idNode.name = entry.mangledName;
        renamedTargetNodes.add(target.idNode);
      }
    }
  }

  // Pass 2: Rename all matching identifier references and assignment LHS patterns within their lexical scope
  walk.ancestor(ast, {
    AssignmentExpression(node: any, _state, ancestors) {
      renamePatternTargetsInScope(node.left, ancestors);
    },
    ForInStatement(node: any, _state, ancestors) {
      if (node.left && node.left.type !== 'VariableDeclaration') {
        renamePatternTargetsInScope(node.left, ancestors);
      }
    },
    ForOfStatement(node: any, _state, ancestors) {
      if (node.left && node.left.type !== 'VariableDeclaration') {
        renamePatternTargetsInScope(node.left, ancestors);
      }
    },
    Identifier(node: any, _state, ancestors) {
      if (renamedTargetNodes.has(node)) return;
      const parent = ancestors[ancestors.length - 2] as any;
      if (isNonVarIdentifierPosition(node, parent)) return;

      const entry = resolveBinding(node.name, ancestors);
      if (entry && entry.shouldMangle && entry.mangledName !== node.name) {
        if (
          parent.type === 'Property' &&
          parent.shorthand &&
          parent.value === node
        ) {
          parent.shorthand = false;
          parent.key = { type: 'Identifier', name: node.name };
        }
        node.name = entry.mangledName;
      }
    },
  });

  return counter;
}
