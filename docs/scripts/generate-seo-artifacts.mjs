#!/usr/bin/env node
// Postbuild step: emits sitemap.xml, llms.txt, llms-full.txt and one .md mirror
// per prerendered route into dist/client (the directory the Pages workflow
// uploads as the deploy artifact).
//
// Every list here is derived from the SAME manifest that drives prerendering
// (`src/prerender-paths.ts` + `src/seo/route-metadata.ts`), so a route that is
// added to the site cannot be missing from the sitemap or from llms.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { nodeDigests } from './source-digest.mjs';
import {
  htmlToMarkdown,
  renderLlmsFull,
  renderLlmsIndex,
  renderMarkdownMirror,
  renderSitemap,
} from './seo-artifacts.mjs';

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(DOCS_ROOT, 'dist', 'client');

/** Loads the app's TypeScript manifest modules without a separate build step. */
const loadManifest = async () => {
  const server = await createServer({
    root: DOCS_ROOT,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: { alias: { '@': path.join(DOCS_ROOT, 'src') } },
  });
  try {
    const [paths, locales, metadata, nav, tools, fingerprint, lastmod] = await Promise.all([
      server.ssrLoadModule('/src/prerender-paths.ts'),
      server.ssrLoadModule('/src/seo/locales.ts'),
      server.ssrLoadModule('/src/seo/route-metadata.ts'),
      server.ssrLoadModule('/src/components/api/api-nav.ts'),
      server.ssrLoadModule('/src/components/tools/tools-data.ts'),
      server.ssrLoadModule('/src/seo/page-fingerprint.ts'),
      server.ssrLoadModule('/src/seo/lastmod.ts'),
    ]);
    const routes = locales.localizedPrerenderPaths(paths.PRERENDER_PATHS);
    return {
      // The very list react-router.config.ts prerenders from, locale trees
      // included, so a sitemap URL and an emitted HTML file cannot disagree.
      ROUTES: routes,
      // Computed while the module server is up: it reads the page sources.
      FINGERPRINTS: fingerprint.fingerprintRoutes(routes, { ...fingerprint.pageData(), ...nodeDigests }),
      LASTMOD_LEDGER: lastmod.LASTMOD_LEDGER,
      lastModified: lastmod.lastModified,
      STATIC_PATHS: paths.STATIC_PATHS,
      DEFAULT_LOCALE: locales.DEFAULT_LOCALE,
      absoluteUrl: locales.absoluteUrl,
      hasMarkdownMirror: locales.hasMarkdownMirror,
      markdownMirrorPath: locales.markdownMirrorPath,
      splitLocalePath: locales.splitLocalePath,
      getRouteMetadata: metadata.getRouteMetadata,
      SITE_URL: metadata.SITE_URL,
      SIDEBAR_GROUPS: nav.SIDEBAR_GROUPS,
      GROUP_TITLES_EN: nav.GROUP_TITLES_EN,
      TOOL_SECTIONS: tools.TOOL_SECTIONS,
    };
  } finally {
    await server.close();
  }
};

const main = async () => {
  const manifest = await loadManifest();
  const {
    ROUTES,
    FINGERPRINTS,
    LASTMOD_LEDGER,
    lastModified,
    DEFAULT_LOCALE,
    absoluteUrl,
    hasMarkdownMirror,
    markdownMirrorPath,
    splitLocalePath,
    getRouteMetadata,
    SITE_URL,
    SIDEBAR_GROUPS,
    GROUP_TITLES_EN,
    TOOL_SECTIONS,
  } = manifest;

  if (!fs.existsSync(OUT_DIR)) {
    throw new Error(`Build output missing at ${OUT_DIR}; run the docs build first.`);
  }

  // The prerendered HTML already carries the ledger's dateModified, so a stale
  // entry cannot be patched here; it has to be fixed at the source.
  const stale = ROUTES.filter((route) => LASTMOD_LEDGER[route]?.hash !== FINGERPRINTS[route]);
  if (stale.length > 0) {
    throw new Error(
      `Pages changed since the lastmod ledger was written: ${stale.join(', ')}. ` +
        'Run `node docs/scripts/update-lastmod-ledger.mjs` and commit docs/src/seo/lastmod-ledger.json.',
    );
  }

  // Route -> { metadata, lastmod, markdown }, built once and reused by all
  // three artifacts so they cannot disagree about what the site contains.
  const pages = ROUTES.map((route) => {
    const metadata = getRouteMetadata(route);
    if (!metadata) throw new Error(`Route ${route} is prerendered but has no route metadata`);

    const htmlPath = path.join(OUT_DIR, route === '/' ? 'index.html' : `${route.slice(1)}/index.html`);
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Route ${route} is in the prerender manifest but ${htmlPath} was not emitted`);
    }

    const dom = new JSDOM(fs.readFileSync(htmlPath, 'utf8'));
    // A page with a mirror advertises it twice — a <link rel="alternate"> in the
    // head and the visually hidden pointer in the body — and neither may name a
    // file this run does not write. Routes without one must advertise nothing,
    // which the same predicate decides on both sides.
    if (hasMarkdownMirror(metadata)) {
      const advertised = dom.window.document
        .querySelector('link[rel="alternate"][type="text/markdown"]')
        ?.getAttribute('href');
      const expected = `${SITE_URL}${markdownMirrorPath(route)}`;
      if (advertised !== expected) {
        throw new Error(
          `Route ${route} advertises markdown mirror ${advertised ?? '(none)'}; expected ${expected}`,
        );
      }
      if (!(dom.window.document.body.textContent ?? '').includes(expected)) {
        throw new Error(`Route ${route} renders no visible-to-agents pointer at ${expected}`);
      }
    } else if (dom.window.document.querySelector('link[rel="alternate"][type="text/markdown"]')) {
      throw new Error(`Route ${route} advertises a markdown mirror this run does not write`);
    }

    return {
      route,
      metadata,
      // Undefined means no page-specific date is known: emit none.
      lastmod: lastModified(route),
      body: htmlToMarkdown(dom.window.document.body, { siteUrl: SITE_URL }),
    };
  });

  const indexable = pages.filter((page) => !page.metadata.noindex);

  // --- sitemap.xml -----------------------------------------------------------
  // noindex routes are excluded on purpose: listing a page you tell Google not
  // to index is a contradictory signal, and `/tools` canonicalises elsewhere.
  const expectedLoc = (route) => absoluteUrl(route);
  for (const page of indexable) {
    if (page.metadata.canonical !== expectedLoc(page.route)) {
      throw new Error(
        `Indexable route ${page.route} canonicalises to ${page.metadata.canonical}; ` +
          'it must self-canonicalise or be marked noindex.',
      );
    }
    // The advertised address must be the one the host answers 200 for. Only
    // `<path>/index.html` is emitted, and GitHub Pages 301s `<path>` to
    // `<path>/`, so a `<loc>` without the slash is a redirect — which is what
    // shipped in every canonical, hreflang href and llms.txt link before this.
    if (!page.metadata.canonical.endsWith('/')) {
      throw new Error(
        `Indexable route ${page.route} advertises ${page.metadata.canonical}, which GitHub ` +
          'Pages 301-redirects; only the trailing-slash form is served directly.',
      );
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'sitemap.xml'),
    renderSitemap(indexable.map((page) => ({ loc: page.metadata.canonical, lastmod: page.lastmod }))),
  );

  // --- markdown mirrors ------------------------------------------------------
  const mirrors = pages
    .filter((page) => hasMarkdownMirror(page.metadata))
    .map((page) => {
      const file = path.join(OUT_DIR, markdownMirrorPath(page.route).slice(1));
      const content = renderMarkdownMirror({
        title: page.metadata.title,
        description: page.metadata.description,
        source: expectedLoc(page.route),
        lastmod: page.lastmod,
        body: page.body,
      });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return { page, content };
    });

  // --- llms.txt / llms-full.txt ----------------------------------------------
  const byRoute = new Map(indexable.map((page) => [page.route, page]));
  const linkFor = (route) => {
    const page = byRoute.get(route);
    return page
      ? { title: page.metadata.h1, url: expectedLoc(route), description: page.metadata.description }
      : undefined;
  };
  const section = (heading, routes) => {
    const links = routes.map(linkFor).filter(Boolean);
    return links.length > 0 ? { heading, links } : undefined;
  };

  const sections = [
    section('Site', manifest.STATIC_PATHS),
    ...SIDEBAR_GROUPS.map((group) =>
      section(
        GROUP_TITLES_EN[group.key] ?? group.key,
        group.moduleIds.map((id) => `/docs/${id}`),
      ),
    ),
    section(
      'Block tools',
      TOOL_SECTIONS.filter((tool) => tool.type === 'block').map((tool) => `/docs/${tool.id}`),
    ),
    section(
      'Inline tools',
      TOOL_SECTIONS.filter((tool) => tool.type === 'inline').map((tool) => `/docs/${tool.id}`),
    ),
  ].filter(Boolean);

  // Both files cover the default locale only: they are an agent index of the
  // x-default tree, and duplicating every page in every language would double
  // the file for no retrieval gain.
  const isDefaultLocale = (route) => splitLocalePath(route).locale === DEFAULT_LOCALE;
  const summary = getRouteMetadata('/').description;
  fs.writeFileSync(
    path.join(OUT_DIR, 'llms.txt'),
    renderLlmsIndex({ title: 'Blok', summary, sections }),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'llms-full.txt'),
    renderLlmsFull({
      title: 'Blok',
      summary,
      documents: mirrors
        .filter(({ page }) => isDefaultLocale(page.route))
        .map(({ content }) => content),
    }),
  );

  // --- unreferenced HTML ------------------------------------------------------
  // Two files ship that nothing links to and no route needs, and both answer
  // 200. `__spa-fallback.html` is react-router's client-routing fallback, which
  // GitHub Pages can never serve (it has no rewrite rules — an unknown path
  // gets 404.html), and it carries the HOME PAGE's title and canonical with no
  // `noindex`: a crawlable duplicate of `/`. `404/index.html` has already been
  // copied to the `404.html` GitHub Pages actually serves, so the directory
  // form only adds a second URL answering 200 with a "not found" body.
  //
  // Removed here rather than in the build script because everything above still
  // needs `404/index.html` on disk to read its metadata.
  const unreferenced = ['__spa-fallback.html', path.join('404', 'index.html')];
  for (const file of unreferenced) {
    const full = path.join(OUT_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(`Expected ${file} in the build output; the prerender shape changed`);
    }
    fs.rmSync(full);
  }
  fs.rmdirSync(path.join(OUT_DIR, '404'));

  const linkCount = sections.reduce((total, { links }) => total + links.length, 0);
  process.stdout.write(
    `SEO artifacts: sitemap.xml (${indexable.length} urls), ` +
      `${mirrors.length} markdown mirrors, llms.txt (${linkCount} links)\n`,
  );
};

await main();
