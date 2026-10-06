import { describe, expect, it } from 'vitest';
import { PRERENDER_PATHS } from '../prerender-paths';
import { buildJsonLd } from './jsonld';
import CHANGELOG from '../../../CHANGELOG.md?raw';
import { LASTMOD_LEDGER, lastModified, latestReleaseDate } from './lastmod';
import { localizedPrerenderPaths } from './locales';
import { nodeDigests } from '../../scripts/source-digest.mjs';
import { fingerprintRoutes, pageData } from './page-fingerprint';
import { getRouteMetadata } from './route-metadata';

const ROUTES = localizedPrerenderPaths(PRERENDER_PATHS);

const UPDATE_HINT = 'run `node docs/scripts/update-lastmod-ledger.mjs` and commit the ledger';

const articleDate = (route: string, path: string, locale: 'en' | 'ru'): unknown => {
  const meta = getRouteMetadata(route);
  if (!meta) throw new Error(`no metadata for ${route}`);
  const graph = buildJsonLd(path, meta, locale)['@graph'] as Record<string, unknown>[];
  const article = graph.find((node) => Array.isArray(node['@type']) && node['@type'].includes('TechArticle'));
  if (!article) throw new Error(`no TechArticle on ${route}`);
  return article.dateModified;
};

describe('lastmod ledger', () => {
  it('records exactly the prerendered routes', () => {
    expect(Object.keys(LASTMOD_LEDGER).sort(), UPDATE_HINT).toEqual([...ROUTES].sort());
  });

  it('matches every page as it is now', () => {
    const fingerprints = fingerprintRoutes(ROUTES, { ...pageData(), ...nodeDigests });
    const stale = ROUTES.filter((route) => LASTMOD_LEDGER[route]?.hash !== fingerprints[route]);

    expect(stale, `pages changed since the ledger was written; ${UPDATE_HINT}`).toEqual([]);
  });

  it('holds only calendar dates or null', () => {
    const malformed = Object.entries(LASTMOD_LEDGER).filter(
      ([, entry]) => entry.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date),
    );

    expect(malformed).toEqual([]);
  });
});

describe('TechArticle dateModified', () => {
  const dated = ROUTES.filter((route) => route.includes('/docs/') && LASTMOD_LEDGER[route]?.date);
  const undated = ROUTES.filter((route) => route.includes('/docs/') && !LASTMOD_LEDGER[route]?.date);

  it('is the ledger date, the same record the sitemap reads', () => {
    for (const route of dated) {
      const ru = route.startsWith('/ru/');
      const path = ru ? route.slice(3) : route;

      expect(articleDate(route, path, ru ? 'ru' : 'en'), route).toBe(lastModified(route));
    }
  });

  it('is omitted where the ledger has no date for the page', () => {
    for (const route of undated) {
      const ru = route.startsWith('/ru/');
      const path = ru ? route.slice(3) : route;

      expect(articleDate(route, path, ru ? 'ru' : 'en'), route).toBeUndefined();
    }
  });
});

describe('changelog date', () => {
  it('is the newest dated release heading', () => {
    const markdown =
      '# Changelog\n\n## [1.2.0](https://example.com/a) (2026-09-17)\n\n- a\n\n## [1.1.0](https://example.com/b) (2026-08-01)\n';

    expect(latestReleaseDate(markdown)).toBe('2026-09-17');
  });

  it('is absent when no release heading carries a date', () => {
    expect(latestReleaseDate('# Changelog\n\n## Unreleased\n\n- a\n')).toBeUndefined();
  });

  // Both trees render the same CHANGELOG.md; only the chrome is translated.
  it.each(['/changelog', '/ru/changelog'])('dates %s by its newest release, or its chrome if newer', (route) => {
    const release = latestReleaseDate(CHANGELOG);
    expect(release).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(lastModified(route)).toBe([release, LASTMOD_LEDGER[route].date].filter(Boolean).sort().at(-1));
  });
});
