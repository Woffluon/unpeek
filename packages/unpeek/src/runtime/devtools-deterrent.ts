import type { ShieldConfig } from './types.js';
import { derivePolymorphicIdent } from '../ast/codegen.js';

export function deriveIntegrityFnName(seed: number): string {
  return derivePolymorphicIdent(seed, 'shield');
}

export function deriveWindowKeySymbol(seed: number): string {
  return derivePolymorphicIdent(seed, 'windowKey');
}

/**
 * Generates a single-line, self-executing (IIFE), polymorphic, synchronous, SSR- & Worker-safe (<1.5 KB)
 * anti-tamper deterrent snippet that calculates a normalized synchronous 32-bit FNV-1a hash of its own
 * Function.prototype.toString() representation, writes the 16-bit key component (expectedDelta) to
 * globalThis[windowKeySymbol], and records the v4 non-poisoning state tuple
 * globalThis[windowKeySymbol + '_s'] = [status, k0, k1, epoch, nonce] (status: 1=VERIFIED, 2=TAMPERED).
 *
 * Freedom To Operate (FTO) Compliance:
 * US9979726B2 covers server-mediated intervention combined with a DOM sweeping loop, while
 * US10380382B2 covers periodic debugger console polling. unpeek strictly avoids both mechanisms
 * and operates purely client-side and build-time synchronously within the expired US7757097B2
 * (Expired - Lifetime) public prior-art domain.
 *
 * When tampering is detected (webdriver when enabled, toString/Reflect/descriptor spoofing, or code alteration):
 * globalThis.__unpeek_tampered is set to true, state status is pinned to 2, String.prototype._u is poisoned to 14,
 * globalThis[sym] is poisoned to expectedDelta ^ mask, and CustomEvent('unpeek:tamper') is dispatched.
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
  const stateLit = JSON.stringify(`${sym}_s`);
  const headlessDecl = detectHeadless ? ',n=w.navigator||0' : '';
  const headlessCond = detectHeadless ? '||n.webdriver||/HeadlessChrome/.test(n.userAgent)' : '';
  const k1Mul = (seed | 1) >>> 0;

  return `(function ${fnName}(w){var G=typeof globalThis<'u'?globalThis:w;if(w){var O=Object,P=O.getOwnPropertyDescriptor,GP=O.getPrototypeOf,R=typeof Reflect<'u'&&Reflect.apply,SP=String.prototype,Q='__unpeek_',y=${symLit},z=${stateLit},U='__unpeek_tampered',T=function(o,k){try{while(o){var r=P&&P(o,k);if(r&&(r.set||!r.writable))return 1;o=GP?GP(o):0;}}catch(e){return 1;}},B=function(k,v,c){try{if(!c||!T(G,k))G[k]=v;}catch(e){}try{if(!c||!T(w,k))w[k]=v;}catch(e){}},s=Function.prototype.toString${headlessDecl},src='',t=0;if((G[z]||w[z]||0)[0]==2)t=1;try{if(typeof R!='function')t=1;else{var E=function(f,a,b){try{R(f,a,b);t=1;}catch(e){t|=!e||(!(e instanceof TypeError)&&e.name!='TypeError');}};E(P,null,[]);E(s,{toString(){}},[]);src=R(s,${fnName},[]);if(typeof s!='function'||'prototype'in s||s.name!='toString'||s.length!=0||R(s,s,[]).indexOf('[native code]')<0||/\\n/.test(src)${headlessCond})t=1;}}catch(e){t=1;}for(var j in K=[y,z,U])if(T(w,K[j])||T(G,K[j]))t=1;if(T(SP,'_u'))t=1;for(var h=0x811c9dc5,i=0;i<src.length;i++)h=Math.imul(h^src.charCodeAt(i),0x01000193)>>>0;var d=h&65535,k0=(h^${seed})>>>0,k1=(h^${k1Mul})>>>0,nc=(d^(h>>>16))>>>0;B(z,[t?2:1,k0^t,k1^t,1,nc],t);if(t){var pd=(d^((h>>>16^0x5a5b)||1))&65535;B(y,pd,1);B(y+'_t',!0);B(Q+'delta',pd);try{SP._u=14;}catch(e){}B(Q+'seed',((w.__unpeek_seed||${seed})^1)>>>0);B(U,!0);try{${consoleSilence}w.dispatchEvent&&w.dispatchEvent(new CustomEvent('unpeek:tamper'));}catch(e){}}else B(y,d);}})(typeof window!=='undefined'?window:typeof self<'u'?self:typeof globalThis<'u'?globalThis:0);`;
}
