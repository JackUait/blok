import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: [ 'test/unit/**/*.test.ts' ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [ 'src/**/*.ts' ],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__module.ts',
        'src/**/index.ts',
        'test/**',
        'node_modules/**',
      ],
    },
  },
  resolve: {
    alias: {
       
      '@/types': path.resolve(__dirname, './types'),
    },
  },
});

