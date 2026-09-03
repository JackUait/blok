import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { enableJsdomWebStorageGuard } from './scripts/jsdom-webstorage-guard.mjs';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// Same Node 26 guard as vitest.config.ts — see scripts/jsdom-webstorage-guard.mjs.
enableJsdomWebStorageGuard();

/**
 * Vitest config used ONLY by Stryker. It exists because the mutation runner
 * drives every project it finds in a config file and cannot filter by name:
 * pointed at vitest.config.ts it would also start the browser-mode `storybook`
 * project and the Angular one. So this file declares the jsdom unit project
 * alone, flattened out of `projects`.
 *
 * The raised timeouts are load-bearing, not cosmetic. Stryker pins vitest to a
 * single worker and a mutant can make code slower, so the repo's 5s default
 * turns ordinary tests into failures — and Stryker refuses to start unless the
 * initial run is entirely green.
 */
export default defineConfig({
  define: {
    // Stryker never runs the CLI suite, so the real version is irrelevant here.
    __CLI_VERSION__: JSON.stringify('0.0.0-mutation'),
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  test: {
    name: 'unit',
    globals: true,
    environment: 'jsdom',
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
    exclude: ['test/unit/angular/**'],
    setupFiles: ['test/unit/vitest.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@/types': path.resolve(dirname, './types'),
      '@bloklabs/react': path.resolve(dirname, './packages/react/src/index.ts'),
      '@bloklabs/vue': path.resolve(dirname, './packages/vue/src/index.ts'),
      '@bloklabs/core/adapters': path.resolve(dirname, './src/adapters.ts'),
      '@bloklabs/core': path.resolve(dirname, './src/blok.ts'),
    },
  },
});
