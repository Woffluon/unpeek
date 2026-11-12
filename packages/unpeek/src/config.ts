import fs, { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { UnpeekConfig } from './types.js';

export const CONFIG_CANDIDATES = [
  'unpeek.config.js',
  'unpeek.config.mjs',
  'unpeek.config.cjs',
  'unpeek.config.json',
];

export const DEFAULT_CONFIG: UnpeekConfig = {
  framework: undefined,
  target: 'browser',
  outDir: undefined,
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  publicDirs: ['public', 'static'],
  filter: {
    include: [],
    exclude: ['node_modules/**', '**/*.test.*', '**/*.spec.*'],
  },
  hotPath: {
    customAnimationCalls: [],
    importSources: {},
    customHooks: [],
    arrayHofMethods: [],
    hocWrappers: [],
    excludeComponents: [],
    maxPipelineCallers: 2,
  },
  vault: {
    minStringLength: 4,
    customDirectives: [],
    reservedProps: [],
    cssFramework: 'tailwind',
    semanticAnchors: {
      excludeUiClasses: true,
    },
    polymorphicDecoys: true,
  },
  mangler: {
    minLength: 3,
    reservedIdentifiers: [],
    excludePrefixes: [],
    excludePatterns: [],
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
  next: {},
  vite: {},
};

function mergeStringArrays(a?: string[], b?: string[]): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

function toRegExp(val: unknown): RegExp | undefined {
  if (!val) return undefined;
  if (val instanceof RegExp) return val;
  if (typeof val === 'string') {
    return new RegExp(val);
  }
  return undefined;
}

function toRegExpArray(val: unknown): RegExp[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const result: RegExp[] = [];
  for (const item of val) {
    const rx = toRegExp(item);
    if (rx) result.push(rx);
  }
  return result;
}

export function normalizeConfig(raw: Record<string, any>): UnpeekConfig {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const result: UnpeekConfig = { ...raw };

  if (raw.hotPath && typeof raw.hotPath === 'object') {
    result.hotPath = {
      ...raw.hotPath,
      hookPattern: toRegExp(raw.hotPath.hookPattern),
      eventHandlerRegex: toRegExp(raw.hotPath.eventHandlerRegex),
    };
  }

  if (raw.vault && typeof raw.vault === 'object') {
    result.vault = {
      ...raw.vault,
      semanticAnchors: raw.vault.semanticAnchors
        ? {
            ...raw.vault.semanticAnchors,
            patterns: toRegExpArray(raw.vault.semanticAnchors.patterns),
          }
        : undefined,
    };
  }

  if (raw.mangler && typeof raw.mangler === 'object') {
    result.mangler = {
      ...raw.mangler,
      excludePatterns: toRegExpArray(raw.mangler.excludePatterns),
    };
  }

  return result;
}

export function mergeUnpeekConfig(base: UnpeekConfig, override?: UnpeekConfig): UnpeekConfig {
  if (!override) {
    return { ...base };
  }

  return {
    ...base,
    framework: override.framework ?? base.framework,
    target: override.target ?? base.target,
    outDir: override.outDir ?? base.outDir,
    extensions: override.extensions ? [...override.extensions] : (base.extensions ? [...base.extensions] : undefined),
    publicDirs: override.publicDirs ? [...override.publicDirs] : (base.publicDirs ? [...base.publicDirs] : undefined),
    filter: {
      include: override.filter?.include ? [...override.filter.include] : (base.filter?.include ? [...base.filter.include] : []),
      exclude: override.filter?.exclude ? [...override.filter.exclude] : (base.filter?.exclude ? [...base.filter.exclude] : []),
    },
    hotPath: {
      customAnimationCalls: mergeStringArrays(
        base.hotPath?.customAnimationCalls,
        override.hotPath?.customAnimationCalls,
      ),
      importSources: {
        ...(base.hotPath?.importSources ?? {}),
        ...(override.hotPath?.importSources ?? {}),
      },
      hookPattern: override.hotPath?.hookPattern ?? base.hotPath?.hookPattern,
      customHooks: mergeStringArrays(
        base.hotPath?.customHooks,
        override.hotPath?.customHooks,
      ),
      arrayHofMethods: mergeStringArrays(
        base.hotPath?.arrayHofMethods,
        override.hotPath?.arrayHofMethods,
      ),
      eventHandlerRegex: override.hotPath?.eventHandlerRegex ?? base.hotPath?.eventHandlerRegex,
      maxPipelineCallers: override.hotPath?.maxPipelineCallers ?? base.hotPath?.maxPipelineCallers ?? 2,
      hocWrappers: mergeStringArrays(
        base.hotPath?.hocWrappers,
        override.hotPath?.hocWrappers,
      ),
      excludeComponents: mergeStringArrays(
        base.hotPath?.excludeComponents,
        override.hotPath?.excludeComponents,
      ),
    },
    vault: {
      minStringLength: override.vault?.minStringLength ?? base.vault?.minStringLength ?? 4,
      customDirectives: mergeStringArrays(
        base.vault?.customDirectives,
        override.vault?.customDirectives,
      ),
      reservedProps: mergeStringArrays(
        base.vault?.reservedProps,
        override.vault?.reservedProps,
      ),
      cssFramework: override.vault?.cssFramework ?? base.vault?.cssFramework ?? 'tailwind',
      semanticAnchors: {
        patterns: override.vault?.semanticAnchors?.patterns
          ? [...override.vault.semanticAnchors.patterns]
          : base.vault?.semanticAnchors?.patterns,
        excludeUiClasses: override.vault?.semanticAnchors?.excludeUiClasses ?? base.vault?.semanticAnchors?.excludeUiClasses ?? true,
      },
      polymorphicDecoys: override.vault?.polymorphicDecoys ?? base.vault?.polymorphicDecoys ?? true,
    },
    mangler: {
      minLength: override.mangler?.minLength ?? base.mangler?.minLength ?? 3,
      reservedIdentifiers: mergeStringArrays(
        base.mangler?.reservedIdentifiers,
        override.mangler?.reservedIdentifiers,
      ),
      excludePrefixes: mergeStringArrays(
        base.mangler?.excludePrefixes,
        override.mangler?.excludePrefixes,
      ),
      excludePatterns: override.mangler?.excludePatterns
        ? [...override.mangler.excludePatterns]
        : base.mangler?.excludePatterns,
    },
    shield: {
      detectHeadless: override.shield?.detectHeadless ?? base.shield?.detectHeadless ?? false,
      deterrentMode: override.shield?.deterrentMode ?? base.shield?.deterrentMode ?? 'passive',
    },
    sourcemaps: {
      keepPrivate: override.sourcemaps?.keepPrivate ?? base.sourcemaps?.keepPrivate ?? true,
      vaultDir: override.sourcemaps?.vaultDir ?? base.sourcemaps?.vaultDir ?? '.unpeek-maps',
      stripComments: override.sourcemaps?.stripComments ?? base.sourcemaps?.stripComments ?? true,
    },
    next: {
      distDir: override.next?.distDir ?? base.next?.distDir,
    },
    vite: {
      outDir: override.vite?.outDir ?? base.vite?.outDir,
      assetsDir: override.vite?.assetsDir ?? base.vite?.assetsDir,
    },
  };
}

export function findConfigFile(cwd: string = process.cwd()): string | null {
  const root = cwd ? resolve(cwd) : process.cwd();
  for (const filename of CONFIG_CANDIDATES) {
    const candidate = join(root, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function loadUnpeekConfig(
  cwd: string = process.cwd(),
  explicitConfig?: UnpeekConfig,
): Promise<UnpeekConfig> {
  const root = cwd ? resolve(cwd) : process.cwd();
  const configPath = findConfigFile(root);
  let parsedConfig: UnpeekConfig = {};

  if (configPath) {
    const ext = extname(configPath).toLowerCase();
    if (ext === '.json') {
      const content = await fs.promises.readFile(configPath, 'utf8');
      parsedConfig = normalizeConfig(JSON.parse(content));
    } else {
      try {
        const fileUrl = pathToFileURL(configPath).href;
        const mod = await import(fileUrl);
        let raw = mod.default ?? mod;
        if (typeof raw === 'function') {
          raw = await raw();
        }
        if (raw && typeof raw === 'object' && 'default' in raw && !raw.framework && !raw.vault && !raw.hotPath && !raw.shield) {
          raw = raw.default;
        }
        parsedConfig = normalizeConfig(raw ?? {});
      } catch (importErr) {
        try {
          const req = createRequire(configPath);
          let raw = req(configPath);
          if (raw && typeof raw === 'object' && 'default' in raw && !raw.framework && !raw.vault && !raw.hotPath && !raw.shield) {
            raw = raw.default;
          }
          if (typeof raw === 'function') {
            raw = await raw();
          }
          parsedConfig = normalizeConfig(raw ?? {});
        } catch {
          throw importErr;
        }
      }
    }
  }

  const baseConfig = mergeUnpeekConfig(DEFAULT_CONFIG, parsedConfig);
  return explicitConfig ? mergeUnpeekConfig(baseConfig, explicitConfig) : baseConfig;
}

export function resolveUnpeekConfigSync(
  cwd: string = process.cwd(),
  explicitConfig?: UnpeekConfig,
): UnpeekConfig {
  const root = cwd ? resolve(cwd) : process.cwd();
  const configPath = findConfigFile(root);
  let parsedConfig: UnpeekConfig = {};

  if (configPath) {
    const ext = extname(configPath).toLowerCase();
    if (ext === '.json') {
      try {
        const content = readFileSync(configPath, 'utf8');
        parsedConfig = normalizeConfig(JSON.parse(content));
      } catch (err) {
        console.warn(`[unpeek] Failed to parse JSON configuration at "${configPath}":`, err);
      }
    } else {
      try {
        const req = createRequire(configPath);
        let raw = req(configPath);
        if (raw && typeof raw === 'object' && 'default' in raw && !raw.framework && !raw.vault && !raw.hotPath && !raw.shield) {
          raw = raw.default;
        }
        if (typeof raw === 'function') {
          raw = raw();
        }
        parsedConfig = normalizeConfig(raw ?? {});
      } catch (err: any) {
        if (err?.code === 'ERR_REQUIRE_ESM') {
          console.warn(
            `[unpeek] Synchronous loading of ESM configuration "${configPath}" is not supported by Node.js require(). Use loadUnpeekConfig() or CommonJS/JSON config format instead.`
          );
        } else {
          console.warn(`[unpeek] Failed to load configuration at "${configPath}":`, err);
        }
      }
    }
  }

  const baseConfig = mergeUnpeekConfig(DEFAULT_CONFIG, parsedConfig);
  return explicitConfig ? mergeUnpeekConfig(baseConfig, explicitConfig) : baseConfig;
}

export function defineConfig(config: UnpeekConfig): UnpeekConfig {
  return config;
}
