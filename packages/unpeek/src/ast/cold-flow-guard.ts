import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

function createDecoyObjectExpression(model: number): any {
  const m = Math.abs(model) % 3;
  if (m === 0) {
    // Model 0: Sahte yetkilendirme baypası (/api/v2/auth/admin-bypass, superadmin_token, elevate)
    return {
      type: 'ObjectExpression',
      properties: [
        {
          type: 'Property',
          key: { type: 'Identifier', name: 'endpoint' },
          value: {
            type: 'Literal',
            value: '/api/v2/auth/admin-bypass',
            raw: '"/api/v2/auth/admin-bypass"',
          },
          kind: 'init',
          computed: false,
          method: false,
          shorthand: false,
        },
        {
          type: 'Property',
          key: { type: 'Identifier', name: 'superadmin_token' },
          value: { type: 'Literal', value: 1, raw: '1' },
          kind: 'init',
          computed: false,
          method: false,
          shorthand: false,
        },
        {
          type: 'Property',
          key: { type: 'Identifier', name: 'elevate' },
          value: { type: 'Literal', value: 1, raw: '1' },
          kind: 'init',
          computed: false,
          method: false,
          shorthand: false,
        },
      ],
    };
  }

  if (m === 1) {
    // Model 1: Sahte master JWT doğrulama (_verifyMasterToken, mock_jwt_bypass_signature, authorized: true)
    return {
      type: 'ObjectExpression',
      properties: [
        {
          type: 'Property',
          key: { type: 'Identifier', name: 'endpoint' },
          value: {
            type: 'Literal',
            value: '/api/v2/auth/verify-master',
            raw: '"/api/v2/auth/verify-master"',
          },
          kind: 'init',
          computed: false,
          method: false,
          shorthand: false,
        },
        {
          type: 'Property',
          key: { type: 'Identifier', name: '_verifyMasterToken' },
          value: { type: 'Literal', value: true, raw: 'true' },
          kind: 'init',
          computed: false,
          method: false,
          shorthand: false,
        },
        {
          type: 'Property',
          key: { type: 'Identifier', name: '_bypassToken' },
          value: {
            type: 'Literal',
            value: 'mock_jwt_bypass_signature',
            raw: '"mock_jwt_bypass_signature"',
          },
          kind: 'init',
          computed: false,
          method: false,
          shorthand: false,
        },
        {
          type: 'Property',
          key: { type: 'Identifier', name: 'authorized' },
          value: { type: 'Literal', value: true, raw: 'true' },
          kind: 'init',
          computed: false,
          method: false,
          shorthand: false,
        },
      ],
    };
  }

  // Model 2: Sahte telemetri hata ayıklama ve süpervizör anahtarı (debug_supervisor_override, mfa_bypassed: true)
  return {
    type: 'ObjectExpression',
    properties: [
      {
        type: 'Property',
        key: { type: 'Identifier', name: 'endpoint' },
        value: {
          type: 'Literal',
          value: '/api/v2/auth/debug-telemetry',
          raw: '"/api/v2/auth/debug-telemetry"',
        },
        kind: 'init',
        computed: false,
        method: false,
        shorthand: false,
      },
      {
        type: 'Property',
        key: { type: 'Identifier', name: 'debug_supervisor_override' },
        value: { type: 'Literal', value: true, raw: 'true' },
        kind: 'init',
        computed: false,
        method: false,
        shorthand: false,
      },
      {
        type: 'Property',
        key: { type: 'Identifier', name: '_bypassToken' },
        value: {
          type: 'Literal',
          value: 'superadmin_token',
          raw: '"superadmin_token"',
        },
        kind: 'init',
        computed: false,
        method: false,
        shorthand: false,
      },
      {
        type: 'Property',
        key: { type: 'Identifier', name: 'mfa_bypassed' },
        value: { type: 'Literal', value: true, raw: 'true' },
        kind: 'init',
        computed: false,
        method: false,
        shorthand: false,
      },
    ],
  };
}

function createDecoyConsequent(fnIndex: number): any {
  return {
    type: 'BlockStatement',
    body: [
      {
        type: 'ReturnStatement',
        argument: createDecoyObjectExpression(fnIndex),
      },
    ],
  };
}

function createSharedDecoyConsequent(decoyIdent: string, fnIndex: number): any {
  const model = Math.abs(fnIndex) % 3;
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
            property: {
              type: 'Literal',
              value: model,
              raw: String(model),
            },
          },
          arguments: [],
        },
      },
    ],
  };
}

export function createSharedDecoyDeclaration(decoyIdent = '_d'): any {
  return {
    type: 'VariableDeclaration',
    kind: 'var',
    declarations: [
      {
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: decoyIdent },
        init: {
          type: 'ArrayExpression',
          elements: [0, 1, 2].map((m) => ({
            type: 'ArrowFunctionExpression',
            id: null,
            params: [],
            body: createDecoyObjectExpression(m),
            generator: false,
            async: false,
            expression: true,
          })),
        },
      },
    ],
  };
}

function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

export function createSotaMbaPredicate(
  seed: number,
  fnIndex = 0,
  paramNode?: any,
  decoyIdent?: string,
  isArrowFn = false
): any {
  // 32-bit non-linear Mixed Boolean-Arithmetic (MBA) opaque invariants:
  // Using contextual runtime zero z:
  // - If function has parameter: z = (param !== void 0 ? 0 : 0)
  // - If arrow function with no params: z = (+!String)
  // - If standard function with no params: z = (arguments.length & 0)
  // In V8 runtime, z === 0, but static SMT/constant-folding analyzers cannot resolve it.
  // v = (z | c1) === c1, k = (c2 | (!String)) === c2.
  // Target is non-zero, deterministic, seed- and index-derived integer (0x7fffffff signature is eliminated).
  const family = Math.abs((seed + fnIndex) & 3);
  const c1 = ((seed >>> 0) + Math.imul(family + 1, 0x45d9f3b)) | 0;
  const c2 = (c1 ^ 0x5a5a5a5a) | 0;
  const target =
    ((seed ^ Math.imul(family + 1, 0x9e3779b1)) & 0x7fffff) | 1;

  let paramName: string | null = null;
  if (typeof paramNode === 'string') {
    paramName = paramNode;
  } else if (paramNode?.type === 'Identifier') {
    paramName = paramNode.name;
  } else if (
    paramNode?.type === 'AssignmentPattern' &&
    paramNode.left?.type === 'Identifier'
  ) {
    paramName = paramNode.left.name;
  }

  const zNode: any = {
    type: 'UnaryExpression',
    operator: '+',
    prefix: true,
    argument: {
      type: 'UnaryExpression',
      operator: '!',
      prefix: true,
      argument: { type: 'Identifier', name: 'String' },
    },
  };

  const vNode: any = {
    type: 'BinaryExpression',
    operator: '|',
    left: zNode,
    right: { type: 'Literal', value: c1, raw: String(c1) },
  };

  const kNode: any = {
    type: 'BinaryExpression',
    operator: '|',
    left: { type: 'Literal', value: c2, raw: String(c2) },
    right: {
      type: 'UnaryExpression',
      operator: '!',
      prefix: true,
      argument: { type: 'Identifier', name: 'String' },
    },
  };

  let mbaExpr: any;
  if (family === 0) {
    // Aile 0: (((v ^ k) + ((v & k) << 1)) - (v + k)) ≡ 0
    const vXorK = {
      type: 'BinaryExpression',
      operator: '^',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    const vAndK = {
      type: 'BinaryExpression',
      operator: '&',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    const shift = {
      type: 'BinaryExpression',
      operator: '<<',
      left: vAndK,
      right: { type: 'Literal', value: 1, raw: '1' },
    };
    const addLeft = {
      type: 'BinaryExpression',
      operator: '+',
      left: vXorK,
      right: shift,
    };
    const vPlusK = {
      type: 'BinaryExpression',
      operator: '+',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    mbaExpr = {
      type: 'BinaryExpression',
      operator: '-',
      left: addLeft,
      right: vPlusK,
    };
  } else if (family === 1) {
    // Aile 1: (((v | k) + (v & k)) ^ (v + k)) ≡ 0
    const vOrK = {
      type: 'BinaryExpression',
      operator: '|',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    const vAndK = {
      type: 'BinaryExpression',
      operator: '&',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    const addLeft = {
      type: 'BinaryExpression',
      operator: '+',
      left: vOrK,
      right: vAndK,
    };
    const vPlusK = {
      type: 'BinaryExpression',
      operator: '+',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    mbaExpr = {
      type: 'BinaryExpression',
      operator: '^',
      left: addLeft,
      right: vPlusK,
    };
  } else if (family === 2) {
    // Aile 2: (((v | ~k) - (~k)) ^ (v & k)) ≡ 0
    const notK = {
      type: 'UnaryExpression',
      operator: '~',
      prefix: true,
      argument: cloneNode(kNode),
    };
    const vOrNotK = {
      type: 'BinaryExpression',
      operator: '|',
      left: cloneNode(vNode),
      right: cloneNode(notK),
    };
    const subLeft = {
      type: 'BinaryExpression',
      operator: '-',
      left: vOrNotK,
      right: cloneNode(notK),
    };
    const vAndK = {
      type: 'BinaryExpression',
      operator: '&',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    mbaExpr = {
      type: 'BinaryExpression',
      operator: '^',
      left: subLeft,
      right: vAndK,
    };
  } else {
    // Aile 3: (((v & ~k) + (v & k)) ^ v) ≡ 0
    const notK = {
      type: 'UnaryExpression',
      operator: '~',
      prefix: true,
      argument: cloneNode(kNode),
    };
    const vAndNotK = {
      type: 'BinaryExpression',
      operator: '&',
      left: cloneNode(vNode),
      right: cloneNode(notK),
    };
    const vAndK = {
      type: 'BinaryExpression',
      operator: '&',
      left: cloneNode(vNode),
      right: cloneNode(kNode),
    };
    const addLeft = {
      type: 'BinaryExpression',
      operator: '+',
      left: vAndNotK,
      right: vAndK,
    };
    mbaExpr = {
      type: 'BinaryExpression',
      operator: '^',
      left: addLeft,
      right: cloneNode(vNode),
    };
  }

  const decoyIdx = Math.abs(fnIndex) % 3;
  const consequent = decoyIdent
    ? createSharedDecoyConsequent(decoyIdent, decoyIdx)
    : createDecoyConsequent(decoyIdx);

  return {
    type: 'IfStatement',
    test: {
      type: 'BinaryExpression',
      operator: '===',
      left: mbaExpr,
      right: { type: 'Literal', value: target, raw: String(target) },
    },
    consequent,
    alternate: null,
  };
}

export const createOpaqueGuardStatement = createSotaMbaPredicate;

export function applyColdFlowGuard(
  ast: acorn.Program,
  coldFunctionNodes: WeakSet<acorn.Node>,
  seed = 0x9e3779b9,
  hotExemptNodes?: WeakSet<acorn.Node>
): number {
  const decoyIdent = '_d';
  if (Array.isArray(ast.body)) {
    const alreadyGuarded = ast.body.some(
      (stmt: any) =>
        stmt.type === 'VariableDeclaration' &&
        stmt.declarations?.some(
          (d: any) => d.id?.type === 'Identifier' && d.id.name === decoyIdent
        )
    );
    if (alreadyGuarded) return 0;
  }
  let guardedCount = 0;

  function maybeInjectGuard(node: any): void {
    if (!coldFunctionNodes.has(node)) return;
    if (!node.body || node.body.type !== 'BlockStatement') return;

    const firstParam = node.params?.[0];
    const isArrow = node.type === 'ArrowFunctionExpression';
    const guardStmt = createSotaMbaPredicate(
      seed,
      guardedCount,
      firstParam,
      decoyIdent,
      isArrow
    );
    guardedCount++;

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
    const sharedDecoyDecl = createSharedDecoyDeclaration(decoyIdent);
    if (hotExemptNodes) {
      hotExemptNodes.add(sharedDecoyDecl);
      for (const decl of sharedDecoyDecl.declarations || []) {
        if (decl.init?.elements) {
          for (const el of decl.init.elements) {
            hotExemptNodes.add(el);
          }
        }
      }
    }

    let insertIdx = 0;
    while (
      insertIdx < ast.body.length &&
      ast.body[insertIdx].type === 'ExpressionStatement' &&
      (ast.body[insertIdx] as any).directive
    ) {
      insertIdx++;
    }
    ast.body.splice(insertIdx, 0, sharedDecoyDecl);
  }

  return guardedCount;
}
