import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

function createOpaqueGuardStatement(seed: number, fnIndex: number): any {
  // Deterministic polymorphic constants where (((A ^ B) & 7) | !String) === wrongVal
  // `!String` is 0 at runtime (V8 Constant-Folded by TurboFan) while defeating AST literal constant-folders
  const a = ((seed >>> 0) + Math.imul(fnIndex + 1, 0x45d9f3b)) & 0xffff;
  const b = (a ^ 0x1357) & 0xffff;
  const wrongVal = ((a ^ b) & 7) ^ 5; // Guaranteed never equal to ((a ^ b) & 7)

  return {
    type: 'IfStatement',
    test: {
      type: 'BinaryExpression',
      operator: '===',
      left: {
        type: 'BinaryExpression',
        operator: '&',
        left: {
          type: 'BinaryExpression',
          operator: '^',
          left: { type: 'Literal', value: a, raw: String(a) },
          right: {
            type: 'BinaryExpression',
            operator: '|',
            left: { type: 'Literal', value: b, raw: String(b) },
            right: {
              type: 'UnaryExpression',
              operator: '!',
              prefix: true,
              argument: { type: 'Identifier', name: 'String' },
            },
          },
        },
        right: { type: 'Literal', value: 7, raw: '7' },
      },
      right: { type: 'Literal', value: wrongVal, raw: String(wrongVal) },
    },
    consequent: {
      type: 'ReturnStatement',
      argument: null,
    },
    alternate: null,
  };
}

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
    const guardStmt = createOpaqueGuardStatement(seed, guardedCount);

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
