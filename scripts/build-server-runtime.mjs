import { build } from 'vite';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
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
/**
 * Globals the bundle's dependencies expect from a browser or Node, prepended so
 * the artifact runs on a bare ECMAScript engine. `entities` decodes its
 * character-entity trie from base64 through `atob`, and a missing `atob` fails
 * at bundle load — before any conversion runs — so the whole embedded runtime
 * is dead without this. Pinned by the globals-free realm case in
 * test/unit/scripts/build-server-runtime.test.ts.
 */
const hostGlobalsBanner = `if (typeof globalThis.atob !== 'function') {
  globalThis.atob = function (input) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var data = String(input).replace(/[\\t\\n\\f\\r ]/g, '').replace(/=+$/, '');
    var output = '';
    var buffer = 0;
    var bits = 0;
    for (var index = 0; index < data.length; index += 1) {
      var value = alphabet.indexOf(data.charAt(index));
      if (value === -1) {
        throw new Error('atob: invalid base64');
      }
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output += String.fromCharCode((buffer >> bits) & 255);
      }
    }
    return output;
  };
}`;

export async function buildServerRuntime(outDir = defaultOutDir) {
  const { version } = JSON.parse(await readFile(path.resolve(root, 'package.json'), 'utf8'));
  const outputDirectory = path.resolve(outDir);
  const outputPath = path.join(outputDirectory, 'blok-server-runtime.js');

  await mkdir(path.dirname(outputDirectory), { recursive: true });
  const stagingDirectory = await mkdtemp(
    path.join(path.dirname(outputDirectory), '.blok-server-runtime-')
  );

  try {
    await build({
      configFile: false,
      build: {
        copyPublicDir: false,
        emptyOutDir: true,
        outDir: stagingDirectory,
        target: 'es2020',
        minify: 'esbuild',
        lib: {
          entry: path.resolve(root, 'src/view/server-runtime.ts'),
          name: 'BlokServerRuntimeBundle',
          formats: ['iife'],
          fileName: () => 'blok-server-runtime.js',
        },
        rollupOptions: {
          output: {
            banner: hostGlobalsBanner,
          },
        },
      },
      resolve: {
        conditions: ['worker'],
      },
      define: {
        'NODE_ENV': JSON.stringify('production'),
        'process.env.NODE_ENV': JSON.stringify('production'),
        // Same define the editor bundle uses. Without it `getBlokVersion()`
        // falls back to 'dev' and a document written on the server is stamped
        // with a version the editor never writes.
        'VERSION': JSON.stringify(version),
      },
    });

    await mkdir(outputDirectory, { recursive: true });
    await rename(path.join(stagingDirectory, 'blok-server-runtime.js'), outputPath);

    return outputPath;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  await buildServerRuntime();
}
