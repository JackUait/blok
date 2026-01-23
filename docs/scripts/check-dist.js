#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '..', '..', 'dist', 'full.mjs');

if (!fs.existsSync(distPath)) {
  console.error('❌ Blok dist not found.');
  console.error('   Run: npm run build');
  process.exit(1);
}

console.log('✓ Blok dist found');
