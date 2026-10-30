import { beforeEach, describe, expect, it, vi } from 'vitest';

import { searchVisiblePages } from '../../../../src/tools/page/search-pages';
import type { PageConfig } from '../../../../src/tools/page/types';

describe('searchVisiblePages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops pages the user may not see and blank ids', async () => {
    const page: PageConfig = {
      search: () => Promise.resolve([
        { pageId: 'p1', title: 'Roadmap' },
        { pageId: 'p2', title: 'Secret', access: 'none' },
        { pageId: ' ', title: 'Blank' },
      ]),
    };

    await expect(searchVisiblePages(page, 'r')).resolves.toEqual([{ pageId: 'p1', title: 'Roadmap' }]);
  });

  it('keeps only pages resolve can see, with its title, path and status', async () => {
    const page: PageConfig = {
      search: () => Promise.resolve([
        { pageId: 'p1', title: 'Old', path: ['Team'] },
        { pageId: 'p2', title: 'Gone' },
        { pageId: 'p3', title: 'Hidden' },
        { pageId: 'p4', title: 'Broken' },
      ]),
      resolve: (pageId) => {
        if (pageId === 'p1') {
          return { title: 'Roadmap', path: ['Work', 'Team'], status: 'draft' };
        }
        if (pageId === 'p3') {
          return { access: 'none' };
        }
        if (pageId === 'p4') {
          throw new Error('down');
        }

        return null;
      },
    };

    await expect(searchVisiblePages(page, '')).resolves.toEqual([
      { pageId: 'p1', title: 'Roadmap', path: ['Work', 'Team'], status: 'draft' },
    ]);
  });

  it('keeps the search path and status when resolve has none', async () => {
    const page: PageConfig = {
      search: () => Promise.resolve([{ pageId: 'p1', path: ['Team'], status: 'draft' }]),
      resolve: () => ({ title: 'Roadmap' }),
    };

    await expect(searchVisiblePages(page, '')).resolves.toEqual([
      { pageId: 'p1', title: 'Roadmap', path: ['Team'], status: 'draft' },
    ]);
  });

  it('shows the icon from resolve over the search hit, and keeps the hit\'s when resolve has none', async () => {
    const page: PageConfig = {
      search: () => Promise.resolve([
        { pageId: 'p1', icon: { type: 'emoji', value: '📄' } },
        { pageId: 'p2', icon: { type: 'emoji', value: '📌' } },
      ]),
      resolve: (pageId) => pageId === 'p1' ? { title: 'One', icon: { type: 'emoji', value: '🗺️' } } : { title: 'Two' },
    };

    await expect(searchVisiblePages(page, '')).resolves.toEqual([
      { pageId: 'p1', title: 'One', icon: { type: 'emoji', value: '🗺️' } },
      { pageId: 'p2', title: 'Two', icon: { type: 'emoji', value: '📌' } },
    ]);
  });

  it('finds nothing without a search hook', async () => {
    await expect(searchVisiblePages({}, 'r')).resolves.toEqual([]);
  });
});
