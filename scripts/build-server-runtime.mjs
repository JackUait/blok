import { build } from 'vite';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
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
      },
      resolve: {
        conditions: ['worker'],
      },
      define: {
        'NODE_ENV': JSON.stringify('production'),
        'process.env.NODE_ENV': JSON.stringify('production'),
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
