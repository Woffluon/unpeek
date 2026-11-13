import type { UnpeekConfig } from './config.js';

export type UnpeekProfile = 'minimal' | 'recommended' | 'strict';

export const PRESETS: Record<UnpeekProfile, UnpeekConfig> = {
  minimal: {
    profile: 'minimal',
    target: 'browser',
    vault: {
      minStringLength: Number.MAX_SAFE_INTEGER,
      polymorphicDecoys: false,
    },
    mangler: {
      minLength: 3,
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
    target: 'browser',
    vault: {
      minStringLength: 4,
      cssFramework: 'tailwind',
      semanticAnchors: {
        excludeUiClasses: true,
      },
      polymorphicDecoys: true,
    },
    mangler: {
      minLength: 3,
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
    target: 'browser',
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
      minLength: 3,
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
