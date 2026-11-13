import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/config.ts',
    'src/browser.ts',
    'src/vite.ts',
    'src/webpack.ts',
    'src/rollup.ts',
    'src/esbuild.ts',
    'src/bundler/unplugin.ts',
    'src/ast/index.ts',
    'src/runtime/index.ts',
    'src/cli/index.ts',
    'src/next/index.ts',
    'src/next/adapter.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  cjsInterop: true,
  shims: true,
});
