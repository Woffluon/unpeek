import type * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { ScrubberOptions } from './types.js';
import { isNodeInExemptSubtree } from './boundary-classifier.js';

const FILE_URI_USER_RE =
  /file:\/\/\/(?:[A-Za-z]:\/)?(?:Users|home)\/[^/\s"'`]+\/([^\s"'`]+)/gi;
const FILE_URI_LOCAL_RE = /file:\/\/\/(?:[A-Za-z]:\/)?([^\s"'`]+)/gi;
const POSIX_USER_PATH_RE = /\/?(?:Users|home)\/[^/\s"'`]+\/([^\s"'`]+)/g;
const WIN_USER_PATH_RE =
  /[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s"'`]+\\{1,2}([^\s"'`]+)/g;
const PROTECTED_URL_OR_ASSET_RE =
  /(?:https?:\/\/[^\s"'`]+|(?:\/assets\/|\/_next\/static\/)[^\s"'`]*)/gi;

function escapeTemplateRaw(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function scrubStringValue(val: string, rootDir?: string): string {
  // Fast-path: avoid regex work on strings with no path/URI markers
  if (
    !val.includes('/') &&
    !val.includes('\\') &&
    !val.includes('file:')
  ) {
    return val;
  }

  // Temporarily shield https://, http://, /assets/, /_next/static/ segments
  const shielded: string[] = [];
  let out = val.replace(PROTECTED_URL_OR_ASSET_RE, (match) => {
    const token = `\u0000_UP_SHIELD_${shielded.length}_\u0000`;
    shielded.push(match);
    return token;
  });

  out = out.replace(FILE_URI_USER_RE, (_m, tail: string) => `[src]/${tail}`);
  out = out.replace(FILE_URI_LOCAL_RE, (_m, tail: string) => `[src]/${tail}`);
  out = out.replace(POSIX_USER_PATH_RE, (_m, tail: string) => `[src]/${tail}`);
  out = out.replace(
    WIN_USER_PATH_RE,
    (_m, tail: string) => `[src]/${tail.replace(/\\+/g, '/')}`
  );

  if (rootDir && rootDir.length > 1) {
    const normalizedRoot = rootDir.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedRoot.length > 1) {
      if (out.includes(normalizedRoot + '/')) {
        out = out.split(normalizedRoot + '/').join('[src]/');
      }
      const winRoot = normalizedRoot.replace(/\//g, '\\');
      if (out.includes(winRoot + '\\')) {
        out = out.split(winRoot + '\\').join('[src]/');
      }
    }
  }

  if (shielded.length > 0) {
    out = out.replace(
      /\u0000_UP_SHIELD_(\d+)_\u0000/g,
      (_m, idxStr: string) => shielded[Number(idxStr)] ?? ''
    );
  }

  return out;
}

/**
 * Scrubs CWE-540 residual local filesystem paths (POSIX/Windows user paths, file:/// URIs)
 * from Literal strings and TemplateLiteral quasis, respecting hot-path and boundary exemptions.
 */
export function scrubResidualPaths(
  ast: acorn.Program,
  options: ScrubberOptions = {},
  hotExemptNodes?: WeakSet<acorn.Node>,
  exemptSubtreeRoots?: WeakSet<acorn.Node>
): number {
  const exemptSet = options.exemptStrings
    ? new Set(options.exemptStrings)
    : undefined;
  let scrubbedCount = 0;

  walk.ancestor(ast, {
    Literal(node: any, _state: any, ancestors: acorn.Node[]) {
      if (node.regex || typeof node.value !== 'string') return;
      const val: string = node.value;
      if (exemptSet?.has(val)) return;

      const parent = ancestors[ancestors.length - 2] as any;
      if (!parent) return;

      if (
        (parent.type === 'ImportDeclaration' ||
          parent.type === 'ExportNamedDeclaration' ||
          parent.type === 'ExportAllDeclaration' ||
          parent.type === 'ImportExpression') &&
        parent.source === node
      ) {
        return;
      }

      if (
        parent.type === 'ExpressionStatement' &&
        Boolean(parent.directive)
      ) {
        return;
      }

      if (
        isNodeInExemptSubtree(ancestors, hotExemptNodes) ||
        isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)
      ) {
        return;
      }

      const scrubbed = scrubStringValue(val, options.rootDir);
      if (scrubbed !== val) {
        node.value = scrubbed;
        node.raw = JSON.stringify(scrubbed);
        scrubbedCount++;
      }
    },

    TemplateLiteral(node: any, _state: any, ancestors: acorn.Node[]) {
      if (!Array.isArray(node.quasis)) return;
      if (
        isNodeInExemptSubtree(ancestors, hotExemptNodes) ||
        isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)
      ) {
        return;
      }

      const parent = ancestors[ancestors.length - 2] as any;
      if (parent?.type === 'ImportExpression' && parent.source === node) {
        return;
      }

      for (const quasi of node.quasis) {
        const val: string | undefined =
          quasi?.value?.cooked ?? quasi?.value?.raw;
        if (typeof val !== 'string' || exemptSet?.has(val)) continue;
        const scrubbed = scrubStringValue(val, options.rootDir);
        if (scrubbed !== val) {
          quasi.value.cooked = scrubbed;
          quasi.value.raw = escapeTemplateRaw(scrubbed);
          scrubbedCount++;
        }
      }
    },
  });

  return scrubbedCount;
}
