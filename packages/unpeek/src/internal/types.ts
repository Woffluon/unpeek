import type { TransformOptions, TransformResult } from '../ast/types.js';
import type { ShieldPayload } from '../runtime/types.js';

export interface InternalTransformOptions extends TransformOptions {
  skipShieldPreamble?: boolean;
  shieldCoupled?: boolean;
  windowKeySymbol?: string;
  expectedDelta?: number;
}

export interface InternalTransformResult extends TransformResult {
  shaderBuffersCount?: number;
}

export interface InternalShieldPayload extends ShieldPayload {
  integrityCheckFnName: string;
}
