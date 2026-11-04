import { createUnplugin } from 'unplugin';
import type { ProtectOptions } from '../types.js';
import { computeFnv1aHash, transformJavaScript } from '../ast/index.js';
import { generateRuntimeShield } from '../runtime/index.js';

export const unpeekPlugin = createUnplugin<ProtectOptions | undefined>((options = {}) => {
  const baseSeed =
    typeof options.seed === 'number'
      ? options.seed
      : Math.floor(Math.random() * 0x7fffffff) || 0x1337beef;
  const deterrentMode = options.deterrentMode ?? 'gradual';
  const injectRuntimeShield = options.injectRuntimeShield ?? true;
  const minStringLength = options.minStringLength ?? 4;

  return {
    name: 'unpeek',
    enforce: 'post',
    renderChunk(code: string, chunk: { fileName: string; isEntry?: boolean }) {
      if (!chunk.fileName.endsWith('.js') && !chunk.fileName.endsWith('.mjs')) {
        return null;
      }
      if (
        chunk.fileName.includes('server/') ||
        chunk.fileName.includes('ssr/') ||
        chunk.fileName.includes('node_modules/')
      ) {
        return null;
      }

      const shouldInjectShield = injectRuntimeShield && (chunk.isEntry ?? true);
      const chunkSeed = computeFnv1aHash(chunk.fileName, baseSeed);
      const result = transformJavaScript(code, {
        seed: chunkSeed,
        minStringLength,
        filename: chunk.fileName,
        injectRuntimeShield: shouldInjectShield,
        deterrentMode,
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
