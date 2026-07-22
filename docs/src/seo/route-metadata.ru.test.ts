import { describe, expect, it } from 'vitest';
import { localizedPath } from './locales';
import {
  ROUTE_METADATA,
  RU_ROUTE_METADATA,
  SITE_URL,
  getRouteMetadata,
  type RouteMetadata,
} from './route-metadata';

const entries = (): [string, RouteMetadata][] => Object.entries(RU_ROUTE_METADATA);

const CYRILLIC = /[Ѐ-ӿ]/;

describe('Russian route metadata coverage', () => {
  it('covers every English route except the error page', () => {
    const missing = Object.keys(ROUTE_METADATA).filter(
      (path) => path !== '/404' && !(path in RU_ROUTE_METADATA),
    );
    expect(missing).toEqual([]);
  });

  it('describes nothing the English tree does not have', () => {
    const extra = Object.keys(RU_ROUTE_METADATA).filter((path) => !(path in ROUTE_METADATA));
    expect(extra).toEqual([]);
  });

  // A floor so deleting entries cannot make the assertions above vacuous.
  it('describes at least 60 routes', () => {
    expect(entries().length).toBeGreaterThanOrEqual(60);
  });

  it('is actually written in Russian', () => {
    const notTranslated = entries()
      .filter(
        ([, meta]) =>
          !CYRILLIC.test(meta.title) || !CYRILLIC.test(meta.description) || !CYRILLIC.test(meta.h1),
      )
      .map(([path]) => path);
    expect(notTranslated).toEqual([]);
  });

  it('never reuses an English title or description', () => {
    const english = new Set(
      Object.values(ROUTE_METADATA).flatMap((meta) => [meta.title, meta.description]),
    );
    const reused = entries()
      .filter(([, meta]) => english.has(meta.title) || english.has(meta.description))
      .map(([path]) => path);
    expect(reused).toEqual([]);
  });
});

describe('Russian route metadata quality', () => {
  it('keeps every title within 60 characters', () => {
    const tooLong = entries()
      .filter(([, meta]) => meta.title.length > 60)
      .map(([path, meta]) => `${path} (${meta.title.length}): ${meta.title}`);
    expect(tooLong).toEqual([]);
  });

  it('keeps every description between 70 and 155 characters', () => {
    const outOfBounds = entries()
      .filter(([, meta]) => meta.description.length < 70 || meta.description.length > 155)
      .map(([path, meta]) => `${path} (${meta.description.length}): ${meta.description}`);
    expect(outOfBounds).toEqual([]);
  });

  it('uses a unique title for every route', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [path, meta] of entries()) {
      const owner = seen.get(meta.title);
      if (owner) duplicates.push(`${meta.title} — ${owner} and ${path}`);
      else seen.set(meta.title, path);
    }
    expect(duplicates).toEqual([]);
  });

  it('uses a unique description for every route', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [path, meta] of entries()) {
      const owner = seen.get(meta.description);
      if (owner) duplicates.push(`${meta.description} — ${owner} and ${path}`);
      else seen.set(meta.description, path);
    }
    expect(duplicates).toEqual([]);
  });

  it('avoids a shared boilerplate suffix across titles', () => {
    const counts = new Map<string, number>();
    for (const [, meta] of entries()) {
      const suffix = meta.title.split(' — ').slice(1).join(' — ');
      if (!suffix) continue;
      counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
    }
    expect([...counts.entries()].filter(([, count]) => count > 1)).toEqual([]);
  });
});

describe('Russian canonicals and breadcrumbs', () => {
  it('canonicalises each indexable route onto its own prefixed path', () => {
    const mismatched = entries()
      .filter(
        ([path, meta]) =>
          !meta.noindex && meta.canonical !== `${SITE_URL}/ru${path === '/' ? '' : path}/`,
      )
      .map(([path, meta]) => `${path}: ${meta.canonical}`);
    expect(mismatched).toEqual([]);
  });

  it('carries the noindex flag across from the English tree', () => {
    expect(RU_ROUTE_METADATA['/tools'].noindex).toBe(true);
    // A noindex route consolidates onto its destination in the same tree.
    expect(RU_ROUTE_METADATA['/tools'].canonical).toBe(`${SITE_URL}/ru/docs/paragraph/`);
  });

  it('keeps breadcrumb trails inside the Russian tree', () => {
    const trail = RU_ROUTE_METADATA['/docs/caret-api'].breadcrumbs;
    expect(trail?.map((crumb) => crumb.path)).toEqual([
      '/ru',
      '/ru/docs',
      '/ru/docs/caret-api',
      '/ru/docs/caret-api',
    ]);
    expect(trail?.every((crumb) => CYRILLIC.test(crumb.name))).toBe(true);
  });

  it('reuses the English lastUpdated date', () => {
    expect(RU_ROUTE_METADATA['/docs/caret-api'].dateModified).toBe(
      ROUTE_METADATA['/docs/caret-api'].dateModified,
    );
  });
});

describe('getRouteMetadata with a locale prefix', () => {
  it('resolves a prefixed path to the Russian entry', () => {
    expect(getRouteMetadata('/ru/docs/table')).toBe(RU_ROUTE_METADATA['/docs/table']);
  });

  it('resolves the bare prefix to the Russian home page', () => {
    expect(getRouteMetadata('/ru')).toBe(RU_ROUTE_METADATA['/']);
    expect(getRouteMetadata('/ru/')).toBe(RU_ROUTE_METADATA['/']);
  });

  it('still resolves unprefixed paths to the English entry', () => {
    expect(getRouteMetadata('/docs/table')).toBe(ROUTE_METADATA['/docs/table']);
  });

  it('returns undefined for a prefixed path that does not exist', () => {
    expect(getRouteMetadata(localizedPath('/docs/not-a-real-module', 'ru'))).toBeUndefined();
  });
});
