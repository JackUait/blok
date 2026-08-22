import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Package-local test config for @bloklabs/presets — same reason as
 * packages/react/vitest.config.ts: `packages/presets/node_modules` is not
 * gitignored (the root .gitignore only covers top-level node_modules), so
 * vite's cache is redirected to the root node_modules instead.
 */
export default defineConfig({
  cacheDir: path.resolve(dirname, '../../node_modules/.vite/blok-presets-pkg'),
  test: {
    root: dirname,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
