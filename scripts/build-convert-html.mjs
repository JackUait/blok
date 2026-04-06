import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildConvertHtml() {
  console.log('Building convert-html CLI...');

  await build({
    configFile: false,
    build: {
      copyPublicDir: false,
      target: 'node18',
      emptyOutDir: false,
      lib: {
        entry: path.resolve(__dirname, '../src/cli/commands/convert-html/standalone.ts'),
        formats: ['es'],
        fileName: () => 'convert-html.mjs',
      },
      rollupOptions: {
        external: ['node:fs', 'node:path', 'node:process', 'jsdom'],
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  console.log('convert-html CLI built successfully');
}

buildConvertHtml().catch((error) => {
  console.error('Failed to build convert-html CLI:', error);
  process.exit(1);
});
