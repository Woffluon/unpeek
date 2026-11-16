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

/**
 * Verifies native descriptor and `Reflect.apply` error invariants.
 * Native `Object.getOwnPropertyDescriptor(null)` must throw a `TypeError`.
 */
export function isNativeDescriptorIntact(): boolean {
  if (typeof Reflect === 'undefined' || typeof Reflect.apply !== 'function') {
    return false;
  }
  try {
    Reflect.apply(Object.getOwnPropertyDescriptor, null, []);
    return false;
  } catch (err) {
    if (!(err instanceof TypeError)) {
      return false;
    }
  }
  const toStr = Function.prototype.toString;
  if (
    typeof toStr !== 'function' ||
    Reflect.has(toStr, 'prototype') ||
    toStr.name !== 'toString' ||
    toStr.length !== 0
  ) {
    return false;
  }
  try {
    Reflect.apply(toStr, { toString() {} }, []);
    return false;
  } catch (err) {
    if (!(err instanceof TypeError)) {
      return false;
    }
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
      if (typeof selfStr !== 'string' || selfStr.indexOf('[native code]') < 0) {
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
