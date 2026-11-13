import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { ProtectOptions, ProtectSummary, UnpeekConfig } from '../types.js';
import { protectProject } from '../core/protect.js';
import { computeFnv1aHash } from '../shared/hash.js';

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

export type NextConfigLike =
  | NextConfigObject
  | ((...args: never[]) => NextConfigObject | Promise<NextConfigObject>);

export interface NextAdapterContext {
  distDir: string;
  buildId?: string;
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

export function createUnpeekNextAdapter(
  options: UnpeekNextAdapterOptions = {}
): UnpeekNextAdapter {
  const upstreamPath =
    options.upstreamAdapterPath ||
    process.env.UNPEEK_UPSTREAM_ADAPTER_PATH ||
    process.env.NEXT_ADAPTER_PATH;

  return {
    name: 'unpeek',

    async modifyConfig(config: NextConfigObject, context?: Record<string, unknown>) {
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
      if (upstreamPath) {
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
      path.resolve(currentDir, isCjs ? 'next/adapter.cjs' : 'next/adapter.js'),
      path.resolve(currentDir, isCjs ? 'next/adapter.js' : 'next/adapter.cjs'),
      path.resolve(currentDir, isCjs ? 'adapter.cjs' : 'adapter.js'),
      path.resolve(currentDir, isCjs ? 'adapter.js' : 'adapter.cjs'),
      path.resolve(currentDir, '../dist/next/adapter.cjs'),
      path.resolve(currentDir, '../dist/next/adapter.js'),
      path.resolve(process.cwd(), 'node_modules/unpeek/dist/next/adapter.cjs'),
      path.resolve(process.cwd(), 'node_modules/unpeek/dist/next/adapter.js'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    return candidates[0];
  } catch {
    return path.resolve(process.cwd(), 'node_modules/unpeek/dist/next/adapter.js');
  }
}

export function readUnpeekNextOptionsFromEnv(): UnpeekNextAdapterOptions | undefined {
  const raw = process.env.UNPEEK_NEXT_OPTIONS;
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as UnpeekNextAdapterOptions;
    }
  } catch {
    // Ignore malformed UNPEEK_NEXT_OPTIONS JSON
  }
  return undefined;
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
    process.env.UNPEEK_NEXT_OPTIONS = JSON.stringify(options);
  } else {
    delete process.env.UNPEEK_NEXT_OPTIONS;
  }

  const adapterPath = getUnpeekAdapterPath();

  return {
    ...config,
    adapterPath,
  };
}

export function withUnpeek<T extends NextConfigLike = NextConfigObject>(
  nextConfig: T = {} as T,
  options?: UnpeekNextAdapterOptions
): T {
  if (typeof nextConfig === 'function') {
    return (async (...args: never[]) => {
      const resolved = await nextConfig(...args);
      return applyWithUnpeek(resolved, options);
    }) as unknown as T;
  }

  return applyWithUnpeek(nextConfig, options) as unknown as T;
}
