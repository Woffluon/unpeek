import { generate, baseGenerator, type Generator, type State } from 'astring';
import type * as acorn from 'acorn';

export type PolymorphicRole =
  | 'vault'
  | 'shield'
  | 'decoy'
  | 'shader'
  | 'vm'
  | 'wasm'
  | 'salted'
  | 'windowKey'
  | string;

/**
 * Deterministically derives a short, collision-free, minify-friendly identifier
 * (_a0, $b1, etc.) for a given seed and role, eliminating fixed _uC and _u$ prefixes.
 */
export function derivePolymorphicIdent(seed: number, role: PolymorphicRole): string {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < role.length; i++) {
    h ^= role.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const rolePrefixes: Record<string, string> = {
    vault: '_a',
    shield: '$b',
    decoy: '_d',
    shader: '_s',
    vm: '_m',
    wasm: '_w',
    salted: '_k',
    windowKey: '_z',
  };
  const prefix = rolePrefixes[role] ?? `_${String.fromCharCode(97 + (h % 26))}`;
  const suffix = ((h >>> 4) % 1296).toString(36).padStart(2, '0');
  return `${prefix}${suffix}`;
}

const OPERATOR_PRECEDENCE: Record<string, number> = {
  '||': 2,
  '??': 3,
  '&&': 4,
  '|': 5,
  '^': 6,
  '&': 7,
  '==': 8,
  '!=': 8,
  '===': 8,
  '!==': 8,
  '<': 9,
  '>': 9,
  '<=': 9,
  '>=': 9,
  'in': 9,
  'instanceof': 9,
  '<<': 10,
  '>>': 10,
  '>>>': 10,
  '+': 11,
  '-': 11,
  '*': 12,
  '%': 12,
  '/': 12,
  '**': 13,
};

const NEEDS_PARENTHESES = 17;

function expressionNeedsParenthesis(
  state: any,
  node: any,
  parentNode: any,
  isRightHand: boolean
): boolean {
  const nodePrecedence = state.expressionsPrecedence[node.type];
  if (nodePrecedence === NEEDS_PARENTHESES) {
    return true;
  }
  const parentNodePrecedence = state.expressionsPrecedence[parentNode.type];
  if (nodePrecedence !== parentNodePrecedence) {
    return (
      (!isRightHand &&
        nodePrecedence === 15 &&
        parentNodePrecedence === 14 &&
        parentNode.operator === '**') ||
      nodePrecedence < parentNodePrecedence
    );
  }
  if (nodePrecedence !== 13 && nodePrecedence !== 14) {
    return false;
  }
  if (node.operator === '**' && parentNode.operator === '**') {
    return !isRightHand;
  }
  if (
    nodePrecedence === 13 &&
    parentNodePrecedence === 13 &&
    (node.operator === '??' || parentNode.operator === '??')
  ) {
    return true;
  }
  if (isRightHand) {
    return (
      OPERATOR_PRECEDENCE[node.operator] <=
      OPERATOR_PRECEDENCE[parentNode.operator]
    );
  }
  return (
    OPERATOR_PRECEDENCE[node.operator] <
    OPERATOR_PRECEDENCE[parentNode.operator]
  );
}

function formatExpression(state: any, node: any, parentNode: any, isRightHand: boolean): void {
  const generator = state.generator;
  if (expressionNeedsParenthesis(state, node, parentNode, isRightHand)) {
    state.write('(');
    generator[node.type](node, state);
    state.write(')');
  } else {
    generator[node.type](node, state);
  }
}

function formatSequence(state: any, expressions: any[]): void {
  const length = expressions.length;
  if (length > 0) {
    state.write('(');
    state.generator[expressions[0].type](expressions[0], state);
    for (let i = 1; i < length; i++) {
      state.write(',');
      state.generator[expressions[i].type](expressions[i], state);
    }
    state.write(')');
  } else {
    state.write('()');
  }
}

function expressionStartsWith(node: any, char: '+' | '-'): boolean {
  if (!node) return false;
  if (node.type === 'UnaryExpression' && node.prefix) {
    return node.operator === char;
  }
  if (node.type === 'UpdateExpression' && node.prefix) {
    return node.operator[0] === char;
  }
  return false;
}

function expressionEndsWith(node: any, char: '+' | '-'): boolean {
  if (!node) return false;
  if (node.type === 'UpdateExpression' && !node.prefix) {
    return node.operator[0] === char;
  }
  return false;
}

function isRegExp(node: any): boolean {
  return node && ((node.type === 'Literal' && !!node.regex) || node.type === 'RegExpLiteral');
}

/**
 * Custom tight code generator that avoids emitting unneeded whitespace around
 * binary, logical, and assignment operators, commas, colons, and loop headers.
 */
export const compactGenerator: Generator = Object.assign({}, baseGenerator, {
  BinaryExpression(this: any, node: any, state: State) {
    const isIn = node.operator === 'in';
    if (isIn) {
      state.write('(');
    }
    formatExpression(state, node.left, node, false);
    const op = node.operator;
    let spaceBefore = false;
    let spaceAfter = false;

    if (op === 'in' || op === 'instanceof') {
      spaceBefore = true;
      spaceAfter = true;
    } else {
      if (
        (op === '+' || op === '-') &&
        expressionEndsWith(node.left, op as '+' | '-') &&
        !expressionNeedsParenthesis(state, node.left, node, false)
      ) {
        spaceBefore = true;
      }
      if (
        ((op === '+' || op === '-') &&
          expressionStartsWith(node.right, op as '+' | '-') &&
          !expressionNeedsParenthesis(state, node.right, node, true)) ||
        (op === '/' && isRegExp(node.right))
      ) {
        spaceAfter = true;
      }
    }

    if (spaceBefore) state.write(' ');
    state.write(op);
    if (spaceAfter) state.write(' ');
    formatExpression(state, node.right, node, true);
    if (isIn) {
      state.write(')');
    }
  },

  LogicalExpression(node: any, state: State) {
    formatExpression(state, node.left, node, false);
    state.write(node.operator);
    formatExpression(state, node.right, node, true);
  },

  AssignmentExpression(this: any, node: any, state: any) {
    this[node.left.type](node.left, state);
    const op = node.operator;
    if (
      (op.endsWith('+') && expressionStartsWith(node.right, '+')) ||
      (op.endsWith('-') && expressionStartsWith(node.right, '-')) ||
      (op.endsWith('/') && isRegExp(node.right))
    ) {
      state.write(op + ' ');
    } else {
      state.write(op);
    }
    this[node.right.type](node.right, state);
  },

  ConditionalExpression(this: any, node: any, state: any) {
    const test = node.test;
    const precedence = state.expressionsPrecedence[test.type];
    if (precedence === NEEDS_PARENTHESES || precedence <= state.expressionsPrecedence.ConditionalExpression) {
      state.write('(');
      this[test.type](test, state);
      state.write(')');
    } else {
      this[test.type](test, state);
    }
    state.write('?');
    this[node.consequent.type](node.consequent, state);
    state.write(':');
    this[node.alternate.type](node.alternate, state);
  },

  ArrayExpression(this: any, node: any, state: any) {
    state.write('[');
    const elements = node.elements;
    const length = elements.length;
    for (let i = 0; i < length; i++) {
      const element = elements[i];
      if (element != null) {
        this[element.type](element, state);
      }
      if (i + 1 < length) {
        state.write(',');
      }
    }
    state.write(']');
  },

  ObjectExpression(this: any, node: any, state: any) {
    state.write('{');
    const properties = node.properties;
    const length = properties.length;
    for (let i = 0; i < length; i++) {
      const property = properties[i];
      this[property.type](property, state);
      if (i + 1 < length) {
        state.write(',');
      }
    }
    state.write('}');
  },

  Property(this: any, node: any, state: any) {
    if (node.method || node.kind[0] !== 'i') {
      this.MethodDefinition(node, state);
    } else {
      if (!node.shorthand) {
        if (node.computed) {
          state.write('[');
          this[node.key.type](node.key, state);
          state.write(']');
        } else {
          this[node.key.type](node.key, state);
        }
        state.write(':');
      }
      this[node.value.type](node.value, state);
    }
  },

  CallExpression(this: any, node: any, state: any) {
    formatExpression(state, node.callee, node, false);
    if (node.optional) {
      state.write('?.');
    }
    formatSequence(state, node.arguments);
  },

  SequenceExpression(node: any, state: any) {
    formatSequence(state, node.expressions);
  },

  FunctionDeclaration(this: any, node: any, state: any) {
    state.write(
      (node.async ? 'async ' : '') +
      (node.generator ? 'function* ' : 'function ') +
      (node.id ? node.id.name : ''),
      node
    );
    formatSequence(state, node.params);
    this[node.body.type](node.body, state);
  },

  FunctionExpression(this: any, node: any, state: any) {
    (compactGenerator as any).FunctionDeclaration.call(this, node, state);
  },

  ArrowFunctionExpression(this: any, node: any, state: any) {
    state.write(node.async ? 'async ' : '', node);
    const params = node.params;
    if (params != null) {
      if (params.length === 0) {
        state.write('()');
      } else if (params.length === 1 && params[0].type === 'Identifier') {
        state.write(params[0].name, params[0]);
      } else {
        formatSequence(state, node.params);
      }
    } else {
      state.write('()');
    }
    state.write('=>');
    if (node.body.type[0] === 'O') {
      state.write('(');
      this.ObjectExpression(node.body, state);
      state.write(')');
    } else {
      this[node.body.type](node.body, state);
    }
  },

  ForStatement(this: any, node: any, state: any) {
    state.write('for(');
    if (node.init != null) {
      const init = node.init;
      if (init.type[0] === 'V') {
        this.VariableDeclaration(init, state);
      } else {
        this[init.type](init, state);
        state.write(';');
      }
    } else {
      state.write(';');
    }
    if (node.test) {
      this[node.test.type](node.test, state);
    }
    state.write(';');
    if (node.update) {
      this[node.update.type](node.update, state);
    }
    state.write(')');
    this[node.body.type](node.body, state);
  },

  IfStatement(this: any, node: any, state: any) {
    state.write('if(');
    this[node.test.type](node.test, state);
    state.write(')');
    this[node.consequent.type](node.consequent, state);
    if (node.alternate != null) {
      if (node.consequent.type === 'BlockStatement') {
        state.write('else');
      } else {
        state.write(' else');
      }
      if (node.alternate.type === 'BlockStatement') {
        this[node.alternate.type](node.alternate, state);
      } else if (node.alternate.type === 'IfStatement') {
        state.write(' ');
        this[node.alternate.type](node.alternate, state);
      } else {
        state.write(' ');
        this[node.alternate.type](node.alternate, state);
      }
    }
  },

  VariableDeclaration(this: any, node: any, state: any) {
    state.write(node.kind + ' ');
    const declarations = node.declarations;
    const length = declarations.length;
    for (let i = 0; i < length; i++) {
      this.VariableDeclarator(declarations[i], state);
      if (i + 1 < length) {
        state.write(',');
      }
    }
    state.write(';');
  },

  VariableDeclarator(this: any, node: any, state: any) {
    this[node.id.type](node.id, state);
    if (node.init != null) {
      state.write('=');
      this[node.init.type](node.init, state);
    }
  },

  ReturnStatement(this: any, node: any, state: any) {
    state.write('return');
    if (node.argument) {
      state.write(' ');
      this[node.argument.type](node.argument, state);
    }
    state.write(';');
  },
} as any);

/**
 * Generates compact, single-line JavaScript using custom astring rules to eliminate
 * redundant whitespace while preserving string literal contents and language semantics.
 */
export function generateCompactJs(
  ast: Omit<acorn.Node, 'start' | 'end'>
): string {
  return generate(ast as Parameters<typeof generate>[0], {
    generator: compactGenerator,
    indent: '',
    lineEnd: '',
  });
}
