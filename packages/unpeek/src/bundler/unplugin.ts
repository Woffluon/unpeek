import { createUnplugin } from 'unplugin';
import type { ProtectOptions, UnpeekConfig } from '../types.js';
import { computeFnv1aHash, transformJavaScript } from '../ast/index.js';
import { generateRuntimeShield } from '../runtime/index.js';

export const unpeekPlugin = createUnplugin<ProtectOptions | undefined>((options = {}) => {
  const config: UnpeekConfig | undefined =
    options.config ??
    (('framework' in options ||
      'target' in options ||
      'vault' in options ||
      'hotPath' in options ||
      'mangler' in options ||
      'sourcemaps' in options)
      ? (options as UnpeekConfig)
      : undefined);

  const baseSeed =
    typeof options.seed === 'number'
      ? options.seed
      : Math.floor(Math.random() * 0x7fffffff) || 0x1337beef;
  const deterrentMode = options.deterrentMode ?? 'gradual';
  const injectRuntimeShield = options.injectRuntimeShield ?? true;
  const minStringLength = options.minStringLength ?? config?.vault?.minStringLength ?? 4;
  const aggressive = options.aggressive ?? false;

  return {
    name: 'unpeek',
    enforce: 'post',
    renderChunk(code: string, chunk: { fileName: string; isEntry?: boolean }) {
      const normalizedFileName = chunk.fileName.replace(/\\/g, '/');
      if (
        !normalizedFileName.endsWith('.js') &&
        !normalizedFileName.endsWith('.mjs') &&
        !normalizedFileName.endsWith('.cjs')
      ) {
        return null;
      }
      if (
        normalizedFileName.includes('server/') ||
        normalizedFileName.includes('ssr/') ||
        normalizedFileName.includes('node_modules/')
      ) {
        return null;
      }

      const shouldInjectShield = injectRuntimeShield;
      const chunkSeed = computeFnv1aHash(chunk.fileName, baseSeed);
      const result = transformJavaScript(code, {
        seed: chunkSeed,
        minStringLength,
        filename: chunk.fileName,
        injectRuntimeShield: shouldInjectShield,
        deterrentMode,
        aggressive,
        config,
      });

      let finalCode = result.code;
      if (shouldInjectShield) {
        const shield = generateRuntimeShield({
          seed: chunkSeed,
          deterrentMode,
          expectedIntegrityHash: result.integrityToken,
        });
        if (
          shield.preambleCode &&
          !finalCode.includes('(function _u$') &&
          !finalCode.includes(shield.integrityCheckFnName) &&
          !finalCode.startsWith(shield.preambleCode)
        ) {
          finalCode = `${shield.preambleCode}\n${finalCode}`;
        }
      }

      return {
        code: finalCode,
        map: null,
      };
    },
  };
});

export const vitePlugin = unpeekPlugin.vite;
export const webpackPlugin = unpeekPlugin.webpack;
export const rollupPlugin = unpeekPlugin.rollup;
export const esbuildPlugin = unpeekPlugin.esbuild;

export default unpeekPlugin;
