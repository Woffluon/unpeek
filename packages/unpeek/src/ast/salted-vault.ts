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
  VAULT_WALK_BASE,
  collectIdentifierShadowedScopes,
  createNewRegExpAst,
  createShaderVaultAst,
  findVaultInsertIndex,
  isEligibleObjectPropertyKey,
  isEligibleSecretRegExp,
  isExemptTemplateLiteral,
  isShaderPayload,
  rebuildInterpolatedTemplates,
  shouldEncryptString,
  type InterpolatedTemplatePlan,
  type LatchCouplingConfig,
} from './string-vault.js';
import { derivePolymorphicIdent, generateCompactJs } from './codegen.js';
import { fallbackKdf, injectWasmVault } from './wasm-vault.js';
import { generateRuntimeShield } from '../runtime/index.js';
import { deriveWindowKeySymbol } from '../internal/runtime.js';
import {
  isNodeInExemptSubtree,
  isStaticModuleOrAssetPosition,
} from './boundary-classifier.js';

export interface SaltedVaultResult {
  encryptedStringsCount: number;
  integrityToken: number;
  vaultVarName: string;
  decryptFnName: string;
  shaderBuffersCount?: number;
}

/**
 * Computes deterministic 31-bit positive call-site salt using full 64-bit mixing
 * for lazy string resolution.
 */
export function computeCallSiteSalt(seed: number, idx: number): number {
  const [lo, hi] = computeCallSiteSalt64(seed >>> 0, idx >>> 0, seed >>> 0);
  return (((lo ^ hi) & 0x7fffffff) | 1) >>> 0;
}

export const NARROWED_ASYNC_BR_DECL =
  `var _br=(typeof window<'u'&&typeof document<'u'&&window.document===document&&document.nodeType===9&&document.scripts&&document.scripts.length>0&&document.readyState!=='complete')||(typeof self<'u'&&typeof self.importScripts==='function');`;

/**
 * Builds a non-linear Rivest degree-3 permutation polynomial runtime expression
 * that reconstructs the 16-bit expectedDelta without embedding raw delta or `maskA ^ maskB` literals.
 */
export function buildRivestDeltaExpr(seed: number, expectedDelta: number, varName = '_ed'): string {
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

function buildLatchInitSnippet(
  seed: number,
  latchCoupling?: LatchCouplingConfig
): { hasLatch: boolean; latchDecl: string } {
  if (
    !latchCoupling ||
    typeof latchCoupling.latchFnName !== 'string' ||
    !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(latchCoupling.latchFnName)
  ) {
    return { hasLatch: false, latchDecl: '' };
  }
  const tamperByte = ((seed >>> 8) & 0x7f) | 0x35;
  const expectedLatch = latchCoupling.expectedLatchByte & 255;
  return {
    hasLatch: true,
    latchDecl: `var _ld=typeof ${latchCoupling.latchFnName}==="function"?((${latchCoupling.latchFnName}()^${expectedLatch})&255):${tamperByte};`,
  };
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
  _browserOnly = false,
  latchCoupling?: LatchCouplingConfig
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
  const { hasLatch, latchDecl } = buildLatchInitSnippet(seed, latchCoupling);
  const charEmit = hasLatch
    ? `o+=String.fromCharCode((k<0?ch:A[(A.indexOf(P[(k-(t&65535)%92+92)%92])-(t>>>16)%92+92)%92]).charCodeAt(0)^_ld);`
    : `o+=k<0?ch:A[(A.indexOf(P[(k-(t&65535)%92+92)%92])-(t>>>16)%92+92)%92];`;
  const cacheGuardSuffix = hasLatch ? '&&!_ld' : '';

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
      latchDecl +
      `var d=tm?(((Math.imul(i+1,0x9e3779b1)^0x5a5b)&65535)|1):0;` +
      `var q=(h^(""._u||a._u||0)^d)>>>0,p=a[i],o="";` +
      `if(p)for(var t=q^s^Math.imul(i+1,0x01000193),j=0;j<p.length;j++){` +
      `t=Math.imul(t^j+1,0x01000193)^0x811c9dc5;` +
      `var ch=p[j],k=A.indexOf(ch);` +
      charEmit +
      `}if(!tm${cacheGuardSuffix})m[i]=o;return o;};`;
  } else {
    const edInit = buildRivestDeltaExpr(seed, expectedDelta, '_ed');
    const hasWindowKey = Boolean(windowKeySymbol);
    const brDecl = hasWindowKey ? NARROWED_ASYNC_BR_DECL : '';
    const svCheck = hasWindowKey
      ? `(sv===void 0?!_br:sv!==_ed)`
      : `(sv!==void 0&&sv!==_ed)`;
    fBody =
      `var m=[],c=Function.prototype.toString.call(f),_tk=${tkExpr};` +
      `for(var h=0x811c9dc5,j=0;j<c.length;j++)h=Math.imul(h^c.charCodeAt(j),0x01000193)>>>0;` +
      `var A="${safeAlpha}",P="${pChars}";${edInit}` +
      `return function(i,s){` +
      `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
      `var w=typeof window<"u"?window:typeof self<"u"?self:0;` +
      brDecl +
      `var sv=G&&G${propAccess}!==void 0?G${propAccess}:w&&w${propAccess}!==void 0?w${propAccess}:void 0;` +
      `var sr=G&&G${stateAccess}?G${stateAccess}:w&&w${stateAccess}?w${stateAccess}:void 0;` +
      `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||(sr&&sr[0]===2)||((""._u||a._u||0)!==0)||${svCheck};` +
      `if(!tm&&sv===_ed&&(i in m))return m[i];` +
      latchDecl +
      `var d=tm?((_ed^(((Math.imul(i+1,0x9e3779b1)^0x5a5b)&65535)|1))&65535):_ed;` +
      `var q=(h^(""._u||a._u||0)^d)>>>0,p=a[i],o="";` +
      `if(p)for(var t=q^s^Math.imul(i+1,0x01000193),j=0;j<p.length;j++){` +
      `t=Math.imul(t^j+1,0x01000193)^0x811c9dc5;` +
      `var ch=p[j],k=A.indexOf(ch);` +
      charEmit +
      `}if(!tm&&sv===_ed${cacheGuardSuffix})m[i]=o;return o;};`;
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
          (d.id.name.startsWith('_uP') ||
            (d.init?.type === 'CallExpression' &&
              d.init.callee?.type === 'FunctionExpression' &&
              d.init.callee?.id?.name === 'f' &&
              d.init.arguments?.[0]?.type === 'ArrayExpression'))
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
  exemptSubtreeRoots?: WeakSet<acorn.Node>,
  latchCoupling?: LatchCouplingConfig
): SaltedVaultResult {
  if (isAstAlreadySalted(ast)) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('already-salted', seed),
      vaultVarName: '',
      decryptFnName: '',
      shaderBuffersCount: 0,
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
    replaceMode?: 'node' | 'regexp';
    flags?: string;
    onReplace?: (exprAst: any) => void;
  }

  const targetsToReplace: TargetEntry[] = [];
  const encryptedPayloads: string[] = [];
  const shaderToIndex = new Map<string, number>();
  const shaderPayloads: string[] = [];
  const shaderTargets: {
    node: any;
    parent: any;
    idx: number;
    onReplace?: (exprAst: any) => void;
  }[] = [];
  const interpolatedTemplates: InterpolatedTemplatePlan[] = [];
  let regExpShadowedScopes: WeakSet<acorn.Node> | undefined;
  const getRegExpShadowedScopes = (): WeakSet<acorn.Node> => {
    regExpShadowedScopes ??= collectIdentifierShadowedScopes(ast, 'RegExp');
    return regExpShadowedScopes;
  };

  function pushSaltedTarget(
    rawString: string,
    node: any,
    parent: any,
    extra?: Pick<TargetEntry, 'replaceMode' | 'flags' | 'onReplace'>
  ): void {
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
      rawString,
      ...extra,
    });
  }

  function processSaltedCandidate(
    val: string,
    node: any,
    parent: any,
    ancestors: any[],
    onReplace?: (exprAst: any) => void
  ): boolean {
    if (isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)) {
      return false;
    }

    if (
      parent.type === 'ExpressionStatement' &&
      (Boolean(parent.directive) || activeDirectives.has(val))
    ) {
      return false;
    }

    for (let i = ancestors.length - 2; i >= 0; i--) {
      if (
        ancestors[i].type === 'ExpressionStatement' &&
        Boolean((ancestors[i] as any).directive)
      ) {
        return false;
      }
    }

    let isHotExempt = false;
    if (hotExemptNodes) {
      for (let i = ancestors.length - 2; i >= 0; i--) {
        if (hotExemptNodes.has(ancestors[i])) {
          isHotExempt = true;
          break;
        }
      }
    }

    // Protect shaders before hot-exempt bailout (only direct loops / serialized workers stay exempt)
    if (
      isShaderPayload(
        val,
        node,
        parent,
        ancestors,
        seed,
        isHotExempt,
        customReserved
      )
    ) {
      let idx = shaderToIndex.get(val);
      if (idx === undefined) {
        idx = shaderPayloads.length;
        shaderToIndex.set(val, idx);
        shaderPayloads.push(val);
      }
      shaderTargets.push({ node, parent, idx, ...(onReplace ? { onReplace } : {}) });
      return true;
    }

    if (isHotExempt) {
      return false;
    }

    if (
      !shouldEncryptString(
        val,
        minLen,
        parent,
        activeDirectives,
        customReserved
      )
    ) {
      return false;
    }

    pushSaltedTarget(val, node, parent, onReplace ? { onReplace } : undefined);
    return true;
  }

  walk.ancestor(
    ast,
    {
      Literal(node: any, _state: any, ancestors: any[]) {
        if (node.regex) {
          if (
            isEligibleSecretRegExp(
              node,
              ancestors,
              hotExemptNodes,
              exemptSubtreeRoots,
              getRegExpShadowedScopes
            )
          ) {
            pushSaltedTarget(
              node.regex.pattern,
              node,
              ancestors[ancestors.length - 2],
              {
                replaceMode: 'regexp',
                flags: node.regex.flags ?? '',
              }
            );
          }
          return;
        }
        if (typeof node.value !== 'string') return;
        const val: string = node.value;
        if (activeDirectives.has(val)) return;

        const parent = ancestors[ancestors.length - 2];
        if (!parent) return;

        // Do not encrypt static module/bundler/asset URL strings
        if (isStaticModuleOrAssetPosition(node, parent)) {
          return;
        }

        // Keep non-computed object keys literal unless they carry a likely secret
        if (parent.type === 'Property' && parent.key === node && !parent.computed) {
          if (!isEligibleObjectPropertyKey(val, node, parent, ancestors)) {
            return;
          }
        }
        if (
          (parent.type === 'MethodDefinition' ||
            parent.type === 'PropertyDefinition') &&
          parent.key === node &&
          !parent.computed
        ) {
          return;
        }

        processSaltedCandidate(val, node, parent, ancestors);
      },

      TemplateLiteral(node: any, _state: any, ancestors: any[]) {
        if (!Array.isArray(node.quasis) || node.quasis.length === 0) return;
        const parent = ancestors[ancestors.length - 2];
        if (isExemptTemplateLiteral(node, parent)) return;

        const exprCount = Array.isArray(node.expressions)
          ? node.expressions.length
          : 0;
        if (exprCount === 0) {
          if (node.quasis.length !== 1) return;
          const val: string =
            node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
          if (typeof val !== 'string' || activeDirectives.has(val)) return;
          processSaltedCandidate(val, node, parent, ancestors);
          return;
        }

        if (node.quasis.length !== exprCount + 1) return;
        if (node.quasis.some((q: any) => typeof q?.value?.cooked !== 'string')) {
          return;
        }

        const replacements = new Map<number, any>();
        let queuedCount = 0;
        for (let qIdx = 0; qIdx < node.quasis.length; qIdx++) {
          const val: string = node.quasis[qIdx].value.cooked;
          if (activeDirectives.has(val)) continue;
          const queued = processSaltedCandidate(
            val,
            node,
            parent,
            ancestors,
            (exprAst) => {
              replacements.set(qIdx, exprAst);
            }
          );
          if (queued) {
            queuedCount++;
          }
        }
        if (queuedCount > 0) {
          interpolatedTemplates.push({ node, replacements });
        }
      },
    },
    VAULT_WALK_BASE
  );

  if (targetsToReplace.length === 0 && shaderTargets.length === 0) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('empty-salted', seed),
      vaultVarName: '',
      decryptFnName: '',
      shaderBuffersCount: 0,
    };
  }

  let vaultVarName = '';
  let decryptFnName = '';
  let integrityToken = computeFnv1aHash('empty-salted', seed);

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

  if (targetsToReplace.length > 0) {
    // Ensure WebAssembly KDF key generator is injected
    const wasmResult = injectWasmVault(ast, seed);
    const kdfFnName = wasmResult.kdfFnName;

    const suffix = computeFnv1aHash(`salted:${seed}`, seed).toString(36);
    vaultVarName = `_uP${suffix}`;
    const cacheVarName = `_uCache${suffix}`;
    const dCacheVarName = `_uDc${suffix}`;
    decryptFnName = `_uD${suffix}`;

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

    const { hasLatch, latchDecl } = buildLatchInitSnippet(seed, latchCoupling);
    const charMaskXor = hasLatch ? '^_ld' : '';
    const cacheGuardSuffix = hasLatch ? '&&!_ld' : '';

    let helperFnSnippet: string;
    if (!shieldCoupled) {
      helperFnSnippet = `function ${decryptFnName}(i,s){` +
        `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
        `var w=typeof window<"u"?window:typeof self<"u"?self:0,_tk=${tkExpr},_dk=${dkExpr};` +
        `var dv=(G&&G[_dk]!=null?G[_dk]:w&&w[_dk]!=null?w[_dk]:0)|0;` +
        `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||((""._u||0)!==0)||(dv!==0);` +
        `if(!tm&&${cacheVarName}[i]!==void 0)return ${cacheVarName}[i];` +
        latchDecl +
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
        `o+=String.fromCharCode(p.charCodeAt(j)^(((rk>>>16)&127)|1)${charMaskXor});` +
        `}` +
        `if(!tm${cacheGuardSuffix})${cacheVarName}[i]=o;` +
        `return o;` +
        `}`;
    } else {
      const edInit = buildRivestDeltaExpr(seed, (expDelta ?? 0) & 0xffff, '_ed');
      const hasWindowKey = Boolean(sym);
      const brDecl = hasWindowKey ? NARROWED_ASYNC_BR_DECL : '';
      const svCheck = hasWindowKey
        ? `(sv===void 0?!_br:sv!==_ed)`
        : `(sv!==void 0&&sv!==_ed)`;
      helperFnSnippet = `function ${decryptFnName}(i,s){` +
        `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
        `var w=typeof window<"u"?window:typeof self<"u"?self:0,_tk=${tkExpr},_dk=${dkExpr};` +
        `${edInit}` +
        brDecl +
        `var sv=G&&G${propAccess}!==void 0?G${propAccess}:w&&w${propAccess}!==void 0?w${propAccess}:void 0;` +
        `var sr=G&&G${stateAccess}?G${stateAccess}:w&&w${stateAccess}?w${stateAccess}:void 0;` +
        `var dv=(G&&G[_dk]!=null?G[_dk]:w&&w[_dk]!=null?w[_dk]:0)|0;` +
        `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||(sr&&sr[0]===2)||((""._u||0)!==0)||(dv!==0)||${svCheck};` +
        `if(!tm&&sv===_ed&&${cacheVarName}[i]!==void 0)return ${cacheVarName}[i];` +
        latchDecl +
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
        `o+=String.fromCharCode(p.charCodeAt(j)^(((rk>>>16)&127)|1)${charMaskXor});` +
        `}` +
        `if(!tm&&sv===_ed${cacheGuardSuffix})${cacheVarName}[i]=o;` +
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

      if (target.onReplace) {
        target.onReplace(callExpr);
      } else if (target.replaceMode === 'regexp') {
        replaceNodeInParent(
          target.parent,
          target.node,
          createNewRegExpAst(callExpr, target.flags ?? '')
        );
      } else {
        if (target.parent?.type === 'Property' && target.parent.key === target.node) {
          target.parent.computed = true;
        }
        replaceNodeInParent(target.parent, target.node, callExpr);
      }
    }

    const serializedTable = JSON.stringify(encryptedPayloads);
    integrityToken = computeFnv1aHash(serializedTable, seed);

    const varsSnippet = `var ${vaultVarName}=${serializedTable};var ${cacheVarName}=[];var ${dCacheVarName};`;
    const parsedVars = acorn.parse(varsSnippet, {
      ecmaVersion: 'latest',
      sourceType: 'script',
    }) as acorn.Program;

    const insertIdx = findVaultInsertIndex(ast, activeDirectives);
    ast.body.splice(insertIdx, 0, ...(parsedVars.body as any[]), fnDeclAst as any);
  }

  if (shaderPayloads.length > 0) {
    const shaderVarName = derivePolymorphicIdent(seed, 'shader');
    for (const target of shaderTargets) {
      const callExpr: any = {
        type: 'CallExpression',
        callee: {
          type: 'Identifier',
          name: shaderVarName,
        },
        arguments: [
          {
            type: 'Literal',
            value: target.idx,
            raw: String(target.idx),
          },
        ],
        optional: false,
      };
      if (target.onReplace) {
        target.onReplace(callExpr);
      } else {
        replaceNodeInParent(target.parent, target.node, callExpr);
      }
    }
    const shaderHelperStmt = createShaderVaultAst(
      shaderVarName,
      shaderPayloads,
      seed,
      sym,
      expDelta,
      shieldCoupled
    );
    const shaderInsertIdx = findVaultInsertIndex(ast, activeDirectives);
    ast.body.splice(shaderInsertIdx, 0, shaderHelperStmt as any);
    if (targetsToReplace.length === 0) {
      integrityToken = computeFnv1aHash(JSON.stringify(shaderPayloads), seed);
    }
  }

  rebuildInterpolatedTemplates(interpolatedTemplates);

  return {
    encryptedStringsCount: targetsToReplace.length,
    integrityToken,
    vaultVarName,
    decryptFnName,
    shaderBuffersCount: shaderPayloads.length,
  };
}
