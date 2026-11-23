import type { ShieldConfig } from './types.js';
import { derivePolymorphicIdent } from '../ast/codegen.js';

export function deriveIntegrityFnName(seed: number): string {
  return derivePolymorphicIdent(seed, 'shield');
}

export function deriveWindowKeySymbol(seed: number): string {
  return derivePolymorphicIdent(seed, 'windowKey');
}

/**
 * Generates a single-line, self-executing (IIFE), polymorphic, synchronous, SSR- & Worker-safe (<2.3 KB)
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
 * When tampering is detected (webdriver or automation/instrumentation markers when enabled,
 * toString/Reflect/descriptor spoofing, or code alteration):
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
    deterrentMode === 'gradual' ? 'for(var k in console)console[k]=()=>0;' : '';

  const symLit = JSON.stringify(sym);
  const headlessDecl = detectHeadless ? ',n=w.navigator||0' : '';
  const headlessCond = detectHeadless
    ? "||n.webdriver||/HeadlessChrome/.test(n.userAgent)||['__playwright','__puppeteer_evaluation_script__','__nightmare','frida','_frida_'].some(k=>w[k]||G[k])"
    : '';
  const k1Mul = (seed | 1) >>> 0;

  return `(function ${fnName}(w){var G=globalThis||w;if(w){var O=Object,P=O.getOwnPropertyDescriptor,RF=G.Reflect,R=RF&&RF.apply,FP=Function.prototype,SP=String.prototype,ER=Error,EP=ER.prototype,Q='__unpeek_',y=${symLit},z=y+'_s',U='__unpeek_tampered',K=Q+'seed',ST='stack',PS='prepareStackTrace',A='\\n    at ',T=(o,k)=>{try{for(var r;o;o=O.getPrototypeOf(o))if((r=P(o,k))&&(r.set||!r.writable))return 1;}catch(e){return 1;}},D=k=>T(w,k)|T(G,k),B=(k,v,c,W)=>{W=o=>{try{if(!c||!T(o,k))o[k]=v;}catch(e){}};W(G);W(w);},s=FP.toString${headlessDecl},src='',t=+((G[z]||w[z])?.[0]==2),sd=P(EP,ST),ep=ER[PS],M=/^function (?:get )?(\\w*)\\(\\)\\s*\\x7b\\s*\\[native code\\]\\s*\\}$/;try{var ps,rf=P(new ER(),ST),Z=()=>{if(ER[PS]!==void 0){if(typeof process>'u')t=1;ER[PS]=void 0;}},F=(f,n,l)=>typeof f!='function'||'prototype'in f||(l>=0&&(f.name!=n||f.length!=l))||M.exec(R(R,null,[s,f,[]]))?.[1]!=n,E=(f,a,b)=>{try{R(f,a,b);t=1;}catch(e){Z();var ed=P(e,ST),st=sd&&sd.get?R(sd.get,e,[]):ed&&ed.get?R(ed.get,e,[]):e[ST];if(ed&&(!rf||F(ed.get,'',0)))t=1;t|=e?.name!='TypeError'||!st||st.indexOf(A)<0||/(?:Object|Proxy)\\.apply\\b|\\n    at (?!.* \\(<anonymous>\\)$)/m.test(st.split(A+'E (')[0]);}};Z();try{E(P,null,[]);E(s,{toString(){}},[]);E(R,s,[null,s,[]]);}finally{if(ep!==void 0)ER[PS]=ep;}src=R(s,${fnName},[]);t|=(sd&&F(sd.get,ST,-1))|F(R,'apply',3)|F(s,'toString',0)|s.call(T)!==(ps=R(s,T,[]))|FP.call.call(s,T)!==ps|/\\n/.test(src)${headlessCond};}catch(e){t=1;}t|=D(y)|D(z)|D(U)|T(SP,'_u')|T(FP,'toString')|T(FP,'call')|T(RF,'apply')|T(ER,PS)|(sd?T(O.getPrototypeOf(EP),ST):T(EP,ST));for(var h=2166136261,i=0;i<src.length;)h=Math.imul(h^src.charCodeAt(i++),16777619);var d=h&65535,pd=t?d^((h>>>16^23131)||1):d;B(z,[t+1,h^${seed}^t,h^${k1Mul}^t,1,d^h>>>16],t);B(y,pd,t);if(t){B(y+'_t',!0);B(Q+'delta',pd);try{SP._u=14;}catch(e){}B(K,((w[K]||${seed})^1)>>>0);B(U,!0);try{${consoleSilence}w.dispatchEvent?.(new CustomEvent('unpeek:tamper'));}catch(e){}}}})(typeof window!=='undefined'?window:typeof self<'u'?self:typeof globalThis<'u'?globalThis:0);`;
}
