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
  const detectHeadless = config.detectHeadless ?? false;
  const fnName = deriveIntegrityFnName(seed);
  const sym = config.windowKeySymbol ?? deriveWindowKeySymbol(seed);

  const consoleSilence =
    deterrentMode === 'gradual' ? 'for(var k in console)console[k]=function(){return 0;};' : '';

  const symLit = JSON.stringify(sym);
  const headlessDecl = detectHeadless ? ',n=w.navigator||0' : '';
  const headlessCond = detectHeadless ? '||n.webdriver||/HeadlessChrome/.test(n.userAgent)' : '';

  return `(function ${fnName}(w){var G=typeof globalThis!=='undefined'?globalThis:w;if(w){var O=Object,P=O.getOwnPropertyDescriptor,GP=O.getPrototypeOf,T=function(o,k){try{while(o){var r=P&&P(o,k);if(r&&(r.set||!r.writable))return 1;o=GP?GP(o):0;}}catch(e){return 1;}},S=function(o,k,v){try{o[k]=v;}catch(e){}},s=Function.prototype.toString${headlessDecl},src='',t=0;try{src=s.call(${fnName});if('prototype' in s||s.name!=='toString'||s.length!==0||s.call(s).indexOf('[native code]')<0||/\\n/.test(src)${headlessCond})t=1;}catch(e){t=1;}try{s.call(0);t=1;}catch(e){}if(T(w,${symLit})||T(G,${symLit})||T(G,'__unpeek_tampered')||T(w,'__unpeek_tampered')||T(String.prototype,'_u'))t=1;for(var h=0x811c9dc5,i=0;i<src.length;i++)h=Math.imul(h^src.charCodeAt(i),0x01000193)>>>0;var d=h&0xffff;if(t){var pd=(d^(((h>>>16)^0x5a5b)||1))&0xffff;if(!T(G,${symLit}))S(G,${symLit},pd);if(!T(w,${symLit}))S(w,${symLit},pd);S(G,'__unpeek_delta',pd);S(w,'__unpeek_delta',pd);try{String.prototype._u=14;}catch(e){}var ns=((w.__unpeek_seed||${seed})^1)>>>0;S(G,'__unpeek_seed',ns);S(w,'__unpeek_seed',ns);S(G,'__unpeek_tampered',!0);S(w,'__unpeek_tampered',!0);try{${consoleSilence}if(w.dispatchEvent)w.dispatchEvent(new CustomEvent('unpeek:tamper'));}catch(e){}}else{S(G,${symLit},d);S(w,${symLit},d);}}})(typeof window!=='undefined'?window:(typeof self!=='undefined'?self:0));`;
}
