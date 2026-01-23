import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to handle external /dist imports during dev
function externalDistPlugin(): Plugin {
  const parentDistDir = resolve(__dirname, '..', 'dist');

  return {
    name: 'external-dist',
    enforce: 'pre',
    resolveId(id) {
      // Tell Vite that /dist/* paths are external URLs
      if (id.startsWith('/dist/')) {
        return { id, external: true };
      }
      return null;
    },
    configureServer(server) {
      // Serve the parent dist directory at /dist
      return () => {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/dist/')) {
            const filePath = resolve(parentDistDir, req.url.slice('/dist/'.length));
            if (fs.existsSync(filePath)) {
              const ext = filePath.slice(filePath.lastIndexOf('.'));
              const contentType = ext === '.mjs' || ext === '.js'
                ? 'application/javascript'
                : ext === '.css'
                  ? 'text/css'
                  : 'text/plain';

              res.setHeader('Content-Type', contentType);
              res.setHeader('Access-Control-Allow-Origin', '*');
              return fs.createReadStream(filePath).pipe(res);
            }
          }
          next();
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), externalDistPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['/dist/full.mjs'],
    },
  },
  server: {
    port: 5174,
    fs: {
      // Allow serving files from parent directory
      allow: ['..'],
    },
  },
  optimizeDeps: {
    // Don't pre-bundle /dist imports
    exclude: ['/dist/full.mjs'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
