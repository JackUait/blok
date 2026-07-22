import { describe, expect, it } from 'vitest';
import { buildMetaDescriptors } from './meta-descriptors';
import { SITE_URL } from './locales';
import { RU_ROUTE_METADATA } from './route-metadata';

type Descriptor = Record<string, unknown>;

const find = (descriptors: Descriptor[], key: string, value: string): Descriptor | undefined =>
  descriptors.find((d) => d[key] === value);

const alternates = (descriptors: Descriptor[]): { hreflang: unknown; href: unknown }[] =>
  descriptors
    .filter((d) => d.tagName === 'link' && d.rel === 'alternate')
    .map((d) => ({ hreflang: d.hreflang, href: d.href }));

const jsonLdGraph = (descriptors: Descriptor[]): Record<string, unknown>[] => {
  const block = descriptors.find((d) => 'script:ld+json' in d)?.['script:ld+json'] as {
    '@graph': Record<string, unknown>[];
  };
  return block['@graph'];
};

const nodeOfType = (descriptors: Descriptor[], type: string): Record<string, unknown> | undefined =>
  jsonLdGraph(descriptors).find((node) => {
    const nodeType = node['@type'];
    return Array.isArray(nodeType) ? nodeType.includes(type) : nodeType === type;
  });

describe('hreflang', () => {
  it('emits every locale plus x-default on an English page', () => {
    expect(alternates(buildMetaDescriptors('/docs/table'))).toEqual([
      { hreflang: 'en', href: `${SITE_URL}/docs/table/` },
      { hreflang: 'ru', href: `${SITE_URL}/ru/docs/table/` },
      { hreflang: 'x-default', href: `${SITE_URL}/docs/table/` },
    ]);
  });

  it('is reciprocal: the Russian page points back at the English one', () => {
    expect(alternates(buildMetaDescriptors('/ru/docs/table'))).toEqual(
      alternates(buildMetaDescriptors('/docs/table')),
    );
  });

  it('annotates each locale root at the address Pages serves it from', () => {
    expect(alternates(buildMetaDescriptors('/ru'))).toEqual([
      { hreflang: 'en', href: `${SITE_URL}/` },
      { hreflang: 'ru', href: `${SITE_URL}/ru/` },
      { hreflang: 'x-default', href: `${SITE_URL}/` },
    ]);
  });

  it('leaves noindex routes out of the alternate set, since Google ignores them there', () => {
    expect(alternates(buildMetaDescriptors('/tools'))).toEqual([]);
    expect(alternates(buildMetaDescriptors('/ru/tools'))).toEqual([]);
  });
});

describe('Russian head tags', () => {
  it('emits the Russian title, description and canonical', () => {
    const descriptors = buildMetaDescriptors('/ru/docs/table');
    const meta = RU_ROUTE_METADATA['/docs/table'];
    expect(descriptors).toContainEqual({ title: meta.title });
    expect(find(descriptors, 'name', 'description')?.content).toBe(meta.description);
    expect(descriptors).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: `${SITE_URL}/ru/docs/table/`,
    });
  });

  it('declares the page locale and the alternate one to Open Graph', () => {
    const ru = buildMetaDescriptors('/ru/demo');
    expect(find(ru, 'property', 'og:locale')?.content).toBe('ru_RU');
    expect(find(ru, 'property', 'og:locale:alternate')?.content).toBe('en_US');

    const en = buildMetaDescriptors('/demo');
    expect(find(en, 'property', 'og:locale')?.content).toBe('en_US');
    expect(find(en, 'property', 'og:locale:alternate')?.content).toBe('ru_RU');
  });

  it('still classifies a prefixed reference page as an article', () => {
    expect(find(buildMetaDescriptors('/ru/docs/table'), 'property', 'og:type')?.content).toBe(
      'article',
    );
    expect(find(buildMetaDescriptors('/ru'), 'property', 'og:type')?.content).toBe('website');
  });

  it('marks the prefixed redirect route noindex', () => {
    expect(find(buildMetaDescriptors('/ru/tools'), 'name', 'robots')?.content).toBe(
      'noindex, follow',
    );
  });
});

describe('Russian structured data', () => {
  it('emits the article graph on a prefixed docs page, in Russian', () => {
    const descriptors = buildMetaDescriptors('/ru/docs/table');
    const article = nodeOfType(descriptors, 'TechArticle');
    expect(article?.inLanguage).toBe('ru');
    expect(article?.url).toBe(`${SITE_URL}/ru/docs/table/`);
    expect(article?.headline).toBe(RU_ROUTE_METADATA['/docs/table'].h1);
  });

  it('keeps breadcrumb items inside the Russian tree', () => {
    const crumbs = nodeOfType(buildMetaDescriptors('/ru/docs/table'), 'BreadcrumbList');
    const items = (crumbs?.itemListElement as { item: string }[]).map((entry) => entry.item);
    expect(items.every((item) => item.startsWith(`${SITE_URL}/ru`))).toBe(true);
  });

  it('describes the site, not the current page, on the WebSite node', () => {
    const descriptors = buildMetaDescriptors('/ru/docs/table');
    expect(nodeOfType(descriptors, 'WebSite')?.description).toBe(RU_ROUTE_METADATA['/'].description);
  });

  it('emits the software graph on the Russian home page too', () => {
    const descriptors = buildMetaDescriptors('/ru');
    expect(nodeOfType(descriptors, 'SoftwareApplication')).toBeDefined();
    expect(nodeOfType(descriptors, 'WebSite')?.inLanguage).toBe('ru');
  });
});
