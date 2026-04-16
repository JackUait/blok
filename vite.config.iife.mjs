// vite.config.iife.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
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
      cssInjectedByJsPlugin(),
    ],
  };
});
