import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export type ColdReturnDomain = 'number' | 'boolean' | 'string' | 'void' | 'object';

export interface Mba4Constants {
  c1: number;
  m1: number;
  c2: number;
  m2: number;
  k: number;
  cFold: number;
}

export interface Mba4ContextOptions {
  liveVars?: string[];
  sboxIdent?: string;
  aliasIdentA?: string;
  aliasIdentB?: string;
  scratchVarIdent?: string;
  mxIdent?: string;
  returnDomain?: ColdReturnDomain;
  windowKeySymbol?: string;
  expectedDelta?: number;
  shieldCoupled?: boolean;
}

export interface AffineMbaParams {
  readonly m: number;
  readonly m2: number;
  readonly mInv: number;
  readonly c: number;
  readonly d: number;
}

export interface ApplyColdFlowGuardOptions {
  enableBitwiseMba?: boolean;
}

const NEUTRAL_DECOY_KEYS = [
  'telemetryOk',
  'retryBudget',
  'slotMask',
  'frameSeq',
  'digestTag',
  'phaseFlag',
  'epochSync',
  'crcState',
  'gateReady',
  'bufVer',
  'traceCode',
  'windowMode',
];

function mixSeed32(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h | 0;
}

/**
 * Computes the multiplicative inverse of an odd 32-bit integer modulo 2^32
 * via 5 Newton-Raphson iterations: m * mInv === 1 (mod 2^32).
 */
export function modInverseUint32(oddValue: number): number {
  const m = (oddValue | 1) >>> 0;
  let inv = 1;
  for (let i = 0; i < 5; i++) {
    inv = Math.imul(inv, (2 - Math.imul(m, inv)) | 0) >>> 0;
  }
  return inv >>> 0;
}

/**
 * Derives non-canonical parameterized affine MBA parameters over Z_{2^32}
 * satisfying m * mInv === 1 (mod 2^32) and d = -(mInv * c) mod 2^32.
 */
export function deriveAffineMbaParams(seed: number, salt: number): AffineMbaParams {
  let m = (mixSeed32(seed, salt) | 1) >>> 0;
  if (m === 1 || m === 0xffffffff || m === 0x9e3779b9) {
    m = ((m ^ 0x5bd1e995) | 1) >>> 0;
  }
  const m2 = Math.imul(m, 2) >>> 0;
  const mInv = modInverseUint32(m);
  let c = mixSeed32(seed, salt + 0x9e37) >>> 0;
  if (c === 0) c = 0x27d4eb2f;
  const d = (-Math.imul(mInv, c)) >>> 0;
  return { m, m2, mInv, c, d };
}

function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

function makeImul(left: any, right: any): any {
  return {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object: { type: 'Identifier', name: 'Math' },
      property: { type: 'Identifier', name: 'imul' },
    },
    arguments: [left, right],
  };
}

function makeBinary(operator: string, left: any, right: any): any {
  return {
    type: 'BinaryExpression',
    operator,
    left,
    right,
  };
}

function makeUnary(operator: string, argument: any): any {
  return {
    type: 'UnaryExpression',
    operator,
    prefix: true,
    argument,
  };
}

function makeLiteral(value: number | string | boolean): any {
  return {
    type: 'Literal',
    value,
    raw: JSON.stringify(value),
  };
}

function makeInt32Literal(value: number): any {
  const signed = value | 0;
  if (signed < 0) {
    return makeUnary('-', makeLiteral(-signed));
  }
  return makeLiteral(signed);
}

function makeMemberIndex(arrayIdent: string, indexExpr: any): any {
  return {
    type: 'MemberExpression',
    computed: true,
    object: { type: 'Identifier', name: arrayIdent },
    property: indexExpr,
  };
}

/**
 * Exact 32-bit semi-linear MBA family constants + folded bitwise offset C_fold.
 * Families 0..3 implement distinct 4-variable affine forms over Z_{2^32}:
 * - Family 0: x1 + x2 - x3 + 3*x4 + K
 * - Family 1: x1 - x2 + 5*x3 + x4 + K
 * - Family 2: 3*x1 + x2 + x3 - x4 + K
 * - Family 3: -x1 + 7*x2 + x3 + x4 + K
 */
export function computeMba4Constants(
  seed: number,
  fnIndex: number,
  family: number
): Mba4Constants {
  const f = ((family % 4) + 4) % 4;
  const c1 = mixSeed32(seed, fnIndex * 7 + 11);
  const m1 = mixSeed32(seed, fnIndex * 7 + 23);
  const c2 = mixSeed32(seed, fnIndex * 7 + 37);
  const m2 = mixSeed32(seed, fnIndex * 7 + 53);
  const k = mixSeed32(seed, fnIndex * 7 + 71) | 1;

  let offset = 0;
  if (f === 0) {
    offset = (c1 + m1 - 1 + c2 + Math.imul(3, m2)) | 0;
  } else if (f === 1) {
    offset = (c1 - 1 + m1 + Math.imul(5, c2) + m2) | 0;
  } else if (f === 2) {
    offset = (Math.imul(3, c1) + m1 + c2 - 1 + m2) | 0;
  } else {
    offset = (-1 + c1 + Math.imul(7, m1) + c2 + m2) | 0;
  }
  const cFold = (k - offset) | 0;
  return { c1, m1, c2, m2, k, cFold };
}

export function evaluateMba4Target(
  family: number,
  x1: number,
  x2: number,
  x3: number,
  x4: number,
  k: number
): number {
  const f = ((family % 4) + 4) % 4;
  const a = x1 | 0;
  const b = x2 | 0;
  const c = x3 | 0;
  const d = x4 | 0;
  if (f === 0) return (a + b - c + Math.imul(3, d) + k) | 0;
  if (f === 1) return (a - b + Math.imul(5, c) + d + k) | 0;
  if (f === 2) return (Math.imul(3, a) + b + c - d + k) | 0;
  return (-a + Math.imul(7, b) + c + d + k) | 0;
}

export function evaluateMba4Formula(
  family: number,
  x1: number,
  x2: number,
  x3: number,
  x4: number,
  consts: Mba4Constants
): number {
  const f = ((family % 4) + 4) % 4;
  const a = x1 | 0;
  const b = x2 | 0;
  const c = x3 | 0;
  const d = x4 | 0;
  const { c1, m1, c2, m2, cFold } = consts;

  const addOr = (u: number, v: number) => ((u | v) + (u & v)) | 0;
  const addXor = (u: number, v: number) => ((u ^ v) + ((u & v) << 1)) | 0;
  const add2Or = (u: number, v: number) => (((u | v) << 1) - (u ^ v)) | 0;

  if (f === 0) {
    const u1 = addOr(a, c1);
    const u2 = addXor(b, m1);
    const s12 = addXor(u1, u2);
    const n3 = addOr(~c, c2);
    const t4 = Math.imul(3, addOr(d, m2));
    const s123 = addOr(s12, n3);
    const t4k = addXor(t4, cFold);
    return addOr(s123, t4k);
  }
  if (f === 1) {
    const u1 = addXor(a, c1);
    const n2 = addXor(~b, m1);
    const s12 = addOr(u1, n2);
    const t3 = Math.imul(5, addXor(c, c2));
    const u4 = addOr(d, m2);
    const s34 = addOr(t3, u4);
    const s34k = addOr(s34, cFold);
    return addXor(s12, s34k);
  }
  if (f === 2) {
    const t1 = Math.imul(3, addOr(a, c1));
    const u2 = add2Or(b, m1);
    const s12 = addOr(t1, u2);
    const u3 = addXor(c, c2);
    const n4 = addOr(~d, m2);
    const s34 = addXor(u3, n4);
    const s12k = addOr(s12, cFold);
    return addOr(s12k, s34);
  }
  const n1 = addOr(~a, c1);
  const t2 = Math.imul(7, addXor(b, m1));
  const s12 = add2Or(n1, t2);
  const u3 = addOr(c, c2);
  const u4 = addXor(d, m2);
  const s34 = addOr(u3, u4);
  const s34k = addXor(s34, cFold);
  return addOr(s12, s34k);
}

const MBA_CHECK_VECTORS: readonly [number, number, number, number][] = [
  [0, 0, 0, 0],
  [1, -1, 42, 0x7fffffff],
  [-0x80000000, 0x55aa33cc, -12345, 999999],
  [0x12345678, -0x23456789, 0xdeadbeef | 0, 0xcafebabe | 0],
];

export function verifyMba4FamilyEquivalence(
  family: number,
  consts: Mba4Constants
): boolean {
  for (const [x1, x2, x3, x4] of MBA_CHECK_VECTORS) {
    const lhs = evaluateMba4Formula(family, x1, x2, x3, x4, consts);
    const rhs = evaluateMba4Target(family, x1, x2, x3, x4, consts.k);
    if (lhs !== rhs) return false;
  }
  return true;
}

function makeMbaAddOr(u: any, v: any): any {
  return makeBinary(
    '|',
    makeBinary('+', makeBinary('|', cloneNode(u), cloneNode(v)), makeBinary('&', cloneNode(u), cloneNode(v))),
    makeLiteral(0)
  );
}

function makeMbaAddXor(u: any, v: any): any {
  return makeBinary(
    '|',
    makeBinary(
      '+',
      makeBinary('^', cloneNode(u), cloneNode(v)),
      makeBinary('<<', makeBinary('&', cloneNode(u), cloneNode(v)), makeLiteral(1))
    ),
    makeLiteral(0)
  );
}

function makeMbaAdd2Or(u: any, v: any): any {
  return makeBinary(
    '|',
    makeBinary(
      '-',
      makeBinary('<<', makeBinary('|', cloneNode(u), cloneNode(v)), makeLiteral(1)),
      makeBinary('^', cloneNode(u), cloneNode(v))
    ),
    makeLiteral(0)
  );
}

/**
 * Builds a >=4-variable semi-linear MBA AST node with folded bitwise constants C_fold
 * and verifies algebraic equivalence at compile time.
 */
export function buildMba4Ast(
  seed: number,
  fnIndex: number,
  x1Node: any,
  x2Node: any,
  x3Node: any,
  x4Node: any
): any {
  const family = Math.abs((seed ^ Math.imul(fnIndex + 1, 0x27d4eb2d)) % 4);
  const consts = computeMba4Constants(seed, fnIndex, family);
  if (!verifyMba4FamilyEquivalence(family, consts)) {
    throw new Error(`MBA4 algebraic equivalence check failed for family ${family}`);
  }

  const c1Lit = makeInt32Literal(consts.c1);
  const m1Lit = makeInt32Literal(consts.m1);
  const c2Lit = makeInt32Literal(consts.c2);
  const m2Lit = makeInt32Literal(consts.m2);
  const cFoldLit = makeInt32Literal(consts.cFold);

  if (family === 0) {
    const u1 = makeMbaAddOr(x1Node, c1Lit);
    const u2 = makeMbaAddXor(x2Node, m1Lit);
    const s12 = makeMbaAddXor(u1, u2);
    const n3 = makeMbaAddOr(makeUnary('~', cloneNode(x3Node)), c2Lit);
    const t4 = makeImul(makeLiteral(3), makeMbaAddOr(x4Node, m2Lit));
    const s123 = makeMbaAddOr(s12, n3);
    const t4k = makeMbaAddXor(t4, cFoldLit);
    return makeMbaAddOr(s123, t4k);
  }
  if (family === 1) {
    const u1 = makeMbaAddXor(x1Node, c1Lit);
    const n2 = makeMbaAddXor(makeUnary('~', cloneNode(x2Node)), m1Lit);
    const s12 = makeMbaAddOr(u1, n2);
    const t3 = makeImul(makeLiteral(5), makeMbaAddXor(x3Node, c2Lit));
    const u4 = makeMbaAddOr(x4Node, m2Lit);
    const s34 = makeMbaAddOr(t3, u4);
    const s34k = makeMbaAddOr(s34, cFoldLit);
    return makeMbaAddXor(s12, s34k);
  }
  if (family === 2) {
    const t1 = makeImul(makeLiteral(3), makeMbaAddOr(x1Node, c1Lit));
    const u2 = makeMbaAdd2Or(x2Node, m1Lit);
    const s12 = makeMbaAddOr(t1, u2);
    const u3 = makeMbaAddXor(x3Node, c2Lit);
    const n4 = makeMbaAddOr(makeUnary('~', cloneNode(x4Node)), m2Lit);
    const s34 = makeMbaAddXor(u3, n4);
    const s12k = makeMbaAddOr(s12, cFoldLit);
    return makeMbaAddOr(s12k, s34);
  }

  const n1 = makeMbaAddOr(makeUnary('~', cloneNode(x1Node)), c1Lit);
  const t2 = makeImul(makeLiteral(7), makeMbaAddXor(x2Node, m1Lit));
  const s12 = makeMbaAdd2Or(n1, t2);
  const u3 = makeMbaAddOr(x3Node, c2Lit);
  const u4 = makeMbaAddXor(x4Node, m2Lit);
  const s34 = makeMbaAddOr(u3, u4);
  const s34k = makeMbaAddXor(s34, cFoldLit);
  return makeMbaAddOr(s12, s34k);
}

/**
 * Wraps an integer expression in a seeded degree-3 Rivest permutation polynomial P(u)
 * over Z_{2^32}: a0 + u * (a1 + u * (a2 + u * a3)), where a1 is odd and a2, a3 are even.
 */
function buildRivestPermAst(seed: number, fnIndex: number, uExpr: any): any {
  const a0 = mixSeed32(seed, fnIndex * 13 + 3);
  const a1 = mixSeed32(seed, fnIndex * 13 + 5) | 1;
  const a2 = mixSeed32(seed, fnIndex * 13 + 7) & ~1;
  const a3 = mixSeed32(seed, fnIndex * 13 + 9) & ~1;

  const deg3 = makeImul(cloneNode(uExpr), makeInt32Literal(a3));
  const deg2 = makeImul(cloneNode(uExpr), makeBinary('+', makeInt32Literal(a2), deg3));
  const deg1 = makeImul(cloneNode(uExpr), makeBinary('+', makeInt32Literal(a1), deg2));
  return makeBinary('|', makeBinary('+', makeInt32Literal(a0), deg1), makeLiteral(0));
}

function buildSboxMixAst(sboxIdent: string, wIdent: string): any {
  const lowByte = makeMemberIndex(
    sboxIdent,
    makeBinary('&', { type: 'Identifier', name: wIdent }, makeLiteral(255))
  );
  const highByte = makeBinary(
    '<<',
    makeMemberIndex(
      sboxIdent,
      makeBinary(
        '&',
        makeBinary('>>>', { type: 'Identifier', name: wIdent }, makeLiteral(8)),
        makeLiteral(255)
      )
    ),
    makeLiteral(8)
  );
  return makeBinary(
    '|',
    makeBinary('^', makeBinary('^', { type: 'Identifier', name: wIdent }, lowByte), highByte),
    makeLiteral(0)
  );
}

function pickNeutralKey(seed: number, index: number): string {
  const idx = Math.abs((seed ^ Math.imul(index + 1, 0x9e3779b9)) | 0) % NEUTRAL_DECOY_KEYS.length;
  return NEUTRAL_DECOY_KEYS[idx];
}

function createDecoyObjectExpression(
  model: number,
  seed = 0x9e3779b9,
  zExpr?: any
): acorn.ObjectExpression {
  const m = Math.abs(model) % 3;
  const k0 = NEUTRAL_DECOY_KEYS[(m * 3) % NEUTRAL_DECOY_KEYS.length];
  const k1 = NEUTRAL_DECOY_KEYS[(m * 3 + 1) % NEUTRAL_DECOY_KEYS.length];
  const k2 = NEUTRAL_DECOY_KEYS[(m * 3 + 2) % NEUTRAL_DECOY_KEYS.length];
  const tagNum = ((mixSeed32(seed, m + 11) >>> 0) % 900) + 100;
  const val0 = zExpr
    ? makeBinary('&', cloneNode(zExpr), makeLiteral(0xff))
    : makeLiteral((m + 1) * 17);
  const val1 = zExpr
    ? makeBinary('===', makeBinary('&', cloneNode(zExpr), makeLiteral(1)), makeLiteral(0))
    : makeLiteral(false);
  const val2 = makeLiteral(`v${m}_${tagNum}`);

  return {
    type: 'ObjectExpression',
    properties: [
      {
        type: 'Property',
        key: { type: 'Identifier', name: k0 },
        value: val0,
        kind: 'init',
        computed: false,
        method: false,
        shorthand: false,
      },
      {
        type: 'Property',
        key: { type: 'Identifier', name: k1 },
        value: val1,
        kind: 'init',
        computed: false,
        method: false,
        shorthand: false,
      },
      {
        type: 'Property',
        key: { type: 'Identifier', name: k2 },
        value: val2,
        kind: 'init',
        computed: false,
        method: false,
        shorthand: false,
      },
    ],
  } as unknown as acorn.ObjectExpression;
}

function createContextualDecoyConsequent(
  fnIndex: number,
  seed: number,
  domain: ColdReturnDomain,
  decoyIdent?: string,
  zExpr?: any
): any {
  const zRef = zExpr ? cloneNode(zExpr) : makeLiteral(mixSeed32(seed, fnIndex) & 0xff);
  const mask = mixSeed32(seed, fnIndex + 31) & 0xffff;

  if (domain === 'void') {
    return {
      type: 'BlockStatement',
      body: [{ type: 'ReturnStatement', argument: null }],
    };
  }
  if (domain === 'number') {
    return {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: makeBinary('|', makeBinary('^', zRef, makeLiteral(mask)), makeLiteral(0)),
        },
      ],
    };
  }
  if (domain === 'boolean') {
    return {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: makeBinary('===', makeBinary('&', zRef, makeLiteral(1)), makeLiteral(0)),
        },
      ],
    };
  }
  if (domain === 'string') {
    const tag = pickNeutralKey(seed, fnIndex);
    return {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: makeBinary(
            '+',
            makeLiteral(`${tag}:`),
            makeBinary('&', zRef, makeLiteral(0xff))
          ),
        },
      ],
    };
  }

  const model = Math.abs(fnIndex) % 3;
  if (decoyIdent) {
    return {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: {
            type: 'CallExpression',
            callee: {
              type: 'MemberExpression',
              computed: true,
              object: { type: 'Identifier', name: decoyIdent },
              property: makeLiteral(model),
            },
            arguments: [zRef],
          },
        },
      ],
    };
  }

  return {
    type: 'BlockStatement',
    body: [
      {
        type: 'ReturnStatement',
        argument: createDecoyObjectExpression(model, seed, zRef),
      },
    ],
  };
}

export function createSharedDecoyDeclaration(
  decoyIdent = '_d',
  maxModels = 3,
  seed = 0x9e3779b9
): acorn.VariableDeclaration {
  const count = Math.max(1, Math.min(3, maxModels));
  const indices: number[] = [];
  for (let i = 0; i < count; i++) indices.push(i);
  const paramArg = { type: 'Identifier', name: '_v' };
  return {
    type: 'VariableDeclaration',
    kind: 'var',
    declarations: [
      {
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: decoyIdent },
        init: {
          type: 'ArrayExpression',
          elements: indices.map((m) => ({
            type: 'ArrowFunctionExpression',
            id: null,
            params: [cloneNode(paramArg)],
            body: createDecoyObjectExpression(m, seed, paramArg),
            generator: false,
            async: false,
            expression: true,
          })),
        },
      },
    ],
  } as unknown as acorn.VariableDeclaration;
}

function extractParamNames(paramNode?: string | acorn.Pattern, out: string[] = []): string[] {
  if (!paramNode) return out;
  if (typeof paramNode === 'string') {
    if (paramNode !== 'arguments' && paramNode !== 'eval') out.push(paramNode);
    return out;
  }
  switch (paramNode.type) {
    case 'Identifier':
      if (paramNode.name !== 'arguments' && paramNode.name !== 'eval') {
        out.push(paramNode.name);
      }
      break;
    case 'AssignmentPattern':
      extractParamNames(paramNode.left, out);
      break;
    case 'RestElement':
      extractParamNames(paramNode.argument, out);
      break;
    case 'ArrayPattern':
      for (const el of paramNode.elements || []) {
        if (el) extractParamNames(el, out);
      }
      break;
    case 'ObjectPattern':
      for (const prop of paramNode.properties || []) {
        if (prop.type === 'Property') {
          extractParamNames(prop.value, out);
        } else if (prop.type === 'RestElement') {
          extractParamNames(prop.argument, out);
        }
      }
      break;
  }
  return out;
}

function makeSafeNumericParam(name: string): any {
  return {
    type: 'ConditionalExpression',
    test: {
      type: 'BinaryExpression',
      operator: '===',
      left: makeUnary('typeof', { type: 'Identifier', name }),
      right: makeLiteral('number'),
    },
    consequent: makeBinary('|', { type: 'Identifier', name }, makeLiteral(0)),
    alternate: makeLiteral(0),
  };
}

function buildLiveVariables4(
  seed: number,
  fnIndex: number,
  paramNode?: string | acorn.Pattern,
  isArrowFn = false,
  ctxOpts?: Mba4ContextOptions
): [any, any, any, any] {
  const candidates: any[] = [];
  const seenNames = new Set<string>();

  const names = [...(ctxOpts?.liveVars ?? []), ...extractParamNames(paramNode)];
  for (const name of names) {
    if (name && name !== 'arguments' && name !== 'eval' && !seenNames.has(name)) {
      seenNames.add(name);
      candidates.push(makeSafeNumericParam(name));
    }
  }

  if (ctxOpts?.aliasIdentA && ctxOpts?.aliasIdentB) {
    const slot0 = (fnIndex + 0) & 3;
    const slot1 = (fnIndex + 1) & 3;
    candidates.push(makeBinary('|', makeMemberIndex(ctxOpts.aliasIdentA, makeLiteral(slot0)), makeLiteral(0)));
    candidates.push(makeBinary('|', makeMemberIndex(ctxOpts.aliasIdentB, makeLiteral(slot1)), makeLiteral(0)));
  }

  if (!isArrowFn) {
    candidates.push({
      type: 'MemberExpression',
      computed: false,
      object: { type: 'Identifier', name: 'arguments' },
      property: { type: 'Identifier', name: 'length' },
    });
  }

  candidates.push({
    type: 'MemberExpression',
    computed: false,
    object: makeUnary('typeof', { type: 'Identifier', name: 'globalThis' }),
    property: { type: 'Identifier', name: 'length' },
  });

  candidates.push({
    type: 'MemberExpression',
    computed: false,
    object: makeUnary('typeof', {
      type: 'MemberExpression',
      computed: false,
      object: { type: 'Identifier', name: 'Math' },
      property: { type: 'Identifier', name: 'imul' },
    }),
    property: { type: 'Identifier', name: 'length' },
  });

  candidates.push({
    type: 'MemberExpression',
    computed: false,
    object: makeUnary('typeof', { type: 'Identifier', name: 'Object' }),
    property: { type: 'Identifier', name: 'length' },
  });

  while (candidates.length < 4) {
    const base = candidates[0] ?? makeLiteral(mixSeed32(seed, fnIndex));
    const m = mixSeed32(seed, fnIndex + candidates.length * 19);
    candidates.push(makeBinary('^', cloneNode(base), makeInt32Literal(m)));
  }

  return [candidates[0], candidates[1], candidates[2], candidates[3]];
}

interface QnrFamilySpec {
  add: number;
  mask: number;
  target: number;
  outBoundOp: '>' | '<';
  outBoundVal: number;
  bitKind: 'xor1' | 'or2';
  expectedBit: 0 | 1;
}

const QNR_RESIDUE_FAMILIES: readonly QnrFamilySpec[] = [
  // LHS in {1, 2}: > 2 is false; ((v ^ (v >> 1)) & 1) === 1
  { add: 1, mask: 3, target: 3, outBoundOp: '>', outBoundVal: 2, bitKind: 'xor1', expectedBit: 1 },
  // LHS in {3, 4, 7}: < 3 is false; ((v | (v >> 2)) & 1) === 1
  { add: 3, mask: 7, target: 6, outBoundOp: '<', outBoundVal: 3, bitKind: 'or2', expectedBit: 1 },
  // LHS in {1, 5, 6}: > 6 is false; ((v ^ (v >> 1)) & 1) === 1
  { add: 5, mask: 7, target: 3, outBoundOp: '>', outBoundVal: 6, bitKind: 'xor1', expectedBit: 1 },
  // LHS in {0, 7, 8, 11}: > 11 is false; ((v ^ (v >> 1)) & 1) === 0
  { add: 7, mask: 15, target: 13, outBoundOp: '>', outBoundVal: 11, bitKind: 'xor1', expectedBit: 0 },
];

function makeTypeofGlobalLen(): any {
  return {
    type: 'MemberExpression',
    computed: false,
    object: makeUnary('typeof', { type: 'Identifier', name: 'globalThis' }),
    property: { type: 'Identifier', name: 'length' },
  };
}

function makePropAccess(objExpr: any, propName: string): any {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propName)) {
    return {
      type: 'MemberExpression',
      computed: false,
      object: objExpr,
      property: { type: 'Identifier', name: propName },
    };
  }
  return {
    type: 'MemberExpression',
    computed: true,
    object: objExpr,
    property: makeLiteral(propName),
  };
}

function buildQnrBitExpr(qnrValRef: any, bitKind: 'xor1' | 'or2'): any {
  const shiftAmt = bitKind === 'xor1' ? 1 : 2;
  const combOp = bitKind === 'xor1' ? '^' : '|';
  return makeBinary(
    '&',
    makeBinary(
      combOp,
      cloneNode(qnrValRef),
      makeBinary('>>', cloneNode(qnrValRef), makeLiteral(shiftAmt))
    ),
    makeLiteral(1)
  );
}

/**
 * Generates a non-zero-identical Quadratic Non-Residue (QNR) / MBA opaque predicate
 * across 4 modular residue families (mod 4, mod 8, mod 16) and 6 diversified
 * runtime state-, shield-, and domain-coupled predicate forms (eliminating fixed `=== R` suffixes):
 * - Form 0: Dual-path state invariant `(pathA ^ pathB) !== 0`
 * - Form 1: Shield-coupled compound condition (`qnrFail || globalThis[sym + '_s'][0] === 2`)
 * - Form 2: Cross-slot alias inequality (`>` / `<` over two distinct `_uAl`/`_uAm` slots)
 * - Form 3: State-masked non-literal QNR target comparison
 * - Form 4: Unsigned-domain MBA inequality (`((u | (u - 1 >>> 0)) >>> 0) < ((u ^ (u - 1 >>> 0)) >>> 0)`)
 * - Form 5: Parameterized affine-inverse MBA identity over `Z_{2^32}`
 */
export function createSotaMbaPredicate(
  seed: number,
  fnIndex = 0,
  paramNode?: string | acorn.Pattern,
  decoyIdent?: string,
  isArrowFn = false,
  ctxOpts?: Mba4ContextOptions
): acorn.IfStatement {
  const domain = ctxOpts?.returnDomain ?? 'object';
  const [x1, x2, x3, x4] = buildLiveVariables4(seed, fnIndex, paramNode, isArrowFn, ctxOpts);
  const mba4 = buildMba4Ast(seed, fnIndex, x1, x2, x3, x4);
  const qnrFamilyIdx = ((seed ^ Math.imul(fnIndex + 1, 0x9e3779b1)) >>> 0) % QNR_RESIDUE_FAMILIES.length;
  const qnrFamily = QNR_RESIDUE_FAMILIES[qnrFamilyIdx];

  const slotA = (fnIndex + (seed & 3)) & 3;
  const slotB = (slotA + 1 + ((seed >>> 2) & 1)) & 3;
  const hasAlias = Boolean(ctxOpts?.aliasIdentA);
  const aliasReadIdent = ctxOpts?.aliasIdentB ?? ctxOpts?.aliasIdentA ?? '';

  let qnrLeft: any;
  let qnrValForForm0: any;
  let zRefForDecoy: any;
  let aliasInvZero: any = null;

  if (ctxOpts?.mxIdent && ctxOpts?.scratchVarIdent && hasAlias) {
    const scratchId = { type: 'Identifier', name: ctxOpts.scratchVarIdent };
    const names = [...(ctxOpts?.liveVars ?? []), ...extractParamNames(paramNode)];
    const uniqueNames: string[] = [];
    for (const n of names) {
      if (n && n !== 'arguments' && n !== 'eval' && !uniqueNames.includes(n)) {
        uniqueNames.push(n);
      }
    }
    const arg0 =
      uniqueNames.length >= 1
        ? makeSafeNumericParam(uniqueNames[0])
        : !isArrowFn
          ? {
              type: 'MemberExpression',
              computed: false,
              object: { type: 'Identifier', name: 'arguments' },
              property: { type: 'Identifier', name: 'length' },
            }
          : makeTypeofGlobalLen();
    const arg1 =
      uniqueNames.length >= 2
        ? makeSafeNumericParam(uniqueNames[1])
        : uniqueNames.length === 1 && !isArrowFn
          ? {
              type: 'MemberExpression',
              computed: false,
              object: { type: 'Identifier', name: 'arguments' },
              property: { type: 'Identifier', name: 'length' },
            }
          : makeTypeofGlobalLen();

    const a0 = mixSeed32(seed, fnIndex * 13 + 3);
    const a1 = mixSeed32(seed, fnIndex * 13 + 5) | 1;
    const a2 = mixSeed32(seed, fnIndex * 13 + 7) & ~1;
    const a3 = mixSeed32(seed, fnIndex * 13 + 9) & ~1;
    const maskConst = mixSeed32(seed, fnIndex + 97) | 1;
    const r0 = mixSeed32(seed, fnIndex * 17 + 1);
    const r1 = mixSeed32(seed, fnIndex * 17 + 3) | 1;

    const seqExprs: any[] = [
      {
        type: 'AssignmentExpression',
        operator: '=',
        left: cloneNode(scratchId),
        right: {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: ctxOpts.mxIdent },
          arguments: [
            arg0,
            arg1,
            makeLiteral(slotA),
            makeLiteral(slotB),
            makeInt32Literal(maskConst),
            makeInt32Literal(a0),
            makeInt32Literal(a1),
            makeInt32Literal(a2),
            makeInt32Literal(a3),
          ],
          optional: false,
        },
      },
      {
        type: 'AssignmentExpression',
        operator: '=',
        left: cloneNode(scratchId),
        right: makeBinary(
          '|',
          makeBinary('+', makeInt32Literal(r0), makeImul(cloneNode(scratchId), makeInt32Literal(r1))),
          makeLiteral(0)
        ),
      },
    ];
    const qnrCore = makeBinary(
      '&',
      makeBinary('+', makeImul(cloneNode(scratchId), cloneNode(scratchId)), makeLiteral(qnrFamily.add)),
      makeLiteral(qnrFamily.mask)
    );
    qnrLeft = {
      type: 'SequenceExpression',
      expressions: [...seqExprs, qnrCore],
    };
    qnrValForForm0 = {
      type: 'SequenceExpression',
      expressions: [
        {
          type: 'AssignmentExpression',
          operator: '=',
          left: cloneNode(scratchId),
          right: cloneNode(qnrCore),
        },
        buildQnrBitExpr(scratchId, qnrFamily.bitKind),
      ],
    };
    zRefForDecoy = cloneNode(scratchId);
  } else if (ctxOpts?.scratchVarIdent) {
    const scratchId = { type: 'Identifier', name: ctxOpts.scratchVarIdent };
    const rivestOnScratch = buildRivestPermAst(seed, fnIndex, scratchId);
    const seqExprs: any[] = [
      {
        type: 'AssignmentExpression',
        operator: '=',
        left: cloneNode(scratchId),
        right: mba4,
      },
      {
        type: 'AssignmentExpression',
        operator: '=',
        left: cloneNode(scratchId),
        right: rivestOnScratch,
      },
    ];
    if (ctxOpts.sboxIdent) {
      seqExprs.push({
        type: 'AssignmentExpression',
        operator: '=',
        left: cloneNode(scratchId),
        right: buildSboxMixAst(ctxOpts.sboxIdent, ctxOpts.scratchVarIdent),
      });
    }
    if (hasAlias) {
      const aliasWriteMemA = makeMemberIndex(ctxOpts.aliasIdentA!, makeLiteral(slotA));
      const maskConst = mixSeed32(seed, fnIndex + 97) | 1;
      const updateMask = makeBinary(
        '^',
        makeBinary('<<', cloneNode(scratchId), makeLiteral(3)),
        makeInt32Literal(maskConst)
      );
      seqExprs.push({
        type: 'AssignmentExpression',
        operator: '=',
        left: cloneNode(aliasWriteMemA),
        right: makeBinary('|', makeBinary('^', cloneNode(aliasWriteMemA), cloneNode(updateMask)), makeLiteral(0)),
      });
      aliasInvZero = makeBinary(
        '^',
        makeBinary('|', makeBinary('^', cloneNode(aliasWriteMemA), cloneNode(updateMask)), makeLiteral(0)),
        {
          type: 'AssignmentExpression',
          operator: '=',
          left: cloneNode(aliasWriteMemA),
          right: makeBinary('|', makeBinary('^', cloneNode(aliasWriteMemA), cloneNode(updateMask)), makeLiteral(0)),
        }
      );
    }
    const qnrCore = makeBinary(
      '&',
      makeBinary('+', makeImul(cloneNode(scratchId), cloneNode(scratchId)), makeLiteral(qnrFamily.add)),
      makeLiteral(qnrFamily.mask)
    );
    qnrLeft = {
      type: 'SequenceExpression',
      expressions: [...seqExprs, qnrCore],
    };
    qnrValForForm0 = {
      type: 'SequenceExpression',
      expressions: [
        {
          type: 'AssignmentExpression',
          operator: '=',
          left: cloneNode(scratchId),
          right: cloneNode(qnrCore),
        },
        buildQnrBitExpr(scratchId, qnrFamily.bitKind),
      ],
    };
    zRefForDecoy = cloneNode(scratchId);
  } else {
    const zExpr = buildRivestPermAst(seed, fnIndex, mba4);
    const qnrCore = makeBinary(
      '&',
      makeBinary('+', makeImul(cloneNode(zExpr), cloneNode(zExpr)), makeLiteral(qnrFamily.add)),
      makeLiteral(qnrFamily.mask)
    );
    qnrLeft = qnrCore;
    qnrValForForm0 = buildQnrBitExpr(qnrCore, qnrFamily.bitKind);
    zRefForDecoy = zExpr;
  }

  const consequent = createContextualDecoyConsequent(
    fnIndex,
    seed,
    domain,
    decoyIdent,
    zRefForDecoy
  );

  const hasShieldCoupling = Boolean(ctxOpts?.shieldCoupled && ctxOpts?.windowKeySymbol);
  const predOffset = hasShieldCoupling ? 1 : (seed >>> 2) % 6;
  const predForm = (((fnIndex + predOffset) % 6) + 6) % 6;

  let testExpr: any;
  if (predForm === 0) {
    // Form 0: Dual-path state invariant (pathA ^ pathB) !== 0
    // Evaluate seqExprs first, then aliasInvZero (while scratchId still holds S-box value), then qnrValForForm0.
    let pathACore = qnrValForForm0;
    if (aliasInvZero) {
      pathACore = makeBinary('^', aliasInvZero, qnrValForForm0);
    }
    if (hasAlias) {
      pathACore = makeBinary(
        '^',
        pathACore,
        makeBinary('&', makeMemberIndex(aliasReadIdent, makeLiteral(slotB)), makeLiteral(1))
      );
    }
    const pathA = ctxOpts?.scratchVarIdent
      ? {
          type: 'SequenceExpression',
          expressions: [...qnrLeft.expressions.slice(0, -1), pathACore],
        }
      : pathACore;
    const pathB = hasAlias
      ? makeBinary(
          '^',
          makeLiteral(qnrFamily.expectedBit),
          makeBinary('&', makeMemberIndex(ctxOpts!.aliasIdentA!, makeLiteral(slotB)), makeLiteral(1))
        )
      : makeLiteral(qnrFamily.expectedBit);
    testExpr = makeBinary('!==', makeBinary('^', pathA, pathB), makeLiteral(0));
  } else if (predForm === 1) {
    // Form 1: Shield-state coupled compound predicate (always evaluates qnrFail + aliasInvZero first)
    const qnrLhs = aliasInvZero
      ? makeBinary('+', qnrLeft, makeBinary('&', aliasInvZero, makeLiteral(1)))
      : qnrLeft;
    const qnrFail = makeBinary(qnrFamily.outBoundOp, qnrLhs, makeLiteral(qnrFamily.outBoundVal));
    const hasGlobal = makeBinary(
      '<',
      makeUnary('typeof', { type: 'Identifier', name: 'globalThis' }),
      makeLiteral('u')
    );
    const tamperCheck = hasShieldCoupling
      ? {
          type: 'LogicalExpression',
          operator: '&&',
          left: hasGlobal,
          right: {
            type: 'LogicalExpression',
            operator: '&&',
            left: makePropAccess({ type: 'Identifier', name: 'globalThis' }, `${ctxOpts!.windowKeySymbol}_s`),
            right: makeBinary(
              '===',
              {
                type: 'MemberExpression',
                computed: true,
                object: makePropAccess({ type: 'Identifier', name: 'globalThis' }, `${ctxOpts!.windowKeySymbol}_s`),
                property: makeLiteral(0),
              },
              makeLiteral(2)
            ),
          },
        }
      : {
          type: 'LogicalExpression',
          operator: '&&',
          left: hasGlobal,
          right: makeBinary(
            '===',
            makePropAccess({ type: 'Identifier', name: 'globalThis' }, '__unpeek_tampered'),
            makeUnary('!', makeLiteral(0))
          ),
        };
    testExpr = {
      type: 'LogicalExpression',
      operator: '||',
      left: qnrFail,
      right: tamperCheck,
    };
  } else if (predForm === 2) {
    // Form 2: Inequality (> / <) over two distinct _uAl / _uAm slots
    const slotReadB = hasAlias
      ? makeBinary('&', makeMemberIndex(aliasReadIdent, makeLiteral(slotB)), makeLiteral(7))
      : makeBinary('&', makeTypeofGlobalLen(), makeLiteral(7));
    const slotWriteB = hasAlias
      ? makeBinary('&', makeMemberIndex(ctxOpts!.aliasIdentA!, makeLiteral(slotB)), makeLiteral(7))
      : makeBinary('&', makeTypeofGlobalLen(), makeLiteral(7));
    let lhsExpr = makeBinary('+', qnrLeft, slotReadB);
    if (aliasInvZero) {
      lhsExpr = makeBinary('+', lhsExpr, makeBinary('&', aliasInvZero, makeLiteral(3)));
    }
    const rhsExpr = makeBinary('+', makeLiteral(qnrFamily.outBoundVal), slotWriteB);
    testExpr = makeBinary(qnrFamily.outBoundOp, lhsExpr, rhsExpr);
  } else if (predForm === 3) {
    // Form 3: State-masked QNR target (non-literal RHS)
    const tagLhs = hasAlias
      ? makeBinary('&', makeMemberIndex(ctxOpts!.aliasIdentA!, makeLiteral(slotB)), makeLiteral(0xf0))
      : makeBinary('&', makeBinary('<<', makeTypeofGlobalLen(), makeLiteral(4)), makeLiteral(0xf0));
    const tagRhsBase = hasAlias
      ? makeBinary('&', makeMemberIndex(aliasReadIdent, makeLiteral(slotB)), makeLiteral(0xf0))
      : makeBinary('&', makeBinary('<<', makeTypeofGlobalLen(), makeLiteral(4)), makeLiteral(0xf0));
    const tagRhs = aliasInvZero
      ? makeBinary('^', tagRhsBase, makeBinary('&', aliasInvZero, makeLiteral(0x0f)))
      : tagRhsBase;
    const lhsExpr = makeBinary('|', makeBinary('^', qnrLeft, tagLhs), makeLiteral(0));
    const rhsExpr = makeBinary('|', makeBinary('^', makeLiteral(qnrFamily.target), tagRhs), makeLiteral(0));
    testExpr = makeBinary('===', lhsExpr, rhsExpr);
  } else if (predForm === 4) {
    // Form 4: Unsigned-domain MBA inequality over uint32 (breaks signed static reasoning)
    // (((u | ((u - 1) >>> 0)) >>> 0) < ((u ^ ((u - 1) >>> 0)) >>> 0)), u = (scratch ^ k) >>> 0
    const k4 = (mixSeed32(seed, fnIndex * 29 + 13) >>> 0) || 1;
    if (ctxOpts?.scratchVarIdent) {
      const scratchId = { type: 'Identifier', name: ctxOpts.scratchVarIdent };
      const preU = aliasInvZero
        ? makeBinary('^', cloneNode(scratchId), aliasInvZero)
        : cloneNode(scratchId);
      const uAssign = {
        type: 'AssignmentExpression',
        operator: '=',
        left: cloneNode(scratchId),
        right: makeBinary('>>>', makeBinary('^', preU, makeLiteral(k4)), makeLiteral(0)),
      };
      const uMinus1Lhs = makeBinary('>>>', makeBinary('-', cloneNode(scratchId), makeLiteral(1)), makeLiteral(0));
      const uMinus1Rhs = makeBinary('>>>', makeBinary('-', cloneNode(scratchId), makeLiteral(1)), makeLiteral(0));
      const orU = makeBinary('>>>', makeBinary('|', cloneNode(scratchId), uMinus1Lhs), makeLiteral(0));
      const xorU = makeBinary('>>>', makeBinary('^', cloneNode(scratchId), uMinus1Rhs), makeLiteral(0));
      const lhsSeq = {
        type: 'SequenceExpression',
        expressions: [...qnrLeft.expressions.slice(0, -1), uAssign, orU],
      };
      testExpr = makeBinary('<', lhsSeq, xorU);
    } else {
      const uExpr = makeBinary('>>>', makeBinary('^', cloneNode(zRefForDecoy), makeLiteral(k4)), makeLiteral(0));
      const uMinus1Lhs = makeBinary('>>>', makeBinary('-', cloneNode(uExpr), makeLiteral(1)), makeLiteral(0));
      const uMinus1Rhs = makeBinary('>>>', makeBinary('-', cloneNode(uExpr), makeLiteral(1)), makeLiteral(0));
      const orU = makeBinary('>>>', makeBinary('|', cloneNode(uExpr), uMinus1Lhs), makeLiteral(0));
      const xorU = makeBinary('>>>', makeBinary('^', cloneNode(uExpr), uMinus1Rhs), makeLiteral(0));
      testExpr = makeBinary('<', orU, xorU);
    }
  } else {
    // Form 5: Parameterized affine-inverse MBA identity over Z_{2^32}
    // (((Math.imul(mInv, (Math.imul(m, scratch ^ k) + Math.imul(m2, scratch & k) + c) | 0) + d) | 0) !== ((scratch + k) | 0))
    const k5 = (mixSeed32(seed, fnIndex * 31 + 17) >>> 0) || 3;
    const { m, m2, mInv, c, d } = deriveAffineMbaParams(seed, fnIndex * 37 + 23);
    const buildAffineLhs = (valNode: any): any => {
      const inner = makeBinary(
        '|',
        makeBinary(
          '+',
          makeBinary(
            '+',
            makeImul(makeLiteral(m), makeBinary('^', cloneNode(valNode), makeLiteral(k5))),
            makeImul(makeLiteral(m2), makeBinary('&', cloneNode(valNode), makeLiteral(k5)))
          ),
          makeLiteral(c)
        ),
        makeLiteral(0)
      );
      return makeBinary(
        '|',
        makeBinary('+', makeImul(makeLiteral(mInv), inner), makeLiteral(d)),
        makeLiteral(0)
      );
    };
    const buildAffineRhs = (valNode: any): any =>
      makeBinary('|', makeBinary('+', cloneNode(valNode), makeLiteral(k5)), makeLiteral(0));

    if (ctxOpts?.scratchVarIdent) {
      const scratchId = { type: 'Identifier', name: ctxOpts.scratchVarIdent };
      const preSeqs = [...qnrLeft.expressions.slice(0, -1)];
      if (aliasInvZero) {
        preSeqs.push({
          type: 'AssignmentExpression',
          operator: '=',
          left: cloneNode(scratchId),
          right: makeBinary('|', makeBinary('^', cloneNode(scratchId), aliasInvZero), makeLiteral(0)),
        });
      }
      const lhsSeq = {
        type: 'SequenceExpression',
        expressions: [...preSeqs, buildAffineLhs(scratchId)],
      };
      testExpr = makeBinary('!==', lhsSeq, buildAffineRhs(scratchId));
    } else {
      testExpr = makeBinary('!==', buildAffineLhs(zRefForDecoy), buildAffineRhs(zRefForDecoy));
    }
  }

  return {
    type: 'IfStatement',
    test: testExpr,
    consequent,
    alternate: null,
  } as unknown as acorn.IfStatement;
}

export const createOpaqueGuardStatement = createSotaMbaPredicate;

function inferFunctionReturnDomain(fnNode: any): ColdReturnDomain {
  let hasReturnArg = false;
  let seenNumber = false;
  let seenBoolean = false;
  let seenString = false;
  let seenObject = false;

  function scanStmts(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) scanStmts(item);
      return;
    }
    if (
      node !== fnNode &&
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression')
    ) {
      return;
    }
    if (node.type === 'ReturnStatement') {
      if (!node.argument) return;
      hasReturnArg = true;
      const arg = node.argument;
      if (arg.type === 'Literal') {
        if (typeof arg.value === 'number') seenNumber = true;
        else if (typeof arg.value === 'boolean') seenBoolean = true;
        else if (typeof arg.value === 'string') seenString = true;
      } else if (arg.type === 'ObjectExpression' || arg.type === 'ArrayExpression') {
        seenObject = true;
      } else if (arg.type === 'BinaryExpression') {
        if (['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'].includes(arg.operator)) {
          seenBoolean = true;
        } else if (arg.operator !== '+') {
          seenNumber = true;
        }
      } else if (arg.type === 'UnaryExpression') {
        if (arg.operator === '!') seenBoolean = true;
        else if (arg.operator === 'typeof') seenString = true;
        else if (arg.operator === '-' || arg.operator === '+' || arg.operator === '~') seenNumber = true;
      }
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const val = node[key];
      if (val && typeof val === 'object') {
        scanStmts(val);
      }
    }
  }

  scanStmts(fnNode.body);
  if (!hasReturnArg && fnNode.body?.type === 'BlockStatement') return 'void';
  if (seenObject) return 'object';
  if (seenBoolean && !seenNumber && !seenString) return 'boolean';
  if (seenNumber && !seenBoolean && !seenString) return 'number';
  if (seenString && !seenNumber && !seenBoolean) return 'string';
  return 'object';
}

function createSboxAndAliasDeclarations(
  sboxIdent: string,
  aliasIdentA: string,
  aliasIdentB: string,
  scratchVarIdent: string,
  seed: number,
  mxIdent?: string
): acorn.VariableDeclaration {
  const sboxInit = acorn.parseExpressionAt(
    `(function(){var a=[],i,s=${seed | 0},j,t;for(i=0;i<256;i++)a[i]=i;for(i=255;i>0;i--){s=(Math.imul(s,1664525)+1013904223)|0;j=(s>>>0)%(i+1);t=a[i];a[i]=a[j];a[j]=t;}return a;})()`,
    0,
    { ecmaVersion: 'latest' }
  );

  const stateVals = [
    mixSeed32(seed, 101),
    mixSeed32(seed, 103),
    mixSeed32(seed, 107),
    mixSeed32(seed, 109),
  ];

  const declarations: any[] = [
    {
      type: 'VariableDeclarator',
      id: { type: 'Identifier', name: sboxIdent },
      init: sboxInit,
    },
    {
      type: 'VariableDeclarator',
      id: { type: 'Identifier', name: aliasIdentA },
      init: {
        type: 'ArrayExpression',
        elements: stateVals.map((v) => makeInt32Literal(v)),
      },
    },
    {
      type: 'VariableDeclarator',
      id: { type: 'Identifier', name: aliasIdentB },
      init: { type: 'Identifier', name: aliasIdentA },
    },
    {
      type: 'VariableDeclarator',
      id: { type: 'Identifier', name: scratchVarIdent },
      init: makeLiteral(0),
    },
  ];

  if (mxIdent) {
    const mbaAst = buildMba4Ast(
      seed,
      0,
      { type: 'Identifier', name: '$u' },
      { type: 'Identifier', name: '$v' },
      { type: 'Identifier', name: '$p' },
      { type: 'Identifier', name: '$q' }
    );
    const mxFn = {
      type: 'FunctionExpression',
      id: null,
      params: [
        { type: 'Identifier', name: '$a' },
        { type: 'Identifier', name: '$b' },
        { type: 'Identifier', name: '$c' },
        { type: 'Identifier', name: '$d' },
        { type: 'Identifier', name: '$e' },
        { type: 'Identifier', name: '$f' },
        { type: 'Identifier', name: '$g' },
        { type: 'Identifier', name: '$h' },
        { type: 'Identifier', name: '$i' },
      ],
      body: {
        type: 'BlockStatement',
        body: [
          {
            type: 'VariableDeclaration',
            kind: 'var',
            declarations: [
              { type: 'VariableDeclarator', id: { type: 'Identifier', name: '$u' }, init: makeBinary('|', { type: 'Identifier', name: '$a' }, makeLiteral(0)) },
              { type: 'VariableDeclarator', id: { type: 'Identifier', name: '$v' }, init: makeBinary('|', { type: 'Identifier', name: '$b' }, makeLiteral(0)) },
              { type: 'VariableDeclarator', id: { type: 'Identifier', name: '$p' }, init: makeBinary('|', makeMemberIndex(aliasIdentA, { type: 'Identifier', name: '$c' }), makeLiteral(0)) },
              { type: 'VariableDeclarator', id: { type: 'Identifier', name: '$q' }, init: makeBinary('|', makeMemberIndex(aliasIdentB, { type: 'Identifier', name: '$d' }), makeLiteral(0)) },
              { type: 'VariableDeclarator', id: { type: 'Identifier', name: '$z' }, init: mbaAst },
            ],
          },
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: { type: 'Identifier', name: '$z' },
              right: makeBinary(
                '|',
                makeBinary(
                  '+',
                  { type: 'Identifier', name: '$f' },
                  makeImul(
                    { type: 'Identifier', name: '$z' },
                    makeBinary(
                      '+',
                      { type: 'Identifier', name: '$g' },
                      makeImul(
                        { type: 'Identifier', name: '$z' },
                        makeBinary(
                          '+',
                          { type: 'Identifier', name: '$h' },
                          makeImul({ type: 'Identifier', name: '$z' }, { type: 'Identifier', name: '$i' })
                        )
                      )
                    )
                  )
                ),
                makeLiteral(0)
              ),
            },
          },
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: { type: 'Identifier', name: '$z' },
              right: buildSboxMixAst(sboxIdent, '$z'),
            },
          },
          {
            type: 'VariableDeclaration',
            kind: 'var',
            declarations: [
              {
                type: 'VariableDeclarator',
                id: { type: 'Identifier', name: '$m' },
                init: makeBinary('^', makeBinary('<<', { type: 'Identifier', name: '$z' }, makeLiteral(3)), { type: 'Identifier', name: '$e' }),
              },
            ],
          },
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: makeMemberIndex(aliasIdentA, { type: 'Identifier', name: '$c' }),
              right: makeBinary('|', makeBinary('^', makeMemberIndex(aliasIdentA, { type: 'Identifier', name: '$c' }), { type: 'Identifier', name: '$m' }), makeLiteral(0)),
            },
          },
          {
            type: 'VariableDeclaration',
            kind: 'var',
            declarations: [
              {
                type: 'VariableDeclarator',
                id: { type: 'Identifier', name: '$w' },
                init: makeBinary(
                  '^',
                  makeBinary('|', makeBinary('^', makeMemberIndex(aliasIdentA, { type: 'Identifier', name: '$c' }), { type: 'Identifier', name: '$m' }), makeLiteral(0)),
                  {
                    type: 'AssignmentExpression',
                    operator: '=',
                    left: makeMemberIndex(aliasIdentA, { type: 'Identifier', name: '$c' }),
                    right: makeBinary('|', makeBinary('^', makeMemberIndex(aliasIdentA, { type: 'Identifier', name: '$c' }), { type: 'Identifier', name: '$m' }), makeLiteral(0)),
                  }
                ),
              },
            ],
          },
          {
            type: 'ReturnStatement',
            argument: {
              type: 'AssignmentExpression',
              operator: '=',
              left: { type: 'Identifier', name: scratchVarIdent },
              right: makeBinary('|', makeBinary('^', { type: 'Identifier', name: '$z' }, { type: 'Identifier', name: '$w' }), makeLiteral(0)),
            },
          },
        ],
      },
      generator: false,
      async: false,
      expression: false,
    };
    declarations.push({
      type: 'VariableDeclarator',
      id: { type: 'Identifier', name: mxIdent },
      init: mxFn,
    });
  }

  return {
    type: 'VariableDeclaration',
    kind: 'var',
    declarations,
  } as unknown as acorn.VariableDeclaration;
}

/**
 * RFC-002: Maximum cold guards per bundle chunk to strictly enforce
 * the 250 KB bundle ceiling (Edebio) and keep Gzip overhead <15%.
 */
export const MAX_COLD_GUARDS_PER_CHUNK = 12;

/**
 * O1: Maximum cold-path bitwise instruction substitutions per bundle chunk
 * in strict / aggressive builds.
 */
export const MAX_COLD_BITWISE_MBA_PER_CHUNK = 8;

const BITWISE_MBA_OPS = new Set(['^', '|', '&']);

const BITWISE_LOOP_NODE_TYPES = new Set([
  'ForStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
]);

const BITWISE_FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const BITWISE_LEXICAL_SCOPE_TYPES = new Set([
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
  'StaticBlock',
]);

const FORBIDDEN_BITWISE_IDENTIFIERS = new Set([
  'arguments',
  'eval',
  'undefined',
  'NaN',
  'Infinity',
  'globalThis',
  'window',
  'self',
  'Math',
  'BigInt',
]);

function collectBoundPatternNames(pattern: any, out: string[]): void {
  if (!pattern || typeof pattern !== 'object') return;
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern.name);
      break;
    case 'AssignmentPattern':
      collectBoundPatternNames(pattern.left, out);
      break;
    case 'RestElement':
      collectBoundPatternNames(pattern.argument, out);
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements || []) {
        if (el) collectBoundPatternNames(el, out);
      }
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties || []) {
        if (prop.type === 'Property') {
          collectBoundPatternNames(prop.value, out);
        } else if (prop.type === 'RestElement') {
          collectBoundPatternNames(prop.argument, out);
        }
      }
      break;
  }
}

interface BitwiseMbaScopeAnalysis {
  unsafe: boolean;
  scopeBindings: Map<acorn.Node, Set<string>>;
}

function analyzeBitwiseMbaScopes(ast: acorn.Program): BitwiseMbaScopeAnalysis {
  const scopeBindings = new Map<acorn.Node, Set<string>>();
  let unsafe = false;

  const addBinding = (scopeNode: acorn.Node, name: string): void => {
    if (name === 'Math') {
      unsafe = true;
      return;
    }
    let set = scopeBindings.get(scopeNode);
    if (!set) {
      set = new Set();
      scopeBindings.set(scopeNode, set);
    }
    set.add(name);
  };

  const scopeStack: acorn.Node[] = [];
  const varTargetStack: acorn.Node[] = [];

  const getNearestLexicalScope = (): acorn.Node => scopeStack[scopeStack.length - 1] ?? ast;
  const getNearestVarScope = (): acorn.Node => varTargetStack[varTargetStack.length - 1] ?? ast;

  function scan(node: any): void {
    if (unsafe || !node || typeof node !== 'object' || typeof node.type !== 'string') {
      return;
    }

    if (node.type === 'WithStatement') {
      unsafe = true;
      return;
    }
    if (
      (node.type === 'Literal' && (typeof node.value === 'bigint' || typeof node.bigint === 'string')) ||
      node.type === 'BigIntLiteral'
    ) {
      unsafe = true;
      return;
    }
    if (node.type === 'Identifier' && node.name === 'BigInt') {
      unsafe = true;
      return;
    }

    if (
      node.type === 'ImportSpecifier' ||
      node.type === 'ImportDefaultSpecifier' ||
      node.type === 'ImportNamespaceSpecifier'
    ) {
      if (node.local?.type === 'Identifier') {
        addBinding(ast, node.local.name);
      }
    } else if (node.type === 'FunctionDeclaration') {
      if (node.id?.type === 'Identifier') {
        addBinding(getNearestLexicalScope(), node.id.name);
        addBinding(getNearestVarScope(), node.id.name);
      }
    } else if (node.type === 'ClassDeclaration') {
      if (node.id?.type === 'Identifier') {
        addBinding(getNearestLexicalScope(), node.id.name);
      }
    } else if (node.type === 'VariableDeclaration') {
      const targetScope = node.kind === 'var' ? getNearestVarScope() : getNearestLexicalScope();
      for (const decl of node.declarations || []) {
        const names: string[] = [];
        collectBoundPatternNames(decl.id, names);
        for (const name of names) {
          addBinding(targetScope, name);
        }
      }
    }

    if (unsafe) return;

    const pushesLexical = BITWISE_LEXICAL_SCOPE_TYPES.has(node.type);
    const isFn = BITWISE_FUNCTION_TYPES.has(node.type);
    const isStaticBlock = node.type === 'StaticBlock';

    if (pushesLexical) {
      scopeStack.push(node);
      if (!scopeBindings.has(node)) {
        scopeBindings.set(node, new Set());
      }
    }

    if (isFn) {
      if (node.id?.type === 'Identifier') {
        addBinding(node, node.id.name);
      }
      for (const param of node.params || []) {
        const names: string[] = [];
        collectBoundPatternNames(param, names);
        for (const name of names) {
          addBinding(node, name);
        }
      }
      // Hoist `var` bindings in a function body onto the body BlockStatement so
      // parameter default initializers cannot treat body `var`s as in-scope.
      const bodyScope = node.body?.type === 'BlockStatement' ? node.body : node;
      varTargetStack.push(bodyScope);
    } else if (node.type === 'Program' || isStaticBlock) {
      varTargetStack.push(node);
    } else if (node.type === 'CatchClause' && node.param) {
      const names: string[] = [];
      collectBoundPatternNames(node.param, names);
      for (const name of names) {
        addBinding(node, name);
      }
    } else if (node.type === 'ClassExpression' && node.id?.type === 'Identifier') {
      addBinding(node, node.id.name);
    }

    try {
      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'comments' || key === 'tokens') {
          continue;
        }
        const child = node[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            scan(item);
            if (unsafe) return;
          }
        } else if (child && typeof child === 'object') {
          scan(child);
          if (unsafe) return;
        }
      }
    } finally {
      if (isFn || node.type === 'Program' || isStaticBlock) {
        varTargetStack.pop();
      }
      if (pushesLexical) {
        scopeStack.pop();
      }
    }
  }

  scan(ast);
  return { unsafe, scopeBindings };
}

function isSafeAtomicIntegerLiteral(node: any): boolean {
  return Boolean(
    node &&
      node.type === 'Literal' &&
      typeof node.value === 'number' &&
      Number.isInteger(node.value) &&
      node.value >= 0 &&
      node.value <= 0xffffffff
  );
}

function isZeroNumericLiteral(node: any): boolean {
  return Boolean(node && node.type === 'Literal' && typeof node.value === 'number' && node.value === 0);
}

function isLocalBoundIdentifier(
  node: any,
  scopeStack: acorn.Node[],
  scopeBindings: Map<acorn.Node, Set<string>>,
  programNode: acorn.Program
): boolean {
  if (!node || node.type !== 'Identifier') return false;
  if (FORBIDDEN_BITWISE_IDENTIFIERS.has(node.name)) return false;
  for (let i = scopeStack.length - 1; i >= 0; i--) {
    const scopeNode = scopeStack[i];
    if (scopeNode === programNode) return false;
    const bindings = scopeBindings.get(scopeNode);
    if (bindings && bindings.has(node.name)) {
      return true;
    }
  }
  return false;
}

function buildColdBitwiseConditional(
  op: '^' | '|' | '&',
  left: any,
  right: any,
  seed: number,
  subIndex: number,
  hotExemptNodes?: WeakSet<acorn.Node>
): any {
  const { m, mInv, c, d } = deriveAffineMbaParams(seed, 0x4100 + subIndex * 43);

  const a1 = cloneNode(left);
  const b1 = cloneNode(right);
  const a2 = cloneNode(left);
  const b2 = cloneNode(right);

  let affineComb: any;
  if (op === '^') {
    affineComb = makeBinary(
      '-',
      makeImul(makeLiteral(m), makeBinary('|', a1, b1)),
      makeImul(makeLiteral(m), makeBinary('&', a2, b2))
    );
  } else if (op === '|') {
    affineComb = makeBinary(
      '+',
      makeImul(makeLiteral(m), makeBinary('&', a1, b1)),
      makeImul(makeLiteral(m), makeBinary('^', a2, b2))
    );
  } else {
    affineComb = makeBinary(
      '-',
      makeImul(makeLiteral(m), makeBinary('|', a1, b1)),
      makeImul(makeLiteral(m), makeBinary('^', a2, b2))
    );
  }

  const innerWithC = makeBinary('|', makeBinary('+', affineComb, makeLiteral(c)), makeLiteral(0));
  const consequent = makeBinary(
    '|',
    makeBinary('+', makeImul(makeLiteral(mInv), innerWithC), makeLiteral(d)),
    makeLiteral(0)
  );
  const alternate = makeBinary(op, cloneNode(left), cloneNode(right));

  const exemptNodes: any[] = [];
  const uniqueIdents: any[] = [];
  const seenNames = new Set<string>();
  for (const operand of [left, right]) {
    if (operand?.type === 'Identifier' && !seenNames.has(operand.name)) {
      seenNames.add(operand.name);
      uniqueIdents.push(operand);
    }
  }

  const makeIsNumberExpr = (ident: any): any => {
    const numLit = makeLiteral('number');
    const eqNode = makeBinary('===', makeUnary('typeof', { type: 'Identifier', name: ident.name }), numLit);
    exemptNodes.push(numLit, eqNode);
    return eqNode;
  };

  const testExpr =
    uniqueIdents.length === 2
      ? {
          type: 'LogicalExpression',
          operator: '&&',
          left: makeIsNumberExpr(uniqueIdents[0]),
          right: makeIsNumberExpr(uniqueIdents[1]),
        }
      : makeIsNumberExpr(uniqueIdents[0]);

  const replacement: any = {
    type: 'ConditionalExpression',
    test: testExpr,
    consequent,
    alternate,
    _unpeekGuardSubtree: true,
  };

  if (hotExemptNodes) {
    hotExemptNodes.add(replacement);
    hotExemptNodes.add(testExpr);
    for (const nodeToExempt of exemptNodes) {
      hotExemptNodes.add(nodeToExempt);
    }
  }

  return replacement;
}

/**
 * O1: Substitutes cold-path 32-bit bitwise operations (`^`, `|`, `&`, excluding `x | 0`)
 * with number-guarded parameterized affine MBA expressions when strict / aggressive mode
 * is active, preserving exact semantics for BigInt and object operands via fallback.
 */
export function applyColdBitwiseMba(
  ast: acorn.Program,
  coldFunctionNodes: WeakSet<acorn.Node>,
  seed = 0x9e3779b9,
  hotExemptNodes?: WeakSet<acorn.Node>,
  guardSubtreeNodes?: WeakSet<acorn.Node>
): number {
  const { unsafe, scopeBindings } = analyzeBitwiseMbaScopes(ast);
  if (unsafe) return 0;

  let mbaCount = 0;
  const scopeStack: acorn.Node[] = [];

  function walkTransform(
    node: any,
    setInParent: (replacement: any) => void,
    inColdFn: boolean
  ): void {
    if (mbaCount >= MAX_COLD_BITWISE_MBA_PER_CHUNK) return;
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    if (hotExemptNodes?.has(node) || guardSubtreeNodes?.has(node)) return;
    if ((node as any)._unpeekGuardSubtree === true) return;
    if ((node as any)._unpeekSerialized || (node as any)._unpeekVirtualized === true) return;
    if (BITWISE_LOOP_NODE_TYPES.has(node.type)) return;

    const pushedScope = scopeBindings.has(node);
    if (pushedScope) scopeStack.push(node);

    try {
      const childInColdFn = BITWISE_FUNCTION_TYPES.has(node.type)
        ? coldFunctionNodes.has(node)
        : inColdFn;

      if (childInColdFn && node.type === 'BinaryExpression' && BITWISE_MBA_OPS.has(node.operator)) {
        const op = node.operator as '^' | '|' | '&';
        const { left, right } = node;
        const isCoercionOrZero = op === '|' && isZeroNumericLiteral(right);
        if (!isCoercionOrZero) {
          const leftAtomic =
            isSafeAtomicIntegerLiteral(left) ||
            isLocalBoundIdentifier(left, scopeStack, scopeBindings, ast);
          const rightAtomic =
            isSafeAtomicIntegerLiteral(right) ||
            isLocalBoundIdentifier(right, scopeStack, scopeBindings, ast);
          const hasIdent = left?.type === 'Identifier' || right?.type === 'Identifier';
          if (leftAtomic && rightAtomic && hasIdent) {
            const replacement = buildColdBitwiseConditional(
              op,
              left,
              right,
              seed,
              mbaCount,
              hotExemptNodes
            );
            mbaCount++;
            setInParent(replacement);
            return;
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (mbaCount >= MAX_COLD_BITWISE_MBA_PER_CHUNK) break;
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'comments' || key === 'tokens') {
          continue;
        }
        const child = node[key];
        if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            if (mbaCount >= MAX_COLD_BITWISE_MBA_PER_CHUNK) break;
            const item = child[i];
            if (item && typeof item === 'object' && typeof item.type === 'string') {
              walkTransform(
                item,
                (rep) => {
                  child[i] = rep;
                },
                childInColdFn
              );
            }
          }
        } else if (child && typeof child === 'object' && typeof child.type === 'string') {
          walkTransform(
            child,
            (rep) => {
              node[key] = rep;
            },
            childInColdFn
          );
        }
      }
    } finally {
      if (pushedScope) scopeStack.pop();
    }
  }

  walkTransform(ast, () => {}, false);
  return mbaCount;
}

export function applyColdFlowGuard(
  ast: acorn.Program,
  coldFunctionNodes: WeakSet<acorn.Node>,
  seed = 0x9e3779b9,
  hotExemptNodes?: WeakSet<acorn.Node>,
  windowKeySymbol?: string,
  expectedDelta?: number,
  shieldCoupled = false,
  options?: ApplyColdFlowGuardOptions
): number {
  const sfx = (seed >>> 0).toString(36).slice(0, 4);
  const decoyIdent = `_uDec${sfx}`;
  const sboxIdent = `_uSb${sfx}`;
  const aliasIdentA = `_uAl${sfx}`;
  const aliasIdentB = `_uAm${sfx}`;
  const scratchVarIdent = `_uZt${sfx}`;
  const mxIdent = `_uMx${sfx}`;

  if (Array.isArray(ast.body)) {
    const alreadyGuarded = ast.body.some(
      (stmt: any) =>
        stmt.type === 'VariableDeclaration' &&
        stmt.declarations?.some(
          (d: any) =>
            d.id?.type === 'Identifier' &&
            (d.id.name === decoyIdent || d.id.name === sboxIdent || d.id.name === mxIdent)
        )
    );
    if (alreadyGuarded) return 0;
  }

  if (options?.enableBitwiseMba) {
    applyColdBitwiseMba(ast, coldFunctionNodes, seed, hotExemptNodes);
  }

  let guardedCount = 0;

  function maybeInjectGuard(node: any): void {
    if (guardedCount >= MAX_COLD_GUARDS_PER_CHUNK) return;
    if (!coldFunctionNodes.has(node)) return;
    if (hotExemptNodes?.has(node) || (node as any)._unpeekSerialized) return;
    if ((node as any)._unpeekVirtualized === true) return;
    if (!node.body || node.body.type !== 'BlockStatement') return;

    const paramNames: string[] = [];
    for (const p of node.params || []) {
      extractParamNames(p, paramNames);
    }
    const firstParam = node.params?.[0];
    const isArrow = node.type === 'ArrowFunctionExpression';
    const returnDomain = inferFunctionReturnDomain(node);

    const guardStmt = createSotaMbaPredicate(
      seed,
      guardedCount,
      firstParam,
      decoyIdent,
      isArrow,
      {
        liveVars: paramNames,
        sboxIdent,
        aliasIdentA,
        aliasIdentB,
        scratchVarIdent,
        mxIdent,
        returnDomain,
        windowKeySymbol,
        expectedDelta,
        shieldCoupled,
      }
    );
    guardedCount++;
    (guardStmt as any)._unpeekGuardSubtree = true;

    if (hotExemptNodes) {
      hotExemptNodes.add(guardStmt);
      hotExemptNodes.add(guardStmt.consequent);
    }

    // Insert after any leading 'use strict' directive inside the function body
    let insertIdx = 0;
    while (
      insertIdx < node.body.body.length &&
      node.body.body[insertIdx].type === 'ExpressionStatement' &&
      node.body.body[insertIdx].directive
    ) {
      insertIdx++;
    }
    node.body.body.splice(insertIdx, 0, guardStmt);
  }

  walk.simple(ast, {
    FunctionDeclaration: maybeInjectGuard,
    FunctionExpression: maybeInjectGuard,
    ArrowFunctionExpression: maybeInjectGuard,
  });

  if (guardedCount > 0 && Array.isArray(ast.body)) {
    const sharedDecoyDecl = createSharedDecoyDeclaration(
      decoyIdent,
      guardedCount,
      seed
    );
    const sboxAliasDecl = createSboxAndAliasDeclarations(
      sboxIdent,
      aliasIdentA,
      aliasIdentB,
      scratchVarIdent,
      seed,
      mxIdent
    );

    if (hotExemptNodes) {
      hotExemptNodes.add(sharedDecoyDecl);
      hotExemptNodes.add(sboxAliasDecl);
      for (const decl of sboxAliasDecl.declarations || []) {
        if (decl.init?.type === 'FunctionExpression') {
          hotExemptNodes.add(decl.init);
        }
      }
      for (const decl of sharedDecoyDecl.declarations || []) {
        if (decl.init?.type === 'ArrayExpression' && decl.init.elements) {
          for (const el of decl.init.elements) {
            if (el) hotExemptNodes.add(el);
          }
        }
      }
    }

    let insertIdx = 0;
    while (insertIdx < ast.body.length) {
      const stmt: any = ast.body[insertIdx];
      const isDirective =
        stmt.type === 'ExpressionStatement' &&
        (Boolean(stmt.directive) ||
          (stmt.expression?.type === 'Literal' &&
            typeof stmt.expression.value === 'string' &&
            /^(?:use\s+[a-zA-Z0-9_-]+)/.test(stmt.expression.value.trim())));
      if (isDirective || stmt.type === 'ImportDeclaration') {
        insertIdx++;
      } else {
        break;
      }
    }
    ast.body.splice(insertIdx, 0, sboxAliasDecl, sharedDecoyDecl);
  }

  return guardedCount;
}
