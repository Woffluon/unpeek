import type { ShieldConfig } from '../types.js';
import { derivePolymorphicIdent } from '../ast/codegen.js';

export function deriveIntegrityFnName(seed: number): string {
  return derivePolymorphicIdent(seed, 'shield');
}

export function deriveWindowKeySymbol(seed: number): string {
  return derivePolymorphicIdent(seed, 'windowKey');
}

/**
 * Generates a single-line, self-executing (IIFE), polymorphic, synchronous, SSR-safe (<1.5 KB)
 * anti-tamper deterrent snippet that calculates a synchronous 32-bit FNV-1a hash of its own
 * Function.prototype.toString() representation and writes the 5-bit key component (expectedDelta)
 * to window[windowKeySymbol].
 *
 * When tampering is detected (formatting, pretty-print, webdriver, toString spoofing):
 * window.__unpeek_tampered is set to true, String.prototype._u is poisoned to 14,
 * window[sym] is poisoned to expectedDelta ^ 29, and CustomEvent('unpeek:tamper') is dispatched.
 */
export function createDeterrentSnippet(config: ShieldConfig): string {
  const seed = config.seed >>> 0;
  const deterrentMode = config.deterrentMode ?? 'passive';
  const fnName = deriveIntegrityFnName(seed);
  const sym = config.windowKeySymbol ?? deriveWindowKeySymbol(seed);

  const consoleSilence =
    deterrentMode === 'gradual' ? 'for(var k in console)console[k]=function(){return 0;};' : '';

  return `(function ${fnName}(w){if(w){try{var s=Function.prototype.toString,n=w.navigator||0,src=s.call(${fnName}),t=s.call(s).indexOf('[native code]')<0||/\\n/.test(src)||n.webdriver||/HeadlessChrome/.test(n.userAgent);for(var h=0x811c9dc5,i=0;i<src.length;i++)h=Math.imul(h^src.charCodeAt(i),0x01000193)>>>0;var d=(h&31);if(t){w.__unpeek_tampered=!0;w.__unpeek_seed=((w.__unpeek_seed||${seed})^1)>>>0;String.prototype._u=14;w['${sym}']=d^29;try{${consoleSilence}w.dispatchEvent(new CustomEvent('unpeek:tamper'));}catch(e){}}else{w['${sym}']=d;}}catch(e){}}})(typeof window!=='undefined'&&window);`;
}
