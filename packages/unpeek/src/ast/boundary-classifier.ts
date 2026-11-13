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

function isHostMember(node: any, propName: string): boolean {
  if (!node) return false;
  if (node.type === 'Identifier' && node.name === propName) {
    return true;
  }
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    GLOBAL_HOSTS.has(node.object.name) &&
    node.property?.type === 'Identifier' &&
    node.property.name === propName
  ) {
    return true;
  }
  return false;
}

function unwrapAssignedHostMember(node: any, propName: string): boolean {
  if (!node) return false;
  if (isHostMember(node, propName)) return true;
  if (node.type === 'AssignmentExpression' && isHostMember(node.left, propName)) {
    return true;
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
      const callee = node.callee;
      if (
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property?.type === 'Identifier' &&
        callee.property.name === 'push'
      ) {
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
          exemptSubtreeRoots.add(node);
          if (Array.isArray(node.arguments)) {
            for (const arg of node.arguments) {
              if (arg && typeof arg === 'object') {
                exemptSubtreeRoots.add(arg);
              }
            }
          }
        }
      }
    },

    AssignmentExpression(node: any) {
      if (isHostMember(node.left, 'TURBOPACK')) {
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
