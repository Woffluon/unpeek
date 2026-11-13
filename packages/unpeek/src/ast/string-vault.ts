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
  computeCallSiteSalt,
  createSaltedDecryptorFnAst,
  createSaltedVaultHelperAst,
} from './salted-vault.js';
import { isNodeInExemptSubtree } from './boundary-classifier.js';

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
      if (a.id?.name && /^[A-Z]/.test(a.id.name)) {
        isInsideRender = true;
        break;
      }
      if (a._unpeekIsComponent) {
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

const SHADER_SIG_RE =
  /@group|@binding|@vertex|@fragment|@compute|vec4f|gl_Position|uniform/;

export function shouldEncryptString(
  val: string,
  minLen: number,
  parent?: Omit<acorn.Node, 'start' | 'end'>,
  activeDirectives: Set<string> = DIRECTIVE_STRINGS,
  customReserved?: Set<string>
): boolean {
  if (val.length < minLen || activeDirectives.has(val)) return false;
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

function createShaderVaultAst(
  shaderVarName: string,
  shaderPayloads: string[],
  seed: number
): acorn.VariableDeclaration {
  const sSeed = seed >>> 0;
  const fnCode = `(function f(B){var c=Function.prototype.toString.call(f),h=0x811c9dc5;for(var i=0;i<c.length;i++)h=Math.imul(h^c.charCodeAt(i),0x01000193)>>>0;var S=h^${sSeed},b=B.map(function(s){var n=typeof atob=="function"?atob(s):typeof Buffer<"u"?Buffer.from(s,"base64").toString("binary"):"",u=new Uint8Array(n.length);for(var i=0;i<n.length;i++)u[i]=n.charCodeAt(i);return u;}),d=typeof TextDecoder<"u"?new TextDecoder():null;function x(u,i){for(var r=(S^Math.imul(i+1,0x9e3779b1))|0,j=0;j<u.length;j++){r=(Math.imul(r^(j+1),0x45d9f3b)+0x85ebca6b)|0;u[j]^=(r>>>16)&255;}}return function(i){var u=b[i];x(u,i);try{return d?d.decode(u):String.fromCharCode.apply(null,u);}finally{x(u,i);}};})`;
  const parsedProgram = acorn.parse(fnCode, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  });
  const firstStmt = parsedProgram.body[0] as acorn.ExpressionStatement;
  const fnAst = firstStmt.expression;
  const buildH = computeIntegrityHash(generateCompactJs(fnAst), 0);
  const S = (buildH ^ sSeed) >>> 0;

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
            d.id.name.startsWith('_uD') ||
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

  const targetsToReplace: {
    type: 'string' | 'shader';
    node: any;
    parent?: any;
    idx: number;
    scopeChain: acorn.Node[];
  }[] = [];

  const hotTargetsToReplace: {
    node: any;
    parent?: any;
    val: string;
    idx: number;
  }[] = [];

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
      Literal(node: any, _state: any, ancestors: any[]) {
        if (typeof node.value !== 'string') return;
        const val: string = node.value;
        if (activeDirectives.has(val)) return;

        let isHotExempt = false;
        if (hotExemptNodes) {
          for (let i = ancestors.length - 2; i >= 0; i--) {
            if (hotExemptNodes.has(ancestors[i])) {
              isHotExempt = true;
              break;
            }
          }
        }

        const parent = ancestors[ancestors.length - 2] as any;
        if (!parent) return;

        if (isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)) {
          return;
        }

        // Skip directives at top of program or function body, or any ExpressionStatement where directive is truthy
        if (
          parent.type === 'ExpressionStatement' &&
          (Boolean(parent.directive) || activeDirectives.has(val))
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
            });
          }
          return;
        }

        // Preserve standard React/DOM/Vue/Svelte prop keys
        if (
          parent.type === 'Property' &&
          parent.key === node &&
          !parent.computed
        ) {
          if (isReservedProp(val, customReserved)) {
            return;
          }
        }

        if (isReservedProp(val, customReserved)) return;
        if (isTailwindNoise(val)) return;
        if (isSvgPathString(val, parent)) return;

        const isShader = val.length >= 256 || SHADER_SIG_RE.test(val);
        if (isShader) {
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
          });
        } else {
          if (!shouldEncryptString(val, minLen, parent, activeDirectives, customReserved)) return;
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
          });
        }
      },

      TemplateLiteral(node: any, _state: any, ancestors: any[]) {
        if (!node.quasis || node.quasis.length !== 1) return;
        if (node.expressions && node.expressions.length !== 0) return;

        const val: string = node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
        if (typeof val !== 'string' || activeDirectives.has(val)) return;

        if (isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)) {
          return;
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

        const parent = ancestors[ancestors.length - 2] as any;
        if (!parent) return;

        if (isNodeInExemptSubtree(ancestors, exemptSubtreeRoots)) {
          return;
        }

        if (
          parent.type === 'ExpressionStatement' &&
          (Boolean(parent.directive) || activeDirectives.has(val))
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
            });
          }
          return;
        }

        if (isReservedProp(val, customReserved)) return;
        if (isTailwindNoise(val)) return;
        if (isSvgPathString(val, parent)) return;

        const isShader = val.length >= 256 || SHADER_SIG_RE.test(val);
        if (isShader) {
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
          });
        } else {
          if (!shouldEncryptString(val, minLen, parent, activeDirectives, customReserved)) return;
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
          });
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

  for (const { node, parent, val, idx } of hotTargetsToReplace) {
    const key = (idx % 3) + 1;
    let encodedStr = '';
    for (let i = 0; i < val.length; i++) {
      encodedStr += String.fromCharCode(val.charCodeAt(i) ^ key);
    }
    if (parent?.type === 'Property' && parent.key === node) {
      parent.computed = true;
    }
    node.type = 'CallExpression';
    node.callee = {
      type: 'Identifier',
      name: '_hX',
    };
    node.arguments = [
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
    ];
    node.optional = false;
    delete node.value;
    delete node.raw;
    delete node.quasis;
    delete node.expressions;
  }

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

    for (const { type, node, parent, idx } of targetsToReplace) {
      if (parent?.type === 'Property' && parent.key === node) {
        parent.computed = true;
      }
      if (type === 'shader') {
        node.type = 'CallExpression';
        node.callee = { type: 'Identifier', name: shaderVarName };
        node.arguments = [{ type: 'Literal', value: idx, raw: String(idx) }];
      } else {
        const salt = computeCallSiteSalt(seed, idx);
        node.type = 'CallExpression';
        node.callee = { type: 'Identifier', name: decryptFnName };
        node.arguments = [
          { type: 'Literal', value: idx, raw: String(idx) },
          { type: 'Literal', value: salt, raw: String(salt) },
        ];
      }
      node.optional = false;
      delete node.value;
      delete node.raw;
      delete node.quasis;
      delete node.expressions;
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

    for (const { type, node, parent, idx, scopeChain } of targetsToReplace) {
      if (parent?.type === 'Property' && parent.key === node) {
        parent.computed = true;
      }
      if (type === 'shader') {
        node.type = 'CallExpression';
        node.callee = { type: 'Identifier', name: shaderVarName };
        node.arguments = [{ type: 'Literal', value: idx, raw: String(idx) }];
      } else {
        const { fragId, localIdx } = stringFragAssign[idx];
        const meta = fragMeta[fragId];
        meta.chains.push(scopeChain);
        const salt = computeCallSiteSalt(meta.fragSeed, localIdx);
        node.type = 'CallExpression';
        node.callee = { type: 'Identifier', name: meta.fnName };
        node.arguments = [
          { type: 'Literal', value: localIdx, raw: String(localIdx) },
          { type: 'Literal', value: salt, raw: String(salt) },
        ];
      }
      node.optional = false;
      delete node.value;
      delete node.raw;
      delete node.quasis;
      delete node.expressions;
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
      seed
    );
    ast.body.splice(insertIdx++, 0, shaderHelperStmt);
  }

  return {
    encryptedStringsCount: uniqueStrings.length + hotTargetsToReplace.length,
    integrityToken,
    shaderBuffersCount: shaderPayloads.length,
  };
}
