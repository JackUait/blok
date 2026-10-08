import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageRegistry, ROOT_STORAGE_KEY, type PageMap } from '../../../src/playground/page-host';
import { fromPageIcon, titleData, toPageIcon } from '../../../src/playground/page-title-wiring';

const seed = (): PageMap => ({
  guide: { title: 'Guide', icon: '📘', parentId: null, blocks: [] },
  keys: { title: 'Keys', parentId: 'guide', blocks: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('page icon mapping', () => {
  it('turns an emoji string into a page icon, and nothing into nothing', () => {
    expect(toPageIcon('🚀')).toEqual({ type: 'emoji', value: '🚀' });
    expect(toPageIcon('')).toBeUndefined();
    expect(toPageIcon(undefined)).toBeUndefined();
  });

  it('turns an emoji page icon back into its string, and never into an empty one', () => {
    expect(fromPageIcon({ type: 'emoji', value: '🚀' })).toBe('🚀');
    expect(fromPageIcon({ type: 'image', url: 'https://example.com/a.png' })).toBeUndefined();
    expect(fromPageIcon(null)).toBeUndefined();
  });
});

describe('titleData', () => {
  it('reads the root record for the root document', () => {
    localStorage.setItem(ROOT_STORAGE_KEY, JSON.stringify({ title: 'Home', icon: '🏠' }));

    expect(titleData(new PageRegistry(seed()), null)).toEqual({ title: 'Home', icon: { type: 'emoji', value: '🏠' } });
  });

  it('gives the root its default title and no icon when nothing is stored', () => {
    expect(titleData(new PageRegistry(seed()), null)).toEqual({ title: 'Blok' });
  });

  it('reads a child page through get, with and without an icon', () => {
    const pages = new PageRegistry(seed());

    expect(titleData(pages, 'guide')).toEqual({ title: 'Guide', icon: { type: 'emoji', value: '📘' } });
    expect(titleData(pages, 'keys')).toEqual({ title: 'Keys' });
  });

  it('reads through get, so an overlay that overrides get is what the editor gets', () => {
    const pages = new PageRegistry(seed());
    const overlay = {
      root: () => pages.root(),
      get: (id: string) => {
        const page = pages.get(id);

        return page === undefined ? undefined : { ...page, title: 'From host', icon: '🛰️' };
      },
    };

    expect(titleData(overlay, 'guide')).toEqual({ title: 'From host', icon: { type: 'emoji', value: '🛰️' } });
  });

  it('gives an empty title for a page the registry does not know', () => {
    expect(titleData(new PageRegistry(seed()), 'missing')).toEqual({ title: '' });
  });
});
