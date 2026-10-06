import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageLink } from '../../../../src/tools';
import type { PageConfig, PageInfo } from '../../../../src/tools/page/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { PageLinkData } from '../../../../types/tools/page-link';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const options = (
  data: PageLinkData,
  config: PageConfig = {},
  origin: 'load' | 'user' = 'load'
): BlockToolConstructorOptions<PageLinkData, PageConfig> => ({
  api: { i18n: { t: (key: string) => key } } as unknown as API,
  block: { dispatchChange: vi.fn() } as never,
  data,
  config,
  origin,
  readOnly: false,
});

describe('PageLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves only the target ID and never creates an owning page', async () => {
    const create = vi.fn();
    const link = new PageLink(options(
      { pageId: 'p1' },
      { create, resolve: () => ({ title: 'Roadmap' }) },
      'user'
    ));

    link.render();
    link.rendered();
    await flush();

    expect(link.save()).toEqual({ pageId: 'p1' });
    expect(create).not.toHaveBeenCalled();
    expect(PageLink).not.toHaveProperty('copyAsLink');
    expect(PageLink.acceptsChildren).toBe(false);
  });

  it('rejects an empty target instead of minting a page', async () => {
    const create = vi.fn();
    const link = new PageLink(options({ pageId: '' }, { create }, 'user'));

    link.render();
    link.rendered();
    await flush();

    expect(link.validate(link.save())).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('shows allowed metadata and opens the target without an href', async () => {
    const open = vi.fn();
    const link = new PageLink(options(
      { pageId: 'p1' },
      { resolve: () => ({ title: 'Roadmap' }), open }
    ));
    const root = link.render();

    link.rendered();
    await flush();

    expect(root.textContent).toContain('Roadmap');
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);

    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    expect(link.onNavigationEnter(event)).toBe(true);
    expect(open).toHaveBeenCalledWith('p1', { event });
  });

  it('keeps resolved metadata without a URL when the host href throws', async () => {
    const link = new PageLink(options(
      { pageId: 'p1' },
      {
        resolve: () => ({ title: 'Roadmap' }),
        href: () => { throw new Error('URL unavailable'); },
      }
    ));
    const root = link.render();

    link.rendered();
    await flush();

    expect(root.textContent).toContain('Roadmap');
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('removes a stale URL when the host href later throws', async () => {
    let failHref = false;
    const link = new PageLink(options(
      { pageId: 'p1' },
      {
        resolve: () => ({ title: 'Roadmap' }),
        href: () => {
          if (failHref) {
            throw new Error('URL unavailable');
          }

          return '/pages/p1';
        },
      }
    ));
    const root = link.render();

    link.rendered();
    await flush();
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/pages/p1');

    failHref = true;
    expect(() => link.setData({ pageId: 'p1' })).not.toThrow();
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('hides denied metadata and never calls href or open', async () => {
    const href = vi.fn(() => '/pages/secret-title');
    const open = vi.fn();
    const link = new PageLink(options(
      { pageId: 'p1' },
      {
        resolve: () => ({ access: 'none', title: 'Secret', icon: { type: 'emoji', value: 'X' } }),
        href,
        open,
      }
    ));
    const root = link.render();

    link.rendered();
    await flush();

    expect(root.textContent).toContain('tools.page.noAccess');
    expect(root.textContent).not.toContain('Secret');
    expect(root.textContent).not.toContain('X');
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(href).not.toHaveBeenCalled();
    expect(link.onNavigationEnter(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps the newest access result and unsubscribes on removal', async () => {
    const pending: Array<(info: PageInfo) => void> = [];
    const unsubscribe = vi.fn();
    let notify: (() => void) | undefined;
    const link = new PageLink(options(
      { pageId: 'p1' },
      {
        resolve: () => new Promise<PageInfo>((done) => pending.push(done)),
        subscribe: (_pageId, onChange) => {
          notify = onChange;

          return unsubscribe;
        },
      }
    ));
    const root = link.render();

    link.rendered();
    await flush();
    notify?.();
    await flush();

    expect(pending).toHaveLength(2);
    pending[1]?.({ access: 'none', title: 'Secret' });
    await flush();
    pending[0]?.({ title: 'Old visible title' });
    await flush();

    expect(root.textContent).toContain('tools.page.noAccess');
    expect(root.textContent).not.toContain('Secret');
    expect(root.textContent).not.toContain('Old visible title');

    link.removed();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
