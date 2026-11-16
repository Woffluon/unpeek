import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { DeterrentMode } from '../runtime/types.js';
import type { UnpeekConfig } from '../config.js';
import {
  computeFnv1aHash,
  computeCallSiteSalt64,
  invertRivestPoly32,
} from '../shared/hash.js';
import {
  SAFE_ALPHA,
  DIRECTIVE_STRINGS,
  isReservedProp,
  isTailwindNoise,
  isSvgPathString,
} from './string-vault.js';
import { generateCompactJs } from './codegen.js';
import { fallbackKdf, injectWasmVault } from './wasm-vault.js';
import { generateRuntimeShield } from '../runtime/index.js';
import { deriveWindowKeySymbol } from '../internal/runtime.js';
import { isNodeInExemptSubtree } from './boundary-classifier.js';

export interface SaltedVaultResult {
  encryptedStringsCount: number;
  integrityToken: number;
  vaultVarName: string;
  decryptFnName: string;
}

/**
 * Computes deterministic 31-bit positive call-site salt using full 64-bit mixing
 * for lazy string resolution.
 */
export function computeCallSiteSalt(seed: number, idx: number): number {
  const [lo, hi] = computeCallSiteSalt64(seed >>> 0, idx >>> 0, seed >>> 0);
  return (((lo ^ hi) & 0x7fffffff) | 1) >>> 0;
}

/**
 * Builds a non-linear Rivest degree-3 permutation polynomial runtime expression
 * that reconstructs the 16-bit expectedDelta without embedding raw delta or `maskA ^ maskB` literals.
 */
function buildRivestDeltaExpr(seed: number, expectedDelta: number, varName = '_ed'): string {
  const s = seed >>> 0;
  const rA0 = computeFnv1aHash(`riv-a0:${s}`, s) | 0;
  const rA1 = computeFnv1aHash(`riv-a1:${s}`, s) | 1;
  const rA2 = computeFnv1aHash(`riv-a2:${s}`, s) & ~1;
  const rA3 = computeFnv1aHash(`riv-a3:${s}`, s) & ~1;
  const hiTag = (computeFnv1aHash(`riv-hi:${s}`, s) & 0xffff) << 16;
  const target32 = (hiTag | (expectedDelta & 0xffff)) >>> 0;
  const xEnc = invertRivestPoly32(target32, rA0, rA1, rA2, rA3);
  const xMask = computeFnv1aHash(`riv-xm:${s}`, s) >>> 0;
  const xMasked = (xEnc ^ xMask) | 0;
  return `var _rx=(${xMasked}^${xMask | 0})|0,${varName}=(${rA0}+Math.imul(_rx,(${rA1}+Math.imul(_rx,(${rA2}+Math.imul(${rA3},_rx))|0))|0))&65535;`;
}

/**
 * Creates the compact lazy-memoized decryptor function AST for Layer 1 on-demand resolution.
 * Uses an order-independent, non-poisoning state machine:
 * - `globalThis[sym] === undefined`: resolves valid plaintext without writing cache (Issue #1 safe).
 * - `globalThis[sym] === expectedDelta` and untampered: resolves and memoizes in O(1).
 * - Tampered (`__unpeek_tampered === true`, `status === 2`, or mismatched delta): fails closed without caching.
 */
export function createSaltedDecryptorFnAst(
  seed: number,
  pChars: string,
  expectedDelta: number,
  windowKeySymbol: string,
  safeAlpha = SAFE_ALPHA,
  shieldCoupled = true,
  _browserOnly = false
): any {
  const propAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(windowKeySymbol)
    ? `.${windowKeySymbol}`
    : `[${JSON.stringify(windowKeySymbol)}]`;
  const stateSym = `${windowKeySymbol}_s`;
  const stateAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(stateSym)
    ? `.${stateSym}`
    : `[${JSON.stringify(stateSym)}]`;
  const flagSym = `${windowKeySymbol}_t`;
  const flagAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(flagSym)
    ? `.${flagSym}`
    : `[${JSON.stringify(flagSym)}]`;
  const tkExpr = `['__','unp','eek_t','ampered'].join('')`;

  let fBody: string;
  if (!shieldCoupled) {
    fBody =
      `var m=[],c=Function.prototype.toString.call(f),_tk=${tkExpr};` +
      `for(var h=0x811c9dc5,j=0;j<c.length;j++)h=Math.imul(h^c.charCodeAt(j),0x01000193)>>>0;` +
      `var A="${safeAlpha}",P="${pChars}";` +
      `return function(i,s){` +
      `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
      `var w=typeof window<"u"?window:typeof self<"u"?self:0;` +
      `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||((""._u||a._u||0)!==0);` +
      `if(!tm&&(i in m))return m[i];` +
      `var d=tm?(((Math.imul(i+1,0x9e3779b1)^0x5a5b)&65535)|1):0;` +
      `var q=(h^(""._u||a._u||0)^d)>>>0,p=a[i],o="";` +
      `if(p)for(var t=q^s^Math.imul(i+1,0x01000193),j=0;j<p.length;j++){` +
      `t=Math.imul(t^j+1,0x01000193)^0x811c9dc5;` +
      `var ch=p[j],k=A.indexOf(ch);` +
      `o+=k<0?ch:A[(A.indexOf(P[(k-(t&65535)%92+92)%92])-(t>>>16)%92+92)%92];` +
      `}if(!tm)m[i]=o;return o;};`;
  } else {
    const edInit = buildRivestDeltaExpr(seed, expectedDelta, '_ed');
    fBody =
      `var m=[],c=Function.prototype.toString.call(f),_tk=${tkExpr};` +
      `for(var h=0x811c9dc5,j=0;j<c.length;j++)h=Math.imul(h^c.charCodeAt(j),0x01000193)>>>0;` +
      `var A="${safeAlpha}",P="${pChars}";${edInit}` +
      `return function(i,s){` +
      `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
      `var w=typeof window<"u"?window:typeof self<"u"?self:0;` +
      `var sv=G&&G${propAccess}!==void 0?G${propAccess}:w&&w${propAccess}!==void 0?w${propAccess}:void 0;` +
      `var sr=G&&G${stateAccess}?G${stateAccess}:w&&w${stateAccess}?w${stateAccess}:void 0;` +
      `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||(sr&&sr[0]===2)||((""._u||a._u||0)!==0)||(sv!==void 0&&sv!==_ed);` +
      `if(!tm&&sv===_ed&&(i in m))return m[i];` +
      `var d=tm?((_ed^(((Math.imul(i+1,0x9e3779b1)^0x5a5b)&65535)|1))&65535):_ed;` +
      `var q=(h^(""._u||a._u||0)^d)>>>0,p=a[i],o="";` +
      `if(p)for(var t=q^s^Math.imul(i+1,0x01000193),j=0;j<p.length;j++){` +
      `t=Math.imul(t^j+1,0x01000193)^0x811c9dc5;` +
      `var ch=p[j],k=A.indexOf(ch);` +
      `o+=k<0?ch:A[(A.indexOf(P[(k-(t&65535)%92+92)%92])-(t>>>16)%92+92)%92];` +
      `}if(!tm&&sv===_ed)m[i]=o;return o;};`;
  }

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
  fnAst: acorn.Expression | Omit<acorn.Node, 'start' | 'end'>
): acorn.VariableDeclaration {
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
  } as unknown as acorn.VariableDeclaration;
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
  config?: UnpeekConfig,
  windowKeySymbol?: string,
  expectedDelta?: number,
  deterrentMode?: DeterrentMode,
  shieldCoupled = true,
  detectHeadless = false,
  exemptSubtreeRoots?: WeakSet<acorn.Node>
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

      if (isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)) {
        return;
      }

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
      const [saltLo, saltHi] = computeCallSiteSalt64(
        seed >>> 0,
        callSiteIdx >>> 0,
        seed >>> 0
      );
      const localSalt = (((saltLo ^ saltHi) & 0x7fffffff) | 1) >>> 0;

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
  const dCacheVarName = `_uDc${suffix}`;
  const decryptFnName = `_uD${suffix}`;

  const sym = windowKeySymbol ?? deriveWindowKeySymbol(seed);
  let expDelta = expectedDelta;
  if (shieldCoupled && expDelta === undefined) {
    const shield = generateRuntimeShield({
      seed,
      windowKeySymbol: sym,
      deterrentMode: deterrentMode ?? 'passive',
      detectHeadless,
    });
    expDelta = shield.expectedDelta ?? 0;
  }

  const propAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(sym)
    ? `.${sym}`
    : `[${JSON.stringify(sym)}]`;
  const stateSym = `${sym}_s`;
  const stateAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(stateSym)
    ? `.${stateSym}`
    : `[${JSON.stringify(stateSym)}]`;
  const flagSym = `${sym}_t`;
  const flagAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(flagSym)
    ? `.${flagSym}`
    : `[${JSON.stringify(flagSym)}]`;
  const tkExpr = `['__','unp','eek_t','ampered'].join('')`;
  const dkExpr = `['__','unp','eek_d','elta'].join('')`;

  let helperFnSnippet: string;
  if (!shieldCoupled) {
    helperFnSnippet = `function ${decryptFnName}(i,s){` +
      `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
      `var w=typeof window<"u"?window:typeof self<"u"?self:0,_tk=${tkExpr},_dk=${dkExpr};` +
      `var dv=(G&&G[_dk]!=null?G[_dk]:w&&w[_dk]!=null?w[_dk]:0)|0;` +
      `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||((""._u||0)!==0)||(dv!==0);` +
      `if(!tm&&${cacheVarName}[i]!==void 0)return ${cacheVarName}[i];` +
      `if(${dCacheVarName}===void 0){` +
      `var c=Function.prototype.toString.call(${decryptFnName}),h=0x811c9dc5;` +
      `for(var l=0;l<c.length;l++)h=Math.imul(h^c.charCodeAt(l),0x01000193)>>>0;` +
      `${dCacheVarName}=h|0;` +
      `}` +
      `var effD=tm?((${dCacheVarName}^(((Math.imul(i+1,0x9e3779b1)^0x5a5b)&65535)|1))|0):${dCacheVarName};` +
      `var k=${kdfFnName}(i,s,effD);` +
      `var p=${vaultVarName}[i],o="",rk=k|0;` +
      `for(var j=0;j<p.length;j++){` +
      `rk=(Math.imul(rk^(j+1),0x45d9f3b)+0x9e3779b9)|0;` +
      `o+=String.fromCharCode(p.charCodeAt(j)^(((rk>>>16)&127)|1));` +
      `}` +
      `if(!tm)${cacheVarName}[i]=o;` +
      `return o;` +
      `}`;
  } else {
    const edInit = buildRivestDeltaExpr(seed, (expDelta ?? 0) & 0xffff, '_ed');
    helperFnSnippet = `function ${decryptFnName}(i,s){` +
      `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
      `var w=typeof window<"u"?window:typeof self<"u"?self:0,_tk=${tkExpr},_dk=${dkExpr};` +
      `${edInit}` +
      `var sv=G&&G${propAccess}!==void 0?G${propAccess}:w&&w${propAccess}!==void 0?w${propAccess}:void 0;` +
      `var sr=G&&G${stateAccess}?G${stateAccess}:w&&w${stateAccess}?w${stateAccess}:void 0;` +
      `var dv=(G&&G[_dk]!=null?G[_dk]:w&&w[_dk]!=null?w[_dk]:0)|0;` +
      `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||(sr&&sr[0]===2)||((""._u||0)!==0)||(dv!==0)||(sv!==void 0&&sv!==_ed);` +
      `if(!tm&&sv===_ed&&${cacheVarName}[i]!==void 0)return ${cacheVarName}[i];` +
      `if(${dCacheVarName}===void 0){` +
      `var c=Function.prototype.toString.call(${decryptFnName}),h=0x811c9dc5;` +
      `for(var l=0;l<c.length;l++)h=Math.imul(h^c.charCodeAt(l),0x01000193)>>>0;` +
      `${dCacheVarName}=((h|0)^_ed)|0;` +
      `}` +
      `var effD=tm?((${dCacheVarName}^(((Math.imul(i+1,0x9e3779b1)^0x5a5b)&65535)|1))|0):${dCacheVarName};` +
      `var k=${kdfFnName}(i,s,effD);` +
      `var p=${vaultVarName}[i],o="",rk=k|0;` +
      `for(var j=0;j<p.length;j++){` +
      `rk=(Math.imul(rk^(j+1),0x45d9f3b)+0x9e3779b9)|0;` +
      `o+=String.fromCharCode(p.charCodeAt(j)^(((rk>>>16)&127)|1));` +
      `}` +
      `if(!tm&&sv===_ed)${cacheVarName}[i]=o;` +
      `return o;` +
      `}`;
  }

  const parsedFn = acorn.parse(helperFnSnippet, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  }) as acorn.Program;
  const fnDeclAst = parsedFn.body[0];
  const selfHash = computeFnv1aHash(generateCompactJs(fnDeclAst)) | 0;
  const buildD = shieldCoupled ? (selfHash ^ ((expDelta ?? 0) & 0xffff)) | 0 : selfHash | 0;

  // Encrypt each call site with its individual static callSiteSalt bound to shield & decryptor self-hash
  for (const target of targetsToReplace) {
    const k = fallbackKdf(target.callSiteIdx, target.localSalt, buildD, seed);
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

  const varsSnippet = `var ${vaultVarName}=${serializedTable};var ${cacheVarName}=[];var ${dCacheVarName};`;
  const parsedVars = acorn.parse(varsSnippet, {
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

  ast.body.splice(insertIdx, 0, ...(parsedVars.body as any[]), fnDeclAst as any);

  return {
    encryptedStringsCount: targetsToReplace.length,
    integrityToken,
    vaultVarName,
    decryptFnName,
  };
}
