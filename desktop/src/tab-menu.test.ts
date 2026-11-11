import { describe, expect, it } from 'vitest';

import { buildTabMenuItems, pageLinkFor } from './tab-menu';

describe('tab context menu', () => {
  /**
   * The point of Copy Link here is handing a page to an agent: `blok_open` takes
   * the document id, and the tab's href carries it as ?page=<id>. A link the MCP
   * cannot resolve would be useless, so the id has to survive verbatim.
   */
  describe('pageLinkFor', () => {
    it('builds a link an agent can resolve, from the tab href', () => {
      expect(pageLinkFor('http://localhost:1420/?page=blok-architecture')).toBe('blok://page/blok-architecture');
    });

    it('keeps the id verbatim, including uuids', () => {
      const id = '15dcb34a-17c3-4158-95d4-966919c44a2d';
      expect(pageLinkFor(`http://x/?page=${id}`)).toBe(`blok://page/${id}`);
    });

    it('answers null for a href that names no page', () => {
      expect(pageLinkFor('http://localhost:1420/')).toBeNull();
    });
  });

  describe('buildTabMenuItems', () => {
    const tabs = ['a', 'b', 'c'];

    it('disables the directional closes at the ends', () => {
      const first = buildTabMenuItems({ tabId: 'a', tabIds: tabs, href: '' });
      const last = buildTabMenuItems({ tabId: 'c', tabIds: tabs, href: '' });
      expect(first.find((i) => i.action === 'close-left')?.disabled).toBe(true);
      expect(first.find((i) => i.action === 'close-right')?.disabled).toBe(false);
      expect(last.find((i) => i.action === 'close-right')?.disabled).toBe(true);
    });

    it('disables closing others when the tab is alone', () => {
      const items = buildTabMenuItems({ tabId: 'a', tabIds: ['a'], href: '' });
      expect(items.find((i) => i.action === 'close-others')?.disabled).toBe(true);
    });

    it('disables Copy Link when the tab names no page', () => {
      const items = buildTabMenuItems({ tabId: 'a', tabIds: tabs, href: 'http://x/' });
      expect(items.find((i) => i.action === 'copy-link')?.disabled).toBe(true);
    });
  });
});
