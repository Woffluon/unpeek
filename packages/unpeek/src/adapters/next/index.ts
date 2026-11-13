import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { ProtectOptions, ProtectSummary } from '../../core/types.js';
import type { UnpeekConfig } from '../../config.js';
import { protectProject } from '../../core/protect.js';
import { computeFnv1aHash } from '../../shared/hash.js';
import { UnpeekError } from '../../shared/errors.js';
import { serializeNextOptions } from '../../internal/next.js';

const MAX_NEXT_OPTIONS_ENV_BYTES = 32_767;

export interface NextStaticFileOutput {
  filePath?: string;
  path?: string;
  immutableHash?: string;
  size?: number;
  [key: string]: unknown;
}

export interface NextConfigObject {
  adapterPath?: string;
  [key: string]: unknown;
}

export type NextConfigFunction<
  TArgs extends readonly unknown[] = readonly [
    phase: string,
    ctx?: { defaultConfig: NextConfigObject },
  ],
  TResult extends NextConfigObject = NextConfigObject,
> = (...args: TArgs) => TResult | Promise<TResult>;

export type NextConfigLike = NextConfigObject | NextConfigFunction<never[], NextConfigObject>;

export interface NextAdapterContext {
  distDir: string;
  buildId?: string;
  phase?: string;
  config?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  outputs?: {
    staticFiles?:
      | NextStaticFileOutput[]
      | Map<string, NextStaticFileOutput>
      | Record<string, NextStaticFileOutput>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UnpeekNextAdapterOptions extends ProtectOptions {
  upstreamAdapterPath?: string;
  config?: UnpeekConfig;
}

export interface UnpeekNextAdapter {
  name: string;
  modifyConfig?: (
    config: NextConfigObject,
    context?: Record<string, unknown>
  ) => Promise<NextConfigObject> | NextConfigObject;
  onBuildComplete: (context: NextAdapterContext) => Promise<ProtectSummary>;
}

interface UpstreamNextAdapter {
  modifyConfig?: (
    config: NextConfigObject,
    context?: Record<string, unknown>
  ) => Promise<NextConfigObject> | NextConfigObject;
  onBuildComplete?: (context: NextAdapterContext) => Promise<unknown> | unknown;
}

type UpstreamAdapterModule =
  | UpstreamNextAdapter
  | ((context: NextAdapterContext) => Promise<unknown> | unknown)
  | undefined;

async function loadUpstreamAdapter(adapterPath: string): Promise<UpstreamAdapterModule> {
  const resolved = path.isAbsolute(adapterPath)
    ? adapterPath
    : path.resolve(process.cwd(), adapterPath);

  try {
    const mod = (await import(pathToFileURL(resolved).href)) as {
      default?: UpstreamAdapterModule;
    } & UpstreamNextAdapter;
    return mod.default ?? mod;
  } catch {
    const req = createRequire(import.meta.url);
    const mod = req(resolved) as {
      default?: UpstreamAdapterModule;
    } & UpstreamNextAdapter;
    return mod.default ?? mod;
  }
}

function recomputeHash(content: Buffer, existingHash?: string): string {
  const len = existingHash?.length;
  const algo = len === 64 ? 'sha256' : len === 40 ? 'sha1' : len === 32 ? 'md5' : 'sha256';
  return crypto.createHash(algo).update(content).digest('hex');
}

function isNonProductionPhase(phase?: string): boolean {
  return (
    phase !== undefined &&
    phase !== 'phase-production-build' &&
    phase !== 'phase-export'
  );
}

async function delegateToUpstreamOnBuildComplete(
  upstreamPath: string | undefined,
  context: NextAdapterContext
): Promise<void> {
  if (!upstreamPath) return;
  try {
    const upstream = await loadUpstreamAdapter(upstreamPath);
    if (
      upstream &&
      typeof upstream !== 'function' &&
      typeof upstream.onBuildComplete === 'function'
    ) {
      await upstream.onBuildComplete(context);
    } else if (typeof upstream === 'function') {
      await upstream(context);
    }
  } catch (err) {
    console.warn('[unpeek:next] Failed to delegate to upstream adapter onBuildComplete:', err);
  }
}

export function createUnpeekNextAdapter(
  options: UnpeekNextAdapterOptions = {}
): UnpeekNextAdapter {
  const upstreamPath =
    options.upstreamAdapterPath ||
    process.env.UNPEEK_UPSTREAM_ADAPTER_PATH ||
    process.env.NEXT_ADAPTER_PATH;
  let recordedPhase: string | undefined;

  return {
    name: 'unpeek',

    async modifyConfig(config: NextConfigObject, context?: Record<string, unknown>) {
      if (context && typeof context.phase === 'string') {
        recordedPhase = context.phase;
      }
      if (upstreamPath) {
        try {
          const upstream = await loadUpstreamAdapter(upstreamPath);
          if (
            upstream &&
            typeof upstream !== 'function' &&
            typeof upstream.modifyConfig === 'function'
          ) {
            config = await upstream.modifyConfig(config, context);
          }
        } catch (err) {
          console.warn('[unpeek:next] Failed to invoke upstream modifyConfig:', err);
        }
      }
      return config;
    },

    async onBuildComplete(context: NextAdapterContext): Promise<ProtectSummary> {
      const cwd = options.cwd ?? process.cwd();
      const distDir = path.resolve(cwd, context.distDir || '.next');

      // Client bundles live under distDir/static (chunks, immutable, etc.)
      // Server/SSR bundles are under distDir/server and distDir/ssr - these MUST NOT be modified.
      const staticDir = path.join(distDir, 'static');
      const targetDir = fs.existsSync(staticDir) ? staticDir : distDir;

      const phase = context.phase ?? recordedPhase;
      if (isNonProductionPhase(phase)) {
        await delegateToUpstreamOnBuildComplete(upstreamPath, context);
        return {
          framework: 'nextjs',
          outDir: targetDir,
          processedFiles: 0,
          movedSourceMaps: 0,
          originalBytes: 0,
          protectedBytes: 0,
          originalGzipBytes: 0,
          protectedGzipBytes: 0,
          gzipDeltaPercent: 0,
          totalHotFunctionsSkipped: 0,
          totalColdFunctionsProtected: 0,
          totalEncryptedStrings: 0,
          totalMangledSymbols: 0,
          elapsedMs: 0,
        };
      }

      // Deterministic seed based on Next.js buildId if not explicitly provided
      const deterministicSeed =
        typeof options.seed === 'number'
          ? options.seed
          : context.buildId
            ? computeFnv1aHash(context.buildId, 0x5f3759df)
            : 0x5f3759df;

      const summary = await protectProject({
        ...options,
        cwd,
        outDir: targetDir,
        seed: deterministicSeed,
      });

      // Update immutable hashes for modified client assets in Next.js 16 outputs
      if (context.outputs?.staticFiles) {
        const rawStatic = context.outputs.staticFiles;
        const fileList: NextStaticFileOutput[] = Array.isArray(rawStatic)
          ? rawStatic
          : rawStatic instanceof Map
            ? Array.from(rawStatic.values())
            : typeof rawStatic === 'object'
              ? Object.values(rawStatic)
              : [];

        for (const item of fileList) {
          if (!item || typeof item !== 'object') continue;
          const rawFilePath: string | undefined = item.filePath ?? item.path;
          if (!rawFilePath) continue;

          let absPath = path.isAbsolute(rawFilePath)
            ? rawFilePath
            : path.resolve(cwd, rawFilePath);

          if (!fs.existsSync(absPath)) {
            const relClean = rawFilePath.replace(/\\/g, '/').replace(/^\/?(?:_next\/|\.next\/)/, '');
            const fromDist = path.resolve(distDir, relClean);
            if (fs.existsSync(fromDist)) {
              absPath = fromDist;
            } else {
              const staticClean = relClean.replace(/^static\//, '');
              const fromStatic = path.resolve(distDir, 'static', staticClean);
              if (fs.existsSync(fromStatic)) {
                absPath = fromStatic;
              }
            }
          }

          if (fs.existsSync(absPath)) {
            const ext = path.extname(absPath).toLowerCase();
            if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
              try {
                const buf = fs.readFileSync(absPath);
                if (item.immutableHash) {
                  item.immutableHash = recomputeHash(buf, item.immutableHash);
                }
                if (typeof item.size === 'number') {
                  item.size = buf.byteLength;
                }
              } catch {
                // Ignore read errors
              }
            }
          }
        }
      }

      // Delegate to upstream platform adapter (e.g. Vercel's NEXT_ADAPTER_PATH or user adapterPath)
      await delegateToUpstreamOnBuildComplete(upstreamPath, context);

      return summary;
    },
  };
}

export function getUnpeekAdapterPath(): string {
  try {
    const req = typeof require !== 'undefined' ? require : createRequire(import.meta.url);
    try {
      const resolved = req.resolve('unpeek/next/adapter');
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // ignore
    }

    const isCjs = typeof __dirname !== 'undefined';
    const currentDir = isCjs ? __dirname : path.dirname(fileURLToPath(import.meta.url));

    const candidates = [
      path.resolve(currentDir, isCjs ? 'adapters/next/adapter.cjs' : 'adapters/next/adapter.js'),
      path.resolve(currentDir, isCjs ? 'adapters/next/adapter.js' : 'adapters/next/adapter.cjs'),
      path.resolve(currentDir, isCjs ? 'adapter.cjs' : 'adapter.js'),
      path.resolve(currentDir, isCjs ? 'adapter.js' : 'adapter.cjs'),
      path.resolve(currentDir, '../dist/adapters/next/adapter.cjs'),
      path.resolve(currentDir, '../dist/adapters/next/adapter.js'),
      path.resolve(process.cwd(), 'node_modules/unpeek/dist/adapters/next/adapter.cjs'),
      path.resolve(process.cwd(), 'node_modules/unpeek/dist/adapters/next/adapter.js'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    return candidates[0];
  } catch {
    return path.resolve(process.cwd(), 'node_modules/unpeek/dist/adapters/next/adapter.js');
  }
}

function applyWithUnpeek<T extends NextConfigObject>(
  config: T = {} as T,
  options?: UnpeekNextAdapterOptions
): T & { adapterPath: string } {
  const existingAdapter = config.adapterPath || process.env.NEXT_ADAPTER_PATH;
  if (existingAdapter && !process.env.UNPEEK_UPSTREAM_ADAPTER_PATH) {
    process.env.UNPEEK_UPSTREAM_ADAPTER_PATH = existingAdapter;
  }
  if (options?.upstreamAdapterPath) {
    process.env.UNPEEK_UPSTREAM_ADAPTER_PATH = options.upstreamAdapterPath;
  }

  if (options) {
    const serialized = serializeNextOptions(options);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    if (byteLength > MAX_NEXT_OPTIONS_ENV_BYTES) {
      throw new UnpeekError(
        'ERR_NEXT_ADAPTER',
        `Serialized UNPEEK_NEXT_OPTIONS (${byteLength} bytes) exceeds the ${MAX_NEXT_OPTIONS_ENV_BYTES}-byte process.env limit.`
      );
    }
    process.env.UNPEEK_NEXT_OPTIONS = serialized;
  } else {
    delete process.env.UNPEEK_NEXT_OPTIONS;
  }

  const adapterPath = getUnpeekAdapterPath();

  return {
    ...config,
    adapterPath,
  };
}

export function withUnpeek<T extends NextConfigObject = NextConfigObject>(
  nextConfig?: T,
  options?: UnpeekNextAdapterOptions
): T & { adapterPath: string };
export function withUnpeek<
  TArgs extends readonly unknown[],
  TResult extends NextConfigObject,
>(
  nextConfig: (...args: TArgs) => TResult | Promise<TResult>,
  options?: UnpeekNextAdapterOptions
): (...args: TArgs) => Promise<TResult & { adapterPath: string }>;
export function withUnpeek<
  T extends NextConfigObject,
  TArgs extends readonly unknown[],
  TResult extends NextConfigObject,
>(
  nextConfig: T | ((...args: TArgs) => TResult | Promise<TResult>) = {} as T,
  options?: UnpeekNextAdapterOptions
):
  | (T & { adapterPath: string })
  | ((...args: TArgs) => Promise<TResult & { adapterPath: string }>) {
  if (typeof nextConfig === 'function') {
    return async (...args: TArgs): Promise<TResult & { adapterPath: string }> => {
      const resolved = await nextConfig(...args);
      const phase = typeof args[0] === 'string' ? args[0] : undefined;
      if (isNonProductionPhase(phase)) {
        return resolved as TResult & { adapterPath: string };
      }
      return applyWithUnpeek(resolved, options);
    };
  }

  return applyWithUnpeek(nextConfig, options);
}
