export type DeterrentMode = 'gradual' | 'passive';

export interface ShieldConfig {
  seed: number;
  deterrentMode?: DeterrentMode;
  detectHeadless?: boolean;
  expectedIntegrityHash?: number;
  windowKeySymbol?: string;
  expectedDelta?: number;
}

export interface ShieldPayload {
  preambleCode: string;
  expectedHash: number;
  windowKeySymbol?: string;
  expectedDelta?: number;
}
