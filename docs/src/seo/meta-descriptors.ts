// docs/src/seo/meta-descriptors.ts
import { buildJsonLd } from './jsonld';
import { LOCALES, OG_LOCALE, alternateUrls, splitLocalePath } from './locales';
import { ROUTE_METADATA, getRouteMetadata } from './route-metadata';

/**
 * A React Router meta descriptor. `title` renders <title>, `tagName: 'link'`
 * renders a <link>, `script:ld+json` renders a JSON-LD block, and anything else
 * renders a <meta> with the given attributes.
 */
export type MetaDescriptor = Record<string, unknown>;

const SITE_NAME = 'Blok';

/**
 * Every head tag for one route, built from the single route-metadata source.
 *
 * Emitted through React Router's own `<Meta />` pipeline rather than React 19's
 * tag hoisting: `root.tsx` already renders `<Meta />`, and a hoisted `<title>`
 * would sit alongside the one `<Meta />` emits instead of replacing it.
 */
export const buildMetaDescriptors = (pathname: string): MetaDescriptor[] => {
  const meta = getRouteMetadata(pathname);

  if (!meta) {
    // Unknown path — the router will land on the not-found route, which exports
    // its own meta. Give crawlers the site defaults, and no canonical, rather
    // than a canonical pointing at a URL that does not exist.
    const home = ROUTE_METADATA['/'];
    return [
      { title: home.title },
      { name: 'description', content: home.description },
      { name: 'robots', content: 'noindex, follow' },
    ];
  }

  // The locale lives in the path, so every lookup below works on the unprefixed
  // path: `/ru/docs/table` and `/docs/table` are the same page in two languages.
  const { locale, path } = splitLocalePath(pathname);

  return [
    { title: meta.title },
    { name: 'description', content: meta.description },
    ...(meta.noindex ? [{ name: 'robots', content: 'noindex, follow' }] : []),
    { tagName: 'link', rel: 'canonical', href: meta.canonical },

    // Reciprocal on both trees — an unreciprocated hreflang set is ignored
    // outright. Omitted where the page is noindex, which hreflang cannot rescue.
    ...(meta.noindex
      ? []
      : alternateUrls(path).map((alternate) => ({
          tagName: 'link',
          rel: 'alternate',
          ...alternate,
        }))),

    // Only the reference pages are articles; the landing, playground, migration
    // and changelog routes are ordinary site pages.
    { property: 'og:type', content: path.startsWith('/docs/') ? 'article' : 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: OG_LOCALE[locale] },
    ...LOCALES.filter((other) => other !== locale).map((other) => ({
      property: 'og:locale:alternate',
      content: OG_LOCALE[other],
    })),
    { property: 'og:url', content: meta.canonical },
    { property: 'og:title', content: meta.title },
    { property: 'og:description', content: meta.description },
    { property: 'og:image', content: meta.ogImage },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: `${SITE_NAME} — ${meta.h1}` },

    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: meta.title },
    { name: 'twitter:description', content: meta.description },
    { name: 'twitter:image', content: meta.ogImage },
    { name: 'twitter:image:alt', content: `${SITE_NAME} — ${meta.h1}` },

    { 'script:ld+json': buildJsonLd(path, meta, locale) },
  ];
};
