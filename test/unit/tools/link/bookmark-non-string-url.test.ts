/**
 * Saved bookmark JSON may hold any value at `url`. A non-string url must
 * render an inert card, not throw out of the link-safety helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Bookmark, type BookmarkData } from '../../../../src/tools/link/bookmark';
import type { API } from '../../../../types';

const render = (url: unknown): HTMLElement => new Bookmark({
  api: { i18n: { t: (key: string) => key, has: () => false } } as unknown as API,
  block: { dispatchChange: vi.fn() } as never,
  config: { endpoint: 'https://api.test/unfurl' },
  readOnly: false,
  data: { url, title: 'Title' } as unknown as BookmarkData,
}).render();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bookmark with a non-string saved url', () => {
  it.each([[123], [{ href: 'https://site.example.test/' }], [['https://site.example.test/']], [true]])(
    'url %j renders a card with no link',
    (url) => {
      const root = render(url);

      expect(root.querySelector('[data-blok-testid="bookmark-card"]')?.hasAttribute('href')).toBe(false);
    }
  );
});
