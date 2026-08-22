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
      output: [
        { format: 'es', entryFileNames: 'index.mjs' },
        { format: 'cjs', entryFileNames: 'index.cjs' },
      ],
    },
  },
});
