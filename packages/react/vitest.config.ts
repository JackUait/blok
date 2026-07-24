import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Shared with the root vitest.config.ts — lets jsdom's Web Storage through on
// Node 26+. Must run at config-module evaluation, before workers spawn.
import { enableJsdomWebStorageGuard } from '../../scripts/jsdom-webstorage-guard.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));

enableJsdomWebStorageGuard();

/**
 * Package-local test config for @bloklabs/react. Exists because the root
 * vitest config's alias map has no entry for the `@bloklabs/core/view`
 * subpath (its `@bloklabs/core` alias would rewrite it to a broken path),
 * and the root config must not be modified. Tests that exercise the view
 * bindings live in `packages/react/test/` and run via `yarn test` here.
 */
export default defineConfig({
  // Root-level cache: packages/react/node_modules is not gitignored (the root
  // .gitignore only covers top-level node_modules), so keep vite's cache out.
  cacheDir: path.resolve(dirname, '../../node_modules/.vite/blok-react-pkg'),
  test: {
    root: dirname,
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: [path.resolve(dirname, '../../test/unit/vitest.setup.ts')],
  },
  resolve: {
    alias: {
      '@/types': path.resolve(dirname, '../../types'),
      '@bloklabs/core/view': path.resolve(dirname, '../../src/view/index.ts'),
      '@bloklabs/core/adapters': path.resolve(dirname, '../../src/adapters.ts'),
      '@bloklabs/core/locales': path.resolve(dirname, '../../src/locales.ts'),
      '@bloklabs/core': path.resolve(dirname, '../../src/blok.ts'),
    },
  },
});
