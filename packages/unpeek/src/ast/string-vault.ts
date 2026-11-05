import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const DIRECTIVE_STRINGS = new Set([
  'use strict',
  'use client',
  'use server',
  'use asm',
]);

const HELPER_TEMPLATE = (acorn.parse(
  `var _ = (function f(a){var b=typeof Uint8Array!=='undefined'?new Uint8Array(a.length):0;return a.map(function(s){var o="";for(var j=0;j<s.length;j++)o+=String.fromCharCode(s.charCodeAt(j)^(((0^((a._u||/\\n/.test(f)*14)|((j&1)*0)))&30)|1));return o;});})([]);`,
  { ecmaVersion: 'latest', sourceType: 'script' }
) as any).body[0];

function createVaultHelperAst(
  cacheVarName: string,
  encryptedPayloads: string[],
  mask: number,
  step: number
): any {
  const node = structuredClone(HELPER_TEMPLATE);
  node.declarations[0].id.name = cacheVarName;
  node.declarations[0].init.arguments[0].elements = encryptedPayloads.map(
    (str) => ({
      type: 'Literal',
      value: str,
      raw: JSON.stringify(str),
    })
  );
  const outerFn = node.declarations[0].init.callee;
  const returnStmt = outerFn.body.body[1];
  const innerFn = returnStmt.argument.arguments[0];
  const forStmt = innerFn.body.body[1];
  const expr =
    forStmt.body.type === 'BlockStatement'
      ? forStmt.body.body[0].expression
      : forStmt.body.expression;
  const binaryXor = expr.right.arguments[0];
  const innerLeft = binaryXor.right.left.left;
  innerLeft.left.value = mask;
  innerLeft.left.raw = String(mask);
  innerLeft.right.right.right.value = step;
  innerLeft.right.right.right.raw = String(step);
  return node;
}

export function computeFnv1aHash(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface StringVaultResult {
  encryptedStringsCount: number;
  integrityToken: number;
}

function encodeStringWithSeed(str: string, mask: number, step: number): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Period-2 seed-polymorphic XOR scrambles all characters while preserving LZ77/Gzip compressibility
    const k = ((mask ^ ((i & 1) * step)) & 0x1e) | 1;
    out += String.fromCharCode(code ^ k);
  }
  return out;
}

export function applyStringVault(
  ast: acorn.Program,
  seed = 0x9e3779b9,
  minStringLength = 4,
  hotExemptNodes?: WeakSet<acorn.Node>
): StringVaultResult {
  const alreadyVaulted = ast.body.some(
    (stmt: any) =>
      stmt.type === 'VariableDeclaration' &&
      stmt.declarations?.some(
        (d: any) =>
          d.id?.type === 'Identifier' &&
          typeof d.id.name === 'string' &&
          d.id.name.startsWith('_uC')
      )
  );
  if (alreadyVaulted) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('already-vaulted', seed),
    };
  }

  const mask = ((seed >>> 0) & 0x1e) | 3;
  const step = 1;

  const stringToIndex = new Map<string, number>();
  const encryptedPayloads: string[] = [];
  const targetsToReplace: { node: any; parent?: any }[] = [];

  const customWalkBase = {
    ...walk.base,
    Property(node: any, st: any, c: any) {
      c(node.key, st);
      if (node.value) c(node.value, st);
    },
  };

  walk.ancestor(
    ast,
    {
      Literal(node: any, _state, ancestors) {
        if (typeof node.value !== 'string') return;
        const val: string = node.value;
        if (val.length < minStringLength) return;
        if (DIRECTIVE_STRINGS.has(val)) return;

        if (hotExemptNodes) {
          for (let i = ancestors.length - 2; i >= 0; i--) {
            if (hotExemptNodes.has(ancestors[i])) {
              return;
            }
          }
        }

        const parent = ancestors[ancestors.length - 2] as any;
        if (!parent) return;

        // Skip directives at top of program or function body
        if (parent.type === 'ExpressionStatement' && parent.directive) return;

        // Skip import/export source specifiers
        if (
          parent.type === 'ImportDeclaration' ||
          parent.type === 'ExportNamedDeclaration' ||
          parent.type === 'ExportAllDeclaration' ||
          parent.type === 'ImportExpression'
        ) {
          if (parent.source === node) return;
        }

        // Skip class property/method keys
        if (
          (parent.type === 'MethodDefinition' ||
            parent.type === 'PropertyDefinition') &&
          parent.key === node &&
          !parent.computed
        ) {
          return;
        }

        // Convert string literal object keys to computed properties: { "email": x } -> { [_uC[idx]]: x }
        if (parent.type === 'Property' && parent.key === node) {
          parent.computed = true;
        }

        if (
          parent.type === 'ImportAttribute' ||
          parent.type === 'ImportSpecifier' ||
          parent.type === 'ExportSpecifier'
        ) {
          return;
        }

        let idx = stringToIndex.get(val);
        if (idx === undefined) {
          idx = encryptedPayloads.length;
          stringToIndex.set(val, idx);
          encryptedPayloads.push(encodeStringWithSeed(val, mask, step));
        }
        targetsToReplace.push({ node, parent });
      },
    },
    customWalkBase
  );

  if (targetsToReplace.length === 0 || encryptedPayloads.length === 0) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('empty', seed),
    };
  }

  const serializedTable = JSON.stringify(encryptedPayloads);
  const integrityToken = computeFnv1aHash(serializedTable, seed);
  const suffix = computeFnv1aHash(`vault:${seed}`, integrityToken).toString(36);
  const cacheVarName = `_uC${suffix}`;

  for (const { node, parent } of targetsToReplace) {
    if (parent?.type === 'Property' && parent.key === node) {
      parent.computed = true;
    }
    const idx = stringToIndex.get(node.value)!;
    node.type = 'MemberExpression';
    node.object = {
      type: 'Identifier',
      name: cacheVarName,
    };
    node.property = {
      type: 'Literal',
      value: idx,
      raw: String(idx),
    };
    node.computed = true;
    node.optional = false;
    delete node.value;
    delete node.raw;
  }

  // Decrypt once into _uC array at module initialization for O(1) indexed reads
  const helperStmt = createVaultHelperAst(
    cacheVarName,
    encryptedPayloads,
    mask,
    step
  );

  let insertIdx = 0;
  while (insertIdx < ast.body.length) {
    const stmt: any = ast.body[insertIdx];
    const isDirective =
      stmt.type === 'ExpressionStatement' &&
      (stmt.directive ||
        (stmt.expression?.type === 'Literal' &&
          typeof stmt.expression.value === 'string' &&
          DIRECTIVE_STRINGS.has(stmt.expression.value)));
    if (isDirective || stmt.type === 'ImportDeclaration') {
      insertIdx++;
    } else {
      break;
    }
  }

  ast.body.splice(insertIdx, 0, helperStmt);

  return {
    encryptedStringsCount: encryptedPayloads.length,
    integrityToken,
  };
}
