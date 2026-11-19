import type { TransformOptions, TransformResult } from '../ast/types.js';
import type { ShieldPayload } from '../runtime/types.js';
import type { AnySourceMap } from '../core/vlq.js';

export interface InternalSourceMap {
  version: number;
  file?: string;
  sources: string[];
  names: string[];
  mappings: string;
}

export interface InternalTransformOptions extends TransformOptions {
  skipShieldPreamble?: boolean;
  shieldCoupled?: boolean;
  windowKeySymbol?: string;
  expectedDelta?: number;
  expectedStateHash?: number;
  originalSourceMap?: AnySourceMap;
  rootDir?: string;
  generateMap?: boolean;
}

export interface InternalTransformResult extends TransformResult {
  shaderBuffersCount?: number;
  sourceMap?: InternalSourceMap;
}

export interface InternalShieldPayload extends ShieldPayload {
  integrityCheckFnName: string;
}
