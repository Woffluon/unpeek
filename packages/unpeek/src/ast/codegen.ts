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

const IDENT_START_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
const IDENT_CONT_CHARS =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
const DISALLOWED_IDENTS = new Set([
  'as',
  'do',
  'if',
  'in',
  'of',
  'for',
  'int',
  'let',
  'new',
  'try',
  'var',
  'NaN',
  'Map',
  'Set',
  'URL',
  'top',
  'get',
  'set',
  'void',
  'case',
  'else',
  'enum',
  'null',
  'this',
  'true',
  'with',
  'Date',
  'JSON',
  'Math',
  'eval',
]);

/**
 * Deterministically derives a short, collision-free, valid JS identifier
 * from seed and role with a randomized first character ([a-zA-Z_$]),
 * avoiding fixed role prefixes (_a/$b/_z etc.) and reserved words.
 */
export function derivePolymorphicIdent(seed: number, role: PolymorphicRole): string {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < role.length; i++) {
    h ^= role.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Murmur3 avalanche mix so every bit of seed/role affects the first character & suffix
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;

  for (let attempt = 0; attempt < 32; attempt++) {
    const c0 = IDENT_START_CHARS[h % IDENT_START_CHARS.length];
    const c1 = IDENT_CONT_CHARS[(h >>> 6) % IDENT_CONT_CHARS.length];
    const c2 = IDENT_CONT_CHARS[(h >>> 12) % IDENT_CONT_CHARS.length];
    const c3 = IDENT_CONT_CHARS[(h >>> 18) % IDENT_CONT_CHARS.length];
    const ident = `${c0}${c1}${c2}${c3}`;
    if (
      !DISALLOWED_IDENTS.has(ident) &&
      !ident.startsWith('__') &&
      !ident.startsWith('_u') &&
      !ident.startsWith('_0')
    ) {
      return ident;
    }
    h = Math.imul(h ^ (0x9e3779b9 + attempt), 0x85ebca6b) >>> 0;
  }
  return `_${(h >>> 0).toString(36).slice(0, 3).padStart(3, '0')}`;
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

function getLeadingNode(
  state: any,
  node: any,
  parentNode?: any,
  isRightHand = false
): any {
  let cur = node;
  let parent = parentNode;
  let right = isRightHand;
  for (let depth = 0; cur && depth < 32; depth++) {
    if (parent && state && expressionNeedsParenthesis(state, cur, parent, right)) {
      return null;
    }
    if (cur.type === 'BinaryExpression') {
      if (cur.operator === 'in') return null;
      parent = cur;
      cur = cur.left;
      right = false;
    } else if (cur.type === 'LogicalExpression' || cur.type === 'AssignmentExpression') {
      parent = cur;
      cur = cur.left;
      right = false;
    } else if (cur.type === 'ConditionalExpression') {
      const prec = state?.expressionsPrecedence?.[cur.test?.type];
      if (
        prec === NEEDS_PARENTHESES ||
        prec <= state?.expressionsPrecedence?.ConditionalExpression
      ) {
        return null;
      }
      parent = cur;
      cur = cur.test;
      right = false;
    } else if (cur.type === 'MemberExpression') {
      const prec = state?.expressionsPrecedence?.[cur.object?.type];
      if (
        prec === NEEDS_PARENTHESES ||
        prec < state?.expressionsPrecedence?.MemberExpression
      ) {
        return null;
      }
      parent = cur;
      cur = cur.object;
      right = false;
    } else if (cur.type === 'CallExpression') {
      const prec = state?.expressionsPrecedence?.[cur.callee?.type];
      if (
        prec === NEEDS_PARENTHESES ||
        prec < state?.expressionsPrecedence?.CallExpression
      ) {
        return null;
      }
      parent = cur;
      cur = cur.callee;
      right = false;
    } else if (cur.type === 'ChainExpression') {
      parent = cur;
      cur = cur.expression;
      right = false;
    } else if (cur.type === 'TaggedTemplateExpression') {
      const prec = state?.expressionsPrecedence?.[cur.tag?.type];
      if (
        prec === NEEDS_PARENTHESES ||
        prec < state?.expressionsPrecedence?.CallExpression
      ) {
        return null;
      }
      parent = cur;
      cur = cur.tag;
      right = false;
    } else if (cur.type === 'UpdateExpression' && !cur.prefix) {
      parent = cur;
      cur = cur.argument;
      right = false;
    } else {
      return cur;
    }
  }
  return cur;
}

function getTrailingNode(
  state: any,
  node: any,
  parentNode?: any,
  isRightHand = false
): any {
  let cur = node;
  let parent = parentNode;
  let right = isRightHand;
  for (let depth = 0; cur && depth < 32; depth++) {
    if (parent && state && expressionNeedsParenthesis(state, cur, parent, right)) {
      return null;
    }
    if (cur.type === 'BinaryExpression') {
      if (cur.operator === 'in') return null;
      parent = cur;
      cur = cur.right;
      right = true;
    } else if (cur.type === 'LogicalExpression' || cur.type === 'AssignmentExpression') {
      parent = cur;
      cur = cur.right;
      right = true;
    } else if (cur.type === 'ConditionalExpression') {
      parent = cur;
      cur = cur.alternate;
      right = true;
    } else if (cur.type === 'ChainExpression') {
      parent = cur;
      cur = cur.expression;
      right = false;
    } else if (cur.type === 'UnaryExpression' && cur.prefix) {
      parent = cur;
      cur = cur.argument;
      right = true;
    } else if (cur.type === 'UpdateExpression' && cur.prefix) {
      parent = cur;
      cur = cur.argument;
      right = true;
    } else if (cur.type === 'AwaitExpression') {
      parent = cur;
      cur = cur.argument;
      right = true;
    } else {
      return cur;
    }
  }
  return cur;
}

function expressionStartsWith(
  node: any,
  char: '+' | '-' | '/',
  state?: any,
  parentNode?: any,
  isRightHand = false
): boolean {
  const leading = state ? getLeadingNode(state, node, parentNode, isRightHand) : node;
  if (!leading) return false;
  if (leading.type === 'UnaryExpression' && leading.prefix) {
    return leading.operator === char;
  }
  if (leading.type === 'UpdateExpression' && leading.prefix) {
    return leading.operator[0] === char;
  }
  if (
    char === '-' &&
    leading.type === 'Literal' &&
    typeof leading.value === 'number' &&
    leading.value < 0
  ) {
    return true;
  }
  if (char === '/' && isRegExp(leading)) {
    return true;
  }
  return false;
}

function leadingIsUnaryOrUpdate(
  state: any,
  node: any,
  parentNode?: any,
  isRightHand = false
): boolean {
  const leading = getLeadingNode(state, node, parentNode, isRightHand);
  if (!leading) return false;
  if (
    leading.type === 'UnaryExpression' &&
    leading.prefix &&
    '+-!~'.includes(leading.operator)
  ) {
    return true;
  }
  if (leading.type === 'UpdateExpression' && leading.prefix) {
    return true;
  }
  return false;
}

function expressionEndsWith(
  node: any,
  char: '+' | '-',
  state?: any,
  parentNode?: any,
  isRightHand = false
): boolean {
  const trailing = state ? getTrailingNode(state, node, parentNode, isRightHand) : node;
  if (!trailing) return false;
  if (trailing.type === 'UpdateExpression' && !trailing.prefix) {
    return trailing.operator[0] === char;
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
        expressionEndsWith(node.left, op as '+' | '-', state, node, false)
      ) {
        spaceBefore = true;
      }
      if (
        ((op === '+' || op === '-') &&
          (expressionStartsWith(node.right, op as '+' | '-', state, node, true) ||
            leadingIsUnaryOrUpdate(state, node.right, node, true))) ||
        (op === '/' &&
          (isRegExp(node.right) ||
            expressionStartsWith(node.right, '/', state, node, true)))
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

  UnaryExpression(this: any, node: any, state: any) {
    if (node.prefix) {
      const { operator, argument } = node;
      state.write(operator);
      const needsParentheses = expressionNeedsParenthesis(
        state,
        argument,
        node,
        true
      );
      if (needsParentheses) {
        state.write(operator.length > 1 ? ' (' : '(');
        this[argument.type](argument, state);
        state.write(')');
      } else {
        if (
          operator.length > 1 ||
          ('+-!~'.includes(operator) &&
            leadingIsUnaryOrUpdate(state, argument, node, true))
        ) {
          state.write(' ');
        }
        this[argument.type](argument, state);
      }
    } else {
      this[node.argument.type](node.argument, state);
      state.write(node.operator);
    }
  },

  UpdateExpression(this: any, node: any, state: any) {
    if (node.prefix) {
      state.write(node.operator);
      if (leadingIsUnaryOrUpdate(state, node.argument, node, true)) {
        state.write(' ');
      }
      this[node.argument.type](node.argument, state);
    } else {
      this[node.argument.type](node.argument, state);
      state.write(node.operator);
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
      (op.endsWith('+') && expressionStartsWith(node.right, '+', state, node, true)) ||
      (op.endsWith('-') && expressionStartsWith(node.right, '-', state, node, true)) ||
      (op.endsWith('/') &&
        (isRegExp(node.right) || expressionStartsWith(node.right, '/', state, node, true)))
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

  ImportExpression(this: any, node: any, state: any) {
    state.write('import(');
    if (Array.isArray(node.source?.comments) && node.source.comments.length > 0) {
      for (const c of node.source.comments) {
        state.write(c.type === 'Block' ? `/*${c.value}*/` : `//${c.value}\n`);
      }
    }
    this[node.source.type](node.source, state);
    if (node.options != null) {
      state.write(',');
      this[node.options.type](node.options, state);
    }
    state.write(')');
  },
} as any);

export interface CompactJsMapResult {
  code: string;
  mappings: string;
  names: string[];
  sources: string[];
}

const VLQ_BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;
  let encoded = '';
  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 0x20;
    }
    encoded += VLQ_BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

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

/**
 * Generates compact JavaScript alongside an M2 Source Map v3 VLQ mapping
 * derived from Acorn AST node `.loc` start positions (0-based lines/columns).
 */
export function generateCompactJsWithMap(
  ast: acorn.Program | Omit<acorn.Node, 'start' | 'end'>,
  fileName?: string
): CompactJsMapResult {
  const sourceName = fileName || 'input.js';
  const sources = [sourceName];
  const names: string[] = [];
  const nameToIndex = new Map<string, number>();

  interface RawSegment {
    genCol: number;
    srcIdx: number;
    origLine: number;
    origCol: number;
    nameIdx?: number;
  }

  const lines: RawSegment[][] = [];
  const chunks: string[] = [];
  let curLine = 0;
  let curCol = 0;
  let prevWriteLine = 0;
  let prevWriteCol = 0;
  let lastMappedLine = -1;
  let lastMappedCol = -1;

  const outputStream = {
    write(chunk: string) {
      prevWriteLine = curLine;
      prevWriteCol = curCol;
      if (chunk.length > 0) {
        chunks.push(chunk);
        for (let i = 0; i < chunk.length; i++) {
          if (chunk.charCodeAt(i) === 10) {
            curLine++;
            curCol = 0;
          } else {
            curCol++;
          }
        }
      }
    },
  };

  const sourceMapSink = {
    file: sourceName,
    addMapping(mapping: {
      original: { line: number; column: number } | null;
      name?: string;
    }) {
      if (!mapping.original) return;
      const origLine = (mapping.original.line | 0) - 1;
      const origCol = mapping.original.column | 0;
      if (origLine < 0 || origCol < 0) return;

      const genLine = prevWriteLine;
      const genCol = prevWriteCol;
      if (genLine === lastMappedLine && genCol === lastMappedCol) {
        return;
      }
      lastMappedLine = genLine;
      lastMappedCol = genCol;

      while (lines.length <= genLine) {
        lines.push([]);
      }

      let nameIdx: number | undefined;
      if (typeof mapping.name === 'string' && mapping.name.length > 0) {
        let existing = nameToIndex.get(mapping.name);
        if (existing === undefined) {
          existing = names.length;
          names.push(mapping.name);
          nameToIndex.set(mapping.name, existing);
        }
        nameIdx = existing;
      }

      lines[genLine].push({
        genCol,
        srcIdx: 0,
        origLine,
        origCol,
        nameIdx,
      });
    },
  };

  generate(ast as Parameters<typeof generate>[0], {
    generator: compactGenerator,
    indent: '',
    lineEnd: '',
    output: outputStream as unknown as NonNullable<Parameters<typeof generate>[1]>['output'],
    sourceMap: sourceMapSink as unknown as NonNullable<Parameters<typeof generate>[1]>['sourceMap'],
  });

  let prevSrcIdx = 0;
  let prevOrigLine = 0;
  let prevOrigCol = 0;
  let prevNameIdx = 0;

  const encodedLines = lines.map((segs) => {
    let prevGenCol = 0;
    const encodedSegs: string[] = [];
    for (const seg of segs) {
      let s =
        encodeVlq(seg.genCol - prevGenCol) +
        encodeVlq(seg.srcIdx - prevSrcIdx) +
        encodeVlq(seg.origLine - prevOrigLine) +
        encodeVlq(seg.origCol - prevOrigCol);
      prevGenCol = seg.genCol;
      prevSrcIdx = seg.srcIdx;
      prevOrigLine = seg.origLine;
      prevOrigCol = seg.origCol;
      if (seg.nameIdx !== undefined) {
        s += encodeVlq(seg.nameIdx - prevNameIdx);
        prevNameIdx = seg.nameIdx;
      }
      encodedSegs.push(s);
    }
    return encodedSegs.join(',');
  });

  return {
    code: chunks.join(''),
    mappings: encodedLines.join(';'),
    names,
    sources,
  };
}
