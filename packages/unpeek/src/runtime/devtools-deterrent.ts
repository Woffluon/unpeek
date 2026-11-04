import type { ShieldConfig } from '../types.js';
import { computeIntegrityHash } from './integrity-guard.js';

export function deriveIntegrityFnName(seed: number): string {
  const hash = computeIntegrityHash(`unpeek:fn:${seed}`, seed);
  return `_u$${hash.toString(36)}`;
}

function deriveLocalVar(label: string, seed: number): string {
  const hash = computeIntegrityHash(`unpeek:var:${label}:${seed}`, seed) & 0xfffff;
  return `_${label}${hash.toString(36)}`;
}

/**
 * Generates a single-line, self-executing (IIFE), polymorphic, SSR-safe (<1.5 KB)
 * anti-tamper deterrent snippet without false-positive window dimension heuristics.
 */
export function createDeterrentSnippet(config: ShieldConfig): string {
  const seed = config.seed >>> 0;
  const deterrentMode = config.deterrentMode ?? 'passive';
  const fnName = deriveIntegrityFnName(seed);
  const strVar = deriveLocalVar('s', seed);
  const tamperVar = deriveLocalVar('t', seed);
  const noopVar = deriveLocalVar('n', seed);
  const methodsVar = deriveLocalVar('m', seed);
  const idxVar = deriveLocalVar('i', seed);
  const errVar = deriveLocalVar('e', seed);

  const gradualConsoleSilence =
    deterrentMode === 'gradual'
      ? `if(typeof console!=='undefined'){var ${noopVar}=function(){},${methodsVar}=['log','debug','info','table','dir'];for(var ${idxVar}=0;${idxVar}<${methodsVar}.length;${idxVar}++){try{console[${methodsVar}[${idxVar}]]=${noopVar};}catch(${errVar}){}}}`
      : '';

  const tamperDispatch = `if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function'){try{window.dispatchEvent(new CustomEvent('unpeek:tamper'));}catch(${errVar}){}}`;

  return `(function ${fnName}(){if(typeof window!=='undefined'){try{var ${strVar}=Function.prototype.toString,${tamperVar}=${strVar}.call(${strVar}).indexOf('[native code]')===-1||${strVar}.call(${fnName}).indexOf('\\n')!==-1||${strVar}.call(${fnName}).indexOf('\\r')!==-1;if(${tamperVar}){window.__unpeek_tampered=!0;${tamperDispatch}${gradualConsoleSilence}}}catch(${errVar}){}}})();`;
}
