import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

import jsonAsStringPlugin from './vite-plugin-json-as-string.mjs';
import sharedMessageChunksPlugin from './vite-plugin-shared-message-chunks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || 'production';

/**
 * Build locales as ES module only.
 * Locales use dynamic imports and are not compatible with UMD.
 */
async function buildLocales() {
  console.log('Building locales...');

  await build({
    mode,
    configFile: false,
    build: {
      copyPublicDir: false,
      // Same browser floor and ES2020 syntax cap as vite.config.mjs.
      target: [ 'es2020', 'chrome105', 'edge105', 'firefox110', 'safari16' ],
      emptyOutDir: false, // Don't clear dist/ since blok is already built
      lib: {
        entry: path.resolve(__dirname, '../src/locales.ts'),
        name: 'BlokLocales',
        formats: ['es'],
        fileName: () => 'locales.mjs',
      },
      rollupOptions: {
        output: {
          minify: true,
          // The main build already wrote these locale chunks into
          // dist/pure-chunks (vite.config.mjs chunkFileNames) with the same
          // names and bytes. Pointing here reuses them instead of shipping a
          // second copy.
          chunkFileNames: 'pure-chunks/[name]-[hash].mjs',
        },
      },
    },
    plugins: [jsonAsStringPlugin(), sharedMessageChunksPlugin()],
    define: {
      'NODE_ENV': JSON.stringify(mode),
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    resolve: {
      alias: {
        '@/types': path.resolve(__dirname, '../types'),
      },
    },
  });

  console.log('Locales built successfully');
}

buildLocales().catch((error) => {
  console.error('Failed to build locales:', error);
  process.exit(1);
});
