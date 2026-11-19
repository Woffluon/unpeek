import { computeFnv1aHash } from '../shared/hash.js';

const FNV_OFFSET_BASIS = 0x811c9dc5;

/**
 * Strips whitespace so Vite `minify:false` line endings or formatting shifts
 * do not perturb normalized self-integrity digests.
 */
export function normalizeIntegritySource(source: string): string {
  return String(source).replace(/\s+/g, '');
}

/**
 * Computes a 32-bit unsigned FNV-1a hash over the un-normalized source string.
 * Any formatting change (such as DevTools Pretty-Print adding newlines or spaces)
 * or monkeypatching alters the resulting hash.
 */
export function computeIntegrityHash(source: string, seed = 0): number {
  return computeFnv1aHash(source, (FNV_OFFSET_BASIS ^ (seed >>> 0)) >>> 0);
}

/**
 * Computes a whitespace-normalized 32-bit unsigned FNV-1a integrity hash
 * resilient to bundler formatting differences (e.g. Vite `minify: false`).
 */
export function computeNormalizedIntegrityHash(source: string, seed = 0): number {
  return computeFnv1aHash(
    normalizeIntegritySource(source),
    (FNV_OFFSET_BASIS ^ (seed >>> 0)) >>> 0
  );
}

const NATIVE_BUILTIN_RE = /^function (\w+)\(\)\s*\{\s*\[native code\]\s*\}$/;
const STACK_GETTER_RE = /^function (?:get )?stack\(\)\s*\{\s*\[native code\]\s*\}$/;
const STACK_SETTER_RE = /^function (?:set )?stack\(\)\s*\{\s*\[native code\]\s*\}$/;
const NATIVE_ANON_OR_STACK_RE = /^function (?:(?:get )?stack)?\(\)\s*\{\s*\[native code\]\s*\}$/;

function hasTamperedDescriptor(obj: object | null | undefined, key: string): boolean {
  try {
    let cur: object | null = obj ?? null;
    while (cur) {
      const desc = Object.getOwnPropertyDescriptor(cur, key);
      if (desc && (desc.set || !desc.writable)) {
        return true;
      }
      cur = Object.getPrototypeOf(cur);
    }
    return false;
  } catch {
    return true;
  }
}

function isNativeBuiltinSignature(
  fn: unknown,
  expectedName: string,
  expectedLength: number,
  toStr: (...args: any[]) => unknown
): fn is (...args: any[]) => unknown {
  if (
    typeof fn !== 'function' ||
    Reflect.has(fn, 'prototype') ||
    fn.name !== expectedName ||
    fn.length !== expectedLength
  ) {
    return false;
  }
  try {
    const direct = Reflect.apply(toStr, fn, []);
    const nested = Reflect.apply(Reflect.apply, null, [toStr, fn, []]);
    if (typeof direct !== 'string' || direct !== nested) {
      return false;
    }
    const match = NATIVE_BUILTIN_RE.exec(direct);
    return !!match && match[1] === expectedName;
  } catch {
    return false;
  }
}

function probeThrowsCleanTypeError(
  fn: (...args: any[]) => unknown,
  thisArg: unknown,
  args: unknown[],
  toStr: (...args: any[]) => unknown,
  stackProtoDesc?: PropertyDescriptor
): boolean {
  const errCtor = Error as unknown as { prepareStackTrace?: unknown };
  const prevPrepare = errCtor.prepareStackTrace;
  let ok = false;
  let restoreFailed = false;
  try {
    if (prevPrepare !== undefined) {
      if (typeof process === 'undefined') {
        return false;
      }
      errCtor.prepareStackTrace = undefined;
    }
    const refOwnStackDesc = Object.getOwnPropertyDescriptor(new Error(), 'stack');
    const refLine = (new Error().stack || '').split('\n')[1] || '';
    const refMatch = /^\s*at\s+([^\s(]+)\s*\(/.exec(refLine);
    const callerMarker = refMatch ? `\n    at ${refMatch[1]} (` : '';
    try {
      Reflect.apply(fn, thisArg, args);
      return false;
    } catch (err) {
      if (errCtor.prepareStackTrace !== undefined) {
        if (typeof process === 'undefined') {
          return false;
        }
        errCtor.prepareStackTrace = undefined;
      }
      const isTypeError =
        err instanceof TypeError ||
        (err !== null &&
          typeof err === 'object' &&
          (err as { name?: unknown }).name === 'TypeError');
      if (!isTypeError || err === null || typeof err !== 'object') {
        return false;
      }
      const ownDesc = Object.getOwnPropertyDescriptor(err, 'stack');
      if (ownDesc) {
        if (
          'value' in ownDesc ||
          typeof ownDesc.get !== 'function' ||
          Reflect.has(ownDesc.get, 'prototype') ||
          !refOwnStackDesc?.get ||
          ownDesc.get.name !== '' ||
          ownDesc.get.length !== 0
        ) {
          return false;
        }
        const getterSrc = Reflect.apply(toStr, ownDesc.get, []);
        if (typeof getterSrc !== 'string' || !NATIVE_ANON_OR_STACK_RE.test(getterSrc)) {
          return false;
        }
      }
      const stack = stackProtoDesc?.get
        ? Reflect.apply(stackProtoDesc.get, err, [])
        : ownDesc?.get
          ? Reflect.apply(ownDesc.get, err, [])
          : (err as Error).stack;
      if (typeof stack !== 'string' || stack.length === 0 || !stack.includes('\n    at ')) {
        return false;
      }
      if (callerMarker && stack.includes(callerMarker)) {
        const head = stack.slice(0, stack.indexOf(callerMarker));
        if (
          /(?:Object|Proxy)\.apply\b/.test(head) ||
          /\n    at (?!.* \(<anonymous>\)$)/m.test(head)
        ) {
          return false;
        }
      } else if (/(?:Object|Proxy)\.apply\b/.test(stack)) {
        return false;
      }
      ok = true;
    }
  } catch {
    return false;
  } finally {
    if (prevPrepare !== undefined) {
      try {
        errCtor.prepareStackTrace = prevPrepare;
      } catch {
        restoreFailed = true;
      }
    }
  }
  return ok && !restoreFailed;
}

/**
 * Verifies native descriptor and `Reflect.apply` error invariants.
 * Native `Object.getOwnPropertyDescriptor(null)` must throw a `TypeError`,
 * and `Function.prototype.toString` / `Reflect.apply` must resist Proxy spoofing.
 */
export function isNativeDescriptorIntact(): boolean {
  if (typeof Reflect === 'undefined' || typeof Reflect.apply !== 'function') {
    return false;
  }
  const errCtor = Error as unknown as { prepareStackTrace?: unknown };
  if (
    hasTamperedDescriptor(Function.prototype, 'toString') ||
    hasTamperedDescriptor(Function.prototype, 'call') ||
    hasTamperedDescriptor(Reflect, 'apply') ||
    hasTamperedDescriptor(Error, 'prepareStackTrace')
  ) {
    return false;
  }
  if (typeof process === 'undefined' && errCtor.prepareStackTrace !== undefined) {
    return false;
  }
  const toStr = Function.prototype.toString;
  const reflectApply = Reflect.apply;
  const fnCall = Function.prototype.call;
  if (
    !isNativeBuiltinSignature(reflectApply, 'apply', 3, toStr) ||
    !isNativeBuiltinSignature(toStr, 'toString', 0, toStr) ||
    !isNativeBuiltinSignature(fnCall, 'call', 1, toStr)
  ) {
    return false;
  }
  const stackProtoDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
  if (stackProtoDesc) {
    if (
      typeof stackProtoDesc.get !== 'function' ||
      Reflect.has(stackProtoDesc.get, 'prototype')
    ) {
      return false;
    }
    try {
      const getSrc = reflectApply(toStr, stackProtoDesc.get, []);
      if (typeof getSrc !== 'string' || !STACK_GETTER_RE.test(getSrc)) {
        return false;
      }
      if (stackProtoDesc.set !== undefined) {
        if (
          typeof stackProtoDesc.set !== 'function' ||
          Reflect.has(stackProtoDesc.set, 'prototype')
        ) {
          return false;
        }
        const setSrc = reflectApply(toStr, stackProtoDesc.set, []);
        if (typeof setSrc !== 'string' || !STACK_SETTER_RE.test(setSrc)) {
          return false;
        }
      }
    } catch {
      return false;
    }
    if (hasTamperedDescriptor(Object.getPrototypeOf(Error.prototype), 'stack')) {
      return false;
    }
  } else if (hasTamperedDescriptor(Error.prototype, 'stack')) {
    return false;
  }
  if (
    !probeThrowsCleanTypeError(Object.getOwnPropertyDescriptor, null, [], toStr, stackProtoDesc) ||
    !probeThrowsCleanTypeError(toStr, { toString() {} }, [], toStr, stackProtoDesc) ||
    !probeThrowsCleanTypeError(reflectApply, toStr, [null, toStr, []], toStr, stackProtoDesc)
  ) {
    return false;
  }
  try {
    const probeFn = function () {};
    const expectedProbe = reflectApply(toStr, probeFn, []);
    if (
      toStr.call(probeFn) !== expectedProbe ||
      fnCall.call(toStr, probeFn) !== expectedProbe
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Verifies that a function or source string has not been pretty-printed,
 * spoofed (`{ toString() {} }`), or modified by comparing its FNV-1a hash
 * after validating native `Reflect.apply` invariants.
 */
export function verifyCodeIntegrity(
  fnOrSource: ((...args: unknown[]) => unknown) | string,
  expectedHash: number,
  seed = 0,
  normalized = false
): boolean {
  if (typeof fnOrSource !== 'function' && typeof fnOrSource !== 'string') {
    return false;
  }
  if (!isNativeDescriptorIntact()) {
    return false;
  }
  let raw: string;
  if (typeof fnOrSource === 'function') {
    try {
      const toStr = Function.prototype.toString;
      const selfStr = Reflect.apply(toStr, toStr, []);
      const match = typeof selfStr === 'string' ? NATIVE_BUILTIN_RE.exec(selfStr) : null;
      if (!match || match[1] !== 'toString') {
        return false;
      }
      raw = Reflect.apply(toStr, fnOrSource, []);
    } catch {
      return false;
    }
  } else {
    raw = fnOrSource;
  }
  return (
    (normalized
      ? computeNormalizedIntegrityHash(raw, seed)
      : computeIntegrityHash(raw, seed)) ===
    (expectedHash >>> 0)
  );
}
