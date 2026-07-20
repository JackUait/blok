import path from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import angular from '@analogjs/vite-plugin-angular';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const cliPkg = JSON.parse(readFileSync(path.resolve(dirname, 'packages/cli/package.json'), 'utf-8')) as { version: string };

// Node 26 enables Web Storage by default, and its built-in `localStorage` global
// shadows the one jsdom installs. `--localstorage-file` is never provided, so
// Node's own is `undefined` and every `localStorage.*` call in a jsdom test
// throws "Cannot read properties of undefined" — frequently surfacing as an
// unrelated-looking teardown error, because construction already failed earlier.
// Disabling Node's implementation lets jsdom's through.
//
// This goes through NODE_OPTIONS rather than `poolOptions.*.execArgv`: the
// threads pool runs workers via worker_threads, which rejects execArgv entries
// that affect the process, so the flag was silently dropped there. Setting it
// here covers every pool, plus direct `vitest` and IDE runs (which a NODE_OPTIONS
// prefix on the package.json `test` script would miss).
// jsdom 29 does NOT remove the need for this.
const WEBSTORAGE_OFF = '--no-experimental-webstorage';

if (!(process.env.NODE_OPTIONS ?? '').includes(WEBSTORAGE_OFF)) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${WEBSTORAGE_OFF}`.trim();
}

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  define: {
    __CLI_VERSION__: JSON.stringify(cliPkg.version),
    // Vue runtime feature flags. The Vue adapter is authored as render functions
    // (no @vitejs/plugin-vue), so these globals aren't replaced by the SFC plugin;
    // defining them here silences Vue's "feature flag undefined" warnings under the
    // `unit` jsdom project where @vue/test-utils mounts the adapter components.
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/**/__module.ts', 'src/**/index.ts', 'test/**', 'node_modules/**']
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          environment: 'jsdom',
          include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
          // Angular tests need the Angular compiler plugin + zone.js setup, so
          // they run in the dedicated `unit-angular` project below.
          exclude: ['test/unit/angular/**'],
          setupFiles: ['test/unit/vitest.setup.ts']
        },
      },
      {
        extends: true,
        // Angular compiler (JIT) for the adapter unit tests. NOTE: under this
        // repo's Vite 8 / Vitest 4, @analogjs/vite-plugin-angular's AOT (ngtsc)
        // emit does not populate its file map, so signal-based
        // input()/output()/model()/viewChild() do not get compiled. The adapter
        // therefore uses classic @Input()/@Output()/@ViewChild() decorators
        // (which JIT compiles correctly) with internal signal()/effect() for
        // reactivity — same public template API, JIT-compatible.
        plugins: [angular({ tsconfig: path.resolve(dirname, 'tsconfig.spec.json') })],
        test: {
          name: 'unit-angular',
          globals: true,
          environment: 'jsdom',
          include: ['test/unit/angular/**/*.test.ts'],
          setupFiles: ['test/unit/vitest.setup.ts', 'test/unit/angular/setup.ts']
        },
      },
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook')
          })
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{
              browser: 'chromium'
            }]
          },
          setupFiles: ['.storybook/vitest.setup.ts']
        }
      }
    ]
  },
  resolve: {
    alias: {
      '@/types': path.resolve(__dirname, './types'),
      // The Angular adapter imports the Blok runtime via the package's own public
      // specifier (so ng-packagr externalizes it as a peer for consumers). In-repo
      // tests resolve it to the core source; unit tests mock it via vi.mock.
      '@bloklabs/react': path.resolve(__dirname, './packages/react/src/index.ts'),
      '@bloklabs/vue': path.resolve(__dirname, './packages/vue/src/index.ts'),
      '@bloklabs/core/adapters': path.resolve(__dirname, './src/adapters.ts'),
      '@bloklabs/core': path.resolve(__dirname, './src/blok.ts')
    }
  }
});