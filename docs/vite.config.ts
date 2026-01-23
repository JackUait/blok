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
      if (id.startsWith('/dist/')) {
        return { id: resolve(parentDistDir, id.slice('/dist/'.length)) };
      }
      return null;
    },
    load(id) {
      if (id.startsWith(parentDistDir)) {
        return fs.readFileSync(id, 'utf-8');
      }
      return null;
    },
    configureServer(server) {
      // Serve the parent dist directory at /dist
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/dist/')) {
          const filePath = resolve(parentDistDir, req.url.slice('/dist/'.length));
          if (fs.existsSync(filePath)) {
            const ext = filePath.slice(filePath.lastIndexOf('.'));
            const contentType = ext === '.mjs' || ext === '.js'
              ? 'application/javascript; charset=utf-8'
              : ext === '.css'
                ? 'text/css; charset=utf-8'
                : 'text/plain; charset=utf-8';

            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            return fs.createReadStream(filePath).pipe(res);
          } else {
            res.statusCode = 404;
            res.end(`Not found: ${req.url}`);
            return;
          }
        }
        next();
      });
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
