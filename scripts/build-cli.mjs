import { build } from 'vite';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildCli() {
  console.log('Building CLI...');

  const migrationContent = readFileSync(
    path.resolve(__dirname, '../MIGRATION.md'),
    'utf-8'
  );

  await build({
    configFile: false,
    build: {
      copyPublicDir: false,
      target: 'node18',
      emptyOutDir: false,
      lib: {
        entry: path.resolve(__dirname, '../src/cli/index.ts'),
        formats: ['es'],
        fileName: () => 'cli.mjs',
      },
      rollupOptions: {
        external: ['node:fs', 'node:path'],
      },
    },
    define: {
      __MIGRATION_CONTENT__: JSON.stringify(migrationContent),
      __CLI_VERSION__: JSON.stringify(
        JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')).version
      ),
    },
  });

  console.log('CLI built successfully');
}

buildCli().catch((error) => {
  console.error('Failed to build CLI:', error);
  process.exit(1);
});
