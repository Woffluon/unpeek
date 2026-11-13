import fs, { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { UnpeekError } from '../shared/errors.js';
import { PRESETS } from '../presets.js';
import type { PatternInput, UnpeekConfig } from '../config.js';

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

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
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

function clonePatterns(patterns?: PatternInput[]): PatternInput[] | undefined {
  return patterns ? [...patterns] : undefined;
}

export function normalizeConfig(raw: Record<string, unknown>): UnpeekConfig {
  if (!isRecord(raw)) {
    return {};
  }

  const result: UnpeekConfig = { ...(raw as UnpeekConfig) };

  if (isRecord(raw.hotPath)) {
    result.hotPath = {
      ...(raw.hotPath as UnpeekConfig['hotPath']),
      hookPattern: toRegExp(raw.hotPath.hookPattern),
      eventHandlerRegex: toRegExp(raw.hotPath.eventHandlerRegex),
    };
  }

  if (isRecord(raw.vault)) {
    result.vault = {
      ...(raw.vault as UnpeekConfig['vault']),
      semanticAnchors: isRecord(raw.vault.semanticAnchors)
        ? {
            ...(raw.vault.semanticAnchors as NonNullable<UnpeekConfig['vault']>['semanticAnchors']),
            patterns: toRegExpArray(raw.vault.semanticAnchors.patterns),
          }
        : undefined,
    };
  }

  if (isRecord(raw.mangler)) {
    result.mangler = {
      ...(raw.mangler as UnpeekConfig['mangler']),
      excludePatterns: toRegExpArray(raw.mangler.excludePatterns),
    };
  }

  return result;
}

function mergeTwoConfigs(base: UnpeekConfig, override: UnpeekConfig): UnpeekConfig {
  return {
    ...base,
    framework: override.framework ?? base.framework,
    target: override.target ?? base.target,
    profile: override.profile ?? base.profile,
    outDir: override.outDir ?? base.outDir,
    scrubPaths: override.scrubPaths ?? base.scrubPaths,
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
        patterns: clonePatterns(override.vault?.semanticAnchors?.patterns)
          ?? clonePatterns(base.vault?.semanticAnchors?.patterns),
        excludeUiClasses: override.vault?.semanticAnchors?.excludeUiClasses ?? base.vault?.semanticAnchors?.excludeUiClasses ?? true,
      },
      polymorphicDecoys: override.vault?.polymorphicDecoys ?? base.vault?.polymorphicDecoys ?? true,
      fragmented: override.vault?.fragmented ?? base.vault?.fragmented,
      fragmentCount: override.vault?.fragmentCount ?? base.vault?.fragmentCount,
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
      excludePatterns: clonePatterns(override.mangler?.excludePatterns)
        ?? clonePatterns(base.mangler?.excludePatterns),
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

export function mergeUnpeekConfig(base: UnpeekConfig, override?: UnpeekConfig): UnpeekConfig {
  if (!override) {
    return { ...base };
  }

  const effectiveBase = override.profile
    ? mergeTwoConfigs(base, PRESETS[override.profile])
    : base;

  return mergeTwoConfigs(effectiveBase, override);
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

function formatErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function unwrapDefaultExport(raw: unknown): unknown {
  if (
    isRecord(raw) &&
    'default' in raw &&
    !('framework' in raw) &&
    !('vault' in raw) &&
    !('hotPath' in raw) &&
    !('shield' in raw)
  ) {
    return raw.default;
  }
  return raw;
}

function validateAndNormalizeConfig(raw: unknown, configPath: string): UnpeekConfig {
  if (raw === undefined) {
    return {};
  }
  if (!isRecord(raw)) {
    throw new UnpeekError(
      'ERR_CONFIG_INVALID',
      `Configuration at "${configPath}" must export or contain a JSON object.`,
    );
  }
  try {
    return normalizeConfig(raw);
  } catch (err: unknown) {
    if (err instanceof UnpeekError) throw err;
    throw new UnpeekError(
      'ERR_CONFIG_INVALID',
      `Invalid configuration at "${configPath}": ${formatErr(err)}`,
      { cause: err },
    );
  }
}

function parseJsonConfig(content: string, configPath: string): UnpeekConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    throw new UnpeekError(
      'ERR_CONFIG_INVALID',
      `Failed to parse JSON configuration at "${configPath}": ${formatErr(err)}`,
      { cause: err },
    );
  }
  return validateAndNormalizeConfig(parsed, configPath);
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
      let content: string;
      try {
        content = await fs.promises.readFile(configPath, 'utf8');
      } catch (err: unknown) {
        throw new UnpeekError(
          'ERR_CONFIG_LOAD',
          `Failed to read configuration at "${configPath}": ${formatErr(err)}`,
          { cause: err },
        );
      }
      parsedConfig = parseJsonConfig(content, configPath);
    } else {
      let raw: unknown;
      try {
        const fileUrl = pathToFileURL(configPath).href;
        const mod: unknown = await import(fileUrl);
        raw = isRecord(mod) && 'default' in mod ? mod.default : mod;
        if (typeof raw === 'function') {
          raw = await (raw as () => unknown)();
        }
        raw = unwrapDefaultExport(raw);
      } catch (importErr: unknown) {
        try {
          const req = createRequire(configPath);
          let cjsRaw: unknown = req(configPath);
          cjsRaw = unwrapDefaultExport(cjsRaw);
          if (typeof cjsRaw === 'function') {
            cjsRaw = await (cjsRaw as () => unknown)();
          }
          raw = cjsRaw;
        } catch {
          throw new UnpeekError(
            'ERR_CONFIG_LOAD',
            `Failed to load configuration at "${configPath}": ${formatErr(importErr)}`,
            { cause: importErr },
          );
        }
      }
      parsedConfig = validateAndNormalizeConfig(raw ?? {}, configPath);
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
      let content: string;
      try {
        content = readFileSync(configPath, 'utf8');
      } catch (err: unknown) {
        throw new UnpeekError(
          'ERR_CONFIG_LOAD',
          `Failed to read configuration at "${configPath}": ${formatErr(err)}`,
          { cause: err },
        );
      }
      parsedConfig = parseJsonConfig(content, configPath);
    } else {
      let raw: unknown;
      try {
        const req = createRequire(configPath);
        raw = unwrapDefaultExport(req(configPath));
        if (typeof raw === 'function') {
          raw = (raw as () => unknown)();
        }
      } catch (err: unknown) {
        const errCode = isRecord(err) ? err.code : undefined;
        if (errCode === 'ERR_REQUIRE_ESM') {
          throw new UnpeekError(
            'ERR_CONFIG_LOAD',
            `Synchronous loading of ESM configuration "${configPath}" is not supported by Node.js require(). Use loadUnpeekConfig() or CommonJS/JSON config format instead.`,
            { cause: err },
          );
        }
        throw new UnpeekError(
          'ERR_CONFIG_LOAD',
          `Failed to load configuration at "${configPath}": ${formatErr(err)}`,
          { cause: err },
        );
      }
      parsedConfig = validateAndNormalizeConfig(raw ?? {}, configPath);
    }
  }

  const baseConfig = mergeUnpeekConfig(DEFAULT_CONFIG, parsedConfig);
  return explicitConfig ? mergeUnpeekConfig(baseConfig, explicitConfig) : baseConfig;
}
