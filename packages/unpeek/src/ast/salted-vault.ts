import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { UnpeekConfig } from '../types.js';
import {
  computeFnv1aHash,
  SAFE_ALPHA,
  DIRECTIVE_STRINGS,
  isReservedProp,
  isTailwindNoise,
  isSvgPathString,
} from './string-vault.js';
import { fallbackKdf, injectWasmVault } from './wasm-vault.js';
import { deriveWindowKeySymbol } from '../runtime/index.js';

export interface SaltedVaultResult {
  encryptedStringsCount: number;
  integrityToken: number;
  vaultVarName: string;
  decryptFnName: string;
}

/**
 * Computes deterministic 5-bit call-site salt for lazy string resolution.
 */
export function computeCallSiteSalt(seed: number, idx: number): number {
  return (
    ((Math.imul((seed ^ idx) >>> 0, 0x9e3779b1) ^
      Math.imul((idx + 1) >>> 0, 0x45d9f3b)) &
      31) >>>
    0
  );
}

/**
 * Creates the compact lazy-memoized decryptor function AST for Layer 1 on-demand resolution.
 */
export function createSaltedDecryptorFnAst(
  seed: number,
  pChars: string,
  expectedDelta: number,
  windowKeySymbol: string,
  safeAlpha = SAFE_ALPHA
): any {
  const maskA = (computeFnv1aHash('delta-a', seed) & 0xffff) | 1;
  const maskB = ((expectedDelta & 0xffff) ^ maskA) & 0xffff;
  const propAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(windowKeySymbol)
    ? `.${windowKeySymbol}`
    : `[${JSON.stringify(windowKeySymbol)}]`;
  const fBody = `var m=[],w=typeof window!=='undefined'?window:typeof self!=='undefined'?self:0,G=typeof globalThis!=='undefined'?globalThis:w||this,c=Function.prototype.toString.call(f),z=+!String;for(var h=0x811c9dc5,j=0;j<c.length;j++)h=Math.imul(h^c.charCodeAt(j),0x01000193)>>>0;var d=G${propAccess}!=null?G${propAccess}:w?0:(z|${maskA})^${maskB},q=(h^(""._u||a._u||0)^d)>>>0,A="${safeAlpha}",P="${pChars}";return function(i,s){if(i in m)return m[i];var p=a[i],o="";if(p)for(var t=q^s^Math.imul(i+1,0x01000193),j=0;j<p.length;j++){t=Math.imul(t^j+1,0x01000193)^0x811c9dc5;var c=p[j],k=A.indexOf(c);o+=k<0?c:A[(A.indexOf(P[(k-(t&65535)%92+92)%92])-(t>>>16)%92+92)%92];}return m[i]=o;};`;

  return (
    acorn.parse(`(function f(a){${fBody}})`, {
      ecmaVersion: 'latest',
      sourceType: 'script',
    }) as any
  ).body[0].expression;
}

/**
 * Creates the VariableDeclaration AST defining the compact _uD(index, salt) decryptor helper.
 */
export function createSaltedVaultHelperAst(
  decryptFnName: string,
  encryptedPayloads: string[],
  fnAst: any
): any {
  return {
    type: 'VariableDeclaration',
    kind: 'var',
    declarations: [
      {
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: decryptFnName },
        init: {
          type: 'CallExpression',
          callee: fnAst,
          arguments: [
            {
              type: 'ArrayExpression',
              elements: encryptedPayloads.map((str) => ({
                type: 'Literal',
                value: str,
                raw: JSON.stringify(str),
              })),
            },
          ],
          optional: false,
        },
      },
    ],
  };
}

/**
 * Encodes a string literal with a 32-bit KDF key using a per-character rolling keystream.
 */
export function encodeSaltedString(str: string, k: number): string {
  let out = '';
  let rk = k | 0;
  for (let j = 0; j < str.length; j++) {
    rk = (Math.imul(rk ^ (j + 1), 0x45d9f3b) + 0x9e3779b9) | 0;
    const code = str.charCodeAt(j);
    const mask = ((rk >>> 16) & 0x7f) | 1;
    out += String.fromCharCode(code ^ mask);
  }
  return out;
}

/**
 * Decodes a salted payload with a 32-bit KDF key.
 */
export function decodeSaltedString(payload: string, k: number): string {
  return encodeSaltedString(payload, k);
}

function isAstAlreadySalted(ast: acorn.Program): boolean {
  if (!ast || !Array.isArray(ast.body)) return false;
  return ast.body.some((stmt: any) => {
    if (
      stmt.type === 'VariableDeclaration' &&
      stmt.declarations?.some(
        (d: any) =>
          d.id?.type === 'Identifier' &&
          typeof d.id.name === 'string' &&
          d.id.name.startsWith('_uP')
      )
    ) {
      return true;
    }
    return false;
  });
}

function replaceNodeInParent(parent: any, oldNode: any, newNode: any): boolean {
  if (!parent) return false;
  for (const key of Object.keys(parent)) {
    const val = parent[key];
    if (val === oldNode) {
      parent[key] = newNode;
      return true;
    }
    if (Array.isArray(val)) {
      const idx = val.indexOf(oldNode);
      if (idx !== -1) {
        val[idx] = newNode;
        return true;
      }
    }
  }
  return false;
}

/**
 * Applies idempotent call-site salted lazy string vaulting in Layer 2 (--aggressive).
 * Each eligible string access site receives a deterministic static salt constant and is transformed
 * into a _uD(idx, localSalt) call.
 * Operates with 100% idempotence and order-independence under React 19 Concurrent Mode
 * and StrictMode double-mounting.
 */
export function applySaltedStringVault(
  ast: acorn.Program,
  seed = 0x9e3779b9,
  minStringLength = 4,
  hotExemptNodes?: WeakSet<acorn.Node>,
  config?: UnpeekConfig
): SaltedVaultResult {
  if (isAstAlreadySalted(ast)) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('already-salted', seed),
      vaultVarName: '',
      decryptFnName: '',
    };
  }

  const minLen = config?.vault?.minStringLength ?? minStringLength;
  const activeDirectives = new Set(DIRECTIVE_STRINGS);
  if (config?.vault?.customDirectives) {
    for (const dir of config.vault.customDirectives) {
      activeDirectives.add(dir);
    }
  }

  const customReserved = config?.vault?.reservedProps
    ? new Set(config.vault.reservedProps)
    : undefined;

  interface TargetEntry {
    node: any;
    parent: any;
    callSiteIdx: number;
    localSalt: number;
    rawString: string;
  }

  const targetsToReplace: TargetEntry[] = [];
  const encryptedPayloads: string[] = [];

  walk.ancestor(ast, {
    Literal(node: any, ancestors: any[]) {
      if (typeof node.value !== 'string') return;
      if (node.value.length < minLen) return;
      if (activeDirectives.has(node.value)) return;

      const parent = ancestors[ancestors.length - 2];
      if (!parent) return;

      if (
        parent.type === 'ExpressionStatement' &&
        (Boolean(parent.directive) || activeDirectives.has(node.value))
      ) {
        return;
      }

      for (let i = ancestors.length - 2; i >= 0; i--) {
        if (
          ancestors[i].type === 'ExpressionStatement' &&
          Boolean((ancestors[i] as any).directive)
        ) {
          return;
        }
      }

      // Do not encrypt module import/export source paths
      if (
        (parent.type === 'ImportDeclaration' ||
          parent.type === 'ExportNamedDeclaration' ||
          parent.type === 'ExportAllDeclaration' ||
          parent.type === 'ImportExpression') &&
        parent.source === node
      ) {
        return;
      }

      // Do not encrypt uncomputed object keys or class members
      if (parent.type === 'Property' && parent.key === node && !parent.computed) {
        return;
      }
      if (
        (parent.type === 'MethodDefinition' ||
          parent.type === 'PropertyDefinition') &&
        parent.key === node &&
        !parent.computed
      ) {
        return;
      }

      // Skip nodes marked hot-exempt
      if (hotExemptNodes) {
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (hotExemptNodes.has(ancestors[i])) {
            return;
          }
        }
      }

      if (isReservedProp(node.value, customReserved)) return;
      if (isTailwindNoise(node.value)) return;
      if (isSvgPathString(node.value, parent)) return;

      const callSiteIdx = targetsToReplace.length;
      const localSalt =
        (computeFnv1aHash(`salt:${seed}:${callSiteIdx}`, seed) & 0x7fffffff) | 1;

      targetsToReplace.push({
        node,
        parent,
        callSiteIdx,
        localSalt,
        rawString: node.value,
      });
    },
  });

  if (targetsToReplace.length === 0) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('empty-salted', seed),
      vaultVarName: '',
      decryptFnName: '',
    };
  }

  // Ensure WebAssembly KDF key generator is injected
  const wasmResult = injectWasmVault(ast, seed);
  const kdfFnName = wasmResult.kdfFnName;

  const suffix = computeFnv1aHash(`salted:${seed}`, seed).toString(36);
  const vaultVarName = `_uP${suffix}`;
  const cacheVarName = `_uCache${suffix}`;
  const decryptFnName = `_uD${suffix}`;

  // Encrypt each call site with its individual static callSiteSalt
  for (const target of targetsToReplace) {
    const k = fallbackKdf(target.callSiteIdx, target.localSalt, 0, seed);
    encryptedPayloads.push(encodeSaltedString(target.rawString, k));

    const callExpr: any = {
      type: 'CallExpression',
      callee: {
        type: 'Identifier',
        name: decryptFnName,
      },
      arguments: [
        {
          type: 'Literal',
          value: target.callSiteIdx,
          raw: String(target.callSiteIdx),
        },
        {
          type: 'Literal',
          value: target.localSalt,
          raw: String(target.localSalt),
        },
      ],
      optional: false,
    };

    replaceNodeInParent(target.parent, target.node, callExpr);
  }

  const serializedTable = JSON.stringify(encryptedPayloads);
  const integrityToken = computeFnv1aHash(serializedTable, seed);

  const sym = deriveWindowKeySymbol(seed);

  // Injected lazy idempotent decryptor helper
  const helperSnippet = `var ${vaultVarName} = ${serializedTable};
var ${cacheVarName} = [];
function ${decryptFnName}(i, s) {
  if (${cacheVarName}[i] !== void 0) return ${cacheVarName}[i];
  var G = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
  var d = G && G.__unpeek_delta != null ? G.__unpeek_delta : 0;
  var k = ${kdfFnName}(i, s, d);
  var p = ${vaultVarName}[i], o = '', rk = k | 0;
  for (var j = 0; j < p.length; j++) {
    rk = (Math.imul(rk ^ (j + 1), 0x45d9f3b) + 0x9e3779b9) | 0;
    o += String.fromCharCode(p.charCodeAt(j) ^ (((rk >>> 16) & 127) | 1));
  }
  return (${cacheVarName}[i] = o);
}`;

  const parsedHelper = acorn.parse(helperSnippet, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  }) as acorn.Program;

  let insertIdx = 0;
  while (insertIdx < ast.body.length) {
    const stmt: any = ast.body[insertIdx];
    const isDirective =
      stmt.type === 'ExpressionStatement' &&
      (Boolean(stmt.directive) ||
        (stmt.expression?.type === 'Literal' &&
          typeof stmt.expression.value === 'string' &&
          (activeDirectives.has(stmt.expression.value) ||
            /^(?:use\s+[a-zA-Z0-9_-]+)/.test(stmt.expression.value.trim()))));
    if (isDirective || stmt.type === 'ImportDeclaration') {
      insertIdx++;
    } else {
      break;
    }
  }

  ast.body.splice(insertIdx, 0, ...(parsedHelper.body as any[]));

  return {
    encryptedStringsCount: targetsToReplace.length,
    integrityToken,
    vaultVarName,
    decryptFnName,
  };
}
