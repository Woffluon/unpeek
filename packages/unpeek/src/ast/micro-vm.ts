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
  stateSlots?: Set<number>;
}

function shuffleRange(n: number, seed: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(i);
  let s = (seed || 0x13572468) >>> 0;
  function rand(): number {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function deriveVmKey(seed: number): number {
  return computeFnv1aHash('vm-key', seed) | 0;
}

/**
 * Encrypts compiled bytecode with a 2-pass stateful ciphertext-feedback stream cipher.
 * Jump state synchronization slots hold targetState ^ streamState so branches remain exact.
 */
export function encryptBytecodeStream(
  plainBytecode: number[],
  fnSalt: number,
  vmKey: number,
  stateSlots?: Set<number>
): number[] {
  const len = plainBytecode.length;
  const enc = new Array<number>(len);
  const stateBefore = new Array<number>(len + 1);
  const stAtSlot = new Map<number, number>();
  let st = (vmKey ^ fnSalt) | 0;

  for (let p = 0; p < len; p++) {
    stateBefore[p] = st;
    if (stateSlots && stateSlots.has(p)) {
      stAtSlot.set(p, st);
      enc[p] = 0;
    } else {
      st = (Math.imul(st ^ (p + 1), 0x45d9f3b) + 0x9e3779b9) | 0;
      const raw = plainBytecode[p] ^ ((st >>> 16) & 0xffff);
      enc[p] = raw;
      st = (st ^ Math.imul(raw + 1, 0x85ebca6b)) | 0;
    }
  }
  stateBefore[len] = st;

  if (stateSlots) {
    for (const slot of stateSlots) {
      const targetPc = plainBytecode[slot - 1];
      const sBefore = stAtSlot.get(slot) ?? 0;
      enc[slot] = (stateBefore[targetPc] ^ sBefore) | 0;
    }
  }

  return enc;
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
 * Produces the CSP-safe, eval-free, indirect-dispatch stateful stream interpreter.
 * Eliminates plaintext switch(o) dispatch via blinded opcode lookup M and shuffled handler table H.
 * Supports async/await via Promise frame continuation.
 */
export function createInterpreterSource(
  vmHelperName: string,
  opMap: number[],
  seed = 0x9e3779b9
): string {
  const slotMap = shuffleRange(24, (seed ^ 0x517cc1b7) >>> 0);
  const pairOrder = shuffleRange(24, (seed ^ 0x3c6ef372) >>> 0);

  const opMask = (computeFnv1aHash('vm-opmask', seed) & 0xff) | 1;
  const omA = computeFnv1aHash('vm-oma', seed) & 0xff;
  const omB = opMask ^ omA;

  const slotMask = (computeFnv1aHash('vm-slotmask', seed) & 0x7f) | 0x20;
  const smA = computeFnv1aHash('vm-sma', seed) & 0xff;
  const smB = slotMask ^ smA;

  const vmKey = deriveVmKey(seed);
  const vkA = computeFnv1aHash('vm-vka', seed) | 0;
  const vkB = (vmKey ^ vkA) | 0;

  const pairs: number[] = [];
  for (const op of pairOrder) {
    pairs.push(opMap[op] ^ opMask, slotMap[op] ^ slotMask);
  }

  const handlerMap: Record<number, string> = {
    [OP_LDC]: 'function(f){f.q[f.r++]=f.k[rd(f)];}',
    [OP_LDV]: 'function(f){f.q[f.r++]=f.s[rd(f)];}',
    [OP_STV]: 'function(f){f.s[rd(f)]=f.q[--f.r];}',
    [OP_LDG]: 'function(f){f.q[f.r++]=G[f.k[rd(f)]];}',
    [OP_GETP]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a[b];}',
    [OP_SETP]: 'function(f){var v=f.q[--f.r],b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=(a[b]=v);}',
    [OP_CALL]: 'function(f){var n=rd(f),g=[];for(var i=n-1;i>=0;i--)g[i]=f.q[--f.r];var fn=f.q[--f.r];f.q[f.r++]=fn.apply(null,g);}',
    [OP_MCALL]: 'function(f){var n=rd(f),g=[];for(var i=n-1;i>=0;i--)g[i]=f.q[--f.r];var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a[b].apply(a,g);}',
    [OP_ADD]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a+b;}',
    [OP_SUB]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a-b;}',
    [OP_MUL]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a*b;}',
    [OP_XOR]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a^b;}',
    [OP_AND]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a&b;}',
    [OP_OR]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a|b;}',
    [OP_SEQ]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a===b;}',
    [OP_LT]: 'function(f){var b=f.q[--f.r],a=f.q[--f.r];f.q[f.r++]=a<b;}',
    [OP_NOT]: 'function(f){f.q[f.r-1]=!f.q[f.r-1];}',
    [OP_JMP]: 'function(f){var j=rd(f),ts=f.c[f.p++]^f.st;f.p=j;f.st=ts;}',
    [OP_JZ]: 'function(f){var j=rd(f),ts=f.c[f.p++]^f.st;if(!f.q[--f.r]){f.p=j;f.st=ts;}}',
    [OP_RET]: 'function(f){f.d=1;f.v=f.q[--f.r];}',
    [OP_THROW]: 'function(f){throw f.q[--f.r];}',
    [OP_AWAIT]: 'function(f){var v=f.q[--f.r];f.d=2;f.v=Promise.resolve(v).then(function(w){f.d=0;f.q[f.r++]=w;return x(f);});}',
    [OP_OBJ]: 'function(f){var n=rd(f),o={},e=[];for(var i=0;i<n;i++){var v=f.q[--f.r],k0=f.q[--f.r];e.push([k0,v]);}for(var i=e.length-1;i>=0;i--){o[e[i][0]]=e[i][1];}f.q[f.r++]=o;}',
    [OP_ARR]: 'function(f){var n=rd(f),a=[];for(var i=n-1;i>=0;i--)a[i]=f.q[--f.r];f.q[f.r++]=a;}',
  };

  const handlers = new Array<string>(24);
  for (let op = 0; op < 24; op++) {
    handlers[slotMap[op]] = handlerMap[op];
  }

  return `var ${vmHelperName}=(function(){var G=typeof globalThis<"u"?globalThis:(typeof window<"u"?window:this);var z=+!String,ok=(z|${omA})^${omB},sk=(z|${smA})^${smB},vk=(z|${vkA})^${vkB};var M=[],P=[${pairs.join(',')}];for(var i=0;i<P.length;i+=2)M[P[i]]=P[i+1];function rd(f){var p=f.p++;var x0=f.st=(Math.imul(f.st^(p+1),0x45d9f3b)+0x9e3779b9)|0;var w=f.c[p],v=w^((x0>>>16)&0xffff);f.st=(f.st^Math.imul(w+1,0x85ebca6b))|0;return v;}var H;function x(f){while(f.p<f.c.length){var o=rd(f),m=M[o^ok];if(m!==void 0){var h=H[m^sk];if(h)h(f);}if(f.d)return f.v;}}H=[${handlers.join(',')}];return function(c,k,s,t,a){return x({c:c,k:k,s:s,t:t,q:[],r:0,p:0,st:(vk^a)|0,d:0,v:void 0});};})();`;
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
  const stateSlots = new Set<number>();
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
        emit(OP_JZ, 0, 0);
        stateSlots.add(jzPos + 2);
        if (!compileStmt(stmt.consequent)) return false;

        if (stmt.alternate) {
          const jmpPos = bytecode.length;
          emit(OP_JMP, 0, 0);
          stateSlots.add(jmpPos + 2);
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

  return { bytecode, consts, localCount, stateSlots };
}

function findInjectedVmHelperName(ast: acorn.Program): string | null {
  if (!ast || !Array.isArray(ast.body)) return null;
  for (const stmt of ast.body as any[]) {
    if (
      stmt.type === 'FunctionDeclaration' &&
      typeof stmt.id?.name === 'string' &&
      stmt.id.name.startsWith('_uVm')
    ) {
      return stmt.id.name;
    }
    if (stmt.type === 'VariableDeclaration' && Array.isArray(stmt.declarations)) {
      for (const d of stmt.declarations) {
        if (
          d.id?.type === 'Identifier' &&
          typeof d.id.name === 'string' &&
          d.id.name.startsWith('_uVm')
        ) {
          return d.id.name;
        }
      }
    }
  }
  return null;
}

function isMicroVmAlreadyInjected(ast: acorn.Program): boolean {
  return findInjectedVmHelperName(ast) !== null;
}

/**
 * Selective Bytecode Micro-VM virtualization for Layer 2 (--aggressive).
 * Selects qualifying cold functions (not serialized, no JSX, no super/yield/arguments/new.target, 15 <= N <= 80),
 * transforms their bodies into stateful stream-encrypted bytecode calls, and injects the indirect-dispatch interpreter once.
 */
export function applyMicroVm(
  ast: acorn.Program,
  coldFunctionNodes?: Set<acorn.Node> | WeakSet<acorn.Node>,
  serializedFunctionNodes?: WeakSet<acorn.Node>,
  seed = 0x9e3779b9
): MicroVmResult {
  const suffix = computeFnv1aHash(`micro-vm:${seed}`, seed).toString(36);
  const vmHelperName = `_uVm${suffix}`;

  const existingName = findInjectedVmHelperName(ast);
  if (existingName) {
    return {
      virtualizedCount: 0,
      vmHelperName: existingName,
    };
  }

  const opMap = generateOpcodeMap(seed);
  const vmKey = deriveVmKey(seed);
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
    if (virtualizedCount >= 5) break; // RFC-002: Maximum 5 functions per chunk to preserve <15% Gzip budget (Edebio 250 KB ceiling)

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

    const fnSalt = computeFnv1aHash(`vm-fn:${virtualizedCount}`, seed) >>> 0;
    const encBytecode = encryptBytecodeStream(
      compiled.bytecode,
      fnSalt,
      vmKey,
      compiled.stateSlots
    );

    // Replace function body with VM execution call: _uVm(encBytecode, consts, [params], this, fnSalt)
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
          elements: encBytecode.map((b) => ({
            type: 'Literal',
            value: b >>> 0,
            raw: String(b >>> 0),
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
        {
          type: 'Literal',
          value: fnSalt,
          raw: String(fnSalt),
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

  // If at least one function was virtualized, inject interpreter at module top (after directives/imports)
  if (virtualizedCount > 0) {
    const interpreterSource = createInterpreterSource(vmHelperName, opMap, seed);
    const parsedHelper = acorn.parse(interpreterSource, {
      ecmaVersion: 'latest',
      sourceType: 'script',
    }) as acorn.Program;

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

    ast.body.splice(insertIdx, 0, ...(parsedHelper.body as any[]));
  }

  return {
    virtualizedCount,
    vmHelperName,
  };
}
