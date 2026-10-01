import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAGES_STORAGE_KEY,
  PageRegistry,
  pageIdFromPath,
  pagePath,
  type PageMap,
} from '../../../src/playground/page-host';

const seed = (): PageMap => ({
  guide: { title: 'Guide', icon: '📘', parentId: null, blocks: [{ id: 'g1', type: 'paragraph', data: { text: 'Hi' } }] },
  keys: { title: 'Keys', parentId: 'guide', blocks: [] },
});

describe('page routes', () => {
  it('reads the page id from an /editor/page/<id> path', () => {
    expect(pageIdFromPath('/editor/page/abc-1')).toBe('abc-1');
    expect(pageIdFromPath('/editor/page/abc-1/')).toBe('abc-1');
  });

  it('treats anything else as the root document', () => {
    expect(pageIdFromPath('/editor')).toBeNull();
    expect(pageIdFromPath('/editor/page/')).toBeNull();
    expect(pageIdFromPath('/icons/page/abc')).toBeNull();
  });

  it('decodes an encoded id and keeps the query on the built path', () => {
    expect(pageIdFromPath('/editor/page/a%20b')).toBe('a b');
    expect(pagePath('a b', '?collab=off')).toBe('/editor/page/a%20b?collab=off');
    expect(pagePath(null, '?collab=off')).toBe('/editor?collab=off');
  });
});

describe('PageRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('starts from the seed and resolves a page to its title and emoji icon', () => {
    const pages = new PageRegistry(seed());

    expect(pages.info('guide')).toEqual({ title: 'Guide', icon: { type: 'emoji', value: '📘' } });
    expect(pages.info('keys')).toEqual({ title: 'Keys' });
    expect(pages.info('nope')).toBeNull();
  });

  it('keeps edits in localStorage, so a new registry sees them', () => {
    const first = new PageRegistry(seed());

    first.setTitle('guide', 'Handbook');
    first.setIcon('guide', undefined);
    first.create('fresh', 'guide');
    first.setBlocks('fresh', [{ id: 'f1', type: 'paragraph', data: { text: 'New' } }]);

    const second = new PageRegistry(seed());

    expect(second.info('guide')).toEqual({ title: 'Handbook' });
    expect(second.get('fresh')).toEqual({
      title: '',
      parentId: 'guide',
      blocks: [{ id: 'f1', type: 'paragraph', data: { text: 'New' } }],
    });
    expect(JSON.parse(localStorage.getItem(PAGES_STORAGE_KEY) ?? '{}')).toHaveProperty('fresh');
  });

  it('builds the breadcrumb trail from the root down, ending at the page', () => {
    const pages = new PageRegistry(seed());

    expect(pages.trail('keys').map((crumb) => crumb.id)).toEqual(['guide', 'keys']);
    expect(pages.trail('guide').map((crumb) => crumb.id)).toEqual(['guide']);
  });

  it('stops the trail at a parent cycle instead of looping forever', () => {
    const pages = new PageRegistry({
      a: { title: 'A', parentId: 'b', blocks: [] },
      b: { title: 'B', parentId: 'a', blocks: [] },
    });

    expect(pages.trail('a').map((crumb) => crumb.id)).toEqual(['b', 'a']);
  });

  it('a new page does not overwrite an existing one', () => {
    const pages = new PageRegistry(seed());

    pages.create('guide', null);

    expect(pages.get('guide')?.title).toBe('Guide');
  });

  it('reset drops every edit and goes back to the seed', () => {
    const pages = new PageRegistry(seed());

    pages.create('fresh', null);
    pages.setTitle('guide', 'Changed');
    pages.reset();

    expect(pages.get('fresh')).toBeUndefined();
    expect(pages.get('guide')?.title).toBe('Guide');
    expect(new PageRegistry(seed()).get('fresh')).toBeUndefined();
  });

  it('falls back to the seed when storage holds something that is not a page map', () => {
    localStorage.setItem(PAGES_STORAGE_KEY, '[1,2,3]');

    expect(new PageRegistry(seed()).get('guide')?.title).toBe('Guide');
  });
});

describe('playground collaboration room per page', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const from = html.indexOf('const DEV_SERVER_URL =');
  const source = html.slice(from, html.indexOf('function buildConfig(', from));

  const roomFor = (search: string, call: string): unknown =>
    structuredClone(runInNewContext(`${source} ${call};`, {
      window: { location: { search } },
      URLSearchParams,
      __BLOK_DEV_BACKEND__: true,
    }));

  it('gives each page its own document, next to the shared one', () => {
    expect(roomFor('', "collaborationConfig('abc')")).toEqual({ doc: 'playground--page--abc' });
    expect(roomFor('?collab=room', "collaborationConfig('abc')")).toEqual({ doc: 'room--page--abc' });
  });

  it('keeps the root document and the off switch as they were', () => {
    expect(roomFor('', 'collaborationConfig()')).toEqual({ doc: 'playground' });
    expect(roomFor('?collab=off', "collaborationConfig('abc')")).toBeNull();
  });
});
