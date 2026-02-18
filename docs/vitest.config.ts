import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,test.deferred}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./test/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'test/**', 'node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // External /dist imports for tests
  plugins: [
    {
      name: 'external-dist',
      enforce: 'pre',
      resolveId(id, importer) {
        // Skip externalization for mocked imports in tests
        if (importer?.includes('__mocks__')) {
          return null;
        }
        if (id.startsWith('/dist/')) {
          return { id, external: true };
        }
        return null;
      },
      load(id) {
        // Provide mock implementation for /dist/full.mjs in tests
        if (id === '/dist/full.mjs') {
          return {
            code: `
              export const Blok = class MockBlok {
                constructor(config) {
                  setTimeout(() => {
                    if (config.onReady) config.onReady();
                  }, 0);
                }
                destroy = () => {};
                clear = () => Promise.resolve();
                render = () => Promise.resolve();
                blocks = {
                  clear: () => Promise.resolve(),
                  render: () => Promise.resolve(),
                  getBlocksCount: () => 3,
                };
              };
              export const Header = class {};
              export const Paragraph = class {};
              export const List = class {};
              export const Bold = class {};
              export const Italic = class {};
              export const Link = class {};
            `,
          };
        }
        return null;
      },
    },
  ],
});
