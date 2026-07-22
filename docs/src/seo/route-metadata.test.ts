import { describe, expect, it } from 'vitest';
import { MODULE_ORDER } from '../components/api/api-nav';
import { TOOL_SECTIONS } from '../components/tools/tools-data';
import { PRERENDER_PATHS } from '../prerender-paths';
import { absoluteUrl } from './locales';
import {
  ROUTE_METADATA,
  SITE_URL,
  getRouteMetadata,
  type RouteMetadata,
} from './route-metadata';

const entries = (): [string, RouteMetadata][] => Object.entries(ROUTE_METADATA);

describe('route metadata coverage', () => {
  it('has an entry for every prerendered path', () => {
    const missing = PRERENDER_PATHS.filter((path) => !(path in ROUTE_METADATA));
    expect(missing).toEqual([]);
  });

  it('has no entry that is not a prerendered path', () => {
    const known = new Set(PRERENDER_PATHS);
    const extra = Object.keys(ROUTE_METADATA).filter((path) => !known.has(path));
    expect(extra).toEqual([]);
  });

  it('covers every API module', () => {
    const missing = MODULE_ORDER.filter((id) => !(`/docs/${id}` in ROUTE_METADATA));
    expect(missing).toEqual([]);
  });

  it('covers every documented tool', () => {
    const missing = TOOL_SECTIONS.map((tool) => tool.id).filter(
      (id) => !(`/docs/${id}` in ROUTE_METADATA),
    );
    expect(missing).toEqual([]);
  });

  // A floor so deleting entries cannot silently make the assertions above vacuous.
  it('describes at least 60 routes', () => {
    expect(entries().length).toBeGreaterThanOrEqual(60);
  });
});

describe('route metadata quality', () => {
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

  it('gives every route a non-empty h1', () => {
    const empty = entries()
      .filter(([, meta]) => meta.h1.trim().length === 0)
      .map(([path]) => path);
    expect(empty).toEqual([]);
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
    const suffixes = entries().map(([, meta]) => meta.title.split(' — ').slice(1).join(' — '));
    const counts = new Map<string, number>();
    for (const suffix of suffixes) {
      if (!suffix) continue;
      counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
    }
    const repeated = [...counts.entries()].filter(([, count]) => count > 1);
    expect(repeated).toEqual([]);
  });
});

describe('canonical URLs', () => {
  // Every route is emitted as `<path>/index.html`, which GitHub Pages serves at
  // `<path>/` and 301-redirects `<path>` to — so the trailing slash is what
  // makes the canonical answer 200 instead of pointing away from its own page.
  it('points at the production origin and names the served, trailing-slash address', () => {
    const bad = entries()
      .filter(
        ([, meta]) => !meta.canonical.startsWith(`${SITE_URL}/`) || !meta.canonical.endsWith('/'),
      )
      .map(([path, meta]) => `${path}: ${meta.canonical}`);
    expect(bad).toEqual([]);
  });

  it('canonicalises each indexable route to its own path', () => {
    const mismatched = entries()
      .filter(([path, meta]) => !meta.noindex && meta.canonical !== absoluteUrl(path))
      .map(([path, meta]) => `${path}: ${meta.canonical}`);
    expect(mismatched).toEqual([]);
  });

  it('gives every route an absolute og image', () => {
    const relative = entries()
      .filter(([, meta]) => !meta.ogImage.startsWith('https://'))
      .map(([path, meta]) => `${path}: ${meta.ogImage}`);
    expect(relative).toEqual([]);
  });

  it('marks the redirect and error routes noindex', () => {
    expect(ROUTE_METADATA['/tools'].noindex).toBe(true);
    expect(ROUTE_METADATA['/404'].noindex).toBe(true);
  });
});

describe('getRouteMetadata', () => {
  it('resolves a known path', () => {
    expect(getRouteMetadata('/docs/caret-api')?.title).toBe(ROUTE_METADATA['/docs/caret-api'].title);
  });

  it('ignores a trailing slash', () => {
    expect(getRouteMetadata('/docs/table/')).toBe(ROUTE_METADATA['/docs/table']);
  });

  it('returns undefined for an unknown path', () => {
    expect(getRouteMetadata('/docs/not-a-real-module')).toBeUndefined();
  });
});

describe('breadcrumbs', () => {
  it('trails Home / Docs / group / page on a module route', () => {
    expect(ROUTE_METADATA['/docs/caret-api'].breadcrumbs).toEqual([
      { name: 'Home', path: '/' },
      { name: 'Docs', path: '/docs' },
      { name: 'Editing', path: '/docs/caret-api' },
      { name: 'Caret API: move, focus, and set cursor position', path: '/docs/caret-api' },
    ]);
  });

  it('trails through the tool group on a tool route', () => {
    const trail = ROUTE_METADATA['/docs/table'].breadcrumbs;
    expect(trail?.map((crumb) => crumb.name)).toEqual([
      'Home',
      'Docs',
      'Block Tools',
      ROUTE_METADATA['/docs/table'].h1,
    ]);
  });

  it('leaves top-level routes without a trail', () => {
    expect(ROUTE_METADATA['/'].breadcrumbs).toBeUndefined();
  });
});
