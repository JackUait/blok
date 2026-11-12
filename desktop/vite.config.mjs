import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@blok/modal-dialog': fileURLToPath(new URL('../src/components/utils/modal-dialog.ts', import.meta.url)),
      '@bloklabs/core/full': fileURLToPath(new URL('../src/full.ts', import.meta.url)),
      '@bloklabs/core/tools': fileURLToPath(new URL('../src/tools/index.ts', import.meta.url)),
      '@blok/sidebar': fileURLToPath(new URL('../src/shell/sidebar.ts', import.meta.url)),
      '@blok/date-editor': fileURLToPath(new URL('../src/tools/database/cells/date-editor.ts', import.meta.url)),
      '@': fileURLToPath(new URL('../', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    proxy: {
      '/api': { target: process.env.BLOK_API_URL || 'http://127.0.0.1:8080', changeOrigin: false, ws: true },
      '/files': { target: process.env.BLOK_API_URL || 'http://127.0.0.1:8080', changeOrigin: false },
      '/healthz': { target: process.env.BLOK_API_URL || 'http://127.0.0.1:8080', changeOrigin: false },
    },
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
