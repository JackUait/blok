import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

import tailwindcss from '@tailwindcss/vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import license from 'rollup-plugin-license';
import unfurlPlugin from './scripts/unfurl/vite-plugin-unfurl.mjs';
import scopeUtilitiesPlugin from './scripts/scope-utilities/vite-plugin-scope-utilities.mjs';

import * as pkg from './package.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Trick to use Vite server.open option on macOS
 * @see https://github.com/facebook/create-react-app/pull/1690#issuecomment-283518768
 */
process.env.BROWSER = 'open';

export default defineConfig(({ mode }) => {
  const NODE_ENV = mode || 'development';
  const VERSION = pkg.version;

  return {
    build: {
      copyPublicDir: false,
      target: 'es2017',
      lib: {
        entry: {
          blok: path.resolve(__dirname, 'src', 'blok.ts'),
          tools: path.resolve(__dirname, 'src', 'tools', 'index.ts'),
          full: path.resolve(__dirname, 'src', 'full.ts'),
          react: path.resolve(__dirname, 'src', 'react', 'index.ts'),
          vue: path.resolve(__dirname, 'src', 'vue', 'index.ts'),
          markdown: path.resolve(__dirname, 'src', 'markdown', 'index.ts'),
          adapters: path.resolve(__dirname, 'src', 'adapters.ts'),
          icons: path.resolve(__dirname, 'src', 'icons', 'index.ts'),
        },
        formats: ['es', 'cjs'],
      },
      rollupOptions: {
        external: [
          'react', 'react-dom', 'react/jsx-runtime',
          'vue',
        ],
        output: [
          {
            format: 'es',
            entryFileNames: '[name].mjs',
            chunkFileNames: 'chunks/[name]-[hash].mjs',
          },
          {
            format: 'cjs',
            entryFileNames: '[name].cjs',
            chunkFileNames: 'chunks/[name]-[hash].cjs',
          },
        ],
        plugins: [
          license({
            thirdParty: {
              allow: {
                test: (dependency) => {
                  // Manually allow html-janitor (https://github.com/guardian/html-janitor/blob/master/LICENSE)
                  // because of missing LICENSE file in published package
                  if (dependency.name === 'html-janitor') {
                    return true;
                  }

                  // Manually allow khroma (MIT, see node_modules/khroma/license)
                  // because package.json is missing the "license" field
                  if (dependency.name === 'khroma') {
                    return true;
                  }

                  // Return false for unlicensed dependencies.
                  if (!dependency.license) {
                    return false;
                  }

                  // Allow permissive open-source licenses.
                  // Handle SPDX OR expressions like "(MPL-2.0 OR Apache-2.0)".
                  const allowed = ['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0'];
                  const parts = dependency.license.replace(/[()]/g, '').split(/\s+OR\s+/);

                  return parts.some((l) => allowed.includes(l));
                },
                failOnUnlicensed: true,
                failOnViolation: true,
              },
              output: path.resolve(__dirname, 'dist', 'vendor.LICENSE.txt'),
            },
          }),
        ],
      },
    },

    define: {
      'NODE_ENV': JSON.stringify(NODE_ENV),
      'VERSION': JSON.stringify(VERSION),
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
    },

    resolve: {
      alias: {
        '@/types': path.resolve(__dirname, './types'),
      },
    },

    server: {
      port: 3303,
      open: true,
      headers: {
        // Disable caching for local development
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    },

    optimizeDeps: {
      // Scope the dependency scan to the real dev playground. Vite otherwise
      // crawls every *.html in the project, including the Playwright adapter E2E
      // fixtures under test/playwright/fixtures/ — static, import-map-driven pages
      // (served by `npx serve`, not Vite) whose bare specifiers (the Angular
      // fixture's `@blok/angular` and the APF FESM's `@blok/core`)
      // resolve only via the page import map, never from node_modules. Crawling
      // them aborts the scan ("dependencies … could not be resolved") and disables
      // pre-bundling for the whole dev server.
      entries: ['index.html'],
      // Force re-bundling of dependencies in development
      force: true,
    },

    // Clear Vite's cache on startup
    cache: {
      dir: undefined, // Disables cache dir
    },

    plugins: [
      unfurlPlugin(),
      tailwindcss(),
      scopeUtilitiesPlugin(),
      cssInjectedByJsPlugin({
        jsAssetsFilterFunction: (outputChunk) => {
          // Only inject CSS into the main blok bundle, not locales or tools
          // CSS is injected into 'blok' entry, 'full' includes blok so it gets CSS too
          return outputChunk.name === 'blok';
        },
      }),
    ],
  };
});
