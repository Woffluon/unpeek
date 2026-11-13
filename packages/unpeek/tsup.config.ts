import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: [
      'src/index.ts',
      'src/config.ts',
      'src/browser.ts',
      'src/plugins/unplugin.ts',
      'src/adapters/vite.ts',
      'src/adapters/webpack.ts',
      'src/adapters/rollup.ts',
      'src/adapters/esbuild.ts',
      'src/adapters/rspack.ts',
      'src/adapters/next/index.ts',
      'src/adapters/next/adapter.ts',
    ],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: false,
    splitting: true,
    cjsInterop: true,
    shims: true,
  },
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: false,
    splitting: false,
  },
]);
