import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { computeFnv1aHash, SAFE_ALPHA } from './string-vault.js';
import { fallbackKdf, injectWasmVault } from './wasm-vault.js';

const DIRECTIVE_STRINGS = new Set([
  'use strict',
  'use client',
  'use server',
  'use asm',
]);

export interface SaltedVaultResult {
  encryptedStringsCount: number;
  integrityToken: number;
  vaultVarName: string;
  decryptFnName: string;
}

/**
 * Computes deterministic 8-bit call-site salt for lazy string resolution.
 */
export function computeCallSiteSalt(seed: number, idx: number): number {
  return (((seed & 15) ^ (idx * 5) + 3) & 31) >>> 0;
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
  const fBody = `var memo=[];var s=Function.prototype.toString,w=typeof window!=='undefined'&&window,src=s.call(f);for(var h=0x811c9dc5,j=0;j<src.length;j++)h=Math.imul(h^src.charCodeAt(j),0x01000193)>>>0;var rot=(h^((""._u||a._u||0))^(w?(w['${windowKeySymbol}']!=null?w['${windowKeySymbol}']:0):${expectedDelta}))&31;var A="${safeAlpha}",P="${pChars}";return function(i,s){if(memo[i]!==void 0)return memo[i];var p=a[i];if(!p)return "";var o="";for(var j=0;j<p.length;j++){var c=p.charAt(j),k=A.indexOf(c);if(k<0){o+=c;}else{var y=(k-s+rot+9200)%92;var z=A.indexOf(P.charAt(y));o+=A.charAt((z-rot+9200)%92);}}return(memo[i]=o);};`;

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
 * Encodes a string literal with a 32-bit KDF key using periodic XOR.
 */
export function encodeSaltedString(str: string, k: number): string {
  let out = '';
  for (let j = 0; j < str.length; j++) {
    const code = str.charCodeAt(j);
    const mask = ((k >>> (j % 24)) & 0x7f) | 1;
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
  hotExemptNodes?: WeakSet<acorn.Node>
): SaltedVaultResult {
  if (isAstAlreadySalted(ast)) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('already-salted', seed),
      vaultVarName: '',
      decryptFnName: '',
    };
  }

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
      if (node.value.length < minStringLength) return;
      if (DIRECTIVE_STRINGS.has(node.value)) return;

      const parent = ancestors[ancestors.length - 2];
      if (!parent) return;

      // Do not encrypt module import/export source paths
      if (
        (parent.type === 'ImportDeclaration' ||
          parent.type === 'ExportNamedDeclaration' ||
          parent.type === 'ExportAllDeclaration') &&
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

  // Injected lazy idempotent decryptor helper
  const helperSnippet = `var ${vaultVarName} = ${serializedTable};
var ${cacheVarName} = [];
function ${decryptFnName}(i, s) {
  if (${cacheVarName}[i] !== void 0) return ${cacheVarName}[i];
  var d = typeof window !== 'undefined' && window.__unpeek_delta != null ? window.__unpeek_delta : 0;
  var k = ${kdfFnName}(i, s, d);
  var p = ${vaultVarName}[i], o = '';
  for (var j = 0; j < p.length; j++) {
    o += String.fromCharCode(p.charCodeAt(j) ^ (((k >>> (j % 24)) & 127) | 1));
  }
  return (${cacheVarName}[i] = o);
}`;

  const parsedHelper = acorn.parse(helperSnippet, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  }) as acorn.Program;

  ast.body.unshift(...(parsedHelper.body as any[]));

  return {
    encryptedStringsCount: targetsToReplace.length,
    integrityToken,
    vaultVarName,
    decryptFnName,
  };
}
