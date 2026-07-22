/**
 * Architectural enforcement: every addressable docs route carries unique,
 * bounded metadata, and the URL set the build prerenders equals the URL set the
 * sitemap advertises.
 *
 * The incident: until 2026-07-21 the docs site shipped ONE static `<head>` for
 * the whole property. Every one of the 65 addressable URLs — the homepage, the
 * playground, the migration guide, all 28 API modules and all 29 tool pages —
 * answered with the identical `<title>` and `<meta name="description">`, and
 * there was no sitemap at all. To a search engine that is not 65 pages, it is
 * one page with 64 duplicates: 57 documentation URLs were mutually
 * indistinguishable, so none of them could rank for the query they answered.
 *
 * The root-cause fix was a route-metadata layer (`docs/src/seo/route-metadata.ts`)
 * derived from the SAME data that drives the sidebar and the prerender manifest
 * (`MODULE_ORDER`, `TOOL_SECTIONS`, `STATIC_PATHS`), so a page cannot exist
 * without metadata and metadata cannot exist without a page. This law keeps all
 * three in lockstep — in particular the per-route UNIQUENESS assertions, which
 * are what would have turned that single site-wide title red on day one.
 *
 * Placement: this is a docs-tree law that lives at the repo root on purpose.
 * `docs/vitest.config.ts` collects only `docs/src/**`, and the docs suite runs
 * in the deploy workflow, not in the gating CI job. Root `test/unit/**` runs on
 * every push, so an SEO regression fails the check that actually blocks a
 * merge. `docs/dist` does not exist during a unit run, so nothing here asserts
 * on build output — that half is guarded by `docs-deploy-law.test.ts`.
 *
 * Constraint on what may be imported from here: the root `tsconfig.json`
 * excludes `docs/`, but an import still pulls the module into the root program.
 * These four are plain data modules. Importing a docs `.tsx` component would
 * drag in `docs/node_modules/@types/react` alongside the root copy and break
 * `yarn lint` with TS2322 — read those with `node:fs` instead, as the
 * navigation law does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_ORDER } from '../../../docs/src/components/api/api-nav';
import {
  DOCUMENTED_TOOL_ROUTE_PATHS,
  TOOL_SECTIONS,
} from '../../../docs/src/components/tools/tools-data';
import { PRERENDER_PATHS } from '../../../docs/src/prerender-paths';
import {
  ROUTE_METADATA,
  RU_ROUTE_METADATA,
  SITE_URL,
  type RouteMetadata,
} from '../../../docs/src/seo/route-metadata';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ROUTES_SOURCE = readFileSync(resolve(REPO_ROOT, 'docs/src/routes.ts'), 'utf8');
const ROBOTS_TXT = readFileSync(resolve(REPO_ROOT, 'docs/public/robots.txt'), 'utf8');

/**
 * Routes that are deliberately kept out of the sitemap. Every key MUST carry a
 * written reason; an empty one fails the test below, so silencing this law
 * always leaves a justification behind.
 */
const SITEMAP_EXEMPT_ROUTES: Record<string, string> = {
  '/tools':
    'Legacy index that client-side redirects into /docs; it canonicalises onto /docs/paragraph, ' +
    'so listing it would tell Google to index a URL that disavows itself.',
  '/404':
    'GitHub Pages serves the error page from the site root as 404.html. A sitemap entry would ' +
    'advertise a URL whose only job is to answer for URLs that do not exist.',
};

/** Both locale trees are real addressable URL sets, so both are held to the copy rules. */
const TREES: [locale: string, metadata: Record<string, RouteMetadata>][] = [
  ['en', ROUTE_METADATA],
  ['ru', RU_ROUTE_METADATA],
];

/**
 * The addressable paths declared in `docs/src/routes.ts`, normalised onto the
 * keys the metadata table uses. The Russian tree is the same route modules
 * behind a locale prefix, so it resolves to the same unprefixed keys.
 */
const declaredRoutePaths = (): string[] => {
  const declared = [...ROUTES_SOURCE.matchAll(/\broute\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const paths = new Set<string>(['/']); // index()

  for (const raw of declared) {
    const unprefixed = raw === 'ru' ? '' : raw.replace(/^ru\//, '');

    if (unprefixed === '') continue; // the localized home page, already covered by index()
    // `docs/*` is a splat whose own landing page is `/docs`; `*` is the 404.
    if (unprefixed === '*') paths.add('/404');
    else paths.add(`/${unprefixed.replace(/\/\*$/, '')}`);
  }

  return [...paths];
};

const duplicatesOf = (
  metadata: Record<string, RouteMetadata>,
  field: 'title' | 'description',
): string[] => {
  const owner = new Map<string, string>();
  const duplicates: string[] = [];

  for (const [path, meta] of Object.entries(metadata)) {
    const previous = owner.get(meta[field]);

    if (previous === undefined) owner.set(meta[field], path);
    else duplicates.push(`${previous} and ${path} share the ${field}: "${meta[field]}"`);
  }

  return duplicates;
};

describe('docs SEO surface law — route coverage', () => {
  it('gives every route declared in routes.ts an entry', () => {
    const missing = declaredRoutePaths().filter((path) => !(path in ROUTE_METADATA));

    expect(
      missing,
      `routes.ts declares addressable paths with no entry in docs/src/seo/route-metadata.ts: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('gives every API module and every documented tool an entry', () => {
    const ids = [...MODULE_ORDER, ...TOOL_SECTIONS.map((tool) => tool.id)];
    const missing = [...new Set(ids)].filter((id) => !(`/docs/${id}` in ROUTE_METADATA));

    expect(
      missing,
      `these appear in the sidebar but have no route metadata, so their page would ship with ` +
        `another page's title: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('prerenders exactly the routes it describes — no extras, no omissions', () => {
    const prerendered = [...PRERENDER_PATHS].sort();
    const described = Object.keys(ROUTE_METADATA).sort();

    expect(
      { onlyPrerendered: prerendered.filter((p) => !described.includes(p)),
        onlyDescribed: described.filter((p) => !prerendered.includes(p)) },
      'PRERENDER_PATHS and ROUTE_METADATA must be the same URL set: a prerendered page with no ' +
        'metadata ships a duplicate title, and metadata with no page is a sitemap URL that 404s.',
    ).toEqual({ onlyPrerendered: [], onlyDescribed: [] });
  });

  it('keeps a documented tool discoverable: a page AND a sitemap URL', () => {
    // Closes the loop opened by DOCUMENTED_BLOCK_TOOL_KEYS / DOCUMENTED_INLINE_TOOL_KEYS
    // in tools-data.ts, which already fail when a shipped tool has no docs entry.
    // Without this, a tool could be documented yet unreachable and unlisted.
    const undiscoverable = DOCUMENTED_TOOL_ROUTE_PATHS.filter(
      (path) => !(path in ROUTE_METADATA) || !PRERENDER_PATHS.includes(path) || ROUTE_METADATA[path].noindex,
    );

    expect(
      undiscoverable,
      `documented tools with no crawlable page or no sitemap URL: ${undiscoverable.join(', ')}`,
    ).toEqual([]);
  });
});

describe('docs SEO surface law — the sitemap equals the route set', () => {
  // The generator (docs/scripts/generate-seo-artifacts.mjs) lists every
  // prerendered route except the ones flagged noindex, so the sitemap's URL set
  // is decided here, in the metadata, and this is where it can be asserted
  // without a build.
  it('withholds a route from the sitemap only with a written reason', () => {
    const withheld = Object.entries(ROUTE_METADATA)
      .filter(([, meta]) => meta.noindex)
      .map(([path]) => path)
      .sort();

    expect(
      withheld,
      'a route dropped from the sitemap must be listed in SITEMAP_EXEMPT_ROUTES with the reason it is not indexable',
    ).toEqual(Object.keys(SITEMAP_EXEMPT_ROUTES).sort());
  });

  it('carries a non-empty reason for every exemption', () => {
    const unjustified = Object.entries(SITEMAP_EXEMPT_ROUTES)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([path]) => path);

    expect(unjustified, 'every sitemap exemption must state why').toEqual([]);
  });

  it('lists no exemption for a route that no longer exists', () => {
    const stale = Object.keys(SITEMAP_EXEMPT_ROUTES).filter((path) => !(path in ROUTE_METADATA));

    expect(stale, `stale sitemap exemptions: ${stale.join(', ')}`).toEqual([]);
  });
});

describe.each(TREES)('docs SEO surface law — %s copy', (_locale, metadata) => {
  const entries = (): [string, RouteMetadata][] => Object.entries(metadata);

  it('gives every route a non-empty h1', () => {
    const empty = entries()
      .filter(([, meta]) => meta.h1.trim().length === 0)
      .map(([path]) => path);

    expect(empty, `routes with no H1 — the strongest on-page relevance signal: ${empty.join(', ')}`).toEqual([]);
  });

  it('keeps every title within 60 characters', () => {
    const tooLong = entries()
      .filter(([, meta]) => meta.title.length > 60)
      .map(([path, meta]) => `${path} (${meta.title.length}): ${meta.title}`);

    expect(tooLong, `titles Google will truncate in the result: ${tooLong.join(' | ')}`).toEqual([]);
  });

  it('keeps every description between 70 and 155 characters', () => {
    const outOfBounds = entries()
      .filter(([, meta]) => meta.description.length < 70 || meta.description.length > 155)
      .map(([path, meta]) => `${path} (${meta.description.length}): ${meta.description}`);

    expect(
      outOfBounds,
      `descriptions too thin to be used or long enough to be truncated: ${outOfBounds.join(' | ')}`,
    ).toEqual([]);
  });

  it('uses a unique title for every route', () => {
    const duplicates = duplicatesOf(metadata, 'title');

    expect(
      duplicates,
      'two routes sharing a title is the exact defect this law exists for — a shared title makes ' +
        `the pages indistinguishable to a search engine: ${duplicates.join(' | ')}`,
    ).toEqual([]);
  });

  it('uses a unique description for every route', () => {
    const duplicates = duplicatesOf(metadata, 'description');

    expect(duplicates, `duplicate descriptions: ${duplicates.join(' | ')}`).toEqual([]);
  });
});

describe('docs SEO surface law — robots.txt', () => {
  it('advertises the sitemap on the canonical origin', () => {
    const sitemapLines = ROBOTS_TXT.split('\n').filter((line) => /^\s*Sitemap:/i.test(line));

    expect(sitemapLines, 'robots.txt must point crawlers at the sitemap').not.toEqual([]);
    expect(
      sitemapLines.map((line) => line.split(/:\s*/).slice(1).join(':').trim()),
      `every Sitemap: line must be absolute against ${SITE_URL}`,
    ).toEqual([`${SITE_URL}/sitemap.xml`]);
  });

  it('disallows nothing under /assets', () => {
    // Googlebot and Applebot are the only crawlers that execute JavaScript.
    // Blocking the hashed JS/CSS bundles would stop them rendering ANY page,
    // which is a far larger loss than whatever the Disallow was meant to hide.
    const blocked = ROBOTS_TXT.split('\n')
      .map((line) => line.trim())
      .filter((line) => /^Disallow:/i.test(line))
      .filter((line) => {
        // A robots rule is a prefix match, so both directions are a hit:
        // `Disallow: /assets/` blocks /assets/app.js, and `Disallow: /a` blocks
        // the whole directory too.
        const prefix = line.slice('Disallow:'.length).trim().replace(/\*.*$/, '');

        return prefix !== '' && (prefix.startsWith('/assets') || '/assets'.startsWith(prefix));
      });

    expect(blocked, `robots.txt blocks the render-critical bundles: ${blocked.join(' | ')}`).toEqual([]);
  });
});

describe('docs SEO surface law — non-vacuity floor', () => {
  // Without these, deleting the metadata module's contents (or a broken import
  // returning an empty object) would make every assertion above trivially pass.
  it('describes at least 60 routes in both locale trees', () => {
    expect(Object.keys(ROUTE_METADATA).length).toBeGreaterThanOrEqual(60);
    expect(Object.keys(RU_ROUTE_METADATA).length).toBeGreaterThanOrEqual(60);
  });

  it('still derives the route set from at least 55 modules and tools', () => {
    expect(MODULE_ORDER.length + TOOL_SECTIONS.length).toBeGreaterThanOrEqual(55);
  });

  it('reads a robots.txt and a routes.ts with real content', () => {
    expect(ROBOTS_TXT).toMatch(/User-agent:/i);
    expect(declaredRoutePaths().length).toBeGreaterThanOrEqual(7);
  });
});
