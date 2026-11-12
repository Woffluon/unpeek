import * as acorn from 'acorn';
import { computeFnv1aHash } from './string-vault.js';

export function encodeSignedLeb128(value: number): number[] {
  const bytes: number[] = [];
  let val = value | 0;
  let more = true;
  while (more) {
    let byte = val & 0x7f;
    val >>= 7;
    if (
      (val === 0 && (byte & 0x40) === 0) ||
      (val === -1 && (byte & 0x40) !== 0)
    ) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

export function encodeUnsignedLeb128(value: number): number[] {
  const bytes: number[] = [];
  let val = value >>> 0;
  do {
    let byte = val & 0x7f;
    val >>>= 7;
    if (val !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (val !== 0);
  return bytes;
}

function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) | 0;
}

function writeI32LE(value: number): number[] {
  const v = value | 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/**
 * Builds a compact, valid, standalone WebAssembly binary (<512 bytes) that exports:
 * kdf(fnId: i32, callSiteSalt: i32, shieldHash: i32) -> i32
 *
 * Constant-blinded synthesis: seed, 0x01000193, and 0x45d9f3b never appear as
 * plaintext i32.const literals or raw .data words. Values are reconstructed at
 * runtime from blinded shares in linear memory using bit rotations and multiplications.
 *
 * Evaluation formula:
 * ((fnId ^ seed) * 0x01000193) ^ ((callSiteSalt + shieldHash) * 0x45d9f3b)
 */
export function generateWasmKdfBinary(seed: number): Uint8Array {
  const sVal = seed | 0;
  const memBase = ((seed >>> 0) & 0x7f) * 4;
  const r0 = computeFnv1aHash('wasm-r0', seed) | 0;
  const rotAmt = ((seed >>> 0) % 27) + 3;
  const kMul = computeFnv1aHash('wasm-kmul', seed) | 1;
  const kA = (kMul >>> 16) & 0xffff;
  const kB = kMul & 0xffff;
  const memMask = (computeFnv1aHash('wasm-mem', seed) & 0x3ff) | 1;
  const memA = memBase ^ memMask;

  const w0 = r0;
  const w1 = (sVal ^ rotl32(r0, rotAmt) ^ Math.imul(r0 | 1, kMul)) | 0;
  const w2 = (0x01000193 ^ ((w0 + w1) | 0)) | 0;
  const w3 = (0x45d9f3b - Math.imul(w1 | 1, w2 | 1)) | 0;

  const instructions = [
    0x41, ...encodeSignedLeb128(memA), // i32.const memA
    0x41, ...encodeSignedLeb128(memMask), // i32.const memMask
    0x73, // i32.xor
    0x22, 0x03, // local.tee 3 (ptr)
    0x28, 0x02, 0x00, // i32.load align=2 offset=0
    0x21, 0x04, // local.set 4 (w0)
    0x20, 0x03, // local.get 3
    0x28, 0x02, 0x04, // i32.load align=2 offset=4
    0x21, 0x05, // local.set 5 (w1)
    0x20, 0x03, // local.get 3
    0x28, 0x02, 0x08, // i32.load align=2 offset=8
    0x21, 0x06, // local.set 6 (w2)

    // (fnId ^ seed) * m1
    0x20, 0x00, // local.get 0 (fnId)
    0x20, 0x05, // local.get 5 (w1)
    0x20, 0x04, // local.get 4 (w0)
    0x41, ...encodeSignedLeb128(rotAmt), // i32.const rotAmt
    0x77, // i32.rotl
    0x73, // i32.xor
    0x20, 0x04, // local.get 4 (w0)
    0x41, 0x01, // i32.const 1
    0x72, // i32.or
    0x41, ...encodeSignedLeb128(kA), // i32.const kA
    0x41, 0x10, // i32.const 16
    0x74, // i32.shl
    0x41, ...encodeSignedLeb128(kB), // i32.const kB
    0x72, // i32.or
    0x6c, // i32.mul
    0x73, // i32.xor (seed)
    0x73, // i32.xor (fnId ^ seed)

    0x20, 0x06, // local.get 6 (w2)
    0x20, 0x04, // local.get 4 (w0)
    0x20, 0x05, // local.get 5 (w1)
    0x6a, // i32.add
    0x73, // i32.xor (m1)
    0x6c, // i32.mul

    // (callSiteSalt + shieldHash) * m2
    0x20, 0x01, // local.get 1 (callSiteSalt)
    0x20, 0x02, // local.get 2 (shieldHash)
    0x6a, // i32.add
    0x20, 0x03, // local.get 3 (ptr)
    0x28, 0x02, 0x0c, // i32.load align=2 offset=12
    0x20, 0x05, // local.get 5 (w1)
    0x41, 0x01, // i32.const 1
    0x72, // i32.or
    0x20, 0x06, // local.get 6 (w2)
    0x41, 0x01, // i32.const 1
    0x72, // i32.or
    0x6c, // i32.mul
    0x6a, // i32.add (m2)
    0x6c, // i32.mul

    0x73, // i32.xor
    0x0b, // end
  ];

  // Function body with 4 i32 locals (ptr, w0, w1, w2)
  const funcBody = [0x01, 0x04, 0x7f, ...instructions];
  const funcBodyWithLen = [...encodeUnsignedLeb128(funcBody.length), ...funcBody];

  // Section 10: Code section (1 function)
  const codeSectionPayload = [0x01, ...funcBodyWithLen];
  const codeSection = [
    0x0a,
    ...encodeUnsignedLeb128(codeSectionPayload.length),
    ...codeSectionPayload,
  ];

  // Section 1: Type section (1 func type: (i32, i32, i32) -> i32)
  const typePayload = [
    0x01, // 1 type
    0x60, // func
    0x03, 0x7f, 0x7f, 0x7f, // 3 params of type i32
    0x01, 0x7f, // 1 result of type i32
  ];
  const typeSection = [
    0x01,
    ...encodeUnsignedLeb128(typePayload.length),
    ...typePayload,
  ];

  // Section 3: Function section (1 function using type 0)
  const funcPayload = [
    0x01, // 1 function
    0x00, // type index 0
  ];
  const funcSection = [
    0x03,
    ...encodeUnsignedLeb128(funcPayload.length),
    ...funcPayload,
  ];

  // Section 5: Memory section (1 memory, initial 1 page)
  const memSection = [0x05, 0x03, 0x01, 0x00, 0x01];

  // Section 7: Export section (export func 0 as "kdf")
  const exportName = [0x03, 0x6b, 0x64, 0x66]; // "kdf"
  const exportPayload = [
    0x01, // 1 export
    ...exportName,
    0x00, // function export
    0x00, // function index 0
  ];
  const exportSection = [
    0x07,
    ...encodeUnsignedLeb128(exportPayload.length),
    ...exportPayload,
  ];

  // Section 11: Data section (4 blinded 32-bit words at memBase)
  const dataWords = [
    ...writeI32LE(w0),
    ...writeI32LE(w1),
    ...writeI32LE(w2),
    ...writeI32LE(w3),
  ];
  const dataPayload = [
    0x01, // 1 active segment
    0x00, // memory index 0
    0x41, ...encodeSignedLeb128(memBase), 0x0b, // i32.const memBase; end
    ...encodeUnsignedLeb128(dataWords.length),
    ...dataWords,
  ];
  const dataSection = [
    0x0b,
    ...encodeUnsignedLeb128(dataPayload.length),
    ...dataPayload,
  ];

  // WASM binary header (\0asm + version 1)
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  return new Uint8Array([
    ...header,
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
    ...dataSection,
  ]);
}

/**
 * Synchronous JavaScript fallback implementing the exact same 32-bit KDF logic
 * for strict CSP environments where WebAssembly instantiation is prohibited.
 */
export function fallbackKdf(
  fnId: number,
  callSiteSalt: number,
  shieldHash: number,
  seed: number
): number {
  return (
    (Math.imul((fnId ^ seed) | 0, 0x01000193) ^
      Math.imul(((callSiteSalt + shieldHash) | 0), 0x45d9f3b)) |
    0
  );
}

export interface WasmVaultInjectionResult {
  kdfFnName: string;
  wasmBytes: Uint8Array;
  wasmVarName: string;
}

export function isWasmVaultAlreadyInjected(ast: acorn.Program): boolean {
  if (!ast || !Array.isArray(ast.body)) return false;
  return ast.body.some((stmt: any) => {
    if (
      stmt.type === 'VariableDeclaration' &&
      stmt.declarations?.some(
        (d: any) =>
          d.id?.type === 'Identifier' &&
          typeof d.id.name === 'string' &&
          d.id.name.startsWith('_wKdf')
      )
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Injects the synchronous inline WebAssembly KDF key vault into the AST program.
 * Falls back transparently to Math.imul on strict CSP runtimes.
 */
export function injectWasmVault(
  ast: acorn.Program,
  seed = 0x9e3779b9
): WasmVaultInjectionResult {
  const suffix = computeFnv1aHash(`wasm:${seed}`, seed).toString(36);
  const kdfFnName = `_wKdf${suffix}`;
  const wasmVarName = `_wb${suffix}`;

  // Check if already injected
  if (isWasmVaultAlreadyInjected(ast)) {
    const existing = (ast.body as any[]).find(
      (stmt) =>
        stmt.type === 'VariableDeclaration' &&
        stmt.declarations?.some(
          (d: any) =>
            d.id?.type === 'Identifier' &&
            typeof d.id.name === 'string' &&
            d.id.name.startsWith('_wKdf')
        )
    );
    const id = existing?.declarations[0]?.id?.name ?? kdfFnName;
    return {
      kdfFnName: id,
      wasmBytes: generateWasmKdfBinary(seed),
      wasmVarName,
    };
  }

  const wasmBytes = generateWasmKdfBinary(seed);
  const byteArrayLiteral = Array.from(wasmBytes).join(',');

  const targets = [0x01000193, 0x45d9f3b, seed | 0];
  const aArr: number[] = [];
  const bArr: number[] = [];
  const mArr: number[] = [];
  for (let i = 0; i < targets.length; i++) {
    const aVal = computeFnv1aHash(`mba-a:${i}`, seed) | 0;
    const mVal = computeFnv1aHash(`mba-m:${i}`, seed) | 0;
    const bVal = ((targets[i] ^ mVal) - aVal) | 0;
    aArr.push(aVal);
    bArr.push(bVal);
    mArr.push(mVal);
  }
  const strKey = ((seed & 0x7f) ^ 0x3d) | 0;
  const mChars = [105 ^ strKey, 109 ^ strKey, 117 ^ strKey, 108 ^ strKey].join(',');

  const helperSnippet = `var ${kdfFnName};
try {
  var ${wasmVarName} = new Uint8Array([${byteArrayLiteral}]);
  var _wm${suffix} = new WebAssembly.Module(${wasmVarName});
  var _wi${suffix} = new WebAssembly.Instance(_wm${suffix});
  ${kdfFnName} = _wi${suffix}.exports.kdf;
} catch (e) {
  ${kdfFnName} = (function() {
    var _z = +!String;
    var _a = [${aArr.join(',')}];
    var _b = [${bArr.join(',')}];
    var _m0 = [${mArr.join(',')}];
    var _k = [];
    for (var _j = 0; _j < 3; _j++) {
      var _u = _a[_j] | _z, _v = _b[_j];
      var _t = ((_u | _v) + (_u & _v)) | 0;
      _k[_j] = ((_t + _m0[_j]) - ((_t & _m0[_j]) << 1)) | 0;
    }
    var _p = '';
    var _c = [${mChars}];
    for (var _i = 0; _i < _c.length; _i++) {
      _p += String.fromCharCode(_c[_i] ^ ${strKey});
    }
    var _m = Math[_p];
    return function(f, s, h) {
      var _f0 = f | 0, _c2 = _k[2];
      var _fs = ((_f0 + _c2) - ((_f0 & _c2) << 1)) | 0;
      var _s0 = s | 0, _h0 = h | 0;
      var _sh = ((_s0 ^ _h0) + ((_s0 & _h0) << 1)) | 0;
      var _l = _m(_fs, _k[0]), _r = _m(_sh, _k[1]);
      return ((_l + _r) - ((_l & _r) << 1)) | 0;
    };
  })();
}`;

  const parsedHelper = acorn.parse(helperSnippet, {
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

  return {
    kdfFnName,
    wasmBytes,
    wasmVarName,
  };
}
