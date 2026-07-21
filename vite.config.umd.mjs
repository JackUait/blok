// vite.config.umd.mjs
//
// Third build pass: the Editor.js drop-in browser global.
//
// Editor.js historically shipped `window.EditorJS` as the constructor itself,
// used as `new EditorJS({ ... })`. This pass reproduces that by building the
// default-only entry (`src/blok.global.ts`, which re-exports just the `Blok`
// class as default) as a UMD bundle with `output.exports: 'default'` and the
// global name `EditorJS`. That makes `window.EditorJS === Blok` (the class),
// so `new EditorJS({ ... })` works from a plain <script> tag — instead of the
// namespace-object footgun (`new EditorJS.default({ ... })`).
//
// This is ADDITIVE: the ESM/CJS multi-export builds (vite.config.mjs) and the
// batteries-included `BlokEditor` namespace IIFE (vite.config.iife.mjs) are
// left untouched. `emptyOutDir: false` preserves their output.
import path from 'path';
import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import scopeUtilitiesPlugin from './scripts/scope-utilities/vite-plugin-scope-utilities.mjs';
import jsonAsStringPlugin from './scripts/vite-plugin-json-as-string.mjs';
import * as pkg from './package.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const NODE_ENV = mode || 'production';
  const VERSION = pkg.version;

  return {
    build: {
      copyPublicDir: false,
      target: 'es2017',
      emptyOutDir: false, // CRITICAL: Do NOT wipe the ESM/CJS/IIFE output from earlier passes
      lib: {
        entry: path.resolve(__dirname, 'src', 'blok.global.ts'),
        name: 'EditorJS',
        formats: ['umd'],
        fileName: () => 'blok.umd.js',
      },
      rollupOptions: {
        // Bundle everything for CDN use — no externals
        output: {
          // The entry has a single default export; surface it AS the global
          // (`window.EditorJS === Blok`) rather than a namespace object.
          exports: 'default',
          inlineDynamicImports: true,
          // CDN build served raw by unpkg/jsdelivr — ship it minified.
          minify: true,
        },
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

    plugins: [
      jsonAsStringPlugin(),
      // LOAD-BEARING: styles reach the bundle as a JS string
      // (`main.css?inline` → UI.loadStyles), so nothing else compiles Tailwind.
      // Without this the CDN bundle ships `@theme {...}` / `@tailwind
      // utilities;` verbatim and renders completely unstyled. Must stay before
      // scopeUtilitiesPlugin, which rewrites the generated utilities — same
      // order as vite.config.mjs.
      tailwindcss(),
      scopeUtilitiesPlugin(),
      cssInjectedByJsPlugin(),
    ],
  };
});
