import { describe, expect, it } from 'vitest';
import { ROUTE_METADATA, SITE_URL } from './route-metadata';
import { buildMetaDescriptors } from './meta-descriptors';

type Descriptor = Record<string, unknown>;

const find = (descriptors: Descriptor[], key: string, value: string): Descriptor | undefined =>
  descriptors.find((d) => d[key] === value);

const jsonLd = (descriptors: Descriptor[]): Record<string, unknown>[] =>
  descriptors
    .filter((d) => 'script:ld+json' in d)
    .map((d) => d['script:ld+json'] as Record<string, unknown>);

const graphTypes = (descriptors: Descriptor[]): string[] =>
  jsonLd(descriptors).flatMap((block) => {
    const graph = block['@graph'] as { '@type': string | string[] }[];
    return graph.flatMap((node) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]));
  });

describe('buildMetaDescriptors', () => {
  it('emits the route title and description', () => {
    const descriptors = buildMetaDescriptors('/docs/caret-api');
    expect(descriptors).toContainEqual({ title: ROUTE_METADATA['/docs/caret-api'].title });
    expect(find(descriptors, 'name', 'description')?.content).toBe(
      ROUTE_METADATA['/docs/caret-api'].description,
    );
  });

  it('emits an absolute canonical link', () => {
    const descriptors = buildMetaDescriptors('/docs/table');
    expect(descriptors).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: `${SITE_URL}/docs/table/`,
    });
  });

  it('resolves a trailing-slash request to the same route', () => {
    expect(buildMetaDescriptors('/docs/table/')).toEqual(buildMetaDescriptors('/docs/table'));
  });

  it('emits the full Open Graph set', () => {
    const descriptors = buildMetaDescriptors('/demo');
    const meta = ROUTE_METADATA['/demo'];
    expect(find(descriptors, 'property', 'og:type')?.content).toBe('website');
    expect(find(descriptors, 'property', 'og:site_name')?.content).toBe('Blok');
    expect(find(descriptors, 'property', 'og:url')?.content).toBe(meta.canonical);
    expect(find(descriptors, 'property', 'og:title')?.content).toBe(meta.title);
    expect(find(descriptors, 'property', 'og:description')?.content).toBe(meta.description);
    expect(find(descriptors, 'property', 'og:image')?.content).toBe(meta.ogImage);
  });

  it('emits a large-image Twitter card', () => {
    const descriptors = buildMetaDescriptors('/');
    expect(find(descriptors, 'name', 'twitter:card')?.content).toBe('summary_large_image');
    expect(find(descriptors, 'name', 'twitter:title')?.content).toBe(ROUTE_METADATA['/'].title);
    expect(find(descriptors, 'name', 'twitter:description')?.content).toBe(
      ROUTE_METADATA['/'].description,
    );
    expect(find(descriptors, 'name', 'twitter:image')?.content).toBe(ROUTE_METADATA['/'].ogImage);
  });

  it('marks noindex routes and leaves indexable ones alone', () => {
    expect(find(buildMetaDescriptors('/tools'), 'name', 'robots')?.content).toBe(
      'noindex, follow',
    );
    expect(find(buildMetaDescriptors('/docs/table'), 'name', 'robots')).toBeUndefined();
  });

  it('falls back to the site defaults on an unknown path', () => {
    const descriptors = buildMetaDescriptors('/docs/not-a-real-module');
    expect(descriptors).toContainEqual({ title: ROUTE_METADATA['/'].title });
    expect(find(descriptors, 'tagName', 'link')).toBeUndefined();
  });
});

describe('JSON-LD', () => {
  it('carries Organization and WebSite on every route', () => {
    for (const path of ['/', '/demo', '/docs/table', '/changelog']) {
      expect(graphTypes(buildMetaDescriptors(path))).toEqual(
        expect.arrayContaining(['Organization', 'WebSite']),
      );
    }
  });

  it('adds SoftwareApplication and SoftwareSourceCode only on the homepage', () => {
    expect(graphTypes(buildMetaDescriptors('/'))).toEqual(
      expect.arrayContaining(['SoftwareApplication', 'SoftwareSourceCode']),
    );
    expect(graphTypes(buildMetaDescriptors('/demo'))).not.toContain('SoftwareApplication');
  });

  it('prices the free offer truthfully and claims no rating', () => {
    const app = jsonLd(buildMetaDescriptors('/'))
      .flatMap((block) => block['@graph'] as Record<string, unknown>[])
      .find((node) => node['@type'] === 'SoftwareApplication');
    expect((app?.offers as Record<string, string>).price).toBe('0');
    expect(app).not.toHaveProperty('aggregateRating');
    expect(app?.license).toBe('https://www.apache.org/licenses/LICENSE-2.0');
  });

  it('never emits the retired SearchAction', () => {
    const serialized = ['/', '/docs/table', '/changelog']
      .map((path) => JSON.stringify(buildMetaDescriptors(path)))
      .join('');
    expect(serialized).not.toContain('SearchAction');
    expect(serialized).not.toContain('potentialAction');
  });

  it('dual-types docs pages as TechArticle and Article with a breadcrumb trail', () => {
    const types = graphTypes(buildMetaDescriptors('/docs/table'));
    expect(types).toEqual(expect.arrayContaining(['TechArticle', 'Article', 'BreadcrumbList']));
  });

  it('carries dateModified where the source data has a lastUpdated date', () => {
    const article = jsonLd(buildMetaDescriptors('/docs/quick-start'))
      .flatMap((block) => block['@graph'] as Record<string, unknown>[])
      .find((node) => Array.isArray(node['@type']) && node['@type'].includes('TechArticle'));
    expect(article?.dateModified).toBe(ROUTE_METADATA['/docs/quick-start'].dateModified);
    expect(article?.dateModified).toBeTruthy();
  });

  it('numbers breadcrumb positions from one with absolute item URLs', () => {
    const crumbs = jsonLd(buildMetaDescriptors('/docs/caret-api'))
      .flatMap((block) => block['@graph'] as Record<string, unknown>[])
      .find((node) => node['@type'] === 'BreadcrumbList');
    expect(crumbs?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Docs', item: `${SITE_URL}/docs/` },
      { '@type': 'ListItem', position: 3, name: 'Editing', item: `${SITE_URL}/docs/caret-api/` },
      {
        '@type': 'ListItem',
        position: 4,
        name: ROUTE_METADATA['/docs/caret-api'].h1,
        item: `${SITE_URL}/docs/caret-api/`,
      },
    ]);
  });

  it('omits article markup on non-docs routes', () => {
    expect(graphTypes(buildMetaDescriptors('/demo'))).not.toContain('TechArticle');
  });
});
