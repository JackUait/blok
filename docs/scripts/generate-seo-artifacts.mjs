#!/usr/bin/env node
// Postbuild step: emits sitemap.xml, llms.txt, llms-full.txt and one .md mirror
// per prerendered route into dist/client (the directory the Pages workflow
// uploads as the deploy artifact).
//
// Every list here is derived from the SAME manifest that drives prerendering
// (`src/prerender-paths.ts` + `src/seo/route-metadata.ts`), so a route that is
// added to the site cannot be missing from the sitemap or from llms.txt.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  htmlToMarkdown,
  mirrorPathForRoute,
  renderLlmsFull,
  renderLlmsIndex,
  renderMarkdownMirror,
  renderSitemap,
} from './seo-artifacts.mjs';

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(DOCS_ROOT, '..');
const OUT_DIR = path.join(DOCS_ROOT, 'dist', 'client');

/**
 * Source files whose git history dates each static route. Docs routes are
 * handled generically below. A route with no mapping throws rather than
 * silently getting today's date.
 */
const STATIC_SOURCES = {
  '/': ['docs/src/pages/HomePage.tsx', 'docs/src/components/home'],
  '/demo': ['docs/src/pages/DemoPage.tsx'],
  '/docs': ['docs/src/components/api/DocsHub.tsx'],
  '/tools': ['docs/src/pages/ToolsPage.tsx'],
  '/migration': ['docs/src/pages/MigrationPage.tsx', 'docs/src/components/migration'],
  '/migration/reference': ['docs/src/pages/MigrationReferencePage.tsx'],
  '/changelog': ['CHANGELOG.md'],
  '/404': ['docs/src/routes/not-found.tsx'],
};

const API_DATA_SOURCE = 'docs/src/components/api/api-data.ts';
const TOOLS_DATA_SOURCE = 'docs/src/components/tools/tools-data.ts';

const gitDateCache = new Map();

const gitDate = (repoPath) => {
  if (!gitDateCache.has(repoPath)) {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', repoPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    gitDateCache.set(repoPath, iso.slice(0, 10));
  }
  return gitDateCache.get(repoPath);
};

/** Latest commit date (YYYY-MM-DD) touching any of the given repo paths. */
const lastCommitDate = (repoPaths) => {
  const newest = repoPaths.map(gitDate).filter(Boolean).sort().at(-1);
  // Empty when the file is added but not yet committed, and on a shallow CI
  // clone whose single commit did not touch it. Fall back to HEAD's date rather
  // than the filesystem, whose mtimes are the clone time in CI. (A `fetch-depth:
  // 0` checkout is what gives every page its own real date.)
  return newest ?? gitDate('.');
};

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
    const [paths, locales, metadata, nav, tools] = await Promise.all([
      server.ssrLoadModule('/src/prerender-paths.ts'),
      server.ssrLoadModule('/src/seo/locales.ts'),
      server.ssrLoadModule('/src/seo/route-metadata.ts'),
      server.ssrLoadModule('/src/components/api/api-nav.ts'),
      server.ssrLoadModule('/src/components/tools/tools-data.ts'),
    ]);
    return {
      // The very list react-router.config.ts prerenders from, locale trees
      // included, so a sitemap URL and an emitted HTML file cannot disagree.
      ROUTES: locales.localizedPrerenderPaths(paths.PRERENDER_PATHS),
      STATIC_PATHS: paths.STATIC_PATHS,
      DEFAULT_LOCALE: locales.DEFAULT_LOCALE,
      absoluteUrl: locales.absoluteUrl,
      splitLocalePath: locales.splitLocalePath,
      getRouteMetadata: metadata.getRouteMetadata,
      SITE_URL: metadata.SITE_URL,
      MODULE_ORDER: nav.MODULE_ORDER,
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
    DEFAULT_LOCALE,
    absoluteUrl,
    splitLocalePath,
    getRouteMetadata,
    SITE_URL,
    MODULE_ORDER,
    SIDEBAR_GROUPS,
    GROUP_TITLES_EN,
    TOOL_SECTIONS,
  } = manifest;

  if (!fs.existsSync(OUT_DIR)) {
    throw new Error(`Build output missing at ${OUT_DIR}; run the docs build first.`);
  }

  const toolIds = new Set(TOOL_SECTIONS.map((tool) => tool.id));

  const sourcesForRoute = (route) => {
    const { locale, path: unprefixed } = splitLocalePath(route);
    // A translated page also changes when its message catalogue does.
    const localeSource = locale === DEFAULT_LOCALE ? [] : [`docs/src/i18n/${locale}.json`];
    if (STATIC_SOURCES[unprefixed]) return [...STATIC_SOURCES[unprefixed], ...localeSource];
    const id = unprefixed.replace(/^\/docs\//, '');
    if (MODULE_ORDER.includes(id)) return [API_DATA_SOURCE, ...localeSource];
    if (toolIds.has(id)) return [TOOLS_DATA_SOURCE, ...localeSource];
    throw new Error(`No lastmod source mapped for route ${route}`);
  };

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
    return {
      route,
      metadata,
      lastmod: lastCommitDate(sourcesForRoute(route)),
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
  const mirrors = pages.map((page) => {
    const file = path.join(OUT_DIR, mirrorPathForRoute(page.route));
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
        .filter(({ page }) => !page.metadata.noindex && isDefaultLocale(page.route))
        .map(({ content }) => content),
    }),
  );

  const linkCount = sections.reduce((total, { links }) => total + links.length, 0);
  process.stdout.write(
    `SEO artifacts: sitemap.xml (${indexable.length} urls), ` +
      `${mirrors.length} markdown mirrors, llms.txt (${linkCount} links)\n`,
  );
};

await main();
