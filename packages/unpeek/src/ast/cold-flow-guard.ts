import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

function createOpaqueGuardStatement(seed: number, fnIndex: number): any {
  // Deterministic polymorphic constants where ((A ^ B) & 7) === Expected
  const a = ((seed >>> 0) + Math.imul(fnIndex + 1, 0x45d9f3b)) & 0xffff;
  const b = (a ^ 0x1357) & 0xffff;
  const wrongVal = ((a ^ b) & 7) ^ 5; // Guaranteed never equal to ((a ^ b) & 7)

  const guardCode = `if (((${a} ^ ${b}) & 7) === ${wrongVal}) return;`;
  const parsed = acorn.parse(guardCode, {
    ecmaVersion: 'latest',
    allowReturnOutsideFunction: true,
  });
  return parsed.body[0];
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
