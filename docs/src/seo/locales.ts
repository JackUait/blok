// docs/src/seo/locales.ts
import type { Locale } from '../i18n';

/** Production origin. Canonicals, og:url and JSON-LD ids are all absolute against it. */
export const SITE_URL = 'https://blokeditor.com';

/** Every locale the site is published in, in the order hreflang lists them. */
export const LOCALES: readonly Locale[] = ['en', 'ru'];

/** The locale served from the site root, with no path prefix. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Locale is part of the address, not client state: `docs/public/CNAME` pins one
 * apex domain to one Pages site, so a subdomain would mean a second site and
 * split authority, and query parameters are Google's least-preferred i18n
 * signal. That leaves a path prefix.
 */
export const LOCALE_PREFIX: Record<Locale, string> = { en: '', ru: '/ru' };

export const OG_LOCALE: Record<Locale, string> = { en: 'en_US', ru: 'ru_RU' };

/** The `<html lang>` value written into each prerendered file. */
export const HTML_LANG: Record<Locale, string> = { en: 'en', ru: 'ru' };

export interface LocalePath {
  locale: Locale;
  /** The path with the locale prefix removed — the key every route table uses. */
  path: string;
}

const stripTrailingSlash = (pathname: string): string =>
  pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname || '/';

/** Split `/ru/docs/table` into its locale and the unprefixed `/docs/table`. */
export const splitLocalePath = (pathname: string): LocalePath => {
  const normalized = stripTrailingSlash(pathname);

  for (const locale of LOCALES) {
    const prefix = LOCALE_PREFIX[locale];
    if (!prefix) continue;
    if (normalized === prefix) return { locale, path: '/' };
    // A whole segment only: `/rules` is not the Russian tree.
    if (normalized.startsWith(`${prefix}/`)) {
      return { locale, path: normalized.slice(prefix.length) };
    }
  }

  return { locale: DEFAULT_LOCALE, path: normalized };
};

/** The address of an unprefixed path in a given locale. */
export const localizedPath = (path: string, locale: Locale): string => {
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix) return path;
  return path === '/' ? prefix : `${prefix}${path}`;
};

/**
 * The absolute address a path is actually *served* at — the one and only form
 * every advertised URL must take: canonical, og:url, hreflang, sitemap `<loc>`,
 * JSON-LD ids, llms.txt links and the markdown mirrors' `source:`.
 *
 * The build emits directory indexes only (`docs/table/index.html`, never
 * `docs/table.html`), and GitHub Pages serves those at `<path>/` while
 * 301-redirecting `<path>`. Advertising the slashless form therefore pointed
 * every one of those surfaces at a redirect — a canonical that redirected away
 * from the page declaring it, and hreflang hrefs Google ignores for exactly
 * that reason. Now `/docs/table` redirects *into* the canonical instead.
 */
export const absoluteUrl = (pathname: string): string =>
  `${SITE_URL}${pathname.endsWith('/') ? pathname : `${pathname}/`}`;

/**
 * Both trees, so the build emits a real HTML file for every locale. `/404` is
 * excluded from the prefixed trees: GitHub Pages serves a single `404.html`
 * from the site root, so a `/ru/404` file could never be reached.
 */
export const localizedPrerenderPaths = (paths: readonly string[]): string[] => [
  ...paths,
  ...LOCALES.filter((locale) => locale !== DEFAULT_LOCALE).flatMap((locale) =>
    paths.filter((path) => path !== '/404').map((path) => localizedPath(path, locale)),
  ),
];

export interface AlternateUrl {
  /**
   * Lower-case on purpose. These go through `createElement('link', props)`, and
   * React 19 emits the prop name verbatim there — a camelCase `hrefLang` still
   * parses (HTML attribute names are case-insensitive) but no audit tool, and no
   * grep of the built file, would ever find it.
   */
  hreflang: string;
  href: string;
}

/**
 * The reciprocal hreflang set for one page. Every locale's copy of a page emits
 * the identical set — that reciprocity is what makes Google honour it at all.
 */
export const alternateUrls = (path: string): AlternateUrl[] => [
  ...LOCALES.map((locale) => ({
    hreflang: locale,
    href: absoluteUrl(localizedPath(path, locale)),
  })),
  { hreflang: 'x-default', href: absoluteUrl(localizedPath(path, DEFAULT_LOCALE)) },
];
