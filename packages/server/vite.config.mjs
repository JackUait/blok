import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    copyPublicDir: false,
    // Runs in the consumer's backend, never in a browser: node:crypto stays
    // external rather than being polyfilled into the bundle.
    ssr: true,
    target: 'node20',
    lib: {
      entry: path.resolve(dirname, 'src', 'ticket.ts'),
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      output: [
        { format: 'es', entryFileNames: 'ticket.mjs' },
        { format: 'cjs', entryFileNames: 'ticket.cjs' },
      ],
    },
  },
});
