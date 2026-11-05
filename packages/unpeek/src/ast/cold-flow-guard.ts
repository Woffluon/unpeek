import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

function createDecoyConsequent(fnIndex: number): any {
  const model = Math.abs(fnIndex) % 3;
  if (model === 0) {
    // Model 0: Sahte yetkilendirme baypası (/api/v2/auth/admin-bypass, superadmin_token, elevate)
    return {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: {
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
          },
        },
      ],
    };
  }

  if (model === 1) {
    // Model 1: Sahte master JWT doğrulama (_verifyMasterToken, mock_jwt_bypass_signature, authorized: true)
    return {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: {
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
          },
        },
      ],
    };
  }

  // Model 2: Sahte telemetri hata ayıklama ve süpervizör anahtarı (debug_supervisor_override, mfa_bypassed: true)
  return {
    type: 'BlockStatement',
    body: [
      {
        type: 'ReturnStatement',
        argument: {
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
        },
      },
    ],
  };
}

export function createSotaMbaPredicate(seed: number, fnIndex = 0): any {
  // 32-bit non-linear Mixed Boolean-Arithmetic (MBA) opaque invariant:
  // ∀ x, y ∈ ℤ₃₂: ((x | y) + (x & y)) ≡ (x + y)
  // Therefore: ((((x | y) + (x & y)) ^ (x + y)) | !String) ≡ 0
  // Comparing with 0x7fffffff (2147483647) is guaranteed false while frustrating static SMT solvers
  const x = ((seed >>> 0) + Math.imul(fnIndex + 1, 0x45d9f3b)) | 0;
  const y = (x ^ 0x5a5a5a5a) | 0;

  return {
    type: 'IfStatement',
    test: {
      type: 'BinaryExpression',
      operator: '===',
      left: {
        type: 'BinaryExpression',
        operator: '|',
        left: {
          type: 'BinaryExpression',
          operator: '^',
          left: {
            type: 'BinaryExpression',
            operator: '+',
            left: {
              type: 'BinaryExpression',
              operator: '|',
              left: { type: 'Literal', value: x, raw: String(x) },
              right: { type: 'Literal', value: y, raw: String(y) },
            },
            right: {
              type: 'BinaryExpression',
              operator: '&',
              left: { type: 'Literal', value: x, raw: String(x) },
              right: { type: 'Literal', value: y, raw: String(y) },
            },
          },
          right: {
            type: 'BinaryExpression',
            operator: '+',
            left: { type: 'Literal', value: x, raw: String(x) },
            right: { type: 'Literal', value: y, raw: String(y) },
          },
        },
        right: {
          type: 'UnaryExpression',
          operator: '!',
          prefix: true,
          argument: { type: 'Identifier', name: 'String' },
        },
      },
      right: { type: 'Literal', value: 0x7fffffff, raw: '0x7fffffff' },
    },
    consequent: createDecoyConsequent(fnIndex),
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
  let guardedCount = 0;

  function maybeInjectGuard(node: any): void {
    if (!coldFunctionNodes.has(node)) return;
    if (!node.body || node.body.type !== 'BlockStatement') return;

    const guardStmt = createSotaMbaPredicate(seed, 0);
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

  return guardedCount;
}
