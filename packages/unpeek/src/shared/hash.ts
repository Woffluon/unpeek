export function computeFnv1aHash(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Computes a full 64-bit (2x 32-bit unsigned) call-site salt from function hash,
 * call-site index, and build seed using cross-lane non-linear mixing.
 */
export function computeCallSiteSalt64(
  fnHash: number,
  callIndex: number,
  seed: number
): [number, number] {
  const s = seed >>> 0;
  const f = fnHash >>> 0;
  const idx = (callIndex + 1) >>> 0;
  let lo = (f ^ s ^ Math.imul(idx, 0x9e3779b1)) >>> 0;
  let hi = (s ^ Math.imul((f ^ 0x85ebca6b) >>> 0, 0xc2b2ae35) ^ idx) >>> 0;
  lo = Math.imul(lo ^ (lo >>> 16), 0x85ebca6b) >>> 0;
  hi = Math.imul(hi ^ (hi >>> 15), 0xc2b2ae35) >>> 0;
  lo = (lo ^ Math.imul(hi ^ (hi >>> 13), 0x27d4eb2f)) >>> 0;
  hi = (hi ^ Math.imul(lo ^ (lo >>> 16), 0x165667b1)) >>> 0;
  lo = Math.imul(lo ^ (lo >>> 15), 0x45d9f3b) >>> 0;
  hi = Math.imul(hi ^ (hi >>> 16), 0x45d9f3b) >>> 0;
  return [lo >>> 0, hi >>> 0];
}

/**
 * Evaluates a Rivest degree-3 permutation polynomial mod 2^32:
 * P(x) = a0 + a1*x + a2*x^2 + a3*x^3 (mod 2^32),
 * where a1 is odd and a2, a3 are even so P is a bijection on Z_{2^32}.
 */
export function evalRivestPoly32(
  x: number,
  a0: number,
  a1Odd: number,
  a2Even: number,
  a3Even: number
): number {
  const xv = x | 0;
  const c0 = a0 | 0;
  const c1 = a1Odd | 1;
  const c2 = a2Even & ~1;
  const c3 = a3Even & ~1;
  const t2 = (c2 + Math.imul(c3, xv)) | 0;
  const t1 = (c1 + Math.imul(t2, xv)) | 0;
  return (c0 + Math.imul(t1, xv)) >>> 0;
}

/**
 * Computes the exact inverse P^{-1}(y) mod 2^32 via 5-step Newton / Hensel lifting.
 */
export function invertRivestPoly32(
  y: number,
  a0: number,
  a1Odd: number,
  a2Even: number,
  a3Even: number
): number {
  const yv = y | 0;
  const c0 = a0 | 0;
  const c1 = a1Odd | 1;
  const c2 = a2Even & ~1;
  const c3 = a3Even & ~1;
  const twoC2 = (c2 << 1) | 0;
  const threeC3 = Math.imul(3, c3);

  let x = ((yv - c0) & 1) | 0;
  for (let step = 0; step < 5; step++) {
    const fx = (c0 + Math.imul(x, (c1 + Math.imul(x, (c2 + Math.imul(c3, x)) | 0)) | 0)) | 0;
    const err = (fx - yv) | 0;
    const dfx = (c1 + Math.imul(x, (twoC2 + Math.imul(threeC3, x)) | 0)) | 0;
    let inv = 1;
    for (let j = 0; j < 5; j++) {
      inv = Math.imul(inv, (2 - Math.imul(dfx, inv)) | 0);
    }
    x = (x - Math.imul(err, inv)) | 0;
  }
  return x >>> 0;
}
