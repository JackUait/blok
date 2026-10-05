#!/usr/bin/env node
// Audits a built docs site against the route manifest and writes a JSON report.
//
// Usage: node docs/scripts/audit-build-output.mjs [--dir <built site>] [--report <file.json>]
// --dir defaults to docs/dist/client, a root (`--base /`) build. Exits 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { auditBuild } from './build-audit.mjs';

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: path.join(DOCS_ROOT, 'dist', 'client') },
    report: { type: 'string' },
  },
});

/** The same manifest modules generate-seo-artifacts.mjs and prerendering read. */
const loadPages = async () => {
  const server = await createServer({
    root: DOCS_ROOT,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: { alias: { '@': path.join(DOCS_ROOT, 'src') } },
  });
  try {
    const [paths, locales, metadata] = await Promise.all([
      server.ssrLoadModule('/src/prerender-paths.ts'),
      server.ssrLoadModule('/src/seo/locales.ts'),
      server.ssrLoadModule('/src/seo/route-metadata.ts'),
    ]);
    const pages = locales.localizedPrerenderPaths(paths.PRERENDER_PATHS).map((route) => {
      const meta = metadata.getRouteMetadata(route);
      if (!meta) throw new Error(`Route ${route} is prerendered but has no route metadata`);
      return {
        route,
        canonical: meta.canonical,
        noindex: Boolean(meta.noindex),
        mirror: locales.hasMarkdownMirror(meta),
      };
    });
    return { pages, siteUrl: metadata.SITE_URL };
  } finally {
    await server.close();
  }
};

const outDir = path.resolve(values.dir);
if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  throw new Error(`No built site at ${outDir}; run the docs build first.`);
}

const { pages, siteUrl } = await loadPages();
const result = auditBuild({ outDir, siteUrl, pages });
const report = { generatedAt: new Date().toISOString(), outDir, siteUrl, ...result };

if (values.report) {
  fs.mkdirSync(path.dirname(path.resolve(values.report)), { recursive: true });
  fs.writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`);
}

for (const { route, check, detail } of result.failures) {
  process.stdout.write(`FAIL  ${route ?? '(site)'} ${check}: ${detail}\n`);
}
const { summary } = result;
process.stdout.write(
  `Build audit: ${summary.pages} manifest pages, ${summary.indexable} indexable, ${summary.failures} failures\n`,
);
if (summary.failures > 0) process.exit(1);
