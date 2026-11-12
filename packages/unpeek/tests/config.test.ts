import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_CONFIG,
  defineConfig,
  findConfigFile,
  loadUnpeekConfig,
  mergeUnpeekConfig,
  resolveUnpeekConfigSync,
} from '../src/config.js';
import type { UnpeekConfig } from '../src/types.js';

describe('Unpeek Config System', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `unpeek-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('DEFAULT_CONFIG', () => {
    it('provides sensible default configuration', () => {
      expect(DEFAULT_CONFIG.target).toBe('browser');
      expect(DEFAULT_CONFIG.vault?.minStringLength).toBe(4);
      expect(DEFAULT_CONFIG.vault?.cssFramework).toBe('tailwind');
      expect(DEFAULT_CONFIG.hotPath?.maxPipelineCallers).toBe(2);
      expect(DEFAULT_CONFIG.sourcemaps?.keepPrivate).toBe(true);
      expect(DEFAULT_CONFIG.sourcemaps?.vaultDir).toBe('.unpeek-maps');
    });
  });

  describe('defineConfig', () => {
    it('returns the same config object unmodified', () => {
      const cfg: UnpeekConfig = {
        framework: 'vite',
        target: 'browser',
        hotPath: { customAnimationCalls: ['myAnim'] },
      };
      expect(defineConfig(cfg)).toBe(cfg);
    });
  });

  describe('mergeUnpeekConfig', () => {
    it('returns base copy when override is undefined', () => {
      const merged = mergeUnpeekConfig(DEFAULT_CONFIG);
      expect(merged.target).toBe(DEFAULT_CONFIG.target);
      expect(merged.vault?.minStringLength).toBe(DEFAULT_CONFIG.vault?.minStringLength);
    });

    it('merges top-level and nested override properties', () => {
      const override: UnpeekConfig = {
        framework: 'nextjs',
        target: 'universal',
        outDir: '.next/custom',
        hotPath: {
          customAnimationCalls: ['tick', 'renderLoop'],
          maxPipelineCallers: 5,
        },
        vault: {
          minStringLength: 8,
          customDirectives: ['use custom'],
          cssFramework: 'unocss',
        },
        sourcemaps: {
          keepPrivate: false,
        },
      };

      const merged = mergeUnpeekConfig(DEFAULT_CONFIG, override);
      expect(merged.framework).toBe('nextjs');
      expect(merged.target).toBe('universal');
      expect(merged.outDir).toBe('.next/custom');
      expect(merged.hotPath?.customAnimationCalls).toEqual(['tick', 'renderLoop']);
      expect(merged.hotPath?.maxPipelineCallers).toBe(5);
      expect(merged.vault?.minStringLength).toBe(8);
      expect(merged.vault?.customDirectives).toContain('use custom');
      expect(merged.vault?.cssFramework).toBe('unocss');
      expect(merged.sourcemaps?.keepPrivate).toBe(false);
      expect(merged.sourcemaps?.vaultDir).toBe('.unpeek-maps'); // preserved from default
    });

    it('deduplicates array entries when merging', () => {
      const base: UnpeekConfig = {
        hotPath: {
          customHooks: ['useA', 'useB'],
        },
      };
      const override: UnpeekConfig = {
        hotPath: {
          customHooks: ['useB', 'useC'],
        },
      };
      const merged = mergeUnpeekConfig(base, override);
      expect(merged.hotPath?.customHooks).toEqual(['useA', 'useB', 'useC']);
    });
  });

  describe('findConfigFile', () => {
    it('returns null when no config file exists in directory', () => {
      expect(findConfigFile(tempDir)).toBeNull();
    });

    it('finds unpeek.config.json when present', () => {
      const filePath = join(tempDir, 'unpeek.config.json');
      writeFileSync(filePath, JSON.stringify({ framework: 'vanilla' }));
      expect(findConfigFile(tempDir)).toBe(filePath);
    });
  });

  describe('resolveUnpeekConfigSync', () => {
    it('returns default config merged with explicit config when no file exists', () => {
      const config = resolveUnpeekConfigSync(tempDir, { framework: 'webpack' });
      expect(config.framework).toBe('webpack');
      expect(config.target).toBe('browser');
    });

    it('loads and normalizes unpeek.config.json synchronously', () => {
      const filePath = join(tempDir, 'unpeek.config.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          framework: 'vite',
          target: 'universal',
          hotPath: {
            customAnimationCalls: ['requestStep'],
            hookPattern: '^use[A-Z0-9]',
          },
          vault: {
            minStringLength: 6,
          },
        }),
      );

      const config = resolveUnpeekConfigSync(tempDir);
      expect(config.framework).toBe('vite');
      expect(config.target).toBe('universal');
      expect(config.hotPath?.customAnimationCalls).toContain('requestStep');
      expect(config.hotPath?.hookPattern).toBeInstanceOf(RegExp);
      expect(config.hotPath?.hookPattern?.test('useCustomState')).toBe(true);
      expect(config.vault?.minStringLength).toBe(6);
    });

    it('merges explicit config overrides over JSON file config', () => {
      const filePath = join(tempDir, 'unpeek.config.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          framework: 'vite',
          vault: { minStringLength: 6 },
        }),
      );

      const config = resolveUnpeekConfigSync(tempDir, {
        vault: { minStringLength: 10 },
      });
      expect(config.framework).toBe('vite');
      expect(config.vault?.minStringLength).toBe(10);
    });
  });

  describe('loadUnpeekConfig', () => {
    it('loads unpeek.config.json asynchronously', async () => {
      const filePath = join(tempDir, 'unpeek.config.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          framework: 'nextjs',
          mangler: {
            reservedIdentifiers: ['specialGlobal'],
            excludePatterns: ['^MY_PREFIX_'],
          },
        }),
      );

      const config = await loadUnpeekConfig(tempDir);
      expect(config.framework).toBe('nextjs');
      expect(config.mangler?.reservedIdentifiers).toContain('specialGlobal');
      expect(config.mangler?.excludePatterns?.[0]).toBeInstanceOf(RegExp);
      expect(config.mangler?.excludePatterns?.[0].test('MY_PREFIX_TEST')).toBe(true);
    });

    it('loads ESM unpeek.config.mjs asynchronously', async () => {
      const filePath = join(tempDir, 'unpeek.config.mjs');
      writeFileSync(
        filePath,
        `export default {
          framework: 'vite',
          target: 'universal',
          hotPath: {
            customAnimationCalls: ['onTickAnim'],
          }
        };`,
      );

      const config = await loadUnpeekConfig(tempDir);
      expect(config.framework).toBe('vite');
      expect(config.target).toBe('universal');
      expect(config.hotPath?.customAnimationCalls).toContain('onTickAnim');
    });

    it('handles function export in unpeek.config.mjs', async () => {
      const filePath = join(tempDir, 'unpeek.config.mjs');
      writeFileSync(
        filePath,
        `export default () => ({
          framework: 'webpack',
          vault: {
            cssFramework: 'unocss'
          }
        });`,
      );

      const config = await loadUnpeekConfig(tempDir);
      expect(config.framework).toBe('webpack');
      expect(config.vault?.cssFramework).toBe('unocss');
    });
  });
});
