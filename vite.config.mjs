import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

import tailwindcss from '@tailwindcss/vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import license from 'rollup-plugin-license';
import unfurlPlugin from './scripts/unfurl/vite-plugin-unfurl.mjs';
import scopeUtilitiesPlugin from './scripts/scope-utilities/vite-plugin-scope-utilities.mjs';
import jsonAsStringPlugin from './scripts/vite-plugin-json-as-string.mjs';
import sharedMessageChunksPlugin from './scripts/vite-plugin-shared-message-chunks.mjs';

import * as pkg from './package.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.resolve(__dirname, 'src');

/**
 * One internal lib entry per tool folder that src/tools/index.ts re-exports,
 * so each tool gets its own chunk and a consumer's bundler can drop the tools
 * an app never imports. With `/tools` as the only entry, all tools shared one
 * chunk, and their static fields (lowered to top-level assignments) kept every
 * tool alive. The Paragraph-only guard in test/unit/build/bundle-outputs.test.ts
 * checks the result.
 */
const toolEntries = () => {
  const index = fs.readFileSync(path.join(SRC, 'tools', 'index.ts'), 'utf8');
  const dirs = [...new Set([...index.matchAll(/^export \{[^}]*\} from '\.\/([a-z/-]+)';$/gm)].map((match) => match[1]))]
    .filter((dir) => fs.existsSync(path.join(SRC, 'tools', dir, 'index.ts')));

  if (dirs.length === 0) {
    throw new Error('vite.config.mjs: found no tool folders in src/tools/index.ts, so the per-tool split would silently vanish');
  }

  return Object.fromEntries(dirs.map((dir) => [`tool-${dir.replace('/', '-')}`, path.join(SRC, 'tools', dir, 'index.ts')]));
};

/**
 * The emoji names and keywords are CLDR data (Unicode-3.0), which asks for its
 * notice to ship with copies. scripts/build-emoji-locale-data.mjs generates the
 * data into src, so the license plugin never sees the package.
 */
const cldrNotice = () => {
  const root = path.resolve(__dirname, 'node_modules', 'cldr-annotations-full');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  return [
    `Name: ${manifest.name}`,
    `Version: ${manifest.version}`,
    `License: ${manifest.license}`,
    'Private: false',
    'Description: Unicode CLDR emoji annotations; Blok ships emoji names and search keywords generated from them',
    'License Text:',
    '===',
    '',
    fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').trim(),
  ].join('\n');
};

const entryFileNames = (ext) => (chunk) => (chunk.name.startsWith('tool-') ? `tool-entries/[name].${ext}` : `[name].${ext}`);

// A chunk goes to `pure-chunks/`, outside the `./dist/chunks/*` sideEffects
// glob, only when it holds nothing but Blok's own side-effect-free modules.
// That lets a bundler skip the chunks of tools an app never imports.
// - Package code stays in `chunks/`: some of it runs on load (mermaid's diagram
//   chunks are imported for their effects alone), and a bundler drops such an
//   import into an undeclared file.
// - The modules below change the page on load.
// test/unit/build/side-effects.test.ts checks both.
const GLOBAL_EFFECT_MODULE = /src[\\/]components[\\/](?:polyfills|utils[\\/]input-modality)\.ts$/;

const isPureModule = (id) => id.startsWith('\0') || (id.startsWith(SRC + path.sep) && !GLOBAL_EFFECT_MODULE.test(id));

const chunkFileNames = (ext) => (chunk) =>
  chunk.moduleIds.every(isPureModule) ? `pure-chunks/[name]-[hash].${ext}` : `chunks/[name]-[hash].${ext}`;

/**
 * Trick to use Vite server.open option on macOS
 * @see https://github.com/facebook/create-react-app/pull/1690#issuecomment-283518768
 */
process.env.BROWSER = 'open';

export default defineConfig(({ mode }) => {
  const NODE_ENV = mode || 'development';
  const VERSION = pkg.version;
  const entries = {
    blok: path.resolve(__dirname, 'src', 'blok.ts'),
    tools: path.resolve(__dirname, 'src', 'tools', 'index.ts'),
    full: path.resolve(__dirname, 'src', 'full.ts'),
    markdown: path.resolve(__dirname, 'src', 'markdown', 'index.ts'),
    view: path.resolve(__dirname, 'src', 'view', 'index.ts'),
    migrate: path.resolve(__dirname, 'src', 'migrate', 'index.ts'),
    adapters: path.resolve(__dirname, 'src', 'adapters.ts'),
    icons: path.resolve(__dirname, 'src', 'icons', 'index.ts'),
    preprocess: path.resolve(__dirname, 'src', 'preprocess', 'index.ts'),
    'agent-models': path.resolve(__dirname, 'src', 'agent-models', 'index.ts'),
  };

  return {
    build: {
      copyPublicDir: false,
      // JS and CSS share one browser floor: what the CSS already needs (`:has()`,
      // container queries). An older CSS target makes lightningcss lower logical
      // properties into rules keyed on the page's `lang`, so an RTL editor on a
      // `lang="en"` page lays out as LTR. `es2020` caps the JS syntax, because
      // consumers' bundlers and test runners parse dist with their own parser;
      // oxc lowers to the oldest entry. test/unit/build/syntax-floor.test.ts
      // checks the output.
      target: [ 'es2020', 'chrome105', 'edge105', 'firefox110', 'safari16' ],
      cssTarget: [ 'chrome105', 'edge105', 'firefox110', 'safari16' ],
      lib: {
        entry: { ...entries, ...toolEntries() },
        formats: ['es', 'cjs'],
      },
      rollupOptions: {
        external: [],
        output: [
          {
            format: 'es',
            entryFileNames: entryFileNames('mjs'),
            chunkFileNames: chunkFileNames('mjs'),
            minify: true,
          },
          {
            format: 'cjs',
            entryFileNames: entryFileNames('cjs'),
            chunkFileNames: chunkFileNames('cjs'),
            minify: true,
          },
        ],
        plugins: [
          license({
            thirdParty: {
              allow: {
                test: (dependency) => {
                  // Manually allow khroma (MIT, see node_modules/khroma/license)
                  // because package.json is missing the "license" field
                  if (dependency.name === 'khroma') {
                    return true;
                  }

                  // elkjs (EPL-2.0) ships because mermaid 12 imports it for its
                  // default ELK layout. Keep in sync with test/unit/build/vendor-license.test.ts.
                  if (dependency.name === 'elkjs' && dependency.license === 'EPL-2.0') {
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
              output: {
                file: path.resolve(__dirname, 'dist', 'vendor.LICENSE.txt'),
                // Same layout as the plugin's default, plus the CLDR notice.
                template: (dependencies) => [...dependencies.map((dependency) => dependency.text()), cldrNotice()].join('\n\n---\n\n'),
              },
            },
          }),
        ],
      },
    },

    define: {
      'NODE_ENV': JSON.stringify(NODE_ENV),
      'VERSION': JSON.stringify(VERSION),
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
      // Set by scripts/dev.mjs: whether `yarn serve` started the sync service
      // beside Vite, so the playground knows to collaborate or stay local.
      '__BLOK_DEV_BACKEND__': JSON.stringify(process.env.BLOK_DEV_BACKEND === '1'),
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
      // fixture's `@bloklabs/angular` and the APF FESM's `@bloklabs/core`)
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
      jsonAsStringPlugin(),
      sharedMessageChunksPlugin(),
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
