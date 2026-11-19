export type DeterrentMode = 'gradual' | 'passive';

export type ShieldEpochStatus = 0 | 1 | 2;

export type ShieldStateRecord = [
  status: ShieldEpochStatus,
  k0: number,
  k1: number,
  epoch: number,
  nonce: number,
];

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
  stateKeySymbol?: string;
  expectedStateHash?: number;
}
