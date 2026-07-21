// vite.config.iife.mjs
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
      emptyOutDir: false, // CRITICAL: Do NOT wipe the ESM/CJS output from the first pass
      lib: {
        entry: path.resolve(__dirname, 'src', 'full.ts'),
        name: 'BlokEditor',
        formats: ['iife'],
        fileName: () => 'blok.iife.js',
      },
      rollupOptions: {
        // Bundle everything for CDN use — no externals
        output: {
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
