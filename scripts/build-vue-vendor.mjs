/**
 * Builds Vue 3 as a local ESM vendor file for Playwright E2E tests.
 *
 * The vue-test.html fixture uses an import map. In CI, external URLs (esm.sh)
 * are unreachable, so this produces a local browser-ESM bundle under
 * test/playwright/fixtures/vendor/ that the import map points to.
 *
 * Vue is a single runtime package (the adapter uses render functions, no SFC
 * compiler), so this is far simpler than the React/Angular vendor builds — one
 * `export * from 'vue'` bundle with the runtime feature flags defined.
 *
 * Output: test/playwright/fixtures/vendor/vue.mjs
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, 'test/playwright/fixtures/vendor');

mkdirSync(outDir, { recursive: true });

await build({
  stdin: {
    contents: `export * from 'vue';`,
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  define: {
    'process.env.NODE_ENV': '"production"',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  outfile: path.resolve(outDir, 'vue.mjs'),
});

console.log('Vue vendor bundle written to test/playwright/fixtures/vendor/vue.mjs');
