import type { ShieldConfig, ShieldPayload } from './types.js';
import type { InternalShieldPayload } from '../internal/types.js';
import {
  computeIntegrityHash,
  computeNormalizedIntegrityHash,
  verifyCodeIntegrity,
} from './integrity-guard.js';
import {
  createDeterrentSnippet,
  deriveIntegrityFnName,
  deriveWindowKeySymbol,
} from './devtools-deterrent.js';

export function generateRuntimeShield(config: ShieldConfig): ShieldPayload {
  const seed = config.seed >>> 0;
  const windowKeySymbol = config.windowKeySymbol ?? deriveWindowKeySymbol(seed);
  const integrityCheckFnName = deriveIntegrityFnName(seed);

  const preambleCode = createDeterrentSnippet({
    ...config,
    windowKeySymbol,
  });

  const fnStart = preambleCode.indexOf('function');
  const endMarker = preambleCode.lastIndexOf('})(');
  const fnEnd = endMarker !== -1 ? endMarker + 1 : preambleCode.lastIndexOf('(') - 1;
  const fnDecl = preambleCode.slice(fnStart, fnEnd);
  const computedHash = computeIntegrityHash(fnDecl, 0);

  const expectedHash =
    config.expectedIntegrityHash !== undefined
      ? config.expectedIntegrityHash >>> 0
      : computedHash;

  const expectedDelta =
    config.expectedDelta !== undefined
      ? config.expectedDelta & 0xffff
      : (computedHash >>> 0) & 0xffff;

  const expectedStateHash = (computedHash ^ seed) | 0;

  const payload: InternalShieldPayload = {
    preambleCode,
    integrityCheckFnName,
    expectedHash,
    windowKeySymbol,
    expectedDelta,
    stateKeySymbol: `${windowKeySymbol}_s`,
    expectedStateHash,
  };
  return payload;
}

export {
  computeIntegrityHash,
  computeNormalizedIntegrityHash,
  isNativeDescriptorIntact,
  normalizeIntegritySource,
  verifyCodeIntegrity,
} from './integrity-guard.js';
export { createDeterrentSnippet } from './devtools-deterrent.js';
