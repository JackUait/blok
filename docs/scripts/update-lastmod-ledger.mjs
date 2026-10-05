#!/usr/bin/env node
// Re-dates the pages whose content changed since docs/src/seo/lastmod-ledger.json
// was last written. Run it in the same commit as the content change; the
// lastmod-ledger test fails until you do. Unchanged pages keep their date, so
// running it twice, or on a tree with no content change, rewrites nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { nodeDigests } from './source-digest.mjs';

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = path.join(DOCS_ROOT, 'src', 'seo', 'lastmod-ledger.json');

const server = await createServer({
  root: DOCS_ROOT,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { '@': path.join(DOCS_ROOT, 'src') } },
});

try {
  const [paths, locales, fingerprint, lastmod] = await Promise.all([
    server.ssrLoadModule('/src/prerender-paths.ts'),
    server.ssrLoadModule('/src/seo/locales.ts'),
    server.ssrLoadModule('/src/seo/page-fingerprint.ts'),
    server.ssrLoadModule('/src/seo/lastmod.ts'),
  ]);
  const routes = locales.localizedPrerenderPaths(paths.PRERENDER_PATHS);
  const previous = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const fingerprints = fingerprint.fingerprintRoutes(routes, { ...fingerprint.pageData(), ...nodeDigests });
  const next = lastmod.mergeLedger(previous, fingerprints, today);

  const changed = Object.keys(next).filter((route) => previous[route]?.hash !== next[route].hash);
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(
    changed.length > 0
      ? `lastmod ledger: ${changed.length} page(s) dated ${today}: ${changed.join(', ')}\n`
      : 'lastmod ledger: no page changed\n',
  );
} finally {
  await server.close();
}
