import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { computeFnv1aHash } from './string-vault.js';

export const OP_LDC = 0;
export const OP_LDV = 1;
export const OP_STV = 2;
export const OP_LDG = 3;
export const OP_GETP = 4;
export const OP_SETP = 5;
export const OP_CALL = 6;
export const OP_MCALL = 7;
export const OP_ADD = 8;
export const OP_SUB = 9;
export const OP_MUL = 10;
export const OP_XOR = 11;
export const OP_AND = 12;
export const OP_OR = 13;
export const OP_SEQ = 14;
export const OP_LT = 15;
export const OP_NOT = 16;
export const OP_JMP = 17;
export const OP_JZ = 18;
export const OP_RET = 19;
export const OP_THROW = 20;
export const OP_AWAIT = 21;
export const OP_OBJ = 22;
export const OP_ARR = 23;

export interface MicroVmResult {
  virtualizedCount: number;
  vmHelperName: string;
}

export interface CompiledFunction {
  bytecode: number[];
  consts: any[];
  localCount: number;
}

/**
 * Generates a build-specific permutation of 24 distinct opcodes in 0..255 derived from seed.
 */
export function generateOpcodeMap(seed: number): number[] {
  const pool: number[] = [];
  for (let i = 0; i < 256; i++) pool.push(i);
  let s = (seed ^ 0xa5a5a5a5) >>> 0;
  function rand(): number {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, 24);
}

/**
 * Produces the CSP-safe, eval-free, switch-dispatch interpreter source code (<1.2 KB).
 * Supports async/await via Promise frame continuation.
 */
export function createInterpreterSource(
  vmHelperName: string,
  opMap: number[]
): string {
  return `function ${vmHelperName}(c, k, s, t) {
  var p = 0, r = 0, q = [];
  var G = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
  function x() {
    while (p < c.length) {
      var o = c[p++];
      switch (o) {
        case ${opMap[OP_LDC]}: q[r++] = k[c[p++]]; break;
        case ${opMap[OP_LDV]}: q[r++] = s[c[p++]]; break;
        case ${opMap[OP_STV]}: s[c[p++]] = q[--r]; break;
        case ${opMap[OP_LDG]}: q[r++] = G[k[c[p++]]]; break;
        case ${opMap[OP_GETP]}: { var b = q[--r], a = q[--r]; q[r++] = a[b]; break; }
        case ${opMap[OP_SETP]}: { var v = q[--r], b = q[--r], a = q[--r]; q[r++] = (a[b] = v); break; }
        case ${opMap[OP_CALL]}: {
          var n = c[p++], g = [];
          for (var i = n - 1; i >= 0; i--) g[i] = q[--r];
          var f = q[--r]; q[r++] = f.apply(null, g); break;
        }
        case ${opMap[OP_MCALL]}: {
          var n = c[p++], g = [];
          for (var i = n - 1; i >= 0; i--) g[i] = q[--r];
          var b = q[--r], a = q[--r]; q[r++] = a[b].apply(a, g); break;
        }
        case ${opMap[OP_ADD]}: { var b = q[--r], a = q[--r]; q[r++] = a + b; break; }
        case ${opMap[OP_SUB]}: { var b = q[--r], a = q[--r]; q[r++] = a - b; break; }
        case ${opMap[OP_MUL]}: { var b = q[--r], a = q[--r]; q[r++] = a * b; break; }
        case ${opMap[OP_XOR]}: { var b = q[--r], a = q[--r]; q[r++] = a ^ b; break; }
        case ${opMap[OP_AND]}: { var b = q[--r], a = q[--r]; q[r++] = a & b; break; }
        case ${opMap[OP_OR]}: { var b = q[--r], a = q[--r]; q[r++] = a | b; break; }
        case ${opMap[OP_SEQ]}: { var b = q[--r], a = q[--r]; q[r++] = a === b; break; }
        case ${opMap[OP_LT]}: { var b = q[--r], a = q[--r]; q[r++] = a < b; break; }
        case ${opMap[OP_NOT]}: { q[r - 1] = !q[r - 1]; break; }
        case ${opMap[OP_JMP]}: { p = c[p]; break; }
        case ${opMap[OP_JZ]}: { var j = c[p++]; if (!q[--r]) p = j; break; }
        case ${opMap[OP_RET]}: return q[--r];
        case ${opMap[OP_THROW]}: throw q[--r];
        case ${opMap[OP_AWAIT]}: {
          var v = q[--r];
          return Promise.resolve(v).then(function(w) { q[r++] = w; return x(); });
        }
        case ${opMap[OP_OBJ]}: {
          var n = c[p++], o = {}, e = [];
          for (var i = 0; i < n; i++) { var v = q[--r], k0 = q[--r]; e.push([k0, v]); }
          for (var i = e.length - 1; i >= 0; i--) { o[e[i][0]] = e[i][1]; }
          q[r++] = o;
          break;
        }
        case ${opMap[OP_ARR]}: {
          var n = c[p++], a = [];
          for (var i = n - 1; i >= 0; i--) a[i] = q[--r];
          q[r++] = a;
          break;
        }
      }
    }
  }
  return x();
}`;
}

function countAstNodes(node: acorn.Node): number {
  let count = 0;
  walk.full(node, () => {
    count++;
  });
  return count;
}

function hasForbiddenConstructs(fnNode: any): boolean {
  let forbidden = false;
  walk.full(fnNode, (node: any) => {
    if (forbidden) return;
    const type = node.type;
    if (
      type === 'JSXElement' ||
      type === 'JSXFragment' ||
      type === 'Super' ||
      type === 'YieldExpression'
    ) {
      forbidden = true;
      return;
    }
    if (type === 'Identifier' && node.name === 'arguments') {
      forbidden = true;
      return;
    }
    if (
      type === 'MetaProperty' &&
      node.meta?.name === 'new' &&
      node.property?.name === 'target'
    ) {
      forbidden = true;
      return;
    }
  });
  return forbidden;
}

/**
 * Compiles a candidate function AST into 24-instruction bytecode.
 * Returns null if the function contains unsupported constructs.
 */
export function compileFunctionToBytecode(
  fnNode: any,
  opMap: number[]
): CompiledFunction | null {
  const bytecode: number[] = [];
  const consts: any[] = [];
  const localMap = new Map<string, number>();
  let localCount = 0;

  // Add parameter identifiers to local scope
  for (const param of fnNode.params) {
    if (param.type !== 'Identifier') return null;
    localMap.set(param.name, localCount++);
  }

  // Pre-scan for local variable declarations (var, let, const)
  const bodyNodes =
    fnNode.body.type === 'BlockStatement'
      ? fnNode.body.body
      : [fnNode.body];

  for (const stmt of bodyNodes) {
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (decl.id.type === 'Identifier') {
          if (!localMap.has(decl.id.name)) {
            localMap.set(decl.id.name, localCount++);
          }
        } else {
          return null; // unsupported destructuring
        }
      }
    }
  }

  function addConst(val: any): number {
    for (let i = 0; i < consts.length; i++) {
      if (consts[i] === val) return i;
    }
    const idx = consts.length;
    consts.push(val);
    return idx;
  }

  function emit(op: number, ...args: number[]): void {
    bytecode.push(opMap[op]);
    for (const a of args) bytecode.push(a);
  }

  function compileExpr(node: any): boolean {
    if (!node) return false;
    switch (node.type) {
      case 'Literal': {
        const idx = addConst(node.value);
        emit(OP_LDC, idx);
        return true;
      }
      case 'Identifier': {
        if (node.name === 'undefined') {
          const idx = addConst(undefined);
          emit(OP_LDC, idx);
        } else if (localMap.has(node.name)) {
          emit(OP_LDV, localMap.get(node.name)!);
        } else {
          const idx = addConst(node.name);
          emit(OP_LDG, idx);
        }
        return true;
      }
      case 'BinaryExpression': {
        if (node.operator === '>') {
          if (!compileExpr(node.right)) return false;
          if (!compileExpr(node.left)) return false;
          emit(OP_LT);
          return true;
        }
        if (node.operator === '<=') {
          if (!compileExpr(node.right)) return false;
          if (!compileExpr(node.left)) return false;
          emit(OP_LT);
          emit(OP_NOT);
          return true;
        }
        if (node.operator === '>=') {
          if (!compileExpr(node.left)) return false;
          if (!compileExpr(node.right)) return false;
          emit(OP_LT);
          emit(OP_NOT);
          return true;
        }
        if (!compileExpr(node.left)) return false;
        if (!compileExpr(node.right)) return false;
        switch (node.operator) {
          case '+': emit(OP_ADD); break;
          case '-': emit(OP_SUB); break;
          case '*': emit(OP_MUL); break;
          case '^': emit(OP_XOR); break;
          case '&': emit(OP_AND); break;
          case '|': emit(OP_OR); break;
          case '==':
          case '===': emit(OP_SEQ); break;
          case '!=':
          case '!==': emit(OP_SEQ); emit(OP_NOT); break;
          case '<': emit(OP_LT); break;
          default: return false;
        }
        return true;
      }
      case 'UnaryExpression': {
        if (!compileExpr(node.argument)) return false;
        switch (node.operator) {
          case '!': emit(OP_NOT); break;
          case '-': {
            const neg1Idx = addConst(-1);
            emit(OP_LDC, neg1Idx);
            emit(OP_MUL);
            break;
          }
          case '+': {
            const zeroIdx = addConst(0);
            emit(OP_LDC, zeroIdx);
            emit(OP_ADD);
            break;
          }
          case '~': {
            const neg1Idx = addConst(-1);
            emit(OP_LDC, neg1Idx);
            emit(OP_XOR);
            break;
          }
          case 'void': {
            const undefIdx = addConst(undefined);
            emit(OP_LDC, undefIdx);
            break;
          }
          default: return false;
        }
        return true;
      }
      case 'MemberExpression': {
        if (!compileExpr(node.object)) return false;
        if (node.computed) {
          if (!compileExpr(node.property)) return false;
        } else {
          const idx = addConst(node.property.name);
          emit(OP_LDC, idx);
        }
        emit(OP_GETP);
        return true;
      }
      case 'CallExpression': {
        if (node.callee.type === 'MemberExpression') {
          if (!compileExpr(node.callee.object)) return false;
          if (node.callee.computed) {
            if (!compileExpr(node.callee.property)) return false;
          } else {
            const idx = addConst(node.callee.property.name);
            emit(OP_LDC, idx);
          }
          for (const arg of node.arguments) {
            if (!compileExpr(arg)) return false;
          }
          emit(OP_MCALL, node.arguments.length);
        } else {
          if (!compileExpr(node.callee)) return false;
          for (const arg of node.arguments) {
            if (!compileExpr(arg)) return false;
          }
          emit(OP_CALL, node.arguments.length);
        }
        return true;
      }
      case 'AssignmentExpression': {
        if (node.operator !== '=') return false;
        if (node.left.type === 'Identifier') {
          if (!localMap.has(node.left.name)) return false;
          if (!compileExpr(node.right)) return false;
          emit(OP_STV, localMap.get(node.left.name)!);
          return true;
        }
        if (node.left.type === 'MemberExpression') {
          if (!compileExpr(node.left.object)) return false;
          if (node.left.computed) {
            if (!compileExpr(node.left.property)) return false;
          } else {
            const idx = addConst(node.left.property.name);
            emit(OP_LDC, idx);
          }
          if (!compileExpr(node.right)) return false;
          emit(OP_SETP);
          return true;
        }
        return false;
      }
      case 'ObjectExpression': {
        for (const prop of node.properties) {
          if (prop.type !== 'Property') return false;
          if (prop.computed) {
            if (!compileExpr(prop.key)) return false;
          } else {
            const keyName = prop.key.name ?? prop.key.value;
            const idx = addConst(keyName);
            emit(OP_LDC, idx);
          }
          if (!compileExpr(prop.value)) return false;
        }
        emit(OP_OBJ, node.properties.length);
        return true;
      }
      case 'ArrayExpression': {
        for (const elem of node.elements) {
          if (!compileExpr(elem)) return false;
        }
        emit(OP_ARR, node.elements.length);
        return true;
      }
      case 'AwaitExpression': {
        if (!compileExpr(node.argument)) return false;
        emit(OP_AWAIT);
        return true;
      }
      default:
        return false;
    }
  }

  function compileStmt(stmt: any): boolean {
    if (!stmt) return false;
    switch (stmt.type) {
      case 'ReturnStatement': {
        if (stmt.argument) {
          if (!compileExpr(stmt.argument)) return false;
        } else {
          const idx = addConst(undefined);
          emit(OP_LDC, idx);
        }
        emit(OP_RET);
        return true;
      }
      case 'ExpressionStatement': {
        if (!compileExpr(stmt.expression)) return false;
        return true;
      }
      case 'VariableDeclaration': {
        for (const decl of stmt.declarations) {
          if (decl.init) {
            if (!compileExpr(decl.init)) return false;
            emit(OP_STV, localMap.get(decl.id.name)!);
          }
        }
        return true;
      }
      case 'IfStatement': {
        if (!compileExpr(stmt.test)) return false;
        const jzPos = bytecode.length;
        emit(OP_JZ, 0);
        if (!compileStmt(stmt.consequent)) return false;

        if (stmt.alternate) {
          const jmpPos = bytecode.length;
          emit(OP_JMP, 0);
          bytecode[jzPos + 1] = bytecode.length;
          if (!compileStmt(stmt.alternate)) return false;
          bytecode[jmpPos + 1] = bytecode.length;
        } else {
          bytecode[jzPos + 1] = bytecode.length;
        }
        return true;
      }
      case 'BlockStatement': {
        for (const s of stmt.body) {
          if (!compileStmt(s)) return false;
        }
        return true;
      }
      default:
        return false;
    }
  }

  if (fnNode.body.type === 'BlockStatement') {
    if (!compileStmt(fnNode.body)) return null;
  } else {
    // Arrow function with expression body
    if (!compileExpr(fnNode.body)) return null;
    emit(OP_RET);
  }

  // Ensure trailing return undefined
  const undefIdx = addConst(undefined);
  emit(OP_LDC, undefIdx);
  emit(OP_RET);

  return { bytecode, consts, localCount };
}

function isMicroVmAlreadyInjected(ast: acorn.Program): boolean {
  if (!ast || !Array.isArray(ast.body)) return false;
  return ast.body.some((stmt: any) => {
    if (
      stmt.type === 'FunctionDeclaration' &&
      typeof stmt.id?.name === 'string' &&
      stmt.id.name.startsWith('_uVm')
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Selective Bytecode Micro-VM virtualization for Layer 2 (--aggressive).
 * Selects qualifying cold functions (not serialized, no JSX, no super/yield/arguments/new.target, 15 <= N <= 80),
 * transforms their bodies into stack-based bytecode calls, and injects the <1.2 KB switch-dispatch interpreter once.
 */
export function applyMicroVm(
  ast: acorn.Program,
  coldFunctionNodes?: Set<acorn.Node> | WeakSet<acorn.Node>,
  serializedFunctionNodes?: WeakSet<acorn.Node>,
  seed = 0x9e3779b9
): MicroVmResult {
  const suffix = computeFnv1aHash(`micro-vm:${seed}`, seed).toString(36);
  const vmHelperName = `_uVm${suffix}`;

  if (isMicroVmAlreadyInjected(ast)) {
    const existing = (ast.body as any[]).find(
      (stmt) =>
        stmt.type === 'FunctionDeclaration' &&
        typeof stmt.id?.name === 'string' &&
        stmt.id.name.startsWith('_uVm')
    );
    return {
      virtualizedCount: 0,
      vmHelperName: existing?.id?.name ?? vmHelperName,
    };
  }

  const opMap = generateOpcodeMap(seed);
  const candidates: any[] = [];

  walk.simple(ast, {
    FunctionDeclaration(node: any) {
      candidates.push(node);
    },
    FunctionExpression(node: any) {
      candidates.push(node);
    },
    ArrowFunctionExpression(node: any) {
      candidates.push(node);
    },
  });

  let virtualizedCount = 0;

  for (const fn of candidates) {
    if (virtualizedCount >= 10) break; // Maximum 10 functions per chunk

    // 1. Must be cold if coldFunctionNodes set is provided
    if (coldFunctionNodes && !coldFunctionNodes.has(fn)) {
      continue;
    }

    // 2. Must not be serialized worker function
    if (serializedFunctionNodes && serializedFunctionNodes.has(fn)) {
      continue;
    }

    // 3. Must not be generator
    if (fn.generator) {
      continue;
    }

    // 4. Must not have forbidden constructs (JSX, super, yield, arguments, new.target)
    if (hasForbiddenConstructs(fn)) {
      continue;
    }

    // 5. AST node count check: 15 <= N <= 80
    const nodeCount = countAstNodes(fn);
    if (nodeCount < 15 || nodeCount > 80) {
      continue;
    }

    // 6. Attempt compilation into bytecode
    const compiled = compileFunctionToBytecode(fn, opMap);
    if (!compiled) {
      continue;
    }

    // Replace function body with VM execution call: _uVm(bytecode, consts, [params], this)
    const paramArgs = fn.params.map((p: any) => ({
      type: 'Identifier',
      name: p.name,
    }));

    const callExpr: any = {
      type: 'CallExpression',
      callee: {
        type: 'Identifier',
        name: vmHelperName,
      },
      arguments: [
        {
          type: 'ArrayExpression',
          elements: compiled.bytecode.map((b) => ({
            type: 'Literal',
            value: b,
            raw: String(b),
          })),
        },
        {
          type: 'ArrayExpression',
          elements: compiled.consts.map((c) => ({
            type: 'Literal',
            value: c,
            raw: c === undefined ? 'void 0' : JSON.stringify(c),
          })),
        },
        {
          type: 'ArrayExpression',
          elements: paramArgs,
        },
        {
          type: 'ThisExpression',
        },
      ],
      optional: false,
    };

    if (fn.body.type === 'BlockStatement') {
      fn.body.body = [
        {
          type: 'ReturnStatement',
          argument: callExpr,
        },
      ];
    } else {
      // Arrow function expression
      fn.body = callExpr;
    }

    virtualizedCount++;
  }

  // If at least one function was virtualized, inject interpreter at module top
  if (virtualizedCount > 0) {
    const interpreterSource = createInterpreterSource(vmHelperName, opMap);
    const parsedHelper = acorn.parse(interpreterSource, {
      ecmaVersion: 'latest',
      sourceType: 'script',
    }) as acorn.Program;

    ast.body.unshift(...(parsedHelper.body as any[]));
  }

  return {
    virtualizedCount,
    vmHelperName,
  };
}
