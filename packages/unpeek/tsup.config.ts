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
    'src/bundler/detector.ts',
    'src/bundler/sourcemap-vault.ts',
    'src/ast/index.ts',
    'src/runtime/index.ts',
    'src/cli/index.ts',
    'src/cli/init.ts',
    'src/cli/protect.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: false,
  sourcemap: true,
  splitting: false,
  shims: true,
});
