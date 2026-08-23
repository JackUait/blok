import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const defaultOutDir = path.resolve(root, 'packages/server/dotnet/Blok.Server/Generated');

/**
 * Build the JavaScript resource embedded by Blok.Server.
 *
 * @param {string} [outDir] output directory
 * @returns {Promise<string>} absolute path to the generated bundle
 */
export async function buildServerRuntime(outDir = defaultOutDir) {
  await build({
    configFile: false,
    build: {
      copyPublicDir: false,
      emptyOutDir: true,
      outDir,
      target: 'es2020',
      minify: 'esbuild',
      lib: {
        entry: path.resolve(root, 'src/server-runtime/index.ts'),
        name: 'BlokServerRuntimeBundle',
        formats: ['iife'],
        fileName: () => 'blok-server-runtime.js',
      },
    },
    resolve: {
      conditions: ['worker'],
    },
    define: {
      'NODE_ENV': JSON.stringify('production'),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  });

  return path.resolve(outDir, 'blok-server-runtime.js');
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  await buildServerRuntime();
}
