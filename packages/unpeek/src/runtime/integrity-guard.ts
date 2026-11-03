const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Computes a 32-bit unsigned FNV-1a hash over the un-normalized source string.
 * Any formatting change (such as DevTools Pretty-Print adding newlines or spaces)
 * or monkeypatching alters the resulting hash.
 */
export function computeIntegrityHash(source: string, seed = 0): number {
  let hash = (FNV_OFFSET_BASIS ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Verifies that a function or source string has not been pretty-printed or modified
 * by comparing its un-normalized Function.prototype.toString() FNV-1a hash.
 */
export function verifyCodeIntegrity(
  fnOrSource: Function | string,
  expectedHash: number,
  seed = 0,
): boolean {
  const raw =
    typeof fnOrSource === 'function'
      ? Function.prototype.toString.call(fnOrSource)
      : String(fnOrSource);
  return computeIntegrityHash(raw, seed) === (expectedHash >>> 0);
}
