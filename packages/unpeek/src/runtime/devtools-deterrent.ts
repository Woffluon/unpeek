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
 * Function.prototype.toString() representation and writes the 16-bit key component (expectedDelta)
 * to window[windowKeySymbol].
 *
 * Freedom To Operate (FTO) Compliance:
 * Strictly avoids timer / setInterval active debugging checks, timing differential loops,
 * and periodic debugger polling covered by third-party patents (e.g. Jscrambler US9979726B2).
 * Operates purely via synchronous cryptographic state coupling via FNV-1a hash and tamper flags.
 *
 * When tampering is detected (formatting, pretty-print, webdriver, toString spoofing):
 * window.__unpeek_tampered is set to true, String.prototype._u is poisoned to 14,
 * window[sym] is poisoned to expectedDelta ^ 0x5a5b, and CustomEvent('unpeek:tamper') is dispatched.
 */
export function createDeterrentSnippet(config: ShieldConfig): string {
  const seed = config.seed >>> 0;
  const deterrentMode = config.deterrentMode ?? 'passive';
  const fnName = deriveIntegrityFnName(seed);
  const sym = config.windowKeySymbol ?? deriveWindowKeySymbol(seed);

  const consoleSilence =
    deterrentMode === 'gradual' ? 'for(var k in console)console[k]=function(){return 0;};' : '';

  const propAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(sym)
    ? `.${sym}`
    : `[${JSON.stringify(sym)}]`;

  return `(function ${fnName}(w){var G=typeof globalThis!=='undefined'?globalThis:w;if(w){try{var s=Function.prototype.toString,n=w.navigator||0,src=s.call(${fnName}),t=s.call(s).indexOf('[native code]')<0||/\\n/.test(src)||n.webdriver||/HeadlessChrome/.test(n.userAgent);for(var h=0x811c9dc5,i=0;i<src.length;i++)h=Math.imul(h^src.charCodeAt(i),0x01000193)>>>0;var d=h&0xffff;if(t){G.__unpeek_tampered=w.__unpeek_tampered=!0;G.__unpeek_seed=w.__unpeek_seed=((w.__unpeek_seed||${seed})^1)>>>0;String.prototype._u=14;G${propAccess}=w${propAccess}=G.__unpeek_delta=w.__unpeek_delta=d^0x5a5b;try{${consoleSilence}if(w.dispatchEvent)w.dispatchEvent(new CustomEvent('unpeek:tamper'));}catch(e){}}else{G${propAccess}=w${propAccess}=d;}}catch(e){}}})(typeof window!=='undefined'?window:(typeof self!=='undefined'?self:0));`;
}
