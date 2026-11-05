import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

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
    consequent: {
      type: 'BlockStatement',
      body: [
        {
          type: 'ExpressionStatement',
          expression: {
            type: 'UnaryExpression',
            operator: 'void',
            prefix: true,
            argument: { type: 'Literal', value: 0, raw: '0' },
          },
        },
      ],
    },
    alternate: null,
  };
}

export const createOpaqueGuardStatement = createSotaMbaPredicate;

export function applyColdFlowGuard(
  ast: acorn.Program,
  coldFunctionNodes: WeakSet<acorn.Node>,
  seed = 0x9e3779b9
): number {
  let guardedCount = 0;

  function maybeInjectGuard(node: any): void {
    if (!coldFunctionNodes.has(node)) return;
    if (!node.body || node.body.type !== 'BlockStatement') return;

    guardedCount++;
    const guardStmt = createSotaMbaPredicate(seed, 0);

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
