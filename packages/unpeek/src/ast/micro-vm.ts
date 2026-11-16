import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { generateCompactJs } from './codegen.js';
import { computeFnv1aHash } from '../shared/hash.js';

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
export const OP_DIV = 26;
export const OP_MOD = 27;
export const OP_SHL = 28;
export const OP_SHR = 29;
export const OP_USHR = 30;
export const OP_POW = 31;
export const OP_EQ = 32;
export const OP_TYPEOF = 33;
export const OP_IN = 34;
export const OP_INSTOF = 35;
export const OP_NEW = 36;
export const OP_THIS = 37;
export const OP_POP = 38;
export const OP_TRY = 39;
export const OP_ENDTRY = 40;
export const OP_NULLISH = 41;
export const OP_DUP = 42;

const OPCODE_COUNT = 43;

export interface MicroVmResult {
  virtualizedCount: number;
  vmHelperName: string;
}

export interface MicroVmExtraOptions {
  criticalFunctionNodes?: WeakSet<acorn.Node>;
  maxFunctionsPerChunk?: number;
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
  accSlots?: Set<number>;
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

function mixOpSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h | 0;
}

/**
 * Encrypts compiled bytecode with a 2-pass stateful ciphertext-feedback + inter-block
 * accumulator-ratcheted stream cipher. Jump and try/catch sync slots hold targetState ^ streamState
 * and targetAcc ^ accState so control-flow merges remain exact while resisting static block lifting.
 */
export function encryptBytecodeStream(
  plainBytecode: number[],
  fnSalt: number,
  vmKey: number,
  stateSlots?: Set<number>,
  accSlots?: Set<number>
): number[] {
  const len = plainBytecode.length;
  const enc = new Array<number>(len);
  const stateBefore = new Array<number>(len + 1);
  const accBefore = new Array<number>(len + 1);
  const stAtSlot = new Map<number, number>();
  const acAtSlot = new Map<number, number>();

  let st = (vmKey ^ fnSalt) | 0;
  let ac = (vmKey ^ (fnSalt << 5) ^ 0x517cc1b7) | 0;

  for (let p = 0; p < len; p++) {
    stateBefore[p] = st;
    accBefore[p] = ac;
    if (stateSlots && stateSlots.has(p)) {
      stAtSlot.set(p, st);
      enc[p] = 0;
    } else if (accSlots && accSlots.has(p)) {
      acAtSlot.set(p, ac);
      enc[p] = 0;
    } else {
      st = (Math.imul(st ^ (p + 1), 0x45d9f3b) + ((ac | 0x9e3779b9) + (ac & 0x9e3779b9))) | 0;
      const plainWord = plainBytecode[p];
      const raw = plainWord ^ ((st >>> 16) & 0xffff);
      enc[p] = raw;
      st = (st ^ Math.imul(raw + 1, 0x85ebca6b)) | 0;
      ac = (Math.imul(ac ^ plainWord, 0x27d4eb2d) ^ ((st >>> 13) | (st << 19))) | 0;
    }
  }
  stateBefore[len] = st;
  accBefore[len] = ac;

  if (stateSlots) {
    for (const slot of stateSlots) {
      const targetPc = plainBytecode[slot - 1];
      const sBefore = stAtSlot.get(slot) ?? 0;
      enc[slot] = (stateBefore[targetPc] ^ sBefore) | 0;
    }
  }
  if (accSlots) {
    for (const slot of accSlots) {
      const targetPc = plainBytecode[slot - 2];
      const aBefore = acAtSlot.get(slot) ?? 0;
      enc[slot] = (accBefore[targetPc] ^ aBefore) | 0;
    }
  }

  return enc;
}

/**
 * Generates a build-specific permutation of distinct opcodes in 0..255 derived from seed.
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
 * Generates a per-(seed, op) polymorphic MBA zero-identity expression over live ($f.ac, $f.p)
 * so every VM handler AST is structurally distinct and resists static AST fingerprinting.
 */
function makeHandlerMbaZeroExpr(seed: number, op: number): string {
  const variant = Math.abs(mixOpSeed(seed, op * 11 + 3)) % 4;
  const c1 = mixOpSeed(seed, op * 11 + 5);
  const c2 = mixOpSeed(seed, op * 11 + 7);
  if (variant === 0) {
    const cSum = (c1 + c2) | 0;
    return `(((((($f.ac|${c1})+($f.ac&${c1}))|0)|((($f.p^${c2})+(($f.p&${c2})<<1))|0))+((((($f.ac|${c1})+($f.ac&${c1}))|0)&((($f.p^${c2})+(($f.p&${c2})<<1))|0))))-(((((($f.ac^$f.p)+(($f.ac&$f.p)<<1))|0)|${cSum})+((((($f.ac^$f.p)+(($f.ac&$f.p)<<1))|0)&${cSum})))|0))|0`;
  }
  if (variant === 1) {
    const cSum = (c1 + c2) | 0;
    return `((((($f.ac|$f.p)<<1)-($f.ac^$f.p))+${cSum})-((($f.ac^${c1})+(($f.ac&${c1})<<1))+(($f.p|${c2})+($f.p&${c2}))))|0`;
  }
  if (variant === 2) {
    const cFold = (1 - c1 - c2) | 0;
    return `(((~$f.ac|${c1})+(~$f.ac&${c1}))+(($f.ac|${c2})+($f.ac&${c2}))+${cFold})|0`;
  }
  return `((($f.ac|$f.p)-(~$f.ac&$f.p))^((($f.ac&${c1})+($f.ac&~${c1}))))|0`;
}

function wrapHandlerWithMba(seed: number, op: number, coreBody: string, isTerminal = false): string {
  const zExpr = makeHandlerMbaZeroExpr(seed, op);
  const shape = Math.abs(mixOpSeed(seed, op * 17 + 1)) % 3;
  const zVar = shape === 0 ? '$z0' : shape === 1 ? '$m0' : '$k0';
  const tail = isTerminal
    ? 'return void 0;'
    : shape === 0
      ? 'return $step($f);'
      : shape === 1
        ? 'var $nx=$step($f);return $nx;'
        : 'return $f.d?void 0:$step($f);';
  const adjustedBody = coreBody.replace(/\$Z/g, zVar);
  if (coreBody.includes('$Z')) {
    return `function($f){var ${zVar}=${zExpr};${adjustedBody}${tail}}`;
  }
  return `function($f){var ${zVar}=${zExpr};$f.r=($f.r+${zVar})|0;${adjustedBody}${tail}}`;
}

/**
 * Produces the CSP-safe, eval-free, direct-threaded closure-trampoline interpreter.
 * Features:
 * - Zero switch(), zero eval(), zero Function(), zero >=4-char string literals.
 * - Order-independent key derivation (never poisons with -1 when globalThis[sym] === undefined).
 * - Direct-threaded closure trampoline ($fn = $fn($f)) with inter-block accumulator ratcheting ($f.ac).
 * - Per-(seed, op) MBA-wrapped handler bodies breaking fixed AST fingerprints.
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

  const xorImpl =
    Math.abs(mixOpSeed(seed, OP_XOR)) % 2 === 0
      ? '($a|$b)-($a&$b)'
      : '$a^$b';
  const andImpl =
    Math.abs(mixOpSeed(seed, OP_AND)) % 2 === 0
      ? '~(~$a|~$b)'
      : '$a&$b';
  const orImpl =
    Math.abs(mixOpSeed(seed, OP_OR)) % 2 === 0
      ? '(($a^$b)+($a&$b))|0'
      : '$a|$b';

  const coreHandlers: Record<number, { body: string; terminal?: boolean }> = {
    [OP_LDC]: { body: '$f.q[($f.r++)+$Z]=$f.k[$rd($f)];' },
    [OP_LDV]: { body: '$f.q[($f.r++)+$Z]=$f.s[$rd($f)];' },
    [OP_STV]: { body: '$f.s[$rd($f)]=$f.q[(--$f.r)+$Z];' },
    [OP_LDG]: { body: '$f.q[($f.r++)+$Z]=$G[$f.k[$rd($f)]];' },
    [OP_GETP]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a[$b];' },
    [OP_SETP]: { body: 'var $v=$f.q[--$f.r],$b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=($a[$b]=$v);' },
    [OP_CALL]: { body: 'var $n=$rd($f)+$Z,$g=[];for(var $i=$n-1;$i>=0;$i--)$g[$i]=$f.q[--$f.r];var $fn=$f.q[--$f.r];$f.q[$f.r++]=$fn.apply(void 0,$g);' },
    [OP_MCALL]: { body: 'var $n=$rd($f)+$Z,$g=[];for(var $i=$n-1;$i>=0;$i--)$g[$i]=$f.q[--$f.r];var $b=$f.q[--$f.r],$a=$f.q[--$f.r];$f.q[$f.r++]=$a[$b].apply($a,$g);' },
    [OP_ADD]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a+$b;' },
    [OP_SUB]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a-$b;' },
    [OP_MUL]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a*$b;' },
    [OP_XOR]: { body: `var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=${xorImpl};` },
    [OP_AND]: { body: `var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=${andImpl};` },
    [OP_OR]: { body: `var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=${orImpl};` },
    [OP_SEQ]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a===$b;' },
    [OP_LT]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a<$b;' },
    [OP_NOT]: { body: '$f.q[($f.r-1)+$Z]=!$f.q[$f.r-1];' },
    [OP_JMP]: { body: 'var $j=$rd($f)+$Z,$ts=$f.c[$f.p++]^$f.st,$ta=$f.c[$f.p++]^$f.ac;$f.p=$j;$f.st=$ts;$f.ac=$ta;' },
    [OP_JZ]: { body: 'var $j=$rd($f)+$Z,$ts=$f.c[$f.p++]^$f.st,$ta=$f.c[$f.p++]^$f.ac;if(!$f.q[--$f.r]){$f.p=$j;$f.st=$ts;$f.ac=$ta;}' },
    [OP_RET]: { body: '$f.d=1;$f.v=$f.q[(--$f.r)+$Z];', terminal: true },
    [OP_THROW]: { body: 'throw $f.q[(--$f.r)+$Z];' },
    [OP_AWAIT]: {
      body: 'var $v=$f.q[(--$f.r)+$Z];$f.d=2;$f.v=Promise.resolve($v).then(function($w){$f.d=0;$f.q[$f.r++]=$w;return $x($f);},function($e){if($f.e.length>0){var $ex=$f.e.pop();$f.d=0;$f.r=$ex.r;$f.q[$f.r++]=$e;$f.p=$ex.p;$f.st=$ex.s;$f.ac=$ex.a;return $x($f);}throw $e;});',
      terminal: true,
    },
    [OP_OBJ]: { body: 'var $n=$rd($f)+$Z,$o={},$e=[];for(var $i=0;$i<$n;$i++){var $v=$f.q[--$f.r],$k0=$f.q[--$f.r];$e.push([$k0,$v]);}for(var $i=$e.length-1;$i>=0;$i--){$o[$e[$i][0]]=$e[$i][1];}$f.q[$f.r++]=$o;' },
    [OP_ARR]: { body: 'var $n=$rd($f)+$Z,$a=[];for(var $i=$n-1;$i>=0;$i--)$a[$i]=$f.q[--$f.r];$f.q[$f.r++]=$a;' },
    [OP_LDU]: { body: '$f.q[($f.r++)+$Z]=$f.u[$rd($f)][0]();' },
    [OP_STU]: { body: '$f.u[$rd($f)][1]($f.q[(--$f.r)+$Z]);' },
    [OP_DIV]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a/$b;' },
    [OP_MOD]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a%$b;' },
    [OP_SHL]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a<<$b;' },
    [OP_SHR]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a>>$b;' },
    [OP_USHR]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a>>>$b;' },
    [OP_POW]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a**$b;' },
    [OP_EQ]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a==$b;' },
    [OP_TYPEOF]: { body: '$f.q[($f.r-1)+$Z]=typeof $f.q[$f.r-1];' },
    [OP_IN]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a in $b;' },
    [OP_INSTOF]: { body: 'var $b=$f.q[--$f.r],$a=$f.q[(--$f.r)+$Z];$f.q[$f.r++]=$a instanceof $b;' },
    [OP_NEW]: { body: 'var $n=$rd($f)+$Z,$g=[];for(var $i=$n-1;$i>=0;$i--)$g[$i]=$f.q[--$f.r];var $fn=$f.q[--$f.r];$f.q[$f.r++]=new $fn(...$g);' },
    [OP_THIS]: { body: '$f.q[($f.r++)+$Z]=$f.t;' },
    [OP_POP]: { body: '--$f.r;$f.r+=$Z;' },
    [OP_TRY]: { body: 'var $cp=$rd($f)+$Z,$cs=$f.c[$f.p++]^$f.st,$ca=$f.c[$f.p++]^$f.ac;$f.e.push({p:$cp,r:$f.r,s:$cs,a:$ca});' },
    [OP_ENDTRY]: { body: '$f.e.pop();$f.r+=$Z;' },
    [OP_NULLISH]: { body: 'var $v=$f.q[($f.r-1)+$Z];$f.q[$f.r-1]=($v===null||$v===void 0);' },
    [OP_DUP]: { body: 'var $top=$f.q[($f.r-1)+$Z];$f.q[$f.r++]=$top;' },
  };

  const handlers = new Array<string>(opCount);
  for (let op = 0; op < opCount; op++) {
    const spec = coreHandlers[op];
    handlers[slotMap[op]] = wrapHandlerWithMba(seed, op, spec.body, Boolean(spec.terminal));
  }

  const hasSym = Boolean(windowKeySymbol && expectedDelta !== undefined);
  const symPropAccess = hasSym
    ? /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(windowKeySymbol!)
      ? `.${windowKeySymbol}`
      : `[${JSON.stringify(windowKeySymbol)}]`
    : '';
  const symTamperPropAccess = hasSym
    ? /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(`${windowKeySymbol}_t`)
      ? `.${windowKeySymbol}_t`
      : `[${JSON.stringify(`${windowKeySymbol}_t`)}]`
    : '';

  const expD = hasSym ? expectedDelta! & 0xffff : 0;
  const seed32 = seed | 0;
  const expDigest = hasSym
    ? (Math.imul((expD ^ seed32) | 0, 0x9e3779b1) ^ ((expD << 16) | (seed32 >>> 16)) ^ 0x85ebca6b) | 0
    : 0;

  // Order-independent tamper gate: globalThis[sym] === undefined does NOT poison;
  // only __unpeek_tampered / sym_t === true or mismatched defined slot triggers fault delta.
  // Uses <=3-char split join to avoid static '__unpeek_tampered' signature and >=4-char string literals.
  const tamperCheckExpr = hasSym
    ? `var $bad=$G[$tk]===!0||$G${symTamperPropAccess}===!0,$sv=$G${symPropAccess};if(!$bad&&$sv!==void 0){if(Array.isArray($sv)){if($sv[0]===2)$bad=true;}else{var $sh=(Math.imul(($sv^$S)|0,0x9e3779b1)^(($sv<<16)|($S>>>16))^0x85ebca6b)|0;if($sh!==$D)$bad=true;}}`
    : `var $bad=$G[$tk]===!0;`;

  const paramsList = hasSym ? '$P,$A,$B,$C,$S,$D' : '$P,$A,$B,$C,$S';

  const factoryRaw = `(function $I(${paramsList}){var $G=typeof globalThis<"u"?globalThis:(typeof window<"u"?window:this);var $tk=['__','unp','eek','_ta','mpe','red'].join('');var $M=[],$ok=$A&255,$sk=$B&255,$vk=$C|0;for(var $j=0;$j<$P.length;$j+=2)$M[$P[$j]]=$P[$j+1];function $rd($f){var $p=$f.p++;var $x0=$f.st=(Math.imul($f.st^($p+1),0x45d9f3b)+(($f.ac|0x9e3779b9)+($f.ac&0x9e3779b9)))|0;var $w=$f.c[$p],$v=$w^(($x0>>>16)&0xffff);$f.st=($f.st^Math.imul($w+1,0x85ebca6b))|0;$f.ac=(Math.imul($f.ac^$v,0x27d4eb2d)^(($f.st>>>13)|($f.st<<19)))|0;return $v;}var $H=[${handlers.join(
    ','
  )}];function $step($f){if($f.d||$f.p>=$f.c.length)return void 0;var $o=$rd($f),$m=$M[$o^$ok];return $m!==void 0?$H[$m^$sk]:void 0;}function $x($f){var $fn=$step($f);while($fn!==void 0){try{$fn=$fn($f);}catch($err){if($f.e.length>0){var $ex=$f.e.pop();$f.r=$ex.r;$f.q[$f.r++]=$err;$f.p=$ex.p;$f.st=$ex.s;$f.ac=$ex.a;$fn=$step($f);}else{throw $err;}}}return $f.v;}return function($c,$k,$s0,$t,$a,$u){${tamperCheckExpr}var $flt=$bad?(Math.imul($vk^$a,0x45d9f3b)|1):0;return $x({c:$c,k:$k,s:$s0,t:$t,u:$u||[],q:[],r:0,p:0,st:($vk^$a^$flt)|0,ac:($vk^($a<<5)^0x517cc1b7^$flt)|0,e:[],d:0,v:void 0});};})`;

  const parsedFactory = acorn.parse(factoryRaw, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  }) as any;
  const compactFactory = generateCompactJs(parsedFactory.body[0].expression);

  const argA = opMask & 0xff;
  const argB = slotMask & 0xff;
  const argC = vmKey | 0;

  return `var ${vmHelperName}=(${compactFactory})([${pairs.join(',')}],${argA},${argB},${argC},${seed32}${
    hasSym ? `,${expDigest}` : ''
  });`;
}

function walkWithParent(
  node: any,
  parent: any,
  visitor: (node: any, parent: any) => boolean | void
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) {
      walkWithParent(item, parent, visitor);
    }
    return;
  }
  if (typeof node.type !== 'string') return;
  if (visitor(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      walkWithParent(child, node, visitor);
    }
  }
}

function countAstNodes(node: acorn.Node): number {
  let count = 0;
  walkWithParent(node, null, () => {
    count++;
  });
  return count;
}

function hasForbiddenConstructs(fnNode: any): boolean {
  let forbidden = false;
  walkWithParent(fnNode, null, (node: any, parent: any) => {
    if (forbidden) return false;
    const type = node.type;
    if (
      type === 'JSXElement' ||
      type === 'JSXFragment' ||
      type === 'Super' ||
      type === 'YieldExpression' ||
      type === 'WithStatement' ||
      type === 'MetaProperty'
    ) {
      forbidden = true;
      return false;
    }
    if (type === 'Identifier' && (node.name === 'arguments' || node.name === 'eval')) {
      if (
        parent &&
        parent.type === 'MemberExpression' &&
        parent.computed === false &&
        parent.property === node
      ) {
        return;
      }
      if (
        parent &&
        parent.type === 'Property' &&
        parent.computed === false &&
        parent.key === node &&
        !parent.shorthand
      ) {
        return;
      }
      forbidden = true;
      return false;
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

function hasAbruptControlFlow(node: any): boolean {
  let abrupt = false;
  walkWithParent(node, null, (n: any) => {
    if (abrupt) return false;
    if (n !== node && FUNCTION_NODE_TYPES.has(n.type)) return false;
    if (
      n.type === 'ReturnStatement' ||
      n.type === 'BreakStatement' ||
      n.type === 'ContinueStatement'
    ) {
      abrupt = true;
      return false;
    }
  });
  return abrupt;
}

/**
 * Pre-VM AST lowering on a cloned function node:
 * - Normalizes default / destructured parameters into synthetic _vp<i> wrapper params + var bindings
 * - Converts expression-bodied arrow functions into BlockStatements
 */
function prepareLoweredFunction(
  fnNode: any,
  enclosingBindings?: Set<string>
): { loweredFn: any; wrapperParams: any[]; paramPassExprs: any[] } | null {
  const clone = JSON.parse(JSON.stringify(fnNode));
  const usedNames = new Set<string>(enclosingBindings ?? []);
  for (const p of clone.params || []) {
    collectPatternNames(p, usedNames);
  }

  let synthCounter = 0;
  function freshParamName(): string {
    let candidate = `_vp${synthCounter++}`;
    while (usedNames.has(candidate)) {
      candidate = `_vp${synthCounter++}`;
    }
    usedNames.add(candidate);
    return candidate;
  }

  const wrapperParams: any[] = [];
  const paramPassExprs: any[] = [];
  const loweredParams: any[] = [];
  const preludeDecls: any[] = [];

  for (const param of fnNode.params || []) {
    if (param.type === 'Identifier') {
      wrapperParams.push(param);
      paramPassExprs.push({ type: 'Identifier', name: param.name });
      loweredParams.push({ type: 'Identifier', name: param.name });
      continue;
    }
    if (param.type === 'RestElement' && param.argument?.type === 'Identifier') {
      wrapperParams.push(param);
      paramPassExprs.push({ type: 'Identifier', name: param.argument.name });
      loweredParams.push({ type: 'Identifier', name: param.argument.name });
      continue;
    }
    if (
      param.type === 'AssignmentPattern' ||
      param.type === 'ObjectPattern' ||
      param.type === 'ArrayPattern'
    ) {
      const synthName = freshParamName();
      const synthIdent = { type: 'Identifier', name: synthName };
      wrapperParams.push(synthIdent);
      paramPassExprs.push(synthIdent);
      loweredParams.push(synthIdent);

      const paramClone = JSON.parse(JSON.stringify(param));
      if (paramClone.type === 'AssignmentPattern') {
        const initExpr = {
          type: 'ConditionalExpression',
          test: {
            type: 'BinaryExpression',
            operator: '===',
            left: { type: 'Identifier', name: synthName },
            right: {
              type: 'UnaryExpression',
              operator: 'void',
              prefix: true,
              argument: { type: 'Literal', value: 0, raw: '0' },
            },
          },
          consequent: paramClone.right,
          alternate: { type: 'Identifier', name: synthName },
        };
        preludeDecls.push({
          type: 'VariableDeclaration',
          kind: 'var',
          declarations: [
            {
              type: 'VariableDeclarator',
              id: paramClone.left,
              init: initExpr,
            },
          ],
        });
      } else {
        preludeDecls.push({
          type: 'VariableDeclaration',
          kind: 'var',
          declarations: [
            {
              type: 'VariableDeclarator',
              id: paramClone,
              init: { type: 'Identifier', name: synthName },
            },
          ],
        });
      }
      continue;
    }
    return null;
  }

  clone.params = loweredParams;
  if (clone.body?.type !== 'BlockStatement') {
    clone.body = {
      type: 'BlockStatement',
      body: [
        {
          type: 'ReturnStatement',
          argument: clone.body,
        },
      ],
    };
    clone.expression = false;
  }
  if (preludeDecls.length > 0) {
    clone.body.body = [...preludeDecls, ...(clone.body.body || [])];
  }

  return { loweredFn: clone, wrapperParams, paramPassExprs };
}

/**
 * Compiles a candidate function AST into expanded Micro-VM v2 bytecode with lexical upvalue capture,
 * short-circuit logical/conditional/sequence ops, loops, destructuring, and try/throw support.
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
  const accSlots = new Set<number>();
  const fnScope = new Map<string, number>();
  const scopeStack: Map<string, number>[] = [fnScope];
  const upvalues: UpvalueDescriptor[] = [];
  const upvalueMap = new Map<string, number>();
  let localCount = 0;
  let tryDepth = 0;

  interface LoopTarget {
    label?: string;
    tryDepth: number;
    breakJumps: number[];
    continueJumps: number[];
  }
  const loopStack: LoopTarget[] = [];

  for (const param of fnNode.params) {
    if (param.type !== 'Identifier') return null;
    if (fnScope.has(param.name)) return null;
    fnScope.set(param.name, localCount++);
  }

  function allocTempSlot(): number {
    return localCount++;
  }

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
        const names = new Set<string>();
        for (const decl of node.declarations || []) {
          collectPatternNames(decl.id, names);
        }
        for (const name of names) {
          if (!fnScope.has(name)) {
            fnScope.set(name, localCount++);
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
      return;
    }
    if (
      node.type === 'ForStatement' ||
      node.type === 'WhileStatement' ||
      node.type === 'DoWhileStatement'
    ) {
      if (node.init) scanVarDecls(node.init, false);
      scanVarDecls(node.body, false);
      return;
    }
    if (node.type === 'TryStatement') {
      scanVarDecls(node.block, false);
      if (node.handler?.body) scanVarDecls(node.handler.body, false);
      if (node.finalizer) scanVarDecls(node.finalizer, false);
      return;
    }
    if (node.type === 'LabeledStatement') {
      scanVarDecls(node.body, false);
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

  function emitJumpPlaceholder(op: number): number {
    const pos = bytecode.length;
    emit(op, 0, 0, 0);
    stateSlots.add(pos + 2);
    accSlots.add(pos + 3);
    return pos;
  }

  function patchJump(pos: number, targetPc: number): void {
    bytecode[pos + 1] = targetPc;
  }

  function compilePatternAssignFromSlot(pattern: any, sourceSlot: number): boolean {
    if (!pattern) return false;
    switch (pattern.type) {
      case 'Identifier': {
        const slot = resolveLocal(pattern.name);
        if (slot !== undefined) {
          emit(OP_LDV, sourceSlot);
          emit(OP_STV, slot);
          return true;
        }
        emit(OP_LDV, sourceSlot);
        return emitStoreVar(pattern.name);
      }
      case 'AssignmentPattern': {
        const valSlot = allocTempSlot();
        emit(OP_LDV, sourceSlot);
        emit(OP_LDC, addConst(undefined));
        emit(OP_SEQ);
        const jzPos = emitJumpPlaceholder(OP_JZ);
        if (!compileExpr(pattern.right, true)) return false;
        emit(OP_STV, valSlot);
        const jmpEnd = emitJumpPlaceholder(OP_JMP);
        patchJump(jzPos, bytecode.length);
        emit(OP_LDV, sourceSlot);
        emit(OP_STV, valSlot);
        patchJump(jmpEnd, bytecode.length);
        return compilePatternAssignFromSlot(pattern.left, valSlot);
      }
      case 'ObjectPattern': {
        for (const prop of pattern.properties || []) {
          if (prop.type !== 'Property') return false;
          emit(OP_LDV, sourceSlot);
          if (prop.computed) {
            if (!compileExpr(prop.key, true)) return false;
          } else {
            const keyName =
              prop.key?.type === 'Identifier'
                ? prop.key.name
                : prop.key?.type === 'Literal'
                  ? String(prop.key.value)
                  : undefined;
            if (keyName === undefined) return false;
            emit(OP_LDC, addConst(keyName));
          }
          emit(OP_GETP);
          const propSlot = allocTempSlot();
          emit(OP_STV, propSlot);
          if (!compilePatternAssignFromSlot(prop.value, propSlot)) return false;
        }
        return true;
      }
      case 'ArrayPattern': {
        const elems = pattern.elements || [];
        for (let i = 0; i < elems.length; i++) {
          const el = elems[i];
          if (!el) continue;
          if (el.type === 'RestElement') {
            if (i !== elems.length - 1) return false;
            emit(OP_LDV, sourceSlot);
            emit(OP_LDC, addConst('slice'));
            emit(OP_LDC, addConst(i));
            emit(OP_MCALL, 1);
            const restSlot = allocTempSlot();
            emit(OP_STV, restSlot);
            return compilePatternAssignFromSlot(el.argument, restSlot);
          }
          emit(OP_LDV, sourceSlot);
          emit(OP_LDC, addConst(i));
          emit(OP_GETP);
          const elSlot = allocTempSlot();
          emit(OP_STV, elSlot);
          if (!compilePatternAssignFromSlot(el, elSlot)) return false;
        }
        return true;
      }
      default:
        return false;
    }
  }

  function compileBinaryOp(operator: string): boolean {
    switch (operator) {
      case '+': emit(OP_ADD); return true;
      case '-': emit(OP_SUB); return true;
      case '*': emit(OP_MUL); return true;
      case '/': emit(OP_DIV); return true;
      case '%': emit(OP_MOD); return true;
      case '**': emit(OP_POW); return true;
      case '^': emit(OP_XOR); return true;
      case '&': emit(OP_AND); return true;
      case '|': emit(OP_OR); return true;
      case '<<': emit(OP_SHL); return true;
      case '>>': emit(OP_SHR); return true;
      case '>>>': emit(OP_USHR); return true;
      case '==': emit(OP_EQ); return true;
      case '===': emit(OP_SEQ); return true;
      case '!=': emit(OP_EQ); emit(OP_NOT); return true;
      case '!==': emit(OP_SEQ); emit(OP_NOT); return true;
      case '<': emit(OP_LT); return true;
      case 'in': emit(OP_IN); return true;
      case 'instanceof': emit(OP_INSTOF); return true;
      default: return false;
    }
  }

  function compileExpr(node: any, inValuePos = true): boolean {
    if (!node) return false;
    switch (node.type) {
      case 'Literal': {
        if (node.regex || typeof node.value === 'bigint') return false;
        if (inValuePos) {
          emit(OP_LDC, addConst(node.value));
        }
        return true;
      }
      case 'Identifier': {
        if (!inValuePos) {
          // Reading an identifier in void position is a no-op unless undeclared global getter
          return true;
        }
        if (node.name === 'undefined') {
          const localSlot = resolveLocal('undefined');
          if (localSlot !== undefined) {
            emit(OP_LDV, localSlot);
          } else if (enclosingBindings && enclosingBindings.has('undefined')) {
            emit(OP_LDU, getOrCreateUpvalue('undefined', false));
          } else {
            emit(OP_LDC, addConst(undefined));
          }
          return true;
        }
        emitLoadVar(node.name);
        return true;
      }
      case 'ThisExpression': {
        if (inValuePos) emit(OP_THIS);
        return true;
      }
      case 'TemplateLiteral': {
        const quasis = node.quasis || [];
        const exprs = node.expressions || [];
        emit(OP_LDC, addConst(quasis[0]?.value?.cooked ?? quasis[0]?.value?.raw ?? ''));
        for (let i = 0; i < exprs.length; i++) {
          if (!compileExpr(exprs[i], true)) return false;
          emit(OP_ADD);
          const qStr = quasis[i + 1]?.value?.cooked ?? quasis[i + 1]?.value?.raw ?? '';
          if (qStr.length > 0) {
            emit(OP_LDC, addConst(qStr));
            emit(OP_ADD);
          }
        }
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'BinaryExpression': {
        if (node.operator === '>') {
          if (!compileExpr(node.right, true)) return false;
          if (!compileExpr(node.left, true)) return false;
          emit(OP_LT);
        } else if (node.operator === '<=') {
          if (!compileExpr(node.right, true)) return false;
          if (!compileExpr(node.left, true)) return false;
          emit(OP_LT);
          emit(OP_NOT);
        } else if (node.operator === '>=') {
          if (!compileExpr(node.left, true)) return false;
          if (!compileExpr(node.right, true)) return false;
          emit(OP_LT);
          emit(OP_NOT);
        } else {
          if (!compileExpr(node.left, true)) return false;
          if (!compileExpr(node.right, true)) return false;
          if (!compileBinaryOp(node.operator)) return false;
        }
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'LogicalExpression': {
        const tmpSlot = allocTempSlot();
        if (!compileExpr(node.left, true)) return false;
        emit(OP_STV, tmpSlot);
        emit(OP_LDV, tmpSlot);
        if (node.operator === '&&') {
          const jzEnd = emitJumpPlaceholder(OP_JZ);
          if (!compileExpr(node.right, true)) return false;
          emit(OP_STV, tmpSlot);
          patchJump(jzEnd, bytecode.length);
        } else if (node.operator === '||') {
          emit(OP_NOT);
          const jzEnd = emitJumpPlaceholder(OP_JZ);
          if (!compileExpr(node.right, true)) return false;
          emit(OP_STV, tmpSlot);
          patchJump(jzEnd, bytecode.length);
        } else if (node.operator === '??') {
          emit(OP_NULLISH);
          const jzEnd = emitJumpPlaceholder(OP_JZ);
          if (!compileExpr(node.right, true)) return false;
          emit(OP_STV, tmpSlot);
          patchJump(jzEnd, bytecode.length);
        } else {
          return false;
        }
        if (inValuePos) {
          emit(OP_LDV, tmpSlot);
        }
        return true;
      }
      case 'ConditionalExpression': {
        if (!compileExpr(node.test, true)) return false;
        const jzAlt = emitJumpPlaceholder(OP_JZ);
        if (!compileExpr(node.consequent, inValuePos)) return false;
        const jmpEnd = emitJumpPlaceholder(OP_JMP);
        patchJump(jzAlt, bytecode.length);
        if (!compileExpr(node.alternate, inValuePos)) return false;
        patchJump(jmpEnd, bytecode.length);
        return true;
      }
      case 'SequenceExpression': {
        const exprs = node.expressions || [];
        if (exprs.length === 0) return false;
        for (let i = 0; i < exprs.length - 1; i++) {
          if (!compileExpr(exprs[i], false)) return false;
        }
        return compileExpr(exprs[exprs.length - 1], inValuePos);
      }
      case 'UnaryExpression': {
        if (node.operator === 'void') {
          if (!compileExpr(node.argument, false)) return false;
          if (inValuePos) emit(OP_LDC, addConst(undefined));
          return true;
        }
        if (node.operator === 'typeof' && node.argument?.type === 'Identifier') {
          const name = node.argument.name;
          if (name === 'undefined' && resolveLocal('undefined') === undefined) {
            emit(OP_LDC, addConst(undefined));
          } else {
            emitLoadVar(name);
          }
          emit(OP_TYPEOF);
          if (!inValuePos) emit(OP_POP);
          return true;
        }
        if (!compileExpr(node.argument, true)) return false;
        switch (node.operator) {
          case '!': emit(OP_NOT); break;
          case '-': {
            emit(OP_LDC, addConst(-1));
            emit(OP_MUL);
            break;
          }
          case '+': {
            emit(OP_LDC, addConst(1));
            emit(OP_MUL);
            break;
          }
          case '~': {
            emit(OP_LDC, addConst(-1));
            emit(OP_XOR);
            break;
          }
          case 'typeof': {
            emit(OP_TYPEOF);
            break;
          }
          default: return false;
        }
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'MemberExpression': {
        if (node.optional) return false;
        if (!compileExpr(node.object, true)) return false;
        if (node.computed) {
          if (!compileExpr(node.property, true)) return false;
        } else {
          if (node.property?.type !== 'Identifier') return false;
          emit(OP_LDC, addConst(node.property.name));
        }
        emit(OP_GETP);
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'CallExpression': {
        if (node.optional) return false;
        for (const arg of node.arguments || []) {
          if (arg?.type === 'SpreadElement') return false;
        }
        if (node.callee.type === 'MemberExpression') {
          if (node.callee.optional) return false;
          if (!compileExpr(node.callee.object, true)) return false;
          if (node.callee.computed) {
            if (!compileExpr(node.callee.property, true)) return false;
          } else {
            if (node.callee.property?.type !== 'Identifier') return false;
            emit(OP_LDC, addConst(node.callee.property.name));
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
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'NewExpression': {
        for (const arg of node.arguments || []) {
          if (arg?.type === 'SpreadElement') return false;
        }
        if (!compileExpr(node.callee, true)) return false;
        for (const arg of node.arguments || []) {
          if (!compileExpr(arg, true)) return false;
        }
        emit(OP_NEW, (node.arguments || []).length);
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'AssignmentExpression': {
        if (node.left.type === 'Identifier') {
          const name = node.left.name;
          if (!canWriteVar(name)) return false;
          if (node.operator === '=') {
            if (!compileExpr(node.right, true)) return false;
          } else if (
            node.operator === '&&=' ||
            node.operator === '||=' ||
            node.operator === '??='
          ) {
            emitLoadVar(name);
            if (node.operator === '||=') emit(OP_NOT);
            else if (node.operator === '??=') emit(OP_NULLISH);
            const jzSkip = emitJumpPlaceholder(OP_JZ);
            if (!compileExpr(node.right, true)) return false;
            if (!emitStoreVar(name)) return false;
            patchJump(jzSkip, bytecode.length);
            if (inValuePos) emitLoadVar(name);
            return true;
          } else {
            const baseOp = node.operator.slice(0, -1);
            emitLoadVar(name);
            if (!compileExpr(node.right, true)) return false;
            if (!compileBinaryOp(baseOp)) return false;
          }
          if (!emitStoreVar(name)) return false;
          if (inValuePos) emitLoadVar(name);
          return true;
        }
        if (node.left.type === 'MemberExpression') {
          if (node.left.optional) return false;
          if (node.operator === '=') {
            if (!compileExpr(node.left.object, true)) return false;
            if (node.left.computed) {
              if (!compileExpr(node.left.property, true)) return false;
            } else {
              if (node.left.property?.type !== 'Identifier') return false;
              emit(OP_LDC, addConst(node.left.property.name));
            }
            if (!compileExpr(node.right, true)) return false;
            emit(OP_SETP);
            if (!inValuePos) emit(OP_POP);
            return true;
          }
          const baseOp = node.operator.slice(0, -1);
          const objSlot = allocTempSlot();
          const keySlot = allocTempSlot();
          if (!compileExpr(node.left.object, true)) return false;
          emit(OP_STV, objSlot);
          if (node.left.computed) {
            if (!compileExpr(node.left.property, true)) return false;
          } else {
            if (node.left.property?.type !== 'Identifier') return false;
            emit(OP_LDC, addConst(node.left.property.name));
          }
          emit(OP_STV, keySlot);
          emit(OP_LDV, objSlot);
          emit(OP_LDV, keySlot);
          emit(OP_LDV, objSlot);
          emit(OP_LDV, keySlot);
          emit(OP_GETP);
          if (!compileExpr(node.right, true)) return false;
          if (!compileBinaryOp(baseOp)) return false;
          emit(OP_SETP);
          if (!inValuePos) emit(OP_POP);
          return true;
        }
        return false;
      }
      case 'UpdateExpression': {
        const oneIdx = addConst(1);
        const stepOp = node.operator === '++' ? OP_ADD : OP_SUB;
        if (node.argument?.type === 'Identifier') {
          const name = node.argument.name;
          if (!canWriteVar(name)) return false;
          if (node.prefix) {
            emitLoadVar(name);
            emit(OP_LDC, oneIdx);
            emit(OP_MUL);
            emit(OP_LDC, oneIdx);
            emit(stepOp);
            if (!emitStoreVar(name)) return false;
            if (inValuePos) emitLoadVar(name);
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
        if (node.argument?.type === 'MemberExpression' && !node.argument.optional) {
          const objSlot = allocTempSlot();
          const keySlot = allocTempSlot();
          const oldSlot = allocTempSlot();
          if (!compileExpr(node.argument.object, true)) return false;
          emit(OP_STV, objSlot);
          if (node.argument.computed) {
            if (!compileExpr(node.argument.property, true)) return false;
          } else {
            if (node.argument.property?.type !== 'Identifier') return false;
            emit(OP_LDC, addConst(node.argument.property.name));
          }
          emit(OP_STV, keySlot);
          emit(OP_LDV, objSlot);
          emit(OP_LDV, keySlot);
          emit(OP_GETP);
          emit(OP_LDC, oneIdx);
          emit(OP_MUL);
          emit(OP_STV, oldSlot);

          emit(OP_LDV, objSlot);
          emit(OP_LDV, keySlot);
          emit(OP_LDV, oldSlot);
          emit(OP_LDC, oneIdx);
          emit(stepOp);
          emit(OP_SETP);
          if (node.prefix) {
            if (!inValuePos) emit(OP_POP);
          } else {
            emit(OP_POP);
            if (inValuePos) emit(OP_LDV, oldSlot);
          }
          return true;
        }
        return false;
      }
      case 'ObjectExpression': {
        for (const prop of node.properties) {
          if (prop.type !== 'Property' || prop.kind !== 'init') return false;
          if (prop.computed) {
            if (!compileExpr(prop.key, true)) return false;
          } else {
            const keyName = prop.key?.name ?? prop.key?.value;
            if (keyName === undefined) return false;
            emit(OP_LDC, addConst(keyName));
          }
          if (!compileExpr(prop.value, true)) return false;
        }
        emit(OP_OBJ, node.properties.length);
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'ArrayExpression': {
        for (const elem of node.elements) {
          if (!elem || elem.type === 'SpreadElement' || !compileExpr(elem, true)) return false;
        }
        emit(OP_ARR, node.elements.length);
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      case 'AwaitExpression': {
        if (!compileExpr(node.argument, true)) return false;
        emit(OP_AWAIT);
        if (!inValuePos) emit(OP_POP);
        return true;
      }
      default:
        return false;
    }
  }

  function compileStmt(stmt: any, isFnBody = false, activeLabel?: string): boolean {
    if (!stmt) return false;
    switch (stmt.type) {
      case 'EmptyStatement':
        return true;
      case 'ReturnStatement': {
        if (stmt.argument) {
          if (!compileExpr(stmt.argument, true)) return false;
        } else {
          emit(OP_LDC, addConst(undefined));
        }
        emit(OP_RET);
        return true;
      }
      case 'ThrowStatement': {
        if (!compileExpr(stmt.argument, true)) return false;
        emit(OP_THROW);
        return true;
      }
      case 'ExpressionStatement': {
        return compileExpr(stmt.expression, false);
      }
      case 'VariableDeclaration': {
        for (const decl of stmt.declarations) {
          if (decl.id?.type === 'Identifier') {
            const slot = resolveLocal(decl.id.name);
            if (slot === undefined) return false;
            if (decl.init) {
              if (!compileExpr(decl.init, true)) return false;
              emit(OP_STV, slot);
            }
          } else if (decl.id?.type === 'ObjectPattern' || decl.id?.type === 'ArrayPattern') {
            if (!decl.init) return false;
            const srcSlot = allocTempSlot();
            if (!compileExpr(decl.init, true)) return false;
            emit(OP_STV, srcSlot);
            if (!compilePatternAssignFromSlot(decl.id, srcSlot)) return false;
          } else {
            return false;
          }
        }
        return true;
      }
      case 'IfStatement': {
        if (!compileExpr(stmt.test, true)) return false;
        const jzPos = emitJumpPlaceholder(OP_JZ);
        if (!compileStmt(stmt.consequent, false)) return false;
        if (stmt.alternate) {
          const jmpPos = emitJumpPlaceholder(OP_JMP);
          patchJump(jzPos, bytecode.length);
          if (!compileStmt(stmt.alternate, false)) return false;
          patchJump(jmpPos, bytecode.length);
        } else {
          patchJump(jzPos, bytecode.length);
        }
        return true;
      }
      case 'WhileStatement': {
        const loopStart = bytecode.length;
        const target: LoopTarget = {
          label: activeLabel,
          tryDepth,
          breakJumps: [],
          continueJumps: [],
        };
        loopStack.push(target);

        if (!compileExpr(stmt.test, true)) {
          loopStack.pop();
          return false;
        }
        const jzEnd = emitJumpPlaceholder(OP_JZ);
        if (!compileStmt(stmt.body, false)) {
          loopStack.pop();
          return false;
        }
        for (const cPos of target.continueJumps) {
          patchJump(cPos, loopStart);
        }
        const jmpLoop = emitJumpPlaceholder(OP_JMP);
        patchJump(jmpLoop, loopStart);

        const loopEnd = bytecode.length;
        patchJump(jzEnd, loopEnd);
        for (const bPos of target.breakJumps) {
          patchJump(bPos, loopEnd);
        }
        loopStack.pop();
        return true;
      }
      case 'DoWhileStatement': {
        const loopStart = bytecode.length;
        const target: LoopTarget = {
          label: activeLabel,
          tryDepth,
          breakJumps: [],
          continueJumps: [],
        };
        loopStack.push(target);

        if (!compileStmt(stmt.body, false)) {
          loopStack.pop();
          return false;
        }
        const continuePc = bytecode.length;
        for (const cPos of target.continueJumps) {
          patchJump(cPos, continuePc);
        }
        if (!compileExpr(stmt.test, true)) {
          loopStack.pop();
          return false;
        }
        const jzEnd = emitJumpPlaceholder(OP_JZ);
        const jmpLoop = emitJumpPlaceholder(OP_JMP);
        patchJump(jmpLoop, loopStart);

        const loopEnd = bytecode.length;
        patchJump(jzEnd, loopEnd);
        for (const bPos of target.breakJumps) {
          patchJump(bPos, loopEnd);
        }
        loopStack.pop();
        return true;
      }
      case 'ForStatement': {
        let pushedForScope = false;
        if (stmt.init?.type === 'VariableDeclaration' && stmt.init.kind !== 'var') {
          const forScope = new Map<string, number>();
          const names = new Set<string>();
          for (const decl of stmt.init.declarations || []) {
            collectPatternNames(decl.id, names);
          }
          for (const name of names) {
            forScope.set(name, localCount++);
          }
          if (forScope.size > 0) {
            scopeStack.push(forScope);
            pushedForScope = true;
          }
        }

        if (stmt.init) {
          const ok =
            stmt.init.type === 'VariableDeclaration'
              ? compileStmt(stmt.init, false)
              : compileExpr(stmt.init, false);
          if (!ok) {
            if (pushedForScope) scopeStack.pop();
            return false;
          }
        }

        const testPc = bytecode.length;
        const target: LoopTarget = {
          label: activeLabel,
          tryDepth,
          breakJumps: [],
          continueJumps: [],
        };
        loopStack.push(target);

        let jzEnd: number | null = null;
        if (stmt.test) {
          if (!compileExpr(stmt.test, true)) {
            loopStack.pop();
            if (pushedForScope) scopeStack.pop();
            return false;
          }
          jzEnd = emitJumpPlaceholder(OP_JZ);
        }

        if (!compileStmt(stmt.body, false)) {
          loopStack.pop();
          if (pushedForScope) scopeStack.pop();
          return false;
        }

        const updatePc = bytecode.length;
        for (const cPos of target.continueJumps) {
          patchJump(cPos, updatePc);
        }
        if (stmt.update) {
          if (!compileExpr(stmt.update, false)) {
            loopStack.pop();
            if (pushedForScope) scopeStack.pop();
            return false;
          }
        }
        const jmpTest = emitJumpPlaceholder(OP_JMP);
        patchJump(jmpTest, testPc);

        const loopEnd = bytecode.length;
        if (jzEnd !== null) patchJump(jzEnd, loopEnd);
        for (const bPos of target.breakJumps) {
          patchJump(bPos, loopEnd);
        }

        loopStack.pop();
        if (pushedForScope) scopeStack.pop();
        return true;
      }
      case 'BreakStatement':
      case 'ContinueStatement': {
        const isBreak = stmt.type === 'BreakStatement';
        const labelName = stmt.label?.name;
        let target: LoopTarget | undefined;
        for (let i = loopStack.length - 1; i >= 0; i--) {
          if (!labelName || loopStack[i].label === labelName) {
            target = loopStack[i];
            break;
          }
        }
        if (!target) return false;
        const exitTryCount = tryDepth - target.tryDepth;
        for (let t = 0; t < exitTryCount; t++) {
          emit(OP_ENDTRY);
        }
        const jmpPos = emitJumpPlaceholder(OP_JMP);
        if (isBreak) target.breakJumps.push(jmpPos);
        else target.continueJumps.push(jmpPos);
        return true;
      }
      case 'LabeledStatement': {
        return compileStmt(stmt.body, false, stmt.label?.name);
      }
      case 'TryStatement': {
        if (stmt.finalizer) {
          // Support finally cleanly when try/catch blocks contain no abrupt return/break/continue
          if (
            hasAbruptControlFlow(stmt.block) ||
            (stmt.handler && hasAbruptControlFlow(stmt.handler.body))
          ) {
            return false;
          }
          const outerTryPos = emitJumpPlaceholder(OP_TRY);
          tryDepth++;
          const innerOk = compileStmt(
            {
              type: 'TryStatement',
              block: stmt.block,
              handler: stmt.handler,
              finalizer: null,
            },
            false
          );
          tryDepth--;
          if (!innerOk) return false;
          emit(OP_ENDTRY);
          if (!compileStmt(stmt.finalizer, false)) return false;
          const jmpAfter = emitJumpPlaceholder(OP_JMP);

          patchJump(outerTryPos, bytecode.length);
          const finErrSlot = allocTempSlot();
          emit(OP_STV, finErrSlot);
          if (!compileStmt(stmt.finalizer, false)) return false;
          emit(OP_LDV, finErrSlot);
          emit(OP_THROW);
          patchJump(jmpAfter, bytecode.length);
          return true;
        }

        const tryPos = emitJumpPlaceholder(OP_TRY);
        tryDepth++;
        if (!compileStmt(stmt.block, false)) {
          tryDepth--;
          return false;
        }
        tryDepth--;
        emit(OP_ENDTRY);
        const jmpAfterCatch = emitJumpPlaceholder(OP_JMP);

        patchJump(tryPos, bytecode.length);
        if (stmt.handler) {
          let pushedCatch = false;
          if (stmt.handler.param) {
            const catchScope = new Map<string, number>();
            const names = new Set<string>();
            collectPatternNames(stmt.handler.param, names);
            for (const name of names) {
              catchScope.set(name, localCount++);
            }
            scopeStack.push(catchScope);
            pushedCatch = true;

            if (stmt.handler.param.type === 'Identifier') {
              emit(OP_STV, catchScope.get(stmt.handler.param.name)!);
            } else {
              const errSlot = allocTempSlot();
              emit(OP_STV, errSlot);
              if (!compilePatternAssignFromSlot(stmt.handler.param, errSlot)) {
                scopeStack.pop();
                return false;
              }
            }
          } else {
            emit(OP_POP);
          }

          if (!compileStmt(stmt.handler.body, false)) {
            if (pushedCatch) scopeStack.pop();
            return false;
          }
          if (pushedCatch) scopeStack.pop();
        } else {
          emit(OP_POP);
        }

        patchJump(jmpAfterCatch, bytecode.length);
        return true;
      }
      case 'BlockStatement': {
        let pushedBlock = false;
        if (!isFnBody) {
          const blockScope = new Map<string, number>();
          for (const s of stmt.body || []) {
            if (s.type === 'VariableDeclaration' && s.kind !== 'var') {
              const names = new Set<string>();
              for (const decl of s.declarations || []) {
                collectPatternNames(decl.id, names);
              }
              for (const name of names) {
                if (!blockScope.has(name)) {
                  blockScope.set(name, localCount++);
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
    if (!compileExpr(fnNode.body, true)) return null;
    emit(OP_RET);
  }

  emit(OP_LDC, addConst(undefined));
  emit(OP_RET);

  return { bytecode, consts, localCount, stateSlots, accSlots, upvalues };
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
 * Selective Bytecode Micro-VM v2 virtualization:
 * - Selects qualifying cold functions (8 <= N <= 400, default cap 12/chunk, criticalFunctionNodes prioritized)
 * - Fixes obj.arguments/obj.eval false positives in MemberExpression.property
 * - Pre-VM AST lowering for destructuring, default params, &&/||/??, ?:, loops, and try/throw
 * - Direct-threaded closure trampoline + inter-block accumulator key ratcheting + MBA handler wrappers
 * - Order-independent key derivation without -1 poisoning when globalThis[sym] === undefined
 */
export function applyMicroVm(
  ast: acorn.Program,
  coldFunctionNodes?: Set<acorn.Node> | WeakSet<acorn.Node>,
  serializedFunctionNodes?: WeakSet<acorn.Node>,
  seed = 0x9e3779b9,
  windowKeySymbol?: string,
  expectedDelta?: number,
  extraOpts?: MicroVmExtraOptions
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

  const maxFunctions = extraOpts?.maxFunctionsPerChunk ?? 12;
  const criticalSet = extraOpts?.criticalFunctionNodes;
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
  const rawCandidates: CandidateRecord[] = [];

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
      rawCandidates.push({ fn: node, ancestors: ancestors.slice() });
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
      rawCandidates.push({ fn: node, ancestors: ancestors.slice() });
    },
    ArrowFunctionExpression(node: any, _state, ancestors) {
      const paramNames = new Set<string>();
      for (const p of node.params || []) {
        collectPatternNames(p, paramNames);
      }
      for (const name of paramNames) {
        addScopeBinding(node, name);
      }
      rawCandidates.push({ fn: node, ancestors: ancestors.slice() });
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

  const candidates = criticalSet
    ? [
        ...rawCandidates.filter((c) => criticalSet.has(c.fn)),
        ...rawCandidates.filter((c) => !criticalSet.has(c.fn)),
      ]
    : rawCandidates;

  let virtualizedCount = 0;

  for (const { fn, ancestors } of candidates) {
    if (virtualizedCount >= maxFunctions) break;

    if (coldFunctionNodes && !coldFunctionNodes.has(fn)) {
      continue;
    }
    if (serializedFunctionNodes && serializedFunctionNodes.has(fn)) {
      continue;
    }
    if (fn.generator) {
      continue;
    }
    const parentNode = ancestors.length >= 2 ? (ancestors[ancestors.length - 2] as any) : null;
    if (parentNode?.type === 'MethodDefinition' && parentNode.kind === 'constructor') {
      continue;
    }
    if (ancestors.some((a) => a.type === 'WithStatement')) {
      continue;
    }
    if (hasForbiddenConstructs(fn)) {
      continue;
    }

    const nodeCount = countAstNodes(fn);
    if (nodeCount < 8 || nodeCount > 400) {
      continue;
    }

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

    const lowered = prepareLoweredFunction(fn, enclosingBindings);
    if (!lowered) {
      continue;
    }

    const compiled = compileFunctionToBytecode(lowered.loweredFn, opMap, enclosingBindings);
    if (!compiled) {
      continue;
    }

    const fnSalt = computeFnv1aHash(`vm-fn:${virtualizedCount}`, seed) >>> 0;
    const encBytecode = encryptBytecodeStream(
      compiled.bytecode,
      fnSalt,
      vmKey,
      compiled.stateSlots,
      compiled.accSlots
    );

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
        elements: lowered.paramPassExprs,
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

    fn.params = lowered.wrapperParams;
    if (fn.body.type === 'BlockStatement') {
      fn.body.body = [
        {
          type: 'ReturnStatement',
          argument: callExpr,
        },
      ];
    } else {
      fn.body = callExpr;
    }

    virtualizedCount++;
  }

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
