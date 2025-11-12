import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    minify: false,
    sourcemap: true,
  },
  define: {
    'NODE_ENV': JSON.stringify('test'),
    'VERSION': JSON.stringify('test-version'),
  },
  resolve: {
    alias: {
      '@/types': path.resolve(__dirname, './types'),
    },
  },
});

