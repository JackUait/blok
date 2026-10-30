import { build } from 'vite';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const defaultOutDir = path.resolve(root, 'packages/server/dotnet/Blok.Server/Generated');
// Committed: go:embed cannot read a gitignored file or one outside the module.
const defaultGoDir = path.resolve(root, 'packages/server/go/internal/jsruntime');

/**
 * Build the JavaScript resource embedded by Blok.Server.
 *
 * @param {string} [outDir] output directory
 * @returns {Promise<string>} absolute path to the generated bundle
 */
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

/**
 * Build the bundle once and write it for both servers.
 *
 * @param {{ csharpDir?: string, goDir?: string }} [dirs] output directories
 * @returns {Promise<string[]>} the C# path, then the Go path
 */
export async function writeServerRuntimes({ csharpDir = defaultOutDir, goDir = defaultGoDir } = {}) {
  const csharpPath = await buildServerRuntime(csharpDir);
  const goPath = path.join(path.resolve(goDir), 'blok-server-runtime.js');
  const partialPath = `${goPath}.partial`;

  await mkdir(path.dirname(goPath), { recursive: true });
  await copyFile(csharpPath, partialPath);
  await rename(partialPath, goPath);

  return [csharpPath, goPath];
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  await writeServerRuntimes();
}
