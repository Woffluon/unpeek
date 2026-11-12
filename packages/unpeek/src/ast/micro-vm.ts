import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { generateCompactJs } from './codegen.js';
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
export const OP_LDU = 24;
export const OP_STU = 25;

const OPCODE_COUNT = 26;

export interface MicroVmResult {
  virtualizedCount: number;
  vmHelperName: string;
}

export interface UpvalueDescriptor {
  name: string;
  isWritten: boolean;
}

export interface CompiledFunction {
  bytecode: number[];
  consts: any[];
  localCount: number;
  stateSlots?: Set<number>;
  upvalues?: UpvalueDescriptor[];
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
 * Generates a build-specific permutation of 26 distinct opcodes in 0..255 derived from seed.
 */
export function generateOpcodeMap(seed: number, count = OPCODE_COUNT): number[] {
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
  return pool.slice(0, count);
}

/**
 * Produces the CSP-safe, eval-free, indirect-dispatch stateful stream interpreter.
 * Eliminates plaintext switch(o) dispatch via blinded opcode lookup M and shuffled handler table H.
 * Binds ok, sk, and vk to a synchronous FNV-1a self-hash of the interpreter function (and G[sym]
 * when shield coupling is active) so formatting or tampering silently corrupts execution.
 * Supports async/await via Promise frame continuation and lexical closures via OP_LDU/OP_STU.
 */
export function createInterpreterSource(
  vmHelperName: string,
  opMap: number[],
  seed = 0x9e3779b9,
  windowKeySymbol?: string,
  expectedDelta?: number
): string {
  const opCount = opMap.length;
  const slotMap = shuffleRange(opCount, (seed ^ 0x517cc1b7) >>> 0);
  const pairOrder = shuffleRange(opCount, (seed ^ 0x3c6ef372) >>> 0);

  const opMask = (computeFnv1aHash('vm-opmask', seed) & 0xff) | 1;
  const slotMask = (computeFnv1aHash('vm-slotmask', seed) & 0x7f) | 0x20;
  const vmKey = deriveVmKey(seed);

  const pairs: number[] = [];
  for (const op of pairOrder) {
    pairs.push(opMap[op] ^ opMask, slotMap[op] ^ slotMask);
  }

  const handlerMap: Record<number, string> = {
    [OP_LDC]: 'function($f){$f.q[$f.r++]=$f.k[$rd($f)];}',
    [OP_LDV]: 'function($f){$f.q[$f.r++]=$f.s[$rd($f)];}',
    [OP_STV]: 'function($f){$f.s[$rd($f)]=$f.q[--$f.r];}',
    [OP_LDG]: 'function($f){$f.q[$f.r++]=$G[$f.k[$rd($f)]];}',
    [OP_GETP]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a[$b];}',
    [OP_SETP]: 'function($f){var $v=$f.q[--$f.r],$b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=($a[$b]=$v);}',
    [OP_CALL]: 'function($f){var $n=$rd($f),$g=[];for(var $i=$n-1;$i>=0;$i--)$g[$i]=$f.q[--$f.r];var $fn=$f.q[--$f.r];$f.q[$f.r++]=$fn.apply(void 0,$g);}',
    [OP_MCALL]: 'function($f){var $n=$rd($f),$g=[];for(var $i=$n-1;$i>=0;$i--)$g[$i]=$f.q[--$f.r];var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a[$b].apply($a,$g);}',
    [OP_ADD]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a+$b;}',
    [OP_SUB]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a-$b;}',
    [OP_MUL]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a*$b;}',
    [OP_XOR]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a^$b;}',
    [OP_AND]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a&$b;}',
    [OP_OR]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a|$b;}',
    [OP_SEQ]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a===$b;}',
    [OP_LT]: 'function($f){var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a<$b;}',
    [OP_NOT]: 'function($f){$f.q[$f.r-1]=!$f.q[$f.r-1];}',
    [OP_JMP]: 'function($f){var $j=$rd($f),$ts=$f.c[$f.p++]^$f.st;$f.p=$j;$f.st=$ts;}',
    [OP_JZ]: 'function($f){var $j=$rd($f),$ts=$f.c[$f.p++]^$f.st;if(!$f.q[--$f.r]){$f.p=$j;$f.st=$ts;}}',
    [OP_RET]: 'function($f){$f.d=1;$f.v=$f.q[--$f.r];}',
    [OP_THROW]: 'function($f){throw $f.q[--$f.r];}',
    [OP_AWAIT]: 'function($f){var $v=$f.q[--$f.r];$f.d=2;$f.v=Promise.resolve($v).then(function($w){$f.d=0;$f.q[$f.r++]=$w;return $x($f);});}',
    [OP_OBJ]: 'function($f){var $n=$rd($f),$o={},$e=[];for(var $i=0;$i<$n;$i++){var $v=$f.q[--$f.r],$k0=$f.q[--$f.r];$e.push([$k0,$v]);}for(var $i=$e.length-1;$i>=0;$i--){$o[$e[$i][0]]=$e[$i][1];}$f.q[$f.r++]=$o;}',
    [OP_ARR]: 'function($f){var $n=$rd($f),$a=[];for(var $i=$n-1;$i>=0;$i--)$a[$i]=$f.q[--$f.r];$f.q[$f.r++]=$a;}',
    [OP_LDU]: 'function($f){$f.q[$f.r++]=$f.u[$rd($f)][0]();}',
    [OP_STU]: 'function($f){$f.u[$rd($f)][1]($f.q[--$f.r]);}',
  };

  const handlers = new Array<string>(opCount);
  for (let op = 0; op < opCount; op++) {
    handlers[slotMap[op]] = handlerMap[op];
  }

  const hasSym = Boolean(windowKeySymbol && expectedDelta !== undefined);
  const symPropAccess = hasSym
    ? /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(windowKeySymbol!)
      ? `.${windowKeySymbol}`
      : `[${JSON.stringify(windowKeySymbol)}]`
    : '';

  const dDecl = hasSym
    ? `var $d=$G${symPropAccess}!=null?$G${symPropAccess}:($W?-1:(($h^$D)&0xffff));`
    : '';
  const okExpr = hasSym ? `(($h&255)^$A^($d&255))&255` : `(($h&255)^$A)&255`;
  const skExpr = hasSym
    ? `((($h>>>8)&255)^$B^(($d>>>8)&255))&255`
    : `((($h>>>8)&255)^$B)&255`;
  const vkExpr = hasSym ? `($h^$C^Math.imul($d|0,0x9e3779b1))|0` : `($h^$C)|0`;
  const paramsList = hasSym ? '$P,$A,$B,$C,$D' : '$P,$A,$B,$C';

  const factoryRaw = `(function $I(${paramsList}){var $G=typeof globalThis<"u"?globalThis:(typeof window<"u"?window:this);${
    hasSym ? 'var $W=typeof window<"u"||typeof self<"u";' : ''
  }var $ts=Function.prototype.toString,$s=$ts.call($I);for(var $h=0x811c9dc5,$i=0;$i<$s.length;$i++)$h=Math.imul($h^$s.charCodeAt($i),0x01000193)>>>0;try{$ts.call(0);$h^=1;}catch($e){}var $M,$ok,$sk,$vk,$in=0;function $init(){$in=1;${dDecl}$ok=${okExpr};$sk=${skExpr};$vk=${vkExpr};$M=[];for(var $j=0;$j<$P.length;$j+=2)$M[$P[$j]]=$P[$j+1];}function $rd($f){var $p=$f.p++;var $x0=$f.st=(Math.imul($f.st^($p+1),0x45d9f3b)+0x9e3779b9)|0;var $w=$f.c[$p],$v=$w^(($x0>>>16)&0xffff);$f.st=($f.st^Math.imul($w+1,0x85ebca6b))|0;return $v;}var $H;function $x($f){while($f.p<$f.c.length){var $o=$rd($f),$m=$M[$o^$ok];if($m!==void 0){var $h0=$H[$m^$sk];if($h0)$h0($f);}if($f.d)return $f.v;}}$H=[${handlers.join(
    ','
  )}];return function($c,$k,$s0,$t,$a,$u){if(!$in)$init();return $x({c:$c,k:$k,s:$s0,t:$t,u:$u||[],q:[],r:0,p:0,st:($vk^$a)|0,d:0,v:void 0});};})`;

  const parsedFactory = acorn.parse(factoryRaw, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  }) as any;
  const factoryExpr = parsedFactory.body[0].expression;
  const compactFactory = generateCompactJs(factoryExpr);
  const buildH = computeFnv1aHash(compactFactory);

  const expD = hasSym ? expectedDelta! & 0xffff : 0;
  const argA = (opMask ^ (buildH & 0xff) ^ (expD & 0xff)) & 0xff;
  const argB = (slotMask ^ ((buildH >>> 8) & 0xff) ^ ((expD >>> 8) & 0xff)) & 0xff;
  const argC = (vmKey ^ buildH ^ (hasSym ? Math.imul(expD | 0, 0x9e3779b1) : 0)) | 0;
  const argD = hasSym ? (buildH ^ expD) & 0xffff : 0;

  return `var ${vmHelperName}=(${compactFactory})([${pairs.join(',')}],${argA},${argB},${argC}${
    hasSym ? `,${argD}` : ''
  });`;
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
      type === 'YieldExpression' ||
      type === 'WithStatement'
    ) {
      forbidden = true;
      return;
    }
    if (type === 'Identifier' && (node.name === 'arguments' || node.name === 'eval')) {
      forbidden = true;
      return;
    }
    if (type === 'MetaProperty') {
      forbidden = true;
      return;
    }
  });
  return forbidden;
}

const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const LEXICAL_SCOPE_TYPES = new Set([
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
  'ClassDeclaration',
  'ClassExpression',
]);

function collectPatternNames(pattern: any, out: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      out.add(pattern.name);
      break;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, out);
      break;
    case 'RestElement':
      collectPatternNames(pattern.argument, out);
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements || []) {
        if (el) collectPatternNames(el, out);
      }
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties || []) {
        if (prop.type === 'Property') {
          collectPatternNames(prop.value, out);
        } else if (prop.type === 'RestElement') {
          collectPatternNames(prop.argument, out);
        }
      }
      break;
  }
}

/**
 * Compiles a candidate function AST into 26-instruction bytecode with lexical upvalue capture.
 * Returns null if the function contains unsupported constructs.
 */
export function compileFunctionToBytecode(
  fnNode: any,
  opMap: number[],
  enclosingBindings?: Set<string>
): CompiledFunction | null {
  const bytecode: number[] = [];
  const consts: any[] = [];
  const stateSlots = new Set<number>();
  const fnScope = new Map<string, number>();
  const scopeStack: Map<string, number>[] = [fnScope];
  const upvalues: UpvalueDescriptor[] = [];
  const upvalueMap = new Map<string, number>();
  let localCount = 0;

  // Add parameter identifiers to function scope
  for (const param of fnNode.params) {
    if (param.type !== 'Identifier') return null;
    if (fnScope.has(param.name)) return null;
    fnScope.set(param.name, localCount++);
  }

  // Pre-scan function-scoped `var` declarations across nested blocks (without descending into nested functions)
  // and top-level `let`/`const` declarations directly in fnNode.body.body.
  let invalidDecl = false;
  function scanVarDecls(node: any, isTopBody: boolean): void {
    if (!node || invalidDecl) return;
    if (Array.isArray(node)) {
      for (const item of node) scanVarDecls(item, isTopBody);
      return;
    }
    if (typeof node !== 'object' || !node.type) return;
    if (FUNCTION_NODE_TYPES.has(node.type)) return;
    if (node.type === 'VariableDeclaration') {
      const isVar = node.kind === 'var';
      if (isVar || isTopBody) {
        for (const decl of node.declarations || []) {
          if (decl.id?.type !== 'Identifier') {
            invalidDecl = true;
            return;
          }
          if (!fnScope.has(decl.id.name)) {
            fnScope.set(decl.id.name, localCount++);
          }
        }
      }
      return;
    }
    if (node.type === 'BlockStatement') {
      for (const s of node.body || []) {
        scanVarDecls(s, false);
      }
      return;
    }
    if (node.type === 'IfStatement') {
      scanVarDecls(node.consequent, false);
      if (node.alternate) scanVarDecls(node.alternate, false);
    }
  }

  if (fnNode.body.type === 'BlockStatement') {
    for (const stmt of fnNode.body.body || []) {
      scanVarDecls(stmt, true);
      if (invalidDecl) return null;
    }
  }

  function resolveLocal(name: string): number | undefined {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const slot = scopeStack[i].get(name);
      if (slot !== undefined) return slot;
    }
    return undefined;
  }

  function getOrCreateUpvalue(name: string, isWritten: boolean): number {
    let idx = upvalueMap.get(name);
    if (idx === undefined) {
      idx = upvalues.length;
      upvalueMap.set(name, idx);
      upvalues.push({ name, isWritten });
    } else if (isWritten) {
      upvalues[idx].isWritten = true;
    }
    return idx;
  }

  function emitLoadVar(name: string): void {
    const localSlot = resolveLocal(name);
    if (localSlot !== undefined) {
      emit(OP_LDV, localSlot);
      return;
    }
    if (enclosingBindings && enclosingBindings.has(name)) {
      emit(OP_LDU, getOrCreateUpvalue(name, false));
      return;
    }
    const idx = addConst(name);
    emit(OP_LDG, idx);
  }

  function canWriteVar(name: string): boolean {
    if (resolveLocal(name) !== undefined) return true;
    return Boolean(enclosingBindings && enclosingBindings.has(name));
  }

  function emitStoreVar(name: string): boolean {
    const localSlot = resolveLocal(name);
    if (localSlot !== undefined) {
      emit(OP_STV, localSlot);
      return true;
    }
    if (enclosingBindings && enclosingBindings.has(name)) {
      emit(OP_STU, getOrCreateUpvalue(name, true));
      return true;
    }
    return false;
  }

  function addConst(val: any): number {
    for (let i = 0; i < consts.length; i++) {
      if (Object.is(consts[i], val)) return i;
    }
    const idx = consts.length;
    consts.push(val);
    return idx;
  }

  function emit(op: number, ...args: number[]): void {
    bytecode.push(opMap[op]);
    for (const a of args) bytecode.push(a);
  }

  function compileExpr(node: any, inValuePos = true): boolean {
    if (!node) return false;
    switch (node.type) {
      case 'Literal': {
        if (node.regex || typeof node.value === 'bigint') return false;
        const idx = addConst(node.value);
        emit(OP_LDC, idx);
        return true;
      }
      case 'Identifier': {
        if (node.name === 'undefined') {
          const localSlot = resolveLocal('undefined');
          if (localSlot !== undefined) {
            emit(OP_LDV, localSlot);
          } else if (enclosingBindings && enclosingBindings.has('undefined')) {
            emit(OP_LDU, getOrCreateUpvalue('undefined', false));
          } else {
            const idx = addConst(undefined);
            emit(OP_LDC, idx);
          }
          return true;
        }
        emitLoadVar(node.name);
        return true;
      }
      case 'BinaryExpression': {
        if (node.operator === '>') {
          if (!compileExpr(node.right, true)) return false;
          if (!compileExpr(node.left, true)) return false;
          emit(OP_LT);
          return true;
        }
        if (node.operator === '<=') {
          if (!compileExpr(node.right, true)) return false;
          if (!compileExpr(node.left, true)) return false;
          emit(OP_LT);
          emit(OP_NOT);
          return true;
        }
        if (node.operator === '>=') {
          if (!compileExpr(node.left, true)) return false;
          if (!compileExpr(node.right, true)) return false;
          emit(OP_LT);
          emit(OP_NOT);
          return true;
        }
        if (!compileExpr(node.left, true)) return false;
        if (!compileExpr(node.right, true)) return false;
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
        if (node.operator === 'void') {
          if (node.argument?.type !== 'Literal' || node.argument.regex) return false;
          const undefIdx = addConst(undefined);
          emit(OP_LDC, undefIdx);
          return true;
        }
        if (!compileExpr(node.argument, true)) return false;
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
          default: return false;
        }
        return true;
      }
      case 'MemberExpression': {
        if (node.optional) return false;
        if (!compileExpr(node.object, true)) return false;
        if (node.computed) {
          if (!compileExpr(node.property, true)) return false;
        } else {
          if (node.property?.type !== 'Identifier') return false;
          const idx = addConst(node.property.name);
          emit(OP_LDC, idx);
        }
        emit(OP_GETP);
        return true;
      }
      case 'CallExpression': {
        if (node.optional) return false;
        if (node.callee.type === 'MemberExpression') {
          if (node.callee.optional) return false;
          if (!compileExpr(node.callee.object, true)) return false;
          if (node.callee.computed) {
            if (!compileExpr(node.callee.property, true)) return false;
          } else {
            if (node.callee.property?.type !== 'Identifier') return false;
            const idx = addConst(node.callee.property.name);
            emit(OP_LDC, idx);
          }
          for (const arg of node.arguments) {
            if (!compileExpr(arg, true)) return false;
          }
          emit(OP_MCALL, node.arguments.length);
        } else {
          if (!compileExpr(node.callee, true)) return false;
          for (const arg of node.arguments) {
            if (!compileExpr(arg, true)) return false;
          }
          emit(OP_CALL, node.arguments.length);
        }
        return true;
      }
      case 'AssignmentExpression': {
        if (node.left.type === 'Identifier') {
          const name = node.left.name;
          if (!canWriteVar(name)) return false;
          if (node.operator === '=') {
            if (!compileExpr(node.right, true)) return false;
          } else {
            let binOp: number | null = null;
            switch (node.operator) {
              case '+=': binOp = OP_ADD; break;
              case '-=': binOp = OP_SUB; break;
              case '*=': binOp = OP_MUL; break;
              case '^=': binOp = OP_XOR; break;
              case '&=': binOp = OP_AND; break;
              case '|=': binOp = OP_OR; break;
              default: return false;
            }
            emitLoadVar(name);
            if (!compileExpr(node.right, true)) return false;
            emit(binOp);
          }
          if (!emitStoreVar(name)) return false;
          if (inValuePos) {
            emitLoadVar(name);
          }
          return true;
        }
        if (node.left.type === 'MemberExpression') {
          if (node.operator !== '=' || node.left.optional) return false;
          if (!compileExpr(node.left.object, true)) return false;
          if (node.left.computed) {
            if (!compileExpr(node.left.property, true)) return false;
          } else {
            if (node.left.property?.type !== 'Identifier') return false;
            const idx = addConst(node.left.property.name);
            emit(OP_LDC, idx);
          }
          if (!compileExpr(node.right, true)) return false;
          emit(OP_SETP);
          return true;
        }
        return false;
      }
      case 'UpdateExpression': {
        if (node.argument?.type !== 'Identifier') return false;
        const name = node.argument.name;
        if (!canWriteVar(name)) return false;
        const oneIdx = addConst(1);
        const stepOp = node.operator === '++' ? OP_ADD : OP_SUB;
        if (node.prefix) {
          emitLoadVar(name);
          emit(OP_LDC, oneIdx);
          emit(OP_MUL);
          emit(OP_LDC, oneIdx);
          emit(stepOp);
          if (!emitStoreVar(name)) return false;
          if (inValuePos) {
            emitLoadVar(name);
          }
        } else {
          if (inValuePos) {
            emitLoadVar(name);
            emit(OP_LDC, oneIdx);
            emit(OP_MUL);
          }
          emitLoadVar(name);
          emit(OP_LDC, oneIdx);
          emit(OP_MUL);
          emit(OP_LDC, oneIdx);
          emit(stepOp);
          if (!emitStoreVar(name)) return false;
        }
        return true;
      }
      case 'ObjectExpression': {
        for (const prop of node.properties) {
          if (prop.type !== 'Property' || prop.kind !== 'init') return false;
          if (prop.computed) {
            if (!compileExpr(prop.key, true)) return false;
          } else {
            const keyName = prop.key?.name ?? prop.key?.value;
            if (keyName === undefined) return false;
            const idx = addConst(keyName);
            emit(OP_LDC, idx);
          }
          if (!compileExpr(prop.value, true)) return false;
        }
        emit(OP_OBJ, node.properties.length);
        return true;
      }
      case 'ArrayExpression': {
        for (const elem of node.elements) {
          if (!elem || !compileExpr(elem, true)) return false;
        }
        emit(OP_ARR, node.elements.length);
        return true;
      }
      case 'AwaitExpression': {
        if (!compileExpr(node.argument, true)) return false;
        emit(OP_AWAIT);
        return true;
      }
      default:
        return false;
    }
  }

  function compileStmt(stmt: any, isFnBody = false): boolean {
    if (!stmt) return false;
    switch (stmt.type) {
      case 'ReturnStatement': {
        if (stmt.argument) {
          if (!compileExpr(stmt.argument, true)) return false;
        } else {
          const idx = addConst(undefined);
          emit(OP_LDC, idx);
        }
        emit(OP_RET);
        return true;
      }
      case 'ExpressionStatement': {
        if (!compileExpr(stmt.expression, false)) return false;
        return true;
      }
      case 'VariableDeclaration': {
        for (const decl of stmt.declarations) {
          if (decl.id?.type !== 'Identifier') return false;
          const slot = resolveLocal(decl.id.name);
          if (slot === undefined) return false;
          if (decl.init) {
            if (!compileExpr(decl.init, true)) return false;
            emit(OP_STV, slot);
          }
        }
        return true;
      }
      case 'IfStatement': {
        if (!compileExpr(stmt.test, true)) return false;
        const jzPos = bytecode.length;
        emit(OP_JZ, 0, 0);
        stateSlots.add(jzPos + 2);
        if (!compileStmt(stmt.consequent, false)) return false;

        if (stmt.alternate) {
          const jmpPos = bytecode.length;
          emit(OP_JMP, 0, 0);
          stateSlots.add(jmpPos + 2);
          bytecode[jzPos + 1] = bytecode.length;
          if (!compileStmt(stmt.alternate, false)) return false;
          bytecode[jmpPos + 1] = bytecode.length;
        } else {
          bytecode[jzPos + 1] = bytecode.length;
        }
        return true;
      }
      case 'BlockStatement': {
        let pushedBlock = false;
        if (!isFnBody) {
          const blockScope = new Map<string, number>();
          for (const s of stmt.body || []) {
            if (s.type === 'VariableDeclaration' && s.kind !== 'var') {
              for (const decl of s.declarations || []) {
                if (decl.id?.type !== 'Identifier') return false;
                if (!blockScope.has(decl.id.name)) {
                  blockScope.set(decl.id.name, localCount++);
                }
              }
            }
          }
          if (blockScope.size > 0) {
            scopeStack.push(blockScope);
            pushedBlock = true;
          }
        }
        for (const s of stmt.body) {
          if (!compileStmt(s, false)) {
            if (pushedBlock) scopeStack.pop();
            return false;
          }
        }
        if (pushedBlock) scopeStack.pop();
        return true;
      }
      default:
        return false;
    }
  }

  if (fnNode.body.type === 'BlockStatement') {
    if (!compileStmt(fnNode.body, true)) return null;
  } else {
    // Arrow function with expression body
    if (!compileExpr(fnNode.body, true)) return null;
    emit(OP_RET);
  }

  // Ensure trailing return undefined
  const undefIdx = addConst(undefined);
  emit(OP_LDC, undefIdx);
  emit(OP_RET);

  return { bytecode, consts, localCount, stateSlots, upvalues };
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

/**
 * Selective Bytecode Micro-VM virtualization for Layer 2 (--aggressive).
 * Selects qualifying cold functions (not serialized, no JSX, no super/yield/arguments/new.target/with, 15 <= N <= 80),
 * tracks enclosing AST lexical scopes to capture free local/module bindings as upvalues (OP_LDU/OP_STU),
 * transforms their bodies into stateful stream-encrypted bytecode calls, and injects the self-hashed interpreter once.
 */
export function applyMicroVm(
  ast: acorn.Program,
  coldFunctionNodes?: Set<acorn.Node> | WeakSet<acorn.Node>,
  serializedFunctionNodes?: WeakSet<acorn.Node>,
  seed = 0x9e3779b9,
  windowKeySymbol?: string,
  expectedDelta?: number
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

  const opMap = generateOpcodeMap(seed, OPCODE_COUNT);
  const vmKey = deriveVmKey(seed);

  const scopeBindings = new Map<acorn.Node, Set<string>>();
  function addScopeBinding(scopeNode: acorn.Node | undefined, name: string): void {
    if (!scopeNode || !name) return;
    let set = scopeBindings.get(scopeNode);
    if (!set) {
      set = new Set<string>();
      scopeBindings.set(scopeNode, set);
    }
    set.add(name);
  }

  function findNearestFunctionOrProgram(ancestors: acorn.Node[]): acorn.Node {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (FUNCTION_NODE_TYPES.has(ancestors[i].type) || ancestors[i].type === 'Program') {
        return ancestors[i];
      }
    }
    return ast;
  }

  function findNearestLexicalScope(ancestors: acorn.Node[]): acorn.Node {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (LEXICAL_SCOPE_TYPES.has(ancestors[i].type)) {
        return ancestors[i];
      }
    }
    return ast;
  }

  interface CandidateRecord {
    fn: any;
    ancestors: acorn.Node[];
  }
  const candidates: CandidateRecord[] = [];

  walk.ancestor(ast, {
    ImportDeclaration(node: any) {
      for (const spec of node.specifiers || []) {
        if (spec.local?.type === 'Identifier') {
          addScopeBinding(ast, spec.local.name);
        }
      }
    },
    VariableDeclaration(node: any, _state, ancestors) {
      const targetScope =
        node.kind === 'var'
          ? findNearestFunctionOrProgram(ancestors)
          : findNearestLexicalScope(ancestors);
      const names = new Set<string>();
      for (const decl of node.declarations || []) {
        collectPatternNames(decl.id, names);
      }
      for (const name of names) {
        addScopeBinding(targetScope, name);
      }
    },
    FunctionDeclaration(node: any, _state, ancestors) {
      const parentAncestors = ancestors.slice(0, -1);
      if (node.id?.type === 'Identifier') {
        addScopeBinding(findNearestLexicalScope(parentAncestors), node.id.name);
        addScopeBinding(findNearestFunctionOrProgram(parentAncestors), node.id.name);
      }
      const paramNames = new Set<string>();
      for (const p of node.params || []) {
        collectPatternNames(p, paramNames);
      }
      for (const name of paramNames) {
        addScopeBinding(node, name);
      }
      candidates.push({ fn: node, ancestors: ancestors.slice() });
    },
    FunctionExpression(node: any, _state, ancestors) {
      if (node.id?.type === 'Identifier') {
        addScopeBinding(node, node.id.name);
      }
      const paramNames = new Set<string>();
      for (const p of node.params || []) {
        collectPatternNames(p, paramNames);
      }
      for (const name of paramNames) {
        addScopeBinding(node, name);
      }
      candidates.push({ fn: node, ancestors: ancestors.slice() });
    },
    ArrowFunctionExpression(node: any, _state, ancestors) {
      const paramNames = new Set<string>();
      for (const p of node.params || []) {
        collectPatternNames(p, paramNames);
      }
      for (const name of paramNames) {
        addScopeBinding(node, name);
      }
      candidates.push({ fn: node, ancestors: ancestors.slice() });
    },
    ClassDeclaration(node: any, _state, ancestors) {
      if (node.id?.type === 'Identifier') {
        addScopeBinding(findNearestLexicalScope(ancestors.slice(0, -1)), node.id.name);
        addScopeBinding(node, node.id.name);
      }
    },
    ClassExpression(node: any) {
      if (node.id?.type === 'Identifier') {
        addScopeBinding(node, node.id.name);
      }
    },
    CatchClause(node: any) {
      if (node.param) {
        const names = new Set<string>();
        collectPatternNames(node.param, names);
        for (const name of names) {
          addScopeBinding(node, name);
        }
      }
    },
  });

  let virtualizedCount = 0;

  for (const { fn, ancestors } of candidates) {
    if (virtualizedCount >= 5) break; // RFC-002: Maximum 5 functions per chunk to preserve <15% Gzip budget

    // 1. Must be cold if coldFunctionNodes set is provided
    if (coldFunctionNodes && !coldFunctionNodes.has(fn)) {
      continue;
    }

    // 2. Must not be serialized worker function
    if (serializedFunctionNodes && serializedFunctionNodes.has(fn)) {
      continue;
    }

    // 3. Must not be generator or class constructor
    if (fn.generator) {
      continue;
    }
    const parentNode = ancestors.length >= 2 ? (ancestors[ancestors.length - 2] as any) : null;
    if (parentNode?.type === 'MethodDefinition' && parentNode.kind === 'constructor') {
      continue;
    }

    // 4. Must not be inside a `with` statement
    if (ancestors.some((a) => a.type === 'WithStatement')) {
      continue;
    }

    // 5. Must not have forbidden constructs (JSX, super, yield, arguments, eval, MetaProperty, with)
    if (hasForbiddenConstructs(fn)) {
      continue;
    }

    // 6. AST node count check: 15 <= N <= 80
    const nodeCount = countAstNodes(fn);
    if (nodeCount < 15 || nodeCount > 80) {
      continue;
    }

    // 7. Build enclosing lexical binding set for upvalue resolution
    const enclosingBindings = new Set<string>();
    for (let i = 0; i < ancestors.length - 1; i++) {
      const bound = scopeBindings.get(ancestors[i]);
      if (bound) {
        for (const name of bound) {
          enclosingBindings.add(name);
        }
      }
    }
    if (fn.type === 'FunctionExpression' && fn.id?.type === 'Identifier') {
      enclosingBindings.add(fn.id.name);
    }

    // 8. Attempt compilation into bytecode
    const compiled = compileFunctionToBytecode(fn, opMap, enclosingBindings);
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

    const paramArgs = fn.params.map((p: any) => ({
      type: 'Identifier',
      name: p.name,
    }));

    const constElements = compiled.consts.map((c) => {
      if (c === undefined) {
        return {
          type: 'UnaryExpression',
          operator: 'void',
          prefix: true,
          argument: { type: 'Literal', value: 0, raw: '0' },
        };
      }
      return {
        type: 'Literal',
        value: c,
        raw: JSON.stringify(c),
      };
    });

    const callArgs: any[] = [
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
        elements: constElements,
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
    ];

    if (compiled.upvalues && compiled.upvalues.length > 0) {
      const usedParamNames = new Set(enclosingBindings);
      const upvalueElements = compiled.upvalues.map((uv, uIdx) => {
        const getterFn = {
          type: 'ArrowFunctionExpression',
          id: null,
          params: [],
          body: { type: 'Identifier', name: uv.name },
          generator: false,
          async: false,
          expression: true,
        };
        if (!uv.isWritten) {
          return {
            type: 'ArrayExpression',
            elements: [getterFn],
          };
        }
        let paramName = `_uv${uIdx}`;
        let suffixIdx = 0;
        while (usedParamNames.has(paramName) || paramName === uv.name) {
          paramName = `_uv${uIdx}_${suffixIdx++}`;
        }
        usedParamNames.add(paramName);
        const setterFn = {
          type: 'ArrowFunctionExpression',
          id: null,
          params: [{ type: 'Identifier', name: paramName }],
          body: {
            type: 'AssignmentExpression',
            operator: '=',
            left: { type: 'Identifier', name: uv.name },
            right: { type: 'Identifier', name: paramName },
          },
          generator: false,
          async: false,
          expression: true,
        };
        return {
          type: 'ArrayExpression',
          elements: [getterFn, setterFn],
        };
      });
      callArgs.push({
        type: 'ArrayExpression',
        elements: upvalueElements,
      });
    }

    const callExpr: any = {
      type: 'CallExpression',
      callee: {
        type: 'Identifier',
        name: vmHelperName,
      },
      arguments: callArgs,
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
    const interpreterSource = createInterpreterSource(
      vmHelperName,
      opMap,
      seed,
      windowKeySymbol,
      expectedDelta
    );
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
