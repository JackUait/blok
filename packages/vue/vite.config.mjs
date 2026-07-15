import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    copyPublicDir: false,
    target: 'es2017',
    lib: {
      entry: path.resolve(dirname, 'src', 'index.ts'),
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      // The core and the framework are peers — never bundled into the adapter.
      external: ['vue', '@blok/core', '@blok/core/adapters'],
      output: [
        { format: 'es', entryFileNames: 'index.mjs' },
        { format: 'cjs', entryFileNames: 'index.cjs' },
      ],
    },
  },
  resolve: {
    // Type-resolution only: rollup `external` wins for emitted specifiers.
    alias: {
      '@/types': path.resolve(dirname, '../../types'),
      '@blok/core/adapters': path.resolve(dirname, '../../src/adapters.ts'),
      '@blok/core': path.resolve(dirname, '../../src/blok.ts'),
    },
  },
});
