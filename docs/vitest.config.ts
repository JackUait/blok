import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,test.deferred}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./test/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'test/**', 'node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // External /dist imports for tests
  plugins: [
    {
      name: 'external-dist',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('/dist/')) {
          return { id, external: true };
        }
        return null;
      },
    },
  ],
});
