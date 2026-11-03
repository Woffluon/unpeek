import type { ShieldConfig, ShieldPayload } from '../types.js';
import { computeIntegrityHash, verifyCodeIntegrity } from './integrity-guard.js';
import { createDeterrentSnippet, deriveIntegrityFnName } from './devtools-deterrent.js';

export function generateRuntimeShield(config: ShieldConfig): ShieldPayload {
  const preambleCode = createDeterrentSnippet(config);
  const integrityCheckFnName = deriveIntegrityFnName(config.seed);
  const expectedHash =
    config.expectedIntegrityHash !== undefined
      ? config.expectedIntegrityHash >>> 0
      : computeIntegrityHash(preambleCode, config.seed);

  return {
    preambleCode,
    integrityCheckFnName,
    expectedHash,
  };
}

export { computeIntegrityHash, verifyCodeIntegrity } from './integrity-guard.js';
export { createDeterrentSnippet } from './devtools-deterrent.js';
