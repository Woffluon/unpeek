import type * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export type ChunkBoundaryKind =
  | 'entry-bootstrap'
  | 'rsc-flight'
  | 'preload-manifest'
  | 'app-chunk';

export interface BoundaryClassification {
  kind: ChunkBoundaryKind;
  exemptSubtreeRoots: WeakSet<acorn.Node>;
  importSourceNodes: WeakSet<acorn.Node>;
  importExpressions: any[];
}

const GLOBAL_HOSTS = new Set(['self', 'window', 'globalThis']);

const MAGIC_COMMENT_RE =
  /webpack(?:ChunkName|Mode|Prefetch|Preload|Ignore|Include|Exclude|Exports)|@?vite-ignore|viteIgnore/i;

type PropMatcher = string | ((name: string) => boolean);

function matchesPropName(name: string, matcher: PropMatcher): boolean {
  return typeof matcher === 'function' ? matcher(name) : name === matcher;
}

function isWebpackOrRspackChunkName(name: string): boolean {
  return name.startsWith('webpackChunk') || name.startsWith('__rspack_chunk');
}

function isWebpackModuleMap(node: any): boolean {
  if (
    !node ||
    node.type !== 'ObjectExpression' ||
    !Array.isArray(node.properties) ||
    node.properties.length === 0
  ) {
    return false;
  }
  return node.properties.some(
    (p: any) =>
      p?.type === 'Property' &&
      (p.value?.type === 'FunctionExpression' ||
        p.value?.type === 'ArrowFunctionExpression')
  );
}

function exemptWebpackPushArg(
  arg: any,
  exemptSubtreeRoots: WeakSet<acorn.Node>
): void {
  if (!arg || typeof arg !== 'object') return;
  if (isWebpackModuleMap(arg)) return;
  if (arg.type === 'ArrayExpression' && Array.isArray(arg.elements)) {
    const hasModuleMap = arg.elements.some((el: any) => isWebpackModuleMap(el));
    if (hasModuleMap) {
      for (const el of arg.elements) {
        if (el && typeof el === 'object' && !isWebpackModuleMap(el)) {
          exemptSubtreeRoots.add(el);
        }
      }
      return;
    }
  }
  exemptSubtreeRoots.add(arg);
}

function exemptTurbopackPropertyKeys(
  objNode: any,
  exemptSubtreeRoots: WeakSet<acorn.Node>
): void {
  if (!Array.isArray(objNode?.properties)) return;
  for (const prop of objNode.properties) {
    if (prop?.type === 'Property' && prop.key && typeof prop.key === 'object') {
      exemptSubtreeRoots.add(prop.key);
    }
  }
}

function exemptTurbopackPushArg(
  arg: any,
  exemptSubtreeRoots: WeakSet<acorn.Node>
): void {
  if (!arg || typeof arg !== 'object') return;
  if (arg.type === 'ArrayExpression' && Array.isArray(arg.elements)) {
    for (let i = 0; i < arg.elements.length; i++) {
      const el = arg.elements[i];
      if (!el || typeof el !== 'object') continue;
      if (i === 0) {
        // Exempt chunk header element (e.g. document.currentScript ternary or chunk path)
        exemptSubtreeRoots.add(el);
        continue;
      }
      if (el.type === 'Literal') {
        // Exempt module ID or chunk path literal
        exemptSubtreeRoots.add(el);
      } else if (el.type === 'ObjectExpression') {
        // Exempt only module-map keys so module factory functions remain protected
        exemptTurbopackPropertyKeys(el, exemptSubtreeRoots);
      } else if (
        el.type === 'FunctionExpression' ||
        el.type === 'ArrowFunctionExpression'
      ) {
        // Flat tuple [script, id, fn, ...]: keep factory body inside vault scope
        continue;
      }
    }
    return;
  }
  if (arg.type === 'ObjectExpression') {
    exemptTurbopackPropertyKeys(arg, exemptSubtreeRoots);
    return;
  }
  if (
    arg.type === 'FunctionExpression' ||
    arg.type === 'ArrowFunctionExpression'
  ) {
    return;
  }
  exemptSubtreeRoots.add(arg);
}

function isHostMember(node: any, matcher: PropMatcher): boolean {
  if (!node) return false;
  if (node.type === 'Identifier' && matchesPropName(node.name, matcher)) {
    return true;
  }
  if (
    node.type === 'MemberExpression' &&
    ((node.object?.type === 'Identifier' && GLOBAL_HOSTS.has(node.object.name)) ||
      node.object?.type === 'ThisExpression')
  ) {
    if (!node.computed && node.property?.type === 'Identifier') {
      return matchesPropName(node.property.name, matcher);
    }
    if (
      node.computed &&
      node.property?.type === 'Literal' &&
      typeof node.property.value === 'string'
    ) {
      return matchesPropName(node.property.value, matcher);
    }
  }
  return false;
}

function unwrapAssignedHostMember(
  node: any,
  matcher: PropMatcher,
  depth = 0
): boolean {
  if (!node || depth > 16) return false;
  if (isHostMember(node, matcher)) return true;
  switch (node.type) {
    case 'ParenthesizedExpression':
      return unwrapAssignedHostMember(node.expression, matcher, depth + 1);
    case 'AssignmentExpression':
      return (
        unwrapAssignedHostMember(node.left, matcher, depth + 1) ||
        unwrapAssignedHostMember(node.right, matcher, depth + 1)
      );
    case 'LogicalExpression':
      return (
        unwrapAssignedHostMember(node.left, matcher, depth + 1) ||
        unwrapAssignedHostMember(node.right, matcher, depth + 1)
      );
    case 'SequenceExpression':
      return (
        Array.isArray(node.expressions) &&
        node.expressions.some((expr: any) =>
          unwrapAssignedHostMember(expr, matcher, depth + 1)
        )
      );
    case 'ConditionalExpression':
      return (
        unwrapAssignedHostMember(node.consequent, matcher, depth + 1) ||
        unwrapAssignedHostMember(node.alternate, matcher, depth + 1)
      );
    default:
      return false;
  }
}

function isImportMetaMember(node: any, propName: string): boolean {
  if (!node || node.type !== 'MemberExpression') return false;
  const obj = node.object;
  if (
    obj?.type !== 'MetaProperty' ||
    obj.meta?.type !== 'Identifier' ||
    obj.meta.name !== 'import' ||
    obj.property?.type !== 'Identifier' ||
    obj.property.name !== 'meta'
  ) {
    return false;
  }
  if (!node.computed && node.property?.type === 'Identifier') {
    return node.property.name === propName;
  }
  return (
    node.computed &&
    node.property?.type === 'Literal' &&
    node.property.value === propName
  );
}

function isRequireResolveCallee(callee: any): boolean {
  if (!callee || callee.type !== 'MemberExpression') return false;
  if (callee.object?.type !== 'Identifier' || callee.object.name !== 'require') {
    return false;
  }
  if (!callee.computed && callee.property?.type === 'Identifier') {
    return callee.property.name === 'resolve';
  }
  return (
    callee.computed &&
    callee.property?.type === 'Literal' &&
    callee.property.value === 'resolve'
  );
}

/**
 * Returns true when a Literal or TemplateLiteral sits in a static module specifier,
 * ES2022 string import/export binding, bundler asset URL, or require/resolve call
 * that must stay literal for bundlers, packagers, and module linkers.
 */
export function isStaticModuleOrAssetPosition(node: any, parent: any): boolean {
  if (!node || !parent) return false;

  if (
    parent.type === 'ImportDeclaration' ||
    parent.type === 'ExportNamedDeclaration'
  ) {
    return parent.source === node;
  }
  if (parent.type === 'ExportAllDeclaration') {
    return parent.source === node || parent.exported === node;
  }
  if (parent.type === 'ImportExpression') {
    return parent.source === node;
  }
  if (parent.type === 'ImportSpecifier') {
    return parent.imported === node;
  }
  if (parent.type === 'ExportSpecifier') {
    return parent.local === node || parent.exported === node;
  }
  if (parent.type === 'ImportAttribute') {
    return true;
  }

  if (parent.type === 'NewExpression') {
    return (
      parent.callee?.type === 'Identifier' &&
      parent.callee.name === 'URL' &&
      Array.isArray(parent.arguments) &&
      parent.arguments.length >= 2 &&
      parent.arguments[0] === node &&
      isImportMetaMember(parent.arguments[1], 'url')
    );
  }

  if (parent.type === 'CallExpression') {
    if (!Array.isArray(parent.arguments) || parent.arguments[0] !== node) {
      return false;
    }
    const callee = parent.callee;
    if (isImportMetaMember(callee, 'resolve')) return true;
    if (isRequireResolveCallee(callee)) return true;
    if (callee?.type === 'Identifier' && callee.name === 'require') return true;
  }

  return false;
}

/**
 * Single-pass Acorn AST boundary classifier for Next.js RSC flight payloads,
 * Turbopack bootstrap blocks, Vite preload manifests, and dynamic import() sources.
 */
export function classifyChunkBoundary(ast: acorn.Program): BoundaryClassification {
  const exemptSubtreeRoots = new WeakSet<acorn.Node>();
  const importSourceNodes = new WeakSet<acorn.Node>();
  const importExpressions: any[] = [];

  let hasEntryBootstrap = false;
  let hasRscFlight = false;
  let hasPreloadManifest = false;

  walk.simple(ast, {
    CallExpression(node: any) {
      const firstArg = Array.isArray(node.arguments)
        ? node.arguments[0]
        : undefined;
      if (
        firstArg &&
        (firstArg.type === 'Literal' || firstArg.type === 'TemplateLiteral') &&
        isStaticModuleOrAssetPosition(firstArg, node)
      ) {
        exemptSubtreeRoots.add(firstArg);
      }

      const callee = node.callee;
      const isPushCall =
        callee?.type === 'MemberExpression' &&
        ((!callee.computed &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'push') ||
          (callee.computed &&
            callee.property?.type === 'Literal' &&
            callee.property.value === 'push'));
      if (isPushCall) {
        if (unwrapAssignedHostMember(callee.object, '__next_f')) {
          hasRscFlight = true;
          if (Array.isArray(node.arguments)) {
            for (const arg of node.arguments) {
              if (arg && typeof arg === 'object') {
                exemptSubtreeRoots.add(arg);
              }
            }
          }
        } else if (unwrapAssignedHostMember(callee.object, 'TURBOPACK')) {
          hasEntryBootstrap = true;
          exemptSubtreeRoots.add(callee);
          if (callee.object && typeof callee.object === 'object') {
            exemptSubtreeRoots.add(callee.object);
          }
          if (Array.isArray(node.arguments)) {
            for (const arg of node.arguments) {
              exemptTurbopackPushArg(arg, exemptSubtreeRoots);
            }
          }
        } else if (
          unwrapAssignedHostMember(callee.object, isWebpackOrRspackChunkName)
        ) {
          hasEntryBootstrap = true;
          exemptSubtreeRoots.add(callee);
          if (callee.object && typeof callee.object === 'object') {
            exemptSubtreeRoots.add(callee.object);
          }
          if (Array.isArray(node.arguments)) {
            for (const arg of node.arguments) {
              exemptWebpackPushArg(arg, exemptSubtreeRoots);
            }
          }
        }
      }
    },

    AssignmentExpression(node: any) {
      if (
        isHostMember(node.left, 'TURBOPACK') ||
        isHostMember(node.left, isWebpackOrRspackChunkName)
      ) {
        hasEntryBootstrap = true;
        exemptSubtreeRoots.add(node);
      } else if (
        node.left?.type === 'Identifier' &&
        node.left.name === '__vite__mapDeps'
      ) {
        hasPreloadManifest = true;
        exemptSubtreeRoots.add(node);
      }
    },

    VariableDeclarator(node: any) {
      if (node.id?.type === 'Identifier') {
        if (node.id.name === '__vite__mapDeps') {
          hasPreloadManifest = true;
          exemptSubtreeRoots.add(node);
        } else if (node.id.name === 'TURBOPACK') {
          hasEntryBootstrap = true;
          exemptSubtreeRoots.add(node);
        }
      }
    },

    FunctionDeclaration(node: any) {
      if (node.id?.type === 'Identifier' && node.id.name === '__vite__mapDeps') {
        hasPreloadManifest = true;
        exemptSubtreeRoots.add(node);
      }
    },

    NewExpression(node: any) {
      const firstArg = Array.isArray(node.arguments)
        ? node.arguments[0]
        : undefined;
      if (
        firstArg &&
        (firstArg.type === 'Literal' || firstArg.type === 'TemplateLiteral') &&
        isStaticModuleOrAssetPosition(firstArg, node)
      ) {
        exemptSubtreeRoots.add(firstArg);
      }
    },

    ImportDeclaration(node: any) {
      if (node.source && typeof node.source === 'object') {
        exemptSubtreeRoots.add(node.source);
      }
      if (Array.isArray(node.specifiers)) {
        for (const spec of node.specifiers) {
          if (
            spec?.type === 'ImportSpecifier' &&
            spec.imported?.type === 'Literal'
          ) {
            exemptSubtreeRoots.add(spec.imported);
          }
        }
      }
    },

    ExportNamedDeclaration(node: any) {
      if (node.source && typeof node.source === 'object') {
        exemptSubtreeRoots.add(node.source);
      }
      if (Array.isArray(node.specifiers)) {
        for (const spec of node.specifiers) {
          if (spec?.type === 'ExportSpecifier') {
            if (spec.local?.type === 'Literal') {
              exemptSubtreeRoots.add(spec.local);
            }
            if (spec.exported?.type === 'Literal') {
              exemptSubtreeRoots.add(spec.exported);
            }
          }
        }
      }
    },

    ExportAllDeclaration(node: any) {
      if (node.source && typeof node.source === 'object') {
        exemptSubtreeRoots.add(node.source);
      }
      if (node.exported && typeof node.exported === 'object') {
        exemptSubtreeRoots.add(node.exported);
      }
    },

    ImportExpression(node: any) {
      importExpressions.push(node);
      if (node.source && typeof node.source === 'object') {
        exemptSubtreeRoots.add(node.source);
        importSourceNodes.add(node.source);
      }
    },
  });

  let kind: ChunkBoundaryKind = 'app-chunk';
  if (hasEntryBootstrap) {
    kind = 'entry-bootstrap';
  } else if (hasRscFlight) {
    kind = 'rsc-flight';
  } else if (hasPreloadManifest) {
    kind = 'preload-manifest';
  }

  return {
    kind,
    exemptSubtreeRoots,
    importSourceNodes,
    importExpressions,
  };
}

/**
 * Checks whether any ancestor of the current AST node is an exempted subtree root.
 */
export function isNodeInExemptSubtree(
  ancestors: acorn.Node[],
  exemptRoots?: WeakSet<acorn.Node>
): boolean {
  if (!exemptRoots) return false;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (exemptRoots.has(ancestors[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Attaches bundler magic comments (webpackChunkName, @vite-ignore, etc.)
 * found inside `import(...)` expressions onto `ImportExpression.source.comments`
 * so compact codegen preserves them.
 */
export function attachMagicComments(
  importExpressions: any[],
  comments: acorn.Comment[]
): void {
  if (importExpressions.length === 0 || comments.length === 0) return;

  const magicComments = comments.filter((c) => MAGIC_COMMENT_RE.test(c.value));
  if (magicComments.length === 0) return;

  for (const expr of importExpressions) {
    const src = expr?.source;
    if (!src || typeof expr.start !== 'number' || typeof src.start !== 'number') {
      continue;
    }
    const matched = magicComments.filter(
      (c) => c.start >= expr.start && c.end <= src.start
    );
    if (matched.length > 0) {
      src.comments = matched.map((c) => ({ type: c.type, value: c.value }));
    }
  }
}
