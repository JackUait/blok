import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

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
      target: 'es2017',
      emptyOutDir: false, // Don't clear dist/ since blok is already built
      lib: {
        entry: path.resolve(__dirname, '../src/locales.ts'),
        name: 'BlokLocales',
        formats: ['es'],
        fileName: () => 'locales.mjs',
      },
    },
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
