import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Lives outside docs/ on purpose: the root vitest config needs the same guard,
// and duplicating it is what left docs/ unguarded through the Node 26 upgrade.
// Vite bundles this config file and follows the relative specifier, so the
// package boundary (docs has its own yarn.lock/node_modules) is not a problem —
// no new dependency is introduced. docs' `tsc` never sees this file: neither
// tsconfig.json (`include: ["src"]`) nor tsconfig.node.json includes it.
import { enableJsdomWebStorageGuard } from '../scripts/jsdom-webstorage-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Must run at config-module evaluation, before the pool spawns any worker.
enableJsdomWebStorageGuard();

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
      '@/types': path.resolve(__dirname, '../types'),
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
        // Provide mock implementation for /dist/react.mjs in tests
        if (id === '/dist/react.mjs') {
          return {
            code: `
              import React from 'react';
              export const BlokEditor = React.forwardRef(function MockBlokEditor(props, ref) {
                React.useImperativeHandle(ref, () => ({
                  save: () => Promise.resolve({ blocks: [] }),
                  clear: () => Promise.resolve(),
                  undo: () => Promise.resolve(),
                  redo: () => Promise.resolve(),
                }));

                return React.createElement('div', {
                  className: props.className,
                  'data-testid': 'mock-blok-editor',
                  'data-blok-content-align': (props.style && props.style.contentAlign) || 'left',
                  'data-tool-names': props.tools ? Object.keys(props.tools).join(',') : '',
                });
              });
            `,
          };
        }
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
                save = () => Promise.resolve({ blocks: [] });
                clear = () => Promise.resolve();
                undo = () => Promise.resolve();
                redo = () => Promise.resolve();
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
        // Provide mock implementation for /dist/tools.mjs in tests — mirrors
        // the full tool export surface of the real bundle.
        if (id === '/dist/tools.mjs') {
          const toolExports = [
            'Paragraph', 'Header', 'List', 'Table', 'Toggle', 'Callout',
            'Database', 'DatabaseRow', 'Divider', 'Quote', 'Code',
            'Image', 'File', 'Audio', 'Video', 'ColumnList', 'Column',
            'Embed', 'Bookmark',
            'Bold', 'Italic', 'Underline', 'Strikethrough',
            'InlineCode', 'Equation', 'Link', 'Marker', 'ClearFormat',
          ];
          return {
            code: toolExports.map((name) => `export const ${name} = class {};`).join('\n'),
          };
        }
        return null;
      },
    },
  ],
});
