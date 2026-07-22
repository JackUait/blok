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
      external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@bloklabs/core', '@bloklabs/core/adapters', '@bloklabs/core/view'],
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
      '@bloklabs/core/view': path.resolve(dirname, '../../src/view/index.ts'),
      '@bloklabs/core/adapters': path.resolve(dirname, '../../src/adapters.ts'),
      '@bloklabs/core': path.resolve(dirname, '../../src/blok.ts'),
    },
  },
});
