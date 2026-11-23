import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { DeterrentMode } from '../runtime/types.js';
import type { UnpeekConfig } from '../config.js';
import { computeFnv1aHash } from '../shared/hash.js';
import { derivePolymorphicIdent, generateCompactJs } from './codegen.js';

export { computeFnv1aHash };
import {
  generateRuntimeShield,
  computeIntegrityHash,
} from '../runtime/index.js';
import { deriveWindowKeySymbol } from '../internal/runtime.js';
import {
  NARROWED_ASYNC_BR_DECL,
  buildRivestDeltaExpr,
  computeCallSiteSalt,
  createSaltedDecryptorFnAst,
  createSaltedVaultHelperAst,
} from './salted-vault.js';
import { isNodeInExemptSubtree } from './boundary-classifier.js';
import { hasRegexSecretRun } from './secret-patterns.js';

export const SAFE_ALPHA =
  " !#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~";

export const DIRECTIVE_STRINGS = new Set([
  'use strict',
  'use client',
  'use server',
  'use asm',
  'use cache',
  'use worklet',
  'use worker',
  'use memo',
]);

export const STANDARD_PROP_KEYS = new Set([
  'id',
  'type',
  'key',
  'ref',
  'className',
  'style',
  'name',
  'value',
  'children',
  'src',
  'href',
  'alt',
  'role',
  'tabIndex',
  'class',
  'part',
  'slot',
  'is',
  'innerHTML',
  'disabled',
  'title',
]);

const STANDARD_PROP_PREFIX_RE = /^(?:data-|aria-|on[A-Z]|v-|bind:)/;

export function isReservedProp(
  propName: string,
  customReserved?: Set<string>
): boolean {
  if (STANDARD_PROP_KEYS.has(propName)) return true;
  if (customReserved && customReserved.has(propName)) return true;
  if (STANDARD_PROP_PREFIX_RE.test(propName)) return true;
  return false;
}

const LOOP_NODE_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

function isReactDomSpecialProp(
  val: string,
  node: any,
  parent: any,
  customReserved?: Set<string>
): boolean {
  if (isReservedProp(val, customReserved)) return true;
  if (!parent) return false;
  if (parent.type === 'Property') {
    if (parent.key === node && !parent.computed) {
      return true;
    }
    const keyName =
      parent.key?.type === 'Identifier'
        ? parent.key.name
        : parent.key?.type === 'Literal'
          ? String(parent.key.value)
          : '';
    if (keyName && isReservedProp(keyName, customReserved)) {
      return true;
    }
  }
  return false;
}

const TAILWIND_TOKEN_RE =
  /^(?:flex|grid|block|inline|hidden|relative|absolute|fixed|w-|h-|min-|max-|p[xytrbl]?-|m[xytrbl]?-|space-[xy]-|text-|font-|bg-|border|rounded|shadow|ring|outline|transition|duration|opacity|cursor|pointer-events|select-|items-|justify-|gap-|overflow-|z-|inset-|top-|left-|right-|bottom-|hover:|focus:|focus-visible:|disabled:|dark:|data-\[|aria-|\[&_)/;

const TAILWIND_VARIANT_PREFIX_RE = /^(?:[a-zA-Z0-9_@-]+:)+/;

export function stripTailwindVariants(token: string): string {
  return token.replace(TAILWIND_VARIANT_PREFIX_RE, '');
}

export function isTailwindNoise(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  const isMatch = (t: string) => {
    const stripped = stripTailwindVariants(t);
    return (
      TAILWIND_TOKEN_RE.test(stripped) ||
      stripped.startsWith('btn') ||
      stripped.startsWith('p-') ||
      stripped.startsWith('m-')
    );
  };
  if (trimmed.includes(' ')) {
    const tokens = trimmed.split(/\s+/);
    let twHits = 0;
    for (const t of tokens) {
      if (isMatch(t)) {
        twHits++;
      }
    }
    if (twHits / tokens.length >= 0.5) return true;
  } else {
    if (isMatch(trimmed)) return true;
  }
  return false;
}

function isParentSvgPathProperty(
  parent?: Omit<acorn.Node, 'start' | 'end'>
): boolean {
  if (!parent) return false;
  if (parent.type === 'Property' && 'key' in parent && parent.key) {
    const key = parent.key as { type: string; name?: string; value?: unknown };
    const keyName =
      key.type === 'Identifier'
        ? key.name
        : key.type === 'Literal'
          ? String(key.value)
          : '';
    if (keyName === 'd' || keyName === 'path') return true;
  }
  if (parent.type === 'JSXAttribute' && 'name' in parent && parent.name) {
    const attrName = (parent.name as { name?: string }).name;
    if (attrName === 'd' || attrName === 'path') return true;
  }
  return false;
}

export function isSvgPathString(
  val: string,
  parent?: Omit<acorn.Node, 'start' | 'end'>
): boolean {
  if (typeof val !== 'string' || val.length < 4) return false;
  const trimmed = val.trim();
  // An SVG path must start with M or m followed by a number/decimal point/sign
  if (!/^[Mm]\s*[-+]?(?:\d*\.\d+|\d+)/.test(trimmed)) {
    return false;
  }
  // Check if parent property/attribute is 'd' or 'path'
  if (parent && isParentSvgPathProperty(parent)) {
    return true;
  }
  // Strict check for SVG path commands and coordinates
  return (
    /[zZ]$/.test(trimmed) ||
    /[Mm]\s*[-+]?\d.*[a-df-zA-DF-Z]\s*[-+]?\d/.test(trimmed) ||
    /^[Mm]\s*[-+]?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?(?:\s+[a-zA-Z][-+]?\d+.*)?$/.test(
      trimmed
    )
  );
}

const DEFAULT_SEMANTIC_ANCHOR_RE =
  /(?:\bapi\/|\bcheckout\b|\badmin\b|\bauth\b|\btoken\b|\bcredential\b|\bsecret\b|\bpassword\b|\bbearer\b)/i;

function isUiClassName(val: string, parent?: any): boolean {
  if (parent) {
    if (parent.type === 'Property') {
      const k =
        parent.key?.type === 'Identifier'
          ? parent.key.name
          : parent.key?.type === 'Literal'
            ? String(parent.key.value)
            : '';
      if (k === 'className' || k === 'class' || k === 'classList') return true;
    }
    if (parent.type === 'JSXAttribute') {
      const name = parent.name?.name;
      if (name === 'className' || name === 'class') return true;
    }
  }
  if (isTailwindNoise(val)) return true;
  if (/^[a-z0-9_-]+(?:\s+[a-z0-9_-]+)+$/i.test(val.trim())) {
    return true;
  }
  return false;
}

export function isAdversaryDecoy(val: string, seed: number): boolean {
  if (
    val.startsWith('/api/v2/auth/') ||
    val === 'superadmin_token' ||
    val === 'elevate' ||
    val === '_verifyMasterToken' ||
    val === 'mock_jwt_bypass_signature' ||
    val === 'debug_supervisor_override' ||
    val.startsWith('_decoy_') ||
    val.startsWith('_auth_bypass_')
  ) {
    return true;
  }
  const s = ((seed >>> 0) & 0xffff).toString(36);
  if (
    val.includes(s) &&
    (val.includes('auth') ||
      val.includes('token') ||
      val.includes('decoy') ||
      val.includes('elevate'))
  ) {
    return true;
  }
  return false;
}

function isEligibleHotLiteral(
  val: string,
  node: any,
  parent: any,
  ancestors: any[],
  minLen: number,
  seed = 0x9e3779b9,
  customReserved?: Set<string>,
  activeDirectives: Set<string> = DIRECTIVE_STRINGS,
  semanticAnchorPatterns?: RegExp[],
  excludeUiClasses = true
): boolean {
  if (val.length < minLen || activeDirectives.has(val)) return false;
  if (isBinaryOrBase64Payload(val)) return false;
  if (isReactDomSpecialProp(val, node, parent, customReserved)) return false;
  if (isTailwindNoise(val)) return false;
  if (isSvgPathString(val, parent)) return false;

  // Preserve 0.00% hot-loop overhead by exempting literals inside loop constructs
  for (let i = ancestors.length - 2; i >= 0; i--) {
    if (LOOP_NODE_TYPES.has(ancestors[i].type)) {
      return false;
    }
  }

  // Exempt Web Worker functions serialized via .toString() from helper references like _hX
  for (let i = ancestors.length - 2; i >= 0; i--) {
    if ((ancestors[i] as any)._unpeekSerialized) {
      return false;
    }
  }

  // Preserve test fixtures for hot loop helpers
  if (val.startsWith('HOT_')) return false;

  let isSemanticAnchor = false;
  if (semanticAnchorPatterns && semanticAnchorPatterns.length > 0) {
    isSemanticAnchor = semanticAnchorPatterns.some((re) => re.test(val));
  } else {
    isSemanticAnchor = DEFAULT_SEMANTIC_ANCHOR_RE.test(val);
  }

  if (isSemanticAnchor && excludeUiClasses && isUiClassName(val, parent)) {
    isSemanticAnchor = false;
  }

  let isInsideRender = false;
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const a: any = ancestors[i];
    if (
      a.type === 'FunctionDeclaration' ||
      a.type === 'FunctionExpression' ||
      a.type === 'ArrowFunctionExpression'
    ) {
      if (Boolean(a._unpeekIsComponent)) {
        isInsideRender = true;
        break;
      }
    }
  }
  if (!isSemanticAnchor && !isInsideRender) return false;

  // Preserve adversarial decoys injected by cold flow guard
  if (isAdversaryDecoy(val, seed)) {
    return false;
  }

  // Skip import/export source specifiers and class methods
  if (parent) {
    if (
      parent.type === 'ImportDeclaration' ||
      parent.type === 'ExportNamedDeclaration' ||
      parent.type === 'ExportAllDeclaration' ||
      parent.type === 'ImportExpression'
    ) {
      if (parent.source === node) return false;
    }
    if (
      (parent.type === 'MethodDefinition' ||
        parent.type === 'PropertyDefinition') &&
      parent.key === node &&
      !parent.computed
    ) {
      return false;
    }
    if (
      parent.type === 'ImportAttribute' ||
      parent.type === 'ImportSpecifier' ||
      parent.type === 'ExportSpecifier'
    ) {
      return false;
    }
  }

  return true;
}

export const SHADER_SIG_RE =
  /@group|@binding|@vertex|@fragment|@compute|@builtin|@location|@workgroup_size|\bstruct\s+[A-Za-z_]\w*\s*\{|\b[iub]?vec[234][fhiu]?\b|\bmat[234](?:x[234])?[fhi]?\b|\buniform\b|\bvar<(?:uniform|storage)|\bgl_(?:Position|FragColor|FragCoord|VertexID|InstanceID)\b|\bfn\s+main\b|\bvoid\s+main\s*\(|\bprecision\s+(?:lowp|mediump|highp)\s+float\b/;

/**
 * Checks whether an AST node sits directly inside a loop construct or a serialized worker function.
 */
export function isInsideLoopOrSerialized(ancestors: any[]): boolean {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const anc = ancestors[i];
    if (LOOP_NODE_TYPES.has(anc.type) || Boolean(anc._unpeekSerialized)) {
      return true;
    }
  }
  return false;
}

const BINARY_DATA_URI_RE =
  /^data:(?:application\/(?:wasm|octet-stream|pdf|zip|gzip|font-[a-z0-9-]+)|image\/|font\/|audio\/|video\/)/i;
const PURE_BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Detects universal WASM Base64 headers, binary data: URIs, and large pure Base64 binary blobs
 * so they are never double-encoded into ShaderVault or StringVault.
 */
export function isBinaryOrBase64Payload(val: string): boolean {
  if (val.startsWith('AGFzbQE')) return true;
  if (BINARY_DATA_URI_RE.test(val)) return true;
  if (val.length >= 4096 && !/\s/.test(val) && PURE_BASE64_RE.test(val)) {
    return true;
  }
  return false;
}

/**
 * Identifies WGSL/GLSL shaders and oversized (>=256 char) payload buffers eligible for Shader Vault,
 * exempting binary/Base64 blobs, direct loops, serialized workers, UI class strings, SVG paths, and reserved properties.
 */
export function isShaderPayload(
  val: string,
  node: any,
  parent: any,
  ancestors: any[],
  seed: number,
  isHotExempt: boolean,
  customReserved?: Set<string>
): boolean {
  if (isBinaryOrBase64Payload(val)) return false;
  if (isInsideLoopOrSerialized(ancestors)) return false;
  if (parent?.type === 'Property' && parent.key === node && !parent.computed) return false;
  if (isReservedProp(val, customReserved)) return false;
  if (isTailwindNoise(val)) return false;
  if (isSvgPathString(val, parent)) return false;
  if (isAdversaryDecoy(val, seed)) return false;
  if (val.startsWith('HOT_')) return false;
  const matchesSig = SHADER_SIG_RE.test(val);
  if (!matchesSig) {
    if (val.length < 256) return false;
    if (isHotExempt && isUiClassName(val, parent)) return false;
  }
  return true;
}

/**
 * Finds the top-level program body index right after directive prologues and static imports.
 */
export function findVaultInsertIndex(
  ast: acorn.Program,
  activeDirectives: Set<string> = DIRECTIVE_STRINGS
): number {
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
  return insertIdx;
}

export function shouldEncryptString(
  val: string,
  minLen: number,
  parent?: Omit<acorn.Node, 'start' | 'end'>,
  activeDirectives: Set<string> = DIRECTIVE_STRINGS,
  customReserved?: Set<string>
): boolean {
  if (val.length < minLen || activeDirectives.has(val)) return false;
  if (isBinaryOrBase64Payload(val)) return false;
  if (isReservedProp(val, customReserved)) return false;
  if (isSvgPathString(val, parent)) return false;
  if (isTailwindNoise(val)) return false;
  return true;
}

export interface StringVaultResult {
  encryptedStringsCount: number;
  integrityToken: number;
  shaderBuffersCount?: number;
}

/**
 * Generates a 92-character zero-escape involutory permutation table from seed.
 * 46 disjoint swaps map SAFE_ALPHA onto itself without backslash, double quote, or backtick.
 */
export function createPermutationTable(seed: number): string {
  let s = (seed || 0x12345678) >>> 0;
  function xorshift(): number {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  }
  const indices: number[] = [];
  for (let i = 0; i < 92; i++) indices.push(i);
  for (let i = 91; i > 0; i--) {
    const j = xorshift() % (i + 1);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  const B = new Array<number>(92);
  for (let i = 0; i < 46; i++) {
    const a = indices[2 * i];
    const b = indices[2 * i + 1];
    B[a] = b;
    B[b] = a;
  }
  let P_CHARS = '';
  for (let i = 0; i < 92; i++) {
    P_CHARS += SAFE_ALPHA[B[i]];
  }
  return P_CHARS;
}

/**
 * Encodes a string literal using the 92-character zero-escape involutory permutation
 * bound to a 32-bit rolling keystream derived from expectedKey, call-site salt, and vault index.
 */
export function encodeStringWithSeed(
  str: string,
  P_CHARS: string,
  expectedKey: number,
  salt = 0,
  idx = 0
): string {
  let out = '';
  let st =
    ((expectedKey >>> 0) ^ (salt >>> 0) ^ Math.imul(idx + 1, 0x01000193)) >>> 0;
  for (let j = 0; j < str.length; j++) {
    st = (Math.imul(st ^ (j + 1), 0x01000193) ^ 0x811c9dc5) | 0;
    const r1 = (st >>> 16) % 92;
    const r2 = (st & 65535) % 92;
    const c = str.charAt(j);
    const k = SAFE_ALPHA.indexOf(c);
    if (k < 0) {
      out += c;
    } else {
      const y = (k + r1) % 92;
      const z = SAFE_ALPHA.indexOf(P_CHARS.charAt(y));
      out += SAFE_ALPHA.charAt((z + r2) % 92);
    }
  }
  return out;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const CHUNK_SIZE = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('No base64 encoder available in this environment');
}

export function createShaderVaultAst(
  shaderVarName: string,
  shaderPayloads: string[],
  seed: number,
  windowKeySymbol?: string,
  expectedDelta?: number,
  shieldCoupled = false
): acorn.VariableDeclaration {
  const sSeed = seed >>> 0;
  let fnCode: string;
  let ed = 0;

  if (!shieldCoupled) {
    fnCode = `(function f(B){var c=Function.prototype.toString.call(f),h=0x811c9dc5;for(var i=0;i<c.length;i++)h=Math.imul(h^c.charCodeAt(i),0x01000193)>>>0;var S=h^${sSeed},b=B.map(function(s){var n=typeof atob=="function"?atob(s):typeof Buffer<"u"?Buffer.from(s,"base64").toString("binary"):"",u=new Uint8Array(n.length);for(var i=0;i<n.length;i++)u[i]=n.charCodeAt(i);return u;}),d=typeof TextDecoder<"u"?new TextDecoder():null;function x(u,i){for(var r=(S^Math.imul(i+1,0x9e3779b1))|0,j=0;j<u.length;j++){r=(Math.imul(r^(j+1),0x45d9f3b)+0x85ebca6b)|0;u[j]^=(r>>>16)&255;}}return function(i){var u=b[i];x(u,i);try{return d?d.decode(u):String.fromCharCode.apply(null,u);}finally{x(u,i);}};})`;
  } else {
    const sym = windowKeySymbol ?? deriveWindowKeySymbol(sSeed);
    let expDelta = expectedDelta;
    if (expDelta === undefined) {
      expDelta =
        generateRuntimeShield({
          seed: sSeed,
          windowKeySymbol: sym,
        }).expectedDelta ?? 0;
    }
    ed = expDelta & 0xffff;
    const edInit = buildRivestDeltaExpr(sSeed, ed, '_ed');
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

    fnCode =
      `(function f(B){` +
      `var c=Function.prototype.toString.call(f),h=0x811c9dc5;` +
      `for(var i=0;i<c.length;i++)h=Math.imul(h^c.charCodeAt(i),0x01000193)>>>0;` +
      `${edInit}` +
      `var _tk=${tkExpr},_sc=[],b=B.map(function(s){var n=typeof atob=="function"?atob(s):typeof Buffer<"u"?Buffer.from(s,"base64").toString("binary"):"",u=new Uint8Array(n.length);for(var i=0;i<n.length;i++)u[i]=n.charCodeAt(i);return u;}),d=typeof TextDecoder<"u"?new TextDecoder():null;` +
      `function x(u,i,S){for(var r=(S^Math.imul(i+1,0x9e3779b1))|0,j=0;j<u.length;j++){r=(Math.imul(r^(j+1),0x45d9f3b)+0x85ebca6b)|0;u[j]^=(r>>>16)&255;}}` +
      `return function(i){` +
      `var G=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:this;` +
      `var w=typeof window<"u"?window:typeof self<"u"?self:0;` +
      `${NARROWED_ASYNC_BR_DECL}` +
      `var sv=G&&G${propAccess}!==void 0?G${propAccess}:w&&w${propAccess}!==void 0?w${propAccess}:void 0;` +
      `var sr=G&&G${stateAccess}?G${stateAccess}:w&&w${stateAccess}?w${stateAccess}:void 0;` +
      `var tm=(G&&(G[_tk]===!0||G${flagAccess}===!0))||(w&&(w[_tk]===!0||w${flagAccess}===!0))||(sr&&sr[0]===2)||((""._u||0)!==0)||(sv===void 0?!_br:sv!==_ed);` +
      `if(!tm&&sv===_ed&&(i in _sc))return _sc[i];` +
      `var S=(h^${sSeed}^_ed^(tm?(((Math.imul(i+1,0x9e3779b1)^0x5a5b)&65535)|1):0))>>>0;` +
      `var u=b[i];x(u,i,S);` +
      `try{var o=d?d.decode(u):String.fromCharCode.apply(null,u);if(!tm&&sv===_ed)_sc[i]=o;return o;}finally{x(u,i,S);}` +
      `};})`;
  }

  const parsedProgram = acorn.parse(fnCode, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  });
  const firstStmt = parsedProgram.body[0] as acorn.ExpressionStatement;
  const fnAst = firstStmt.expression;
  const buildH = computeIntegrityHash(generateCompactJs(fnAst), 0);
  const S = (buildH ^ sSeed ^ (shieldCoupled ? ed : 0)) >>> 0;

  const textEncoder = new TextEncoder();
  const b64List: string[] = [];
  for (let idx = 0; idx < shaderPayloads.length; idx++) {
    const str = shaderPayloads[idx];
    const bytes = textEncoder.encode(str);
    let r = (S ^ Math.imul(idx + 1, 0x9e3779b1)) | 0;
    for (let j = 0; j < bytes.length; j++) {
      r = (Math.imul(r ^ (j + 1), 0x45d9f3b) + 0x85ebca6b) | 0;
      bytes[j] ^= (r >>> 16) & 255;
    }
    b64List.push(uint8ArrayToBase64(bytes));
  }

  return createSaltedVaultHelperAst(shaderVarName, b64List, fnAst);
}

function extractScopeChain(
  ast: acorn.Program,
  ancestors: acorn.Node[]
): acorn.Node[] {
  const chain: acorn.Node[] = [ast];
  for (let i = 1; i < ancestors.length - 1; i++) {
    const a: any = ancestors[i];
    const prev: any = ancestors[i - 1];
    if (
      a.type === 'BlockStatement' &&
      (prev.type === 'FunctionDeclaration' ||
        prev.type === 'FunctionExpression' ||
        prev.type === 'ArrowFunctionExpression')
    ) {
      chain.push(a);
    }
  }
  return chain;
}

function findLowestCommonScope(
  ast: acorn.Program,
  chains: acorn.Node[][]
): acorn.Node {
  if (chains.length === 0) return ast;
  let lca = chains[0];
  for (let c = 1; c < chains.length; c++) {
    const cur = chains[c];
    let matchLen = 0;
    const limit = Math.min(lca.length, cur.length);
    while (matchLen < limit && lca[matchLen] === cur[matchLen]) {
      matchLen++;
    }
    lca = lca.slice(0, Math.max(1, matchLen));
  }
  return lca[lca.length - 1] ?? ast;
}

export interface InterpolatedTemplatePlan {
  node: any;
  replacements: Map<number, any>;
}

export function isExemptTemplateLiteral(node: any, parent: any): boolean {
  if (!parent) return true;
  if (parent.type === 'TaggedTemplateExpression' && parent.quasi === node) {
    return true;
  }
  if (parent.type === 'ImportExpression' && parent.source === node) {
    return true;
  }
  return false;
}

/**
 * Rebuilds `node.quasis` and `node.expressions` in place for interpolated templates
 * whose static quasis were replaced with decrypt expressions, preserving
 * `quasis.length === expressions.length + 1` and `tail: true` only on the last quasi.
 */
export function rebuildInterpolatedTemplates(
  plans: InterpolatedTemplatePlan[]
): void {
  for (const { node, replacements } of plans) {
    if (replacements.size === 0) continue;
    const origQuasis: any[] = node.quasis;
    const origExprs: any[] = node.expressions;
    const nextQuasis: any[] = [];
    const nextExprs: any[] = [];
    let pendingRaw = '';
    let pendingCooked = '';

    const flushQuasi = (tail: boolean): void => {
      nextQuasis.push({
        type: 'TemplateElement',
        value: { raw: pendingRaw, cooked: pendingCooked },
        tail,
      });
      pendingRaw = '';
      pendingCooked = '';
    };

    for (let i = 0; i < origQuasis.length; i++) {
      const quasi = origQuasis[i];
      const replacement = replacements.get(i);
      if (replacement !== undefined) {
        flushQuasi(false);
        nextExprs.push(replacement);
      } else {
        pendingRaw += quasi.value?.raw ?? '';
        pendingCooked += quasi.value?.cooked ?? '';
      }
      if (i < origExprs.length) {
        flushQuasi(false);
        nextExprs.push(origExprs[i]);
      }
    }
    flushQuasi(true);

    node.quasis = nextQuasis;
    node.expressions = nextExprs;
  }
}

export function createNewRegExpAst(sourceExpr: any, flags: string): any {
  return {
    type: 'NewExpression',
    callee: { type: 'Identifier', name: 'RegExp' },
    arguments:
      flags.length > 0
        ? [
            sourceExpr,
            {
              type: 'Literal',
              value: flags,
              raw: JSON.stringify(flags),
            },
          ]
        : [sourceExpr],
  };
}

function mutateNodeToNewRegExp(
  node: any,
  sourceExpr: any,
  flags: string
): void {
  const newExpr = createNewRegExpAst(sourceExpr, flags);
  node.type = 'NewExpression';
  node.callee = newExpr.callee;
  node.arguments = newExpr.arguments;
  delete node.value;
  delete node.raw;
  delete node.regex;
  delete node.optional;
}

const SCOPE_FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const SCOPE_LEXICAL_TYPES = new Set([
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
  'StaticBlock',
]);

function patternContainsIdentifier(pattern: any, targetName: string): boolean {
  if (!pattern || typeof pattern !== 'object') return false;
  switch (pattern.type) {
    case 'Identifier':
      return pattern.name === targetName;
    case 'AssignmentPattern':
      return patternContainsIdentifier(pattern.left, targetName);
    case 'RestElement':
      return patternContainsIdentifier(pattern.argument, targetName);
    case 'ArrayPattern':
      return (pattern.elements || []).some((el: any) =>
        patternContainsIdentifier(el, targetName)
      );
    case 'ObjectPattern':
      return (pattern.properties || []).some((prop: any) =>
        prop?.type === 'Property'
          ? patternContainsIdentifier(prop.value, targetName)
          : prop?.type === 'RestElement'
            ? patternContainsIdentifier(prop.argument, targetName)
            : false
      );
    default:
      return false;
  }
}

function findEnclosingScope(
  ancestors: acorn.Node[],
  scopeSet: Set<string>,
  fallback: acorn.Node
): acorn.Node {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (scopeSet.has(ancestors[i].type)) {
      return ancestors[i];
    }
  }
  return fallback;
}

/**
 * Collects AST scope nodes where `identName` (default `'RegExp'`) is locally
 * bound or shadowed, or where a `with` statement prevents static resolution.
 */
export function collectIdentifierShadowedScopes(
  ast: acorn.Program,
  identName = 'RegExp'
): WeakSet<acorn.Node> {
  const shadowed = new WeakSet<acorn.Node>();
  walk.ancestor(ast, {
    FunctionDeclaration(node: any, _state: any, ancestors: any[]) {
      if (node.id?.name === identName) {
        shadowed.add(
          findEnclosingScope(ancestors.slice(0, -1), SCOPE_LEXICAL_TYPES, ast)
        );
        shadowed.add(node);
      }
      if (
        Array.isArray(node.params) &&
        node.params.some((p: any) => patternContainsIdentifier(p, identName))
      ) {
        shadowed.add(node);
      }
    },
    FunctionExpression(node: any) {
      if (
        node.id?.name === identName ||
        (Array.isArray(node.params) &&
          node.params.some((p: any) => patternContainsIdentifier(p, identName)))
      ) {
        shadowed.add(node);
      }
    },
    ArrowFunctionExpression(node: any) {
      if (
        Array.isArray(node.params) &&
        node.params.some((p: any) => patternContainsIdentifier(p, identName))
      ) {
        shadowed.add(node);
      }
    },
    ClassDeclaration(node: any, _state: any, ancestors: any[]) {
      if (node.id?.name === identName) {
        shadowed.add(
          findEnclosingScope(ancestors.slice(0, -1), SCOPE_LEXICAL_TYPES, ast)
        );
        shadowed.add(node);
      }
    },
    ClassExpression(node: any) {
      if (node.id?.name === identName) {
        shadowed.add(node);
      }
    },
    CatchClause(node: any) {
      if (node.param && patternContainsIdentifier(node.param, identName)) {
        shadowed.add(node);
      }
    },
    WithStatement(node: any) {
      shadowed.add(node);
    },
    ImportDeclaration(node: any) {
      if (
        Array.isArray(node.specifiers) &&
        node.specifiers.some((s: any) => s?.local?.name === identName)
      ) {
        shadowed.add(ast);
      }
    },
    VariableDeclaration(node: any, _state: any, ancestors: any[]) {
      if (
        !Array.isArray(node.declarations) ||
        !node.declarations.some((d: any) =>
          patternContainsIdentifier(d?.id, identName)
        )
      ) {
        return;
      }
      if (node.kind === 'var') {
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const a = ancestors[i];
          if (
            SCOPE_FUNCTION_TYPES.has(a.type) ||
            a.type === 'StaticBlock' ||
            a.type === 'Program'
          ) {
            shadowed.add(a);
            break;
          }
        }
      } else {
        shadowed.add(
          findEnclosingScope(ancestors.slice(0, -1), SCOPE_LEXICAL_TYPES, ast)
        );
      }
    },
  });
  return shadowed;
}

export function isEligibleSecretRegExp(
  node: any,
  ancestors: any[],
  hotExemptNodes?: WeakSet<acorn.Node>,
  exemptSubtreeRoots?: WeakSet<acorn.Node>,
  getShadowedScopes?: () => WeakSet<acorn.Node>
): boolean {
  const pattern: unknown = node?.regex?.pattern;
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 4096) {
    return false;
  }
  if (!hasRegexSecretRun(pattern)) {
    return false;
  }
  if (isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)) {
    return false;
  }
  if (isInsideLoopOrSerialized(ancestors)) {
    return false;
  }
  if (isNodeInExemptSubtree(ancestors, hotExemptNodes)) {
    return false;
  }
  if (getShadowedScopes && isNodeInExemptSubtree(ancestors, getShadowedScopes())) {
    return false;
  }
  return true;
}

export function applyStringVault(
  ast: acorn.Program,
  seed = 0x9e3779b9,
  minStringLength = 4,
  hotExemptNodes?: WeakSet<acorn.Node>,
  windowKeySymbol?: string,
  expectedDelta?: number,
  deterrentMode?: DeterrentMode,
  config?: UnpeekConfig,
  shieldCoupled = true,
  detectHeadless = false,
  exemptSubtreeRoots?: WeakSet<acorn.Node>
): StringVaultResult {
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

  const semanticPatterns = config?.vault?.semanticAnchors?.patterns?.map((p) =>
    typeof p === 'string' ? new RegExp(p) : p,
  );
  const excludeUi = config?.vault?.semanticAnchors?.excludeUiClasses !== false;

  const suffix = ((seed >>> 0) & 0xffff).toString(36);
  const decryptFnName = `_uD${suffix}`;
  const cacheVarName = derivePolymorphicIdent(seed, 'vault');
  const shaderVarName = derivePolymorphicIdent(seed, 'shader');
  const sym = windowKeySymbol ?? deriveWindowKeySymbol(seed);
  const browserOnly = config?.target === 'browser';

  let expDelta = shieldCoupled ? expectedDelta : 0;
  if (shieldCoupled && expDelta === undefined) {
    const shield = generateRuntimeShield({
      seed,
      windowKeySymbol: sym,
      deterrentMode: deterrentMode ?? 'passive',
      detectHeadless,
    });
    expDelta = shield.expectedDelta ?? 0;
  }

  const alreadyVaulted = ast.body.some(
    (stmt: any) =>
      stmt.type === 'VariableDeclaration' &&
      stmt.declarations?.some(
        (d: any) =>
          d.id?.type === 'Identifier' &&
          typeof d.id.name === 'string' &&
          (d.id.name.startsWith('_uC') ||
            (d.id.name.startsWith('_uD') && !d.id.name.startsWith('_uDec')) ||
            d.id.name === decryptFnName ||
            d.id.name === cacheVarName ||
            (d.init?.type === 'CallExpression' &&
              d.init.callee?.type === 'FunctionExpression' &&
              d.init.callee?.id?.name === 'f' &&
              d.init.arguments?.[0]?.type === 'ArrayExpression'))
      )
  );

  if (alreadyVaulted) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('already-vaulted', seed),
      shaderBuffersCount: 0,
    };
  }

  const P_CHARS = createPermutationTable(seed);

  const fnAst = createSaltedDecryptorFnAst(
    seed,
    P_CHARS,
    expDelta ?? 0,
    sym,
    SAFE_ALPHA,
    shieldCoupled,
    browserOnly
  );
  const compactFnStr = generateCompactJs(fnAst);
  const buildH = computeIntegrityHash(compactFnStr, 0);
  const expectedKey = (buildH ^ 0 ^ (shieldCoupled ? (expDelta ?? 0) & 0xffff : 0)) >>> 0;

  const stringToIndex = new Map<string, number>();
  const uniqueStrings: string[] = [];
  const encryptedPayloads: string[] = [];
  const shaderToIndex = new Map<string, number>();
  const shaderPayloads: string[] = [];

  interface VaultTarget {
    type: 'string' | 'shader';
    node: any;
    parent?: any;
    idx: number;
    scopeChain: acorn.Node[];
    replaceMode?: 'node' | 'regexp';
    flags?: string;
    onReplace?: (exprAst: any) => void;
  }

  const targetsToReplace: VaultTarget[] = [];

  const hotTargetsToReplace: {
    node: any;
    parent?: any;
    val: string;
    idx: number;
    onReplace?: (exprAst: any) => void;
  }[] = [];

  const interpolatedTemplates: InterpolatedTemplatePlan[] = [];
  let regExpShadowedScopes: WeakSet<acorn.Node> | undefined;
  const getRegExpShadowedScopes = (): WeakSet<acorn.Node> => {
    regExpShadowedScopes ??= collectIdentifierShadowedScopes(ast, 'RegExp');
    return regExpShadowedScopes;
  };

  const customWalkBase = {
    ...walk.base,
    Property(node: any, st: any, c: any) {
      c(node.key, st);
      if (node.value) c(node.value, st);
    },
  };

  function processVaultCandidate(
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

    // Check shader payloads before hot-exempt bailout (only direct loops / serialized workers stay exempt)
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
      targetsToReplace.push({
        type: 'shader',
        node,
        parent,
        idx,
        scopeChain: extractScopeChain(ast, ancestors),
        ...(onReplace ? { onReplace } : {}),
      });
      return true;
    }

    if (isHotExempt) {
      if (
        isEligibleHotLiteral(
          val,
          node,
          parent,
          ancestors,
          minLen,
          seed,
          customReserved,
          activeDirectives,
          semanticPatterns,
          excludeUi
        )
      ) {
        hotTargetsToReplace.push({
          node,
          parent,
          val,
          idx: hotTargetsToReplace.length,
          ...(onReplace ? { onReplace } : {}),
        });
        return true;
      }
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

    let idx = stringToIndex.get(val);
    if (idx === undefined) {
      idx = uniqueStrings.length;
      stringToIndex.set(val, idx);
      uniqueStrings.push(val);
    }
    targetsToReplace.push({
      type: 'string',
      node,
      parent,
      idx,
      scopeChain: extractScopeChain(ast, ancestors),
      ...(onReplace ? { onReplace } : {}),
    });
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
            const pattern: string = node.regex.pattern;
            const flags: string = node.regex.flags ?? '';
            const parent = ancestors[ancestors.length - 2] as any;
            let idx = stringToIndex.get(pattern);
            if (idx === undefined) {
              idx = uniqueStrings.length;
              stringToIndex.set(pattern, idx);
              uniqueStrings.push(pattern);
            }
            targetsToReplace.push({
              type: 'string',
              node,
              parent,
              idx,
              scopeChain: extractScopeChain(ast, ancestors),
              replaceMode: 'regexp',
              flags,
            });
          }
          return;
        }
        if (typeof node.value !== 'string') return;
        const val: string = node.value;
        if (activeDirectives.has(val)) return;

        const parent = ancestors[ancestors.length - 2] as any;
        if (!parent) return;

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

        if (
          parent.type === 'ImportAttribute' ||
          parent.type === 'ImportSpecifier' ||
          parent.type === 'ExportSpecifier'
        ) {
          return;
        }

        processVaultCandidate(val, node, parent, ancestors);
      },

      TemplateLiteral(node: any, _state: any, ancestors: any[]) {
        if (!Array.isArray(node.quasis) || node.quasis.length === 0) return;
        const parent = ancestors[ancestors.length - 2] as any;
        if (isExemptTemplateLiteral(node, parent)) return;

        const exprCount = Array.isArray(node.expressions)
          ? node.expressions.length
          : 0;
        if (exprCount === 0) {
          if (node.quasis.length !== 1) return;
          const val: string =
            node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
          if (typeof val !== 'string' || activeDirectives.has(val)) return;
          processVaultCandidate(val, node, parent, ancestors);
          return;
        }

        if (node.quasis.length !== exprCount + 1) return;
        if (
          node.quasis.some((q: any) => typeof q?.value?.cooked !== 'string')
        ) {
          return;
        }

        const replacements = new Map<number, any>();
        let queuedCount = 0;
        for (let qIdx = 0; qIdx < node.quasis.length; qIdx++) {
          const val: string = node.quasis[qIdx].value.cooked;
          if (activeDirectives.has(val)) continue;
          const queued = processVaultCandidate(
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
    customWalkBase
  );

  if (targetsToReplace.length === 0 && hotTargetsToReplace.length === 0) {
    return {
      encryptedStringsCount: 0,
      integrityToken: computeFnv1aHash('empty', seed),
      shaderBuffersCount: 0,
    };
  }

  for (const { node, parent, val, idx, onReplace } of hotTargetsToReplace) {
    const key = (idx % 3) + 1;
    let encodedStr = '';
    for (let i = 0; i < val.length; i++) {
      encodedStr += String.fromCharCode(val.charCodeAt(i) ^ key);
    }
    const callExpr: any = {
      type: 'CallExpression',
      callee: {
        type: 'Identifier',
        name: '_hX',
      },
      arguments: [
        {
          type: 'Literal',
          value: encodedStr,
          raw: JSON.stringify(encodedStr),
        },
        {
          type: 'Literal',
          value: key,
          raw: String(key),
        },
      ],
      optional: false,
    };
    if (onReplace) {
      onReplace(callExpr);
      continue;
    }
    if (parent?.type === 'Property' && parent.key === node) {
      parent.computed = true;
    }
    node.type = 'CallExpression';
    node.callee = callExpr.callee;
    node.arguments = callExpr.arguments;
    node.optional = false;
    delete node.value;
    delete node.raw;
    delete node.quasis;
    delete node.expressions;
  }

  function applyVaultTargetReplacement(
    target: VaultTarget,
    callExpr: any
  ): void {
    if (target.onReplace) {
      target.onReplace(callExpr);
      return;
    }
    if (target.replaceMode === 'regexp') {
      mutateNodeToNewRegExp(target.node, callExpr, target.flags ?? '');
      return;
    }
    if (target.parent?.type === 'Property' && target.parent.key === target.node) {
      target.parent.computed = true;
    }
    target.node.type = 'CallExpression';
    target.node.callee = callExpr.callee;
    target.node.arguments = callExpr.arguments;
    target.node.optional = false;
    delete target.node.value;
    delete target.node.raw;
    delete target.node.quasis;
    delete target.node.expressions;
  }

  let insertIdx = findVaultInsertIndex(ast, activeDirectives);

  const wantFragmented = Boolean(config?.vault?.fragmented);
  let fragCount = Math.max(2, Math.min(8, Math.floor(config?.vault?.fragmentCount ?? 3)));
  while (fragCount > 2 && Math.floor(uniqueStrings.length / fragCount) < 4) {
    fragCount--;
  }
  const useFragmented =
    wantFragmented &&
    uniqueStrings.length >= 8 &&
    Math.floor(uniqueStrings.length / fragCount) >= 4;

  let integrityToken = computeFnv1aHash('empty', seed);

  if (!useFragmented) {
    for (let idx = 0; idx < uniqueStrings.length; idx++) {
      const salt = computeCallSiteSalt(seed, idx);
      encryptedPayloads.push(
        encodeStringWithSeed(uniqueStrings[idx], P_CHARS, expectedKey, salt, idx)
      );
    }
    integrityToken = computeFnv1aHash(JSON.stringify(encryptedPayloads), seed);

    for (const target of targetsToReplace) {
      let callExpr: any;
      if (target.type === 'shader') {
        callExpr = {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: shaderVarName },
          arguments: [{ type: 'Literal', value: target.idx, raw: String(target.idx) }],
          optional: false,
        };
      } else {
        const salt = computeCallSiteSalt(seed, target.idx);
        callExpr = {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: decryptFnName },
          arguments: [
            { type: 'Literal', value: target.idx, raw: String(target.idx) },
            { type: 'Literal', value: salt, raw: String(salt) },
          ],
          optional: false,
        };
      }
      applyVaultTargetReplacement(target, callExpr);
    }
  } else {
    // Deterministic seed-based PRNG permutation of unique string indices
    const perm: number[] = [];
    for (let i = 0; i < uniqueStrings.length; i++) perm.push(i);
    let prng = (seed || 0x12345678) >>> 0;
    for (let i = perm.length - 1; i > 0; i--) {
      prng ^= prng << 13;
      prng ^= prng >>> 17;
      prng ^= prng << 5;
      const j = (prng >>> 0) % (i + 1);
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }

    const stringFragAssign = new Array<{ fragId: number; localIdx: number }>(
      uniqueStrings.length
    );
    const fragStrings: string[][] = Array.from({ length: fragCount }, () => []);
    for (let p = 0; p < perm.length; p++) {
      const strIdx = perm[p];
      const fragId = p % fragCount;
      const localIdx = fragStrings[fragId].length;
      fragStrings[fragId].push(uniqueStrings[strIdx]);
      stringFragAssign[strIdx] = { fragId, localIdx };
    }

    const fragMeta: {
      fragSeed: number;
      fnName: string;
      fnAst: any;
      payloads: string[];
      chains: acorn.Node[][];
    }[] = [];
    const usedFnNames = new Set<string>();

    for (let f = 0; f < fragCount; f++) {
      const fragSeed = (seed ^ Math.imul(f + 1, 0x9e3779b9)) >>> 0;
      let fnName = `_uD${(fragSeed & 0xffff).toString(36)}f${f}`;
      while (usedFnNames.has(fnName)) {
        fnName += '_';
      }
      usedFnNames.add(fnName);

      const pCharsF = createPermutationTable(fragSeed);
      const fnAstF = createSaltedDecryptorFnAst(
        fragSeed,
        pCharsF,
        expDelta ?? 0,
        sym,
        SAFE_ALPHA,
        shieldCoupled,
        browserOnly
      );
      const buildHF = computeIntegrityHash(generateCompactJs(fnAstF), 0);
      const expectedKeyF =
        (buildHF ^ 0 ^ (shieldCoupled ? (expDelta ?? 0) & 0xffff : 0)) >>> 0;

      const payloads: string[] = [];
      for (let localIdx = 0; localIdx < fragStrings[f].length; localIdx++) {
        const salt = computeCallSiteSalt(fragSeed, localIdx);
        payloads.push(
          encodeStringWithSeed(
            fragStrings[f][localIdx],
            pCharsF,
            expectedKeyF,
            salt,
            localIdx
          )
        );
      }

      fragMeta.push({
        fragSeed,
        fnName,
        fnAst: fnAstF,
        payloads,
        chains: [],
      });
    }

    for (const target of targetsToReplace) {
      let callExpr: any;
      if (target.type === 'shader') {
        callExpr = {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: shaderVarName },
          arguments: [{ type: 'Literal', value: target.idx, raw: String(target.idx) }],
          optional: false,
        };
      } else {
        const { fragId, localIdx } = stringFragAssign[target.idx];
        const meta = fragMeta[fragId];
        meta.chains.push(target.scopeChain);
        const salt = computeCallSiteSalt(meta.fragSeed, localIdx);
        callExpr = {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: meta.fnName },
          arguments: [
            { type: 'Literal', value: localIdx, raw: String(localIdx) },
            { type: 'Literal', value: salt, raw: String(salt) },
          ],
          optional: false,
        };
      }
      applyVaultTargetReplacement(target, callExpr);
    }

    const allPayloads: string[][] = [];
    for (const meta of fragMeta) {
      allPayloads.push(meta.payloads);
      const helperStmt = createSaltedVaultHelperAst(
        meta.fnName,
        meta.payloads,
        meta.fnAst
      );
      const lcaScope = findLowestCommonScope(ast, meta.chains) as any;
      if (lcaScope === ast || !Array.isArray(lcaScope.body)) {
        ast.body.splice(insertIdx++, 0, helperStmt);
      } else {
        let blockInsertIdx = 0;
        while (
          blockInsertIdx < lcaScope.body.length &&
          lcaScope.body[blockInsertIdx]?.type === 'ExpressionStatement' &&
          Boolean(lcaScope.body[blockInsertIdx]?.directive)
        ) {
          blockInsertIdx++;
        }
        lcaScope.body.splice(blockInsertIdx, 0, helperStmt);
      }
    }
    integrityToken = computeFnv1aHash(JSON.stringify(allPayloads), seed);
  }

  rebuildInterpolatedTemplates(interpolatedTemplates);

  if (hotTargetsToReplace.length > 0) {
    const alreadyHasHx = ast.body.some(
      (stmt: any) =>
        stmt.type === 'FunctionDeclaration' && stmt.id?.name === '_hX'
    );
    if (!alreadyHasHx) {
      const hxAst = acorn.parse(
        'function _hX(s,k){var o="";for(var i=0;i<s.length;i++)o+=String.fromCharCode(s.charCodeAt(i)^k);return o;}',
        { ecmaVersion: 'latest', sourceType: 'script' }
      ) as any;
      ast.body.splice(insertIdx++, 0, hxAst.body[0]);
    }
  }

  if (!useFragmented && encryptedPayloads.length > 0) {
    const vaultHelperStmt = createSaltedVaultHelperAst(
      decryptFnName,
      encryptedPayloads,
      fnAst
    );
    ast.body.splice(insertIdx++, 0, vaultHelperStmt);
  }

  if (shaderPayloads.length > 0) {
    const shaderHelperStmt = createShaderVaultAst(
      shaderVarName,
      shaderPayloads,
      seed,
      sym,
      expDelta,
      shieldCoupled
    );
    ast.body.splice(insertIdx++, 0, shaderHelperStmt);
  }

  return {
    encryptedStringsCount: uniqueStrings.length + hotTargetsToReplace.length,
    integrityToken,
    shaderBuffersCount: shaderPayloads.length,
  };
}
