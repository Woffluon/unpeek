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

/**
 * Builds a compact, valid, standalone WebAssembly binary (<100 bytes) that exports:
 * kdf(fnId: i32, callSiteSalt: i32, shieldHash: i32) -> i32
 *
 * Evaluation formula:
 * ((fnId ^ seed) * 0x01000193) ^ ((callSiteSalt + shieldHash) * 0x45d9f3b)
 */
export function generateWasmKdfBinary(seed: number): Uint8Array {
  // Instruction sequence:
  // local.get 0 (fnId)
  // i32.const seed
  // i32.xor
  // i32.const 0x01000193 (16777619)
  // i32.mul
  // local.get 1 (callSiteSalt)
  // local.get 2 (shieldHash)
  // i32.add
  // i32.const 0x45d9f3b (73244475)
  // i32.mul
  // i32.xor
  // end
  const instructions = [
    0x20, 0x00, // local.get 0
    0x41, ...encodeSignedLeb128(seed), // i32.const seed
    0x73, // i32.xor
    0x41, ...encodeSignedLeb128(0x01000193), // i32.const 0x01000193
    0x6c, // i32.mul
    0x20, 0x01, // local.get 1
    0x20, 0x02, // local.get 2
    0x6a, // i32.add
    0x41, ...encodeSignedLeb128(0x45d9f3b), // i32.const 0x45d9f3b
    0x6c, // i32.mul
    0x73, // i32.xor
    0x0b, // end
  ];

  // Function body with 0 locals declaration
  const funcBody = [0x00, ...instructions];
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

  // WASM binary header (\0asm + version 1)
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  return new Uint8Array([
    ...header,
    ...typeSection,
    ...funcSection,
    ...exportSection,
    ...codeSection,
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

  const sVal = seed | 0;
  const xorMask = (seed ^ 0x5a5a5a5a) | 0;
  const m1 = (16777619 ^ xorMask) | 0;
  const m2 = (73244475 ^ xorMask) | 0;
  const m3 = (sVal ^ xorMask) | 0;
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
    var _k = ${xorMask};
    var _x = [${m1}, ${m2}, ${m3}];
    var _p = '';
    var _c = [${mChars}];
    for (var _i = 0; _i < _c.length; _i++) {
      _p += String.fromCharCode(_c[_i] ^ ${strKey});
    }
    var _m = Math[_p];
    return function(f, s, h) {
      return (_m((f ^ (_x[2] ^ _k)) | 0, _x[0] ^ _k) ^ _m(((s + h) | 0), _x[1] ^ _k)) | 0;
    };
  })();
}`;

  const parsedHelper = acorn.parse(helperSnippet, {
    ecmaVersion: 'latest',
    sourceType: 'script',
  }) as acorn.Program;

  ast.body.unshift(...(parsedHelper.body as any[]));

  return {
    kdfFnName,
    wasmBytes,
    wasmVarName,
  };
}
