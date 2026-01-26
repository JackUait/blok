#!/usr/bin/env node

/**
 * Simple HTTP server for serving documentation files
 * Usage: node scripts/serve-docs.mjs [port]
 *
 * In development, serves Vite dev server at /_dev route
 * In production, serves pre-built React static files from docs/dist/
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../docs');
const DOCS_DIST_DIR = path.resolve(DOCS_DIR, 'dist');
const BLOK_DIST_DIR = path.resolve(__dirname, '../dist');
const DEFAULT_PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

// Check if we're in development mode (Vite dev server)
// Default to true unless explicitly set to false
const DEV_MODE = process.env.DOCS_DEV !== 'false';
const VITE_PORT = 5174;

const PORT = process.env.PORT || parseInt(process.argv[2]) || DEFAULT_PORT;

// Function to proxy request to Vite dev server
function proxyToVite(req, res) {
  // Check if this is a WebSocket upgrade request (for Vite HMR)
  const isWebSocket = req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket';

  const options = {
    hostname: 'localhost',
    port: VITE_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // For WebSocket upgrades, we need to forward the 101 response
    if (isWebSocket || proxyRes.statusCode === 101) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      // Bidirectional pipe for WebSocket
      proxyRes.pipe(res);
      req.pipe(proxyReq);
      return;
    }

    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(
        '<h1>502 - Vite Dev Server Not Running</h1>' +
          '<p>Run: cd docs && npm run dev</p>',
        'utf-8'
      );
    }
  });

  // For non-WebSocket requests, pipe immediately
  if (!isWebSocket) {
    req.pipe(proxyReq);
  }
}

const server = http.createServer((req, res) => {
  let filePath;
  let serveFromReactBuild = false;

  // Serve dist files from /dist/* route (Blok editor bundle)
  if (req.url.startsWith('/dist/')) {
    filePath = path.join(BLOK_DIST_DIR, req.url.replace('/dist/', ''));
  } else if (DEV_MODE) {
    // In dev mode, proxy to Vite for React app
    proxyToVite(req, res);
    return;
  } else if (req.url.startsWith('/assets/')) {
    // Serve assets from React build
    filePath = path.join(DOCS_DIST_DIR, req.url);
    serveFromReactBuild = true;
  } else {
    // For routing, serve index.html from React build (SPA handling)
    const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;

    if (urlPath === '/' || urlPath.startsWith('/demo') || urlPath.startsWith('/api') || urlPath.startsWith('/migration')) {
      // SPA routes - serve index.html
      filePath = path.join(DOCS_DIST_DIR, 'index.html');
      serveFromReactBuild = true;
    } else {
      // Try to serve file from React build, fallback to index.html
      const directPath = path.join(DOCS_DIST_DIR, urlPath);
      if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
        filePath = directPath;
        serveFromReactBuild = true;
      } else {
        filePath = path.join(DOCS_DIST_DIR, 'index.html');
        serveFromReactBuild = true;
      }
    }
  }

  const extname = path.extname(filePath);
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // If React build file not found, serve index.html (SPA fallback)
        if (serveFromReactBuild) {
          const indexPath = path.join(DOCS_DIST_DIR, 'index.html');
          fs.readFile(indexPath, (indexErr, indexContent) => {
            if (indexErr) {
              res.writeHead(404, { 'Content-Type': 'text/html' });
              res.end('<h1>404 - Documentation not found</h1><p>Run: cd docs && npm run build</p>', 'utf-8');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(indexContent, 'utf-8');
            }
          });
        } else {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 - File Not Found</h1>', 'utf-8');
        }
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`, 'utf-8');
      }
      return;
    }

    // Set CORS headers for ES modules
    if (extname === '.mjs' || extname === '.js') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  });
});

server.listen(PORT, () => {
  console.log(`\nDocumentation server running at:`);
  console.log(`  > http://localhost:${PORT}\n`);

  if (DEV_MODE) {
    console.log(`Running in DEV mode (proxying to Vite at port ${VITE_PORT})`);
    console.log(`Make sure Vite is running: cd docs && npm run dev\n`);
  } else {
    console.log(`Running in PROD mode (serving pre-built files from docs/dist/)`);
    console.log(`To build: cd docs && npm run build\n`);
  }

  console.log(`Use DOCS_DEV=false to force production mode`);
  console.log(`Press Ctrl+C to stop.\n`);
});
