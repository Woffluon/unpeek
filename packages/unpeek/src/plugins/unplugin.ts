import fs from 'node:fs';
import path from 'node:path';
import { createUnplugin } from 'unplugin';
import type { UnpeekConfig, UnpeekPluginOptions } from '../config.js';
import type {
  InternalShieldPayload,
  InternalTransformOptions,
} from '../internal/types.js';
import { transformJavaScript } from '../ast/index.js';
import { computeFnv1aHash } from '../shared/hash.js';
import { generateRuntimeShield } from '../runtime/index.js';
import { deriveWindowKeySymbol } from '../internal/runtime.js';
import {
  extractDebugId,
  replaceOrAppendDebugId,
  stripDebugIdComments,
  stripSourceMapComments,
} from '../core/sourcemap-vault.js';
import {
  type AnySourceMap,
  type RawSourceMap,
  chainSourceMaps,
  computeDeterministicDebugId,
  flattenSourceMapSections,
  shiftSourceMapLines,
} from '../core/vlq.js';

const ENTRY_CHUNK_PATTERN =
  /(?:^|\/)(?:webpack|main|index|runtime|turbopack|pages\/_app|pages\/index)(?:[-._/]|$)/i;
const SW_OR_WORKBOX_PATTERN =
  /(?:^|\/)(?:sw|service-worker|workbox-[^/]+)\.(?:js|mjs|cjs)$|\.worker\.min\.(?:js|mjs|cjs)$/i;

function isSupportedJsAsset(fileName: string): boolean {
  const clean = fileName.replace(/\\/g, '/').split('?')[0].split('#')[0].toLowerCase();
  return clean.endsWith('.js') || clean.endsWith('.mjs') || clean.endsWith('.cjs');
}

function isExcludedClientAsset(fileName: string, config?: UnpeekConfig): boolean {
  const norm = fileName.replace(/\\/g, '/').split('?')[0].split('#')[0];
  if (
    norm.includes('server/') ||
    norm.includes('ssr/') ||
    norm.includes('node_modules/')
  ) {
    return true;
  }
  if (config?.target !== 'worker' && SW_OR_WORKBOX_PATTERN.test(norm)) {
    return true;
  }
  return false;
}

function createWebpackRawSource(sources: any, content: string): any {
  if (sources && typeof sources.RawSource === 'function') {
    return new sources.RawSource(content);
  }
  return {
    source: () => content,
    buffer: () => Buffer.from(content, 'utf8'),
    size: () => Buffer.byteLength(content, 'utf8'),
    map: () => null,
    sourceAndMap: () => ({ source: content, map: null }),
    updateHash: (hash: { update: (data: string) => void }) => {
      hash.update(content);
    },
  };
}

export const unpeekPlugin = createUnplugin<UnpeekPluginOptions | undefined>((options = {}) => {
  const config: UnpeekConfig | undefined = options.config;

  const baseSeed =
    typeof options.seed === 'number'
      ? options.seed
      : Math.floor(Math.random() * 0x7fffffff) || 0x1337beef;
  const deterrentMode = options.deterrentMode ?? config?.shield?.deterrentMode ?? 'passive';
  const detectHeadless = options.detectHeadless ?? config?.shield?.detectHeadless ?? false;
  const injectRuntimeShield = options.injectRuntimeShield ?? true;
  const minStringLength = options.minStringLength ?? config?.vault?.minStringLength ?? 4;
  const aggressive = options.aggressive ?? false;

  const masterSym = deriveWindowKeySymbol(baseSeed);
  const masterShield = injectRuntimeShield
    ? generateRuntimeShield({
        seed: baseSeed,
        deterrentMode,
        detectHeadless,
        windowKeySymbol: masterSym,
      })
    : undefined;

  const transformChunk = (
    rawCode: string,
    fileName: string,
    isEntry: boolean,
    inputMap?: AnySourceMap,
    requestMap = false
  ): { code: string; map: RawSourceMap | null } | null => {
    const normalizedFileName = fileName.replace(/\\/g, '/').split('?')[0].split('#')[0];
    if (!isSupportedJsAsset(normalizedFileName) || isExcludedClientAsset(normalizedFileName, config)) {
      return null;
    }

    const fileDebugId = extractDebugId(rawCode);
    const shouldStripComments = config?.sourcemaps?.stripComments !== false;
    let codeToTransform = rawCode;
    if (shouldStripComments && rawCode.includes('sourceMappingURL=')) {
      codeToTransform = stripSourceMapComments(rawCode).code;
    }

    const shouldInjectShield = injectRuntimeShield && isEntry;
    const chunkSeed = computeFnv1aHash(fileName, baseSeed);
    const transformOptions: InternalTransformOptions = {
      seed: chunkSeed,
      minStringLength,
      filename: fileName,
      injectRuntimeShield: shouldInjectShield,
      skipShieldPreamble: true,
      shieldCoupled: injectRuntimeShield,
      windowKeySymbol: masterSym,
      expectedDelta: masterShield?.expectedDelta,
      deterrentMode,
      detectHeadless,
      aggressive,
      config,
    };
    (transformOptions as { generateMap?: boolean; rootDir?: string }).generateMap =
      requestMap || Boolean(inputMap);
    (transformOptions as { generateMap?: boolean; rootDir?: string }).rootDir = process.cwd();

    const result = transformJavaScript(codeToTransform, transformOptions);

    let finalCode = result.code;
    let preambleLineOffset = 0;
    const integrityCheckFnName =
      masterShield && 'integrityCheckFnName' in masterShield
        ? (masterShield as InternalShieldPayload).integrityCheckFnName
        : undefined;
    if (
      shouldInjectShield &&
      masterShield?.preambleCode &&
      !finalCode.includes('(function _u$') &&
      (!integrityCheckFnName || !finalCode.includes(integrityCheckFnName)) &&
      !finalCode.startsWith(masterShield.preambleCode)
    ) {
      const prefix = `${masterShield.preambleCode}\n`;
      preambleLineOffset = (prefix.match(/\n/g) ?? []).length;
      finalCode = `${prefix}${finalCode}`;
    }

    const rawTransformMap = (result as { sourceMap?: RawSourceMap }).sourceMap;
    const shiftedTransformMap = rawTransformMap
      ? shiftSourceMapLines(rawTransformMap, preambleLineOffset)
      : undefined;

    let composedMap: RawSourceMap | null = null;
    if (shiftedTransformMap && inputMap) {
      composedMap = chainSourceMaps(shiftedTransformMap, inputMap);
    } else if (shiftedTransformMap) {
      composedMap = shiftedTransformMap;
    } else if (inputMap) {
      composedMap = flattenSourceMapSections(inputMap);
    }

    const inputMapDebugId = inputMap?.debugId ?? inputMap?.debug_id;
    const hadDebugId = Boolean(fileDebugId || inputMapDebugId || result.debugId);
    if (hadDebugId) {
      const codeWithoutDebugId = stripDebugIdComments(finalCode);
      const mintedDebugId = computeDeterministicDebugId(
        codeWithoutDebugId,
        composedMap?.mappings ?? ''
      );
      finalCode = replaceOrAppendDebugId(codeWithoutDebugId, mintedDebugId);
      if (composedMap) {
        composedMap.debugId = mintedDebugId;
        delete composedMap.debug_id;
      }
    }

    if (composedMap) {
      if (!Object.prototype.hasOwnProperty.call(composedMap, 'toString')) {
        Object.defineProperty(composedMap, 'toString', {
          enumerable: false,
          configurable: true,
          value() {
            return JSON.stringify(this);
          },
        });
      }
    }

    return {
      code: finalCode,
      map: composedMap,
    };
  };

  const renderChunkHandler = (code: string, chunk: { fileName: string; isEntry?: boolean }) => {
    const normalizedFileName = chunk.fileName.replace(/\\/g, '/').split('?')[0].split('#')[0];
    const isEntry =
      chunk.isEntry !== undefined
        ? chunk.isEntry
        : ENTRY_CHUNK_PATTERN.test(normalizedFileName);
    const res = transformChunk(code, chunk.fileName, isEntry, undefined, true);
    if (!res) {
      return null;
    }
    return {
      code: res.code,
      map: (res.map as any) ?? null,
    };
  };

  const attachWebpackLikeProcessAssets = (compiler: any, framework: 'webpack' | 'rspack') => {
    compiler.hooks.thisCompilation.tap('unpeek', (compilation: any) => {
      const stage =
        (framework === 'rspack'
          ? compiler.rspack?.Compilation?.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE
          : compiler.webpack?.Compilation?.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE) ?? 700;

      compilation.hooks.processAssets.tap(
        { name: 'unpeek', stage },
        (assets: Record<string, any>) => {
          const entryFiles = new Set<string>();
          if (compilation.entrypoints && typeof compilation.entrypoints.values === 'function') {
            for (const ep of compilation.entrypoints.values()) {
              if (ep && typeof ep.getFiles === 'function') {
                for (const f of ep.getFiles()) {
                  entryFiles.add(String(f).replace(/\\/g, '/').split('?')[0]);
                }
              }
            }
          }
          if (compilation.chunks) {
            for (const chunk of compilation.chunks) {
              const chunkIsEntry =
                (typeof chunk.hasRuntime === 'function' && chunk.hasRuntime()) ||
                (typeof chunk.canBeInitial === 'function' && chunk.canBeInitial());
              if (chunkIsEntry && chunk.files) {
                for (const f of chunk.files) {
                  entryFiles.add(String(f).replace(/\\/g, '/').split('?')[0]);
                }
              }
            }
          }

          const sources =
            (framework === 'rspack' ? compiler.rspack?.sources : compiler.webpack?.sources) ??
            compiler.webpack?.sources ??
            compiler.rspack?.sources;

          for (const assetName of Object.keys(assets)) {
            const normalizedName = assetName.replace(/\\/g, '/').split('?')[0];
            if (!isSupportedJsAsset(normalizedName) || isExcludedClientAsset(normalizedName, config)) {
              continue;
            }

            const existingAsset =
              typeof compilation.getAsset === 'function'
                ? compilation.getAsset(assetName)
                : { source: assets[assetName] };
            const sourceObj = existingAsset?.source ?? assets[assetName];
            if (!sourceObj) continue;

            const rawContent =
              typeof sourceObj.source === 'function' ? sourceObj.source() : sourceObj;
            const code = Buffer.isBuffer(rawContent)
              ? rawContent.toString('utf8')
              : String(rawContent);

            const mapAssetName = `${assetName}.map`;
            const mapSourceObj = assets[mapAssetName];
            let inputMap: AnySourceMap | undefined;
            if (mapSourceObj) {
              try {
                const rawMap =
                  typeof mapSourceObj.source === 'function'
                    ? mapSourceObj.source()
                    : mapSourceObj;
                const mapStr = Buffer.isBuffer(rawMap) ? rawMap.toString('utf8') : String(rawMap);
                inputMap = JSON.parse(mapStr) as AnySourceMap;
              } catch {
                // ignore malformed map JSON
              }
            } else if (typeof sourceObj.map === 'function') {
              try {
                const m = sourceObj.map();
                if (m && typeof m === 'object') {
                  inputMap = m as AnySourceMap;
                }
              } catch {
                // ignore map() failures
              }
            }

            const isEntry =
              entryFiles.size > 0
                ? entryFiles.has(normalizedName) || ENTRY_CHUNK_PATTERN.test(normalizedName)
                : ENTRY_CHUNK_PATTERN.test(normalizedName);

            const res = transformChunk(code, assetName, isEntry, inputMap, Boolean(inputMap));
            if (!res) continue;

            const newSource = createWebpackRawSource(sources, res.code);
            if (typeof compilation.updateAsset === 'function') {
              compilation.updateAsset(assetName, newSource);
            } else {
              assets[assetName] = newSource;
            }

            if (res.map && mapSourceObj) {
              const newMapSource = createWebpackRawSource(sources, JSON.stringify(res.map));
              if (typeof compilation.updateAsset === 'function') {
                compilation.updateAsset(mapAssetName, newMapSource);
              } else {
                assets[mapAssetName] = newMapSource;
              }
            }
          }
        }
      );
    });
  };

  return {
    name: 'unpeek',
    enforce: 'post',
    // Preserved at top-level for direct unpeekPlugin.raw() unit test compatibility and Rollup
    renderChunk: renderChunkHandler,
    rollup: {
      renderChunk: renderChunkHandler,
    },
    vite: {
      enforce: 'post',
      apply: 'build',
      renderChunk: undefined,
      config(userConfig: any) {
        if (config?.target === 'worker') {
          return undefined;
        }
        const existingWorkerPlugins = userConfig?.worker?.plugins;
        return {
          worker: {
            plugins: () => {
              const resolved =
                typeof existingWorkerPlugins === 'function'
                  ? existingWorkerPlugins()
                  : Array.isArray(existingWorkerPlugins)
                    ? existingWorkerPlugins
                    : [];
              const flat = (Array.isArray(resolved) ? resolved : [resolved])
                .flat(Infinity)
                .filter(Boolean) as Array<{ name?: string }>;
              if (flat.some((p) => p && p.name === 'unpeek')) {
                return flat;
              }
              return [
                ...flat,
                vitePlugin({
                  ...options,
                  seed: baseSeed,
                  config: {
                    ...(config ?? {}),
                    target: 'worker',
                  },
                }),
              ];
            },
          },
        };
      },
      generateBundle(_outputOptions: unknown, bundle: Record<string, any>) {
        for (const [fileName, item] of Object.entries(bundle)) {
          if (!item || item.type !== 'chunk') continue;
          const normalizedFileName = fileName.replace(/\\/g, '/').split('?')[0].split('#')[0];
          if (!isSupportedJsAsset(normalizedFileName) || isExcludedClientAsset(normalizedFileName, config)) {
            continue;
          }

          const mapAssetKey = `${fileName}.map`;
          const mapAsset = bundle[mapAssetKey];
          let inputMap: AnySourceMap | undefined =
            item.map && typeof item.map === 'object' ? (item.map as AnySourceMap) : undefined;
          if (!inputMap && mapAsset && mapAsset.type === 'asset') {
            try {
              const rawMapStr =
                typeof mapAsset.source === 'string'
                  ? mapAsset.source
                  : Buffer.from(mapAsset.source).toString('utf8');
              inputMap = JSON.parse(rawMapStr) as AnySourceMap;
            } catch {
              // ignore malformed map JSON
            }
          }

          const isEntry =
            typeof item.isEntry === 'boolean'
              ? item.isEntry
              : ENTRY_CHUNK_PATTERN.test(normalizedFileName);
          const res = transformChunk(item.code, fileName, isEntry, inputMap, Boolean(inputMap));
          if (!res) continue;

          item.code = res.code;
          if (res.map) {
            item.map = res.map as any;
            if (mapAsset && mapAsset.type === 'asset') {
              mapAsset.source = JSON.stringify(res.map);
            }
          }
        }
      },
    } as any,
    webpack(compiler) {
      attachWebpackLikeProcessAssets(compiler, 'webpack');
    },
    rspack(compiler) {
      attachWebpackLikeProcessAssets(compiler, 'rspack');
    },
    esbuild: {
      config(buildOptions) {
        buildOptions.metafile = true;
      },
      setup(build) {
        build.onEnd(async (result) => {
          const workDir = build.initialOptions.absWorkingDir ?? process.cwd();
          const entryOutputs = new Set<string>();
          if (result.metafile?.outputs) {
            for (const [outKey, meta] of Object.entries(result.metafile.outputs)) {
              if (meta && meta.entryPoint) {
                entryOutputs.add(path.resolve(workDir, outKey));
                entryOutputs.add(outKey.replace(/\\/g, '/'));
              }
            }
          }

          if (Array.isArray(result.outputFiles) && result.outputFiles.length > 0) {
            const mapFilesByPath = new Map<string, (typeof result.outputFiles)[number]>();
            for (const outFile of result.outputFiles) {
              if (outFile.path.endsWith('.map')) {
                mapFilesByPath.set(outFile.path, outFile);
              }
            }

            const jsOutCount = result.outputFiles.filter((f) => isSupportedJsAsset(f.path)).length;
            for (const outFile of result.outputFiles) {
              const normPath = outFile.path.replace(/\\/g, '/');
              if (!isSupportedJsAsset(normPath) || isExcludedClientAsset(normPath, config)) {
                continue;
              }

              const mapFile = mapFilesByPath.get(`${outFile.path}.map`);
              let inputMap: AnySourceMap | undefined;
              if (mapFile) {
                try {
                  inputMap = JSON.parse(mapFile.text) as AnySourceMap;
                } catch {
                  // ignore malformed map
                }
              }

              const relFromWork = path.relative(workDir, outFile.path).replace(/\\/g, '/');
              const isEntry =
                entryOutputs.size > 0
                  ? entryOutputs.has(outFile.path) ||
                    entryOutputs.has(relFromWork) ||
                    ENTRY_CHUNK_PATTERN.test(relFromWork)
                  : ENTRY_CHUNK_PATTERN.test(relFromWork) || jsOutCount === 1;

              const res = transformChunk(
                outFile.text,
                relFromWork || path.basename(outFile.path),
                isEntry,
                inputMap,
                Boolean(inputMap)
              );
              if (!res) continue;

              outFile.contents = Buffer.from(res.code, 'utf8');
              if (res.map && mapFile) {
                mapFile.contents = Buffer.from(JSON.stringify(res.map), 'utf8');
              }
            }
            return;
          }

          const diskOutputs = new Set<string>();
          if (result.metafile?.outputs) {
            for (const outKey of Object.keys(result.metafile.outputs)) {
              const abs = path.resolve(workDir, outKey);
              if (isSupportedJsAsset(abs)) {
                diskOutputs.add(abs);
              }
            }
          } else if (build.initialOptions.outfile) {
            const abs = path.resolve(workDir, build.initialOptions.outfile);
            if (isSupportedJsAsset(abs)) {
              diskOutputs.add(abs);
            }
          }

          const diskArr = Array.from(diskOutputs);
          for (const absPath of diskArr) {
            const relFromWork = path.relative(workDir, absPath).replace(/\\/g, '/');
            if (isExcludedClientAsset(relFromWork, config)) continue;
            if (!fs.existsSync(absPath)) continue;

            const code = fs.readFileSync(absPath, 'utf8');
            const mapPath = `${absPath}.map`;
            let inputMap: AnySourceMap | undefined;
            if (fs.existsSync(mapPath)) {
              try {
                inputMap = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as AnySourceMap;
              } catch {
                // ignore malformed map
              }
            }

            const isEntry =
              entryOutputs.size > 0
                ? entryOutputs.has(absPath) ||
                  entryOutputs.has(relFromWork) ||
                  ENTRY_CHUNK_PATTERN.test(relFromWork)
                : ENTRY_CHUNK_PATTERN.test(relFromWork) || diskArr.length === 1;

            const res = transformChunk(
              code,
              relFromWork || path.basename(absPath),
              isEntry,
              inputMap,
              Boolean(inputMap)
            );
            if (!res) continue;

            fs.writeFileSync(absPath, res.code, 'utf8');
            if (res.map && fs.existsSync(mapPath)) {
              fs.writeFileSync(mapPath, JSON.stringify(res.map), 'utf8');
            }
          }
        });
      },
    },
  };
});

export const vitePlugin = unpeekPlugin.vite;
export const webpackPlugin = unpeekPlugin.webpack;
export const rollupPlugin = unpeekPlugin.rollup;
export const esbuildPlugin = unpeekPlugin.esbuild;
export const rspackPlugin = unpeekPlugin.rspack;

export default unpeekPlugin;
