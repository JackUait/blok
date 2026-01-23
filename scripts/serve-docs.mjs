#!/usr/bin/env node

/**
 * Simple HTTP server for serving documentation files
 * Usage: node scripts/serve-docs.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../docs');
const DIST_DIR = path.resolve(__dirname, '../dist');
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

const PORT = process.env.PORT || parseInt(process.argv[2]) || DEFAULT_PORT;

const server = http.createServer((req, res) => {
  let filePath;

  // Serve dist files from /dist/* route
  if (req.url.startsWith('/dist/')) {
    filePath = path.join(DIST_DIR, req.url.replace('/dist/', ''));
  } else {
    // Serve docs files
    filePath = path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url);
  }

  const extname = path.extname(filePath);
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>', 'utf-8');
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
  console.log(`Press Ctrl+C to stop.\n`);
});
