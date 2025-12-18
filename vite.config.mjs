import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import license from 'rollup-plugin-license';

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
  const isStorybookBuild = process.env.npm_lifecycle_script?.includes('storybook');

  return {
    build: {
      copyPublicDir: false,
      target: 'es2017',
      lib: {
        entry: path.resolve(__dirname, 'src', 'blok.ts'),
        fileName: 'blok',
        formats: ['es'],
      },
      rollupOptions: {
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

                  // Return false for unlicensed dependencies.
                  if (!dependency.license) {
                    return false;
                  }

                  // Allow MIT, Apache-2.0, and ISC licenses.
                  return ['MIT', 'Apache-2.0', 'ISC'].includes(dependency.license);
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
    },

    plugins: [
      // Only use CSS injection plugin for library builds, not Storybook
      !isStorybookBuild && cssInjectedByJsPlugin({
        jsAssetsFilterFunction: (outputChunk) => {
          // Only inject CSS into the main blok bundle, not locales
          return outputChunk.name === 'blok';
        },
      }),
    ].filter(Boolean),
  };
});
