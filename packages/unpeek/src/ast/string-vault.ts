import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const DIRECTIVE_STRINGS = new Set([
  'use strict',
  'use client',
  'use server',
  'use asm',
]);

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
  minStringLength = 4
): StringVaultResult {
  const suffix = ((seed >>> 0) % 0xff).toString(36);
  const cacheVarName = `_uC${suffix}`;
  const mask = ((seed >>> 0) & 0x1e) | 3;
  const step = (((seed >>> 5) & 7) * 2) + 3;

  const stringToIndex = new Map<string, number>();
  const encryptedPayloads: string[] = [];
  const targetsToReplace: { node: any }[] = [];

  walk.ancestor(ast, {
    Literal(node: any, _state, ancestors) {
      if (typeof node.value !== 'string') return;
      const val: string = node.value;
      if (val.length < minStringLength) return;
      if (DIRECTIVE_STRINGS.has(val)) return;

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

      // Skip object/class property keys and import/export attributes
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
      targetsToReplace.push({ node });
    },
  });

  if (targetsToReplace.length === 0 || encryptedPayloads.length === 0) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('empty', seed),
    };
  }

  for (const { node } of targetsToReplace) {
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

  const serializedTable = JSON.stringify(encryptedPayloads);
  const integrityToken = computeFnv1aHash(serializedTable, seed);

  // Decrypt once into const _uC array at module initialization so V8 marks the ContextCell kConst
  const helperSource = `
const ${cacheVarName} = ${serializedTable}.map(function(a) {
  var s = "";
  for (var j = 0; j < a.length; j++) {
    s += String.fromCharCode(a.charCodeAt(j) ^ (((${mask} ^ ((j & 1) * ${step})) & 30) | 1));
  }
  return s;
});
`.trim();

  const helperAst = acorn.parse(helperSource, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  });

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

  ast.body.splice(insertIdx, 0, ...(helperAst.body as any[]));

  return {
    encryptedStringsCount: encryptedPayloads.length,
    integrityToken,
  };
}
