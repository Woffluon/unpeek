import { createUnplugin } from 'unplugin';
import type { ProtectOptions, UnpeekConfig } from '../types.js';
import { computeFnv1aHash, transformJavaScript } from '../ast/index.js';
import { deriveWindowKeySymbol, generateRuntimeShield } from '../runtime/index.js';

const ENTRY_CHUNK_PATTERN = /(?:^|\/)(?:webpack|main|index|runtime|turbopack|pages\/_app|pages\/index)(?:[-._/]|$)/i;

export const unpeekPlugin = createUnplugin<ProtectOptions | undefined>((options = {}) => {
  const config: UnpeekConfig | undefined =
    options.config ??
    (('framework' in options ||
      'target' in options ||
      'vault' in options ||
      'hotPath' in options ||
      'mangler' in options ||
      'shield' in options ||
      'sourcemaps' in options)
      ? (options as UnpeekConfig)
      : undefined);

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

      const isEntry =
        chunk.isEntry !== undefined
          ? chunk.isEntry
          : ENTRY_CHUNK_PATTERN.test(normalizedFileName);
      const shouldInjectShield = injectRuntimeShield && isEntry;
      const chunkSeed = computeFnv1aHash(chunk.fileName, baseSeed);
      const result = transformJavaScript(code, {
        seed: chunkSeed,
        minStringLength,
        filename: chunk.fileName,
        injectRuntimeShield: shouldInjectShield,
        skipShieldPreamble: true,
        shieldCoupled: injectRuntimeShield,
        windowKeySymbol: masterSym,
        expectedDelta: masterShield?.expectedDelta,
        deterrentMode,
        detectHeadless,
        aggressive,
        config,
      });

      let finalCode = result.code;
      if (
        shouldInjectShield &&
        masterShield?.preambleCode &&
        !finalCode.includes('__unpeek_tampered') &&
        !finalCode.includes('(function _u$') &&
        !finalCode.includes(masterShield.integrityCheckFnName) &&
        !finalCode.startsWith(masterShield.preambleCode)
      ) {
        finalCode = `${masterShield.preambleCode}\n${finalCode}`;
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
