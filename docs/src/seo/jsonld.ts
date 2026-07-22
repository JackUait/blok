// docs/src/seo/jsonld.ts
import type { Locale } from '../i18n';
import { BLOK_VERSION } from '../utils/constants';
import { DEFAULT_LOCALE, SITE_URL, absoluteUrl, localizedPath } from './locales';
import { getRouteMetadata, type RouteMetadata } from './route-metadata';

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

/** The locale tree's own root URL, used as the WebSite's `url`. */
const localeHome = (locale: Locale): string => absoluteUrl(localizedPath('/', locale));

/**
 * One WebSite node per locale tree. A single shared id would make every Russian
 * page restate the same `@id` with a different `inLanguage`, which is a
 * contradiction rather than a translation.
 */
const websiteId = (locale: Locale): string => `${localeHome(locale)}#website`;

const REPO_URL = 'https://github.com/JackUait/blok';

/** Root LICENSE + package.json both say Apache-2.0. */
const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

export type JsonLdNode = Record<string, unknown>;

const organization = (): JsonLdNode => ({
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'Blok',
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/android-chrome-512x512.png`,
  sameAs: [REPO_URL, 'https://www.npmjs.com/package/@bloklabs/core'],
});

const website = (locale: Locale): JsonLdNode => ({
  '@type': 'WebSite',
  '@id': websiteId(locale),
  url: localeHome(locale),
  name: 'Blok',
  // The site's own description in the locale being served — that is the home
  // page's, not the current page's.
  description: getRouteMetadata(localizedPath('/', locale))?.description,
  inLanguage: locale,
  publisher: { '@id': ORGANIZATION_ID },
  // Deliberately no `potentialAction`/SearchAction: Google retired the
  // sitelinks searchbox on 2024-11-21, so the markup earns nothing.
});

/**
 * SoftwareApplication needs `offers` plus `aggregateRating` or `review` to be
 * eligible for a rich result. Blok is free, so `price: "0"` is truthful; there
 * is no rating to state (GitHub stars are not one), so the markup stays valid
 * and simply earns no rich result. That is the correct trade.
 */
const softwareApplication = (meta: RouteMetadata): JsonLdNode => ({
  '@type': 'SoftwareApplication',
  name: 'Blok',
  url: `${SITE_URL}/`,
  description: meta.description,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web browser',
  softwareVersion: BLOK_VERSION,
  license: LICENSE_URL,
  publisher: { '@id': ORGANIZATION_ID },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
});

const softwareSourceCode = (meta: RouteMetadata): JsonLdNode => ({
  '@type': 'SoftwareSourceCode',
  name: 'Blok',
  description: meta.description,
  codeRepository: REPO_URL,
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'Web browser',
  license: LICENSE_URL,
  url: `${SITE_URL}/`,
  author: { '@id': ORGANIZATION_ID },
});

const techArticle = (meta: RouteMetadata, locale: Locale): JsonLdNode => ({
  '@type': ['TechArticle', 'Article'],
  headline: meta.h1,
  name: meta.title,
  description: meta.description,
  url: meta.canonical,
  mainEntityOfPage: meta.canonical,
  inLanguage: locale,
  isPartOf: { '@id': websiteId(locale) },
  author: { '@id': ORGANIZATION_ID },
  publisher: { '@id': ORGANIZATION_ID },
  ...(meta.dateModified && { dateModified: meta.dateModified }),
});

const breadcrumbList = (meta: RouteMetadata): JsonLdNode | undefined =>
  meta.breadcrumbs && {
    '@type': 'BreadcrumbList',
    itemListElement: meta.breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };

/**
 * One `@graph` per page: Organization and WebSite site-wide, the software pair
 * on the homepage, and TechArticle + BreadcrumbList on documentation pages.
 */
export const buildJsonLd = (
  path: string,
  meta: RouteMetadata,
  locale: Locale = DEFAULT_LOCALE,
): JsonLdNode => {
  const graph: JsonLdNode[] = [organization(), website(locale)];

  if (path === '/') {
    graph.push(softwareApplication(meta), softwareSourceCode(meta));
  }

  if (path.startsWith('/docs/')) {
    graph.push(techArticle(meta, locale));
    const crumbs = breadcrumbList(meta);
    if (crumbs) graph.push(crumbs);
  }

  return { '@context': 'https://schema.org', '@graph': graph };
};
