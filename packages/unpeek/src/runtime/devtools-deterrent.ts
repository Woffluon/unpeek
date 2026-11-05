import type { ShieldConfig } from '../types.js';
import { computeIntegrityHash } from './integrity-guard.js';

export function deriveIntegrityFnName(seed: number): string {
  const hash = computeIntegrityHash(`unpeek:fn:${seed}`, seed);
  return `_u$${hash.toString(36)}`;
}

/**
 * Generates a single-line, self-executing (IIFE), polymorphic, SSR-safe (<1.5 KB)
 * anti-tamper deterrent snippet without false-positive window dimension heuristics.
 */
export function createDeterrentSnippet(config: ShieldConfig): string {
  const seed = config.seed >>> 0;
  const deterrentMode = config.deterrentMode ?? 'passive';
  const fnName = deriveIntegrityFnName(seed);

  const consoleSilence = deterrentMode === 'gradual' ? 'for(var k in console)console[k]=f=>0;' : '';

  return `(function ${fnName}(w){if(w){try{(w.queueMicrotask||w.requestIdleCallback||(f=>f()))(function f(a){var s=Function.prototype.toString,n=w.navigator||0,t=s.call(s).indexOf('[native code]')<0||/\\n/.test(s.call(${fnName}))||n.webdriver||/HeadlessChrome/.test(n.userAgent);if(t){w.__unpeek_tampered=!0,w.__unpeek_seed=((w.__unpeek_seed||${seed})^1)>>>0,String.prototype._u=14;try{${consoleSilence}w.dispatchEvent(new CustomEvent('unpeek:tamper'));}catch(e){}}});}catch(e){}}})(typeof window!=='undefined'&&window);`;
}
