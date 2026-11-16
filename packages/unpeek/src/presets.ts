import type { UnpeekConfig } from './config.js';

export type UnpeekProfile = 'minimal' | 'recommended' | 'strict';

export const PRESETS: Record<UnpeekProfile, UnpeekConfig> = {
  minimal: {
    profile: 'minimal',
    tier: 'Tier 1',
    target: 'browser',
    coldFlow: false,
    vault: {
      minStringLength: Number.MAX_SAFE_INTEGER,
      polymorphicDecoys: false,
    },
    mangler: {
      minLength: 1,
    },
    shield: {
      detectHeadless: false,
      deterrentMode: 'passive',
    },
    sourcemaps: {
      keepPrivate: true,
      vaultDir: '.unpeek-maps',
      stripComments: true,
    },
    scrubPaths: false,
  },
  recommended: {
    profile: 'recommended',
    tier: 'Tier 2',
    target: 'browser',
    coldFlow: true,
    vault: {
      minStringLength: 4,
      cssFramework: 'tailwind',
      semanticAnchors: {
        excludeUiClasses: true,
      },
      polymorphicDecoys: true,
    },
    mangler: {
      minLength: 1,
    },
    shield: {
      detectHeadless: false,
      deterrentMode: 'passive',
    },
    sourcemaps: {
      keepPrivate: true,
      vaultDir: '.unpeek-maps',
      stripComments: true,
    },
    scrubPaths: false,
  },
  strict: {
    profile: 'strict',
    tier: 'Tier 3',
    target: 'browser',
    coldFlow: true,
    critical: {
      annotation: '@unpeek-critical',
    },
    vault: {
      minStringLength: 4,
      cssFramework: 'tailwind',
      semanticAnchors: {
        excludeUiClasses: true,
      },
      polymorphicDecoys: true,
      fragmented: true,
      fragmentCount: 4,
    },
    mangler: {
      minLength: 1,
    },
    shield: {
      detectHeadless: true,
      deterrentMode: 'gradual',
    },
    sourcemaps: {
      keepPrivate: true,
      vaultDir: '.unpeek-maps',
      stripComments: true,
    },
    scrubPaths: true,
  },
};
