import { describe, expect, it } from 'vitest';
import { PRERENDER_PATHS } from '../prerender-paths';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_PREFIX,
  OG_LOCALE,
  absoluteUrl,
  alternateUrls,
  localizedPath,
  localizedPrerenderPaths,
  hasMarkdownMirror,
  markdownMirrorPath,
  markdownMirrorUrl,
  splitLocalePath,
  servedPath,
} from './locales';
import { SITE_URL } from './route-metadata';

describe('locale constants', () => {
  it('serves the default locale from the site root and every other locale from a prefix', () => {
    expect(LOCALE_PREFIX[DEFAULT_LOCALE]).toBe('');
    const prefixed = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);
    expect(prefixed.length).toBeGreaterThan(0);
    for (const locale of prefixed) {
      expect(LOCALE_PREFIX[locale]).toBe(`/${locale}`);
    }
  });

  it('gives every locale an og:locale value', () => {
    expect(LOCALES.map((locale) => OG_LOCALE[locale])).toEqual(['en_US', 'ru_RU']);
  });
});

describe('splitLocalePath', () => {
  it('reads the default locale from an unprefixed path', () => {
    expect(splitLocalePath('/docs/table')).toEqual({ locale: 'en', path: '/docs/table' });
  });

  it('reads the locale from the first segment and strips it', () => {
    expect(splitLocalePath('/ru/docs/table')).toEqual({ locale: 'ru', path: '/docs/table' });
  });

  it('maps a bare locale prefix onto the site root', () => {
    expect(splitLocalePath('/ru')).toEqual({ locale: 'ru', path: '/' });
    expect(splitLocalePath('/ru/')).toEqual({ locale: 'ru', path: '/' });
  });

  it('only matches a whole segment, so a path that merely starts with the letters is untouched', () => {
    expect(splitLocalePath('/rules')).toEqual({ locale: 'en', path: '/rules' });
  });

  it('normalises a trailing slash', () => {
    expect(splitLocalePath('/docs/table/')).toEqual({ locale: 'en', path: '/docs/table' });
    expect(splitLocalePath('/')).toEqual({ locale: 'en', path: '/' });
  });
});

describe('localizedPath', () => {
  it('round-trips through splitLocalePath for every locale', () => {
    for (const locale of LOCALES) {
      for (const path of ['/', '/demo', '/docs/quick-start']) {
        expect(splitLocalePath(localizedPath(path, locale))).toEqual({ locale, path });
      }
    }
  });

  it('leaves the default locale unprefixed', () => {
    expect(localizedPath('/docs/table', 'en')).toBe('/docs/table');
    expect(localizedPath('/', 'en')).toBe('/');
  });

  it('never produces a trailing slash on the bare locale root', () => {
    expect(localizedPath('/', 'ru')).toBe('/ru');
  });
});

describe('localizedPrerenderPaths', () => {
  const paths = localizedPrerenderPaths(PRERENDER_PATHS);

  it('keeps every English path', () => {
    const missing = PRERENDER_PATHS.filter((path) => !paths.includes(path));
    expect(missing).toEqual([]);
  });

  it('adds a Russian twin for every English path except the error page', () => {
    const missing = PRERENDER_PATHS.filter(
      (path) => path !== '/404' && !paths.includes(localizedPath(path, 'ru')),
    );
    expect(missing).toEqual([]);
  });

  it('leaves the error page out of the Russian tree, since Pages serves one 404.html', () => {
    expect(paths).not.toContain('/ru/404');
  });

  it('emits no duplicates', () => {
    expect(paths.length).toBe(new Set(paths).size);
  });
});

// The build emits directory indexes only — `docs/table/index.html`, never
// `docs/table.html` — and GitHub Pages serves those at `<path>/` while
// 301-redirecting `<path>`. Advertising the slashless form pointed every
// canonical, sitemap <loc>, hreflang href, og:url, JSON-LD id and llms.txt link
// at a redirect: not one URL the site claimed answered 200.
describe('absoluteUrl', () => {
  it('addresses a directory index with the trailing slash Pages serves', () => {
    expect(absoluteUrl('/docs/table')).toBe(`${SITE_URL}/docs/table/`);
    expect(absoluteUrl('/ru/docs/table')).toBe(`${SITE_URL}/ru/docs/table/`);
    expect(absoluteUrl('/ru')).toBe(`${SITE_URL}/ru/`);
  });

  it('leaves the site root as a bare slash rather than doubling it', () => {
    expect(absoluteUrl('/')).toBe(`${SITE_URL}/`);
  });

  it('is idempotent, so a path that already ends in a slash is unchanged', () => {
    expect(absoluteUrl('/docs/table/')).toBe(`${SITE_URL}/docs/table/`);
  });
});

describe('alternateUrls', () => {
  it('emits one absolute URL per locale plus x-default, pointing at the default locale', () => {
    expect(alternateUrls('/docs/table')).toEqual([
      { hreflang: 'en', href: `${SITE_URL}/docs/table/` },
      { hreflang: 'ru', href: `${SITE_URL}/ru/docs/table/` },
      { hreflang: 'x-default', href: `${SITE_URL}/docs/table/` },
    ]);
  });

  it('is reciprocal: the same set is emitted whichever locale asked for it', () => {
    expect(alternateUrls(splitLocalePath('/ru/demo').path)).toEqual(alternateUrls('/demo'));
  });

  it('names the served address of each locale root', () => {
    expect(alternateUrls('/')).toEqual([
      { hreflang: 'en', href: `${SITE_URL}/` },
      { hreflang: 'ru', href: `${SITE_URL}/ru/` },
      { hreflang: 'x-default', href: `${SITE_URL}/` },
    ]);
  });
});

describe('markdownMirrorPath', () => {
  it('maps every route to a sibling .md file', () => {
    expect(markdownMirrorPath('/')).toBe('/index.md');
    expect(markdownMirrorPath('/demo')).toBe('/demo.md');
    expect(markdownMirrorPath('/docs/table')).toBe('/docs/table.md');
    expect(markdownMirrorPath('/migration/reference')).toBe('/migration/reference.md');
  });

  it('resolves the served trailing-slash form to the same file', () => {
    expect(markdownMirrorPath('/docs/table/')).toBe(markdownMirrorPath('/docs/table'));
    expect(markdownMirrorPath('/ru/')).toBe(markdownMirrorPath('/ru'));
  });

  it('keeps the locale tree separate', () => {
    expect(markdownMirrorPath('/ru')).toBe('/ru.md');
    expect(markdownMirrorPath('/ru/docs/table')).toBe('/ru/docs/table.md');
  });

  it('never produces the same file for two different prerendered routes', () => {
    const files = localizedPrerenderPaths(PRERENDER_PATHS).map(markdownMirrorPath);

    expect(new Set(files).size).toBe(files.length);
  });
});

// One rule, one definition: the head <link>, the in-body pointer and the build
// step that writes the files all ask this, so the site cannot name a mirror the
// build did not emit.
describe('hasMarkdownMirror', () => {
  it('gives an ordinary route a mirror', () => {
    expect(hasMarkdownMirror({})).toBe(true);
    expect(hasMarkdownMirror({ noindex: false })).toBe(true);
  });

  it('withholds one from a noindex route', () => {
    expect(hasMarkdownMirror({ noindex: true })).toBe(false);
  });

  it('withholds one from a path that is not a route at all', () => {
    expect(hasMarkdownMirror(undefined)).toBe(false);
  });
});

describe('markdownMirrorUrl', () => {
  it('is absolute, so a mirror fetched on its own still names its origin', () => {
    expect(markdownMirrorUrl('/docs/table')).toBe(`${SITE_URL}/docs/table.md`);
    expect(markdownMirrorUrl('/')).toBe(`${SITE_URL}/index.md`);
  });
});

// GitHub Pages emits directory indexes only, so it answers `/docs/table/` with
// the page and 301-redirects `/docs/table` onto it. `absoluteUrl` already
// enforces that for advertised URLs (canonical, sitemap, hreflang); this is its
// site-relative twin for the hrefs the app renders, which were slashless and so
// spent a redirect on every internal hop a crawler took.
describe('servedPath', () => {
  it('adds the trailing slash GitHub Pages redirects to', () => {
    expect(servedPath('/docs/table')).toBe('/docs/table/');
  });

  it('leaves an address that already has one alone', () => {
    expect(servedPath('/docs/table/')).toBe('/docs/table/');
  });

  it('keeps the site root a single slash', () => {
    expect(servedPath('/')).toBe('/');
  });

  it('passes through anything that is not a site-absolute path', () => {
    expect(servedPath('#main-content')).toBe('#main-content');
    expect(servedPath('https://example.com/x')).toBe('https://example.com/x');
  });

  // The slash belongs on the path, never after the query or the fragment.
  it('puts the slash before a query string or a fragment', () => {
    expect(servedPath('/docs/table?tab=api')).toBe('/docs/table/?tab=api');
    expect(servedPath('/docs/table#merged-cells')).toBe('/docs/table/#merged-cells');
  });
});
