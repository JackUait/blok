import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PageTool } from '../../../../src/tools/page';
import type { PageConfig, PageData } from '../../../../src/tools/page/types';
import { renderPagePreview } from '../../../../src/tools/page/preview';
import { previewLines } from '../../../../src/tools/page/hover-preview';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import { convertBlockDataToString } from '../../../../src/components/utils/blocks';
import type { API, BlockOrigin, BlockToolConstructorOptions } from '../../../../types';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createMockAPI = (): API =>
  ({
    i18n: { t: (key: string) => key, has: () => true },
  }) as unknown as API;

interface Setup {
  data?: Partial<PageData>;
  config?: PageConfig;
  readOnly?: boolean;
  origin?: BlockOrigin;
  replaySource?: 'history' | 'remote';
  dispatchChange?: ReturnType<typeof vi.fn>;
}

const createOptions = ({
  data = { pageId: 'p1' },
  config = {},
  readOnly = false,
  origin = 'load',
  replaySource,
  dispatchChange = vi.fn(),
}: Setup = {}): BlockToolConstructorOptions<PageData, PageConfig> => ({
  api: createMockAPI(),
  block: { dispatchChange } as never,
  config,
  readOnly,
  data: data as PageData,
  origin,
  ...(replaySource !== undefined && { replaySource }),
});

const anchorOf = (root: HTMLElement): HTMLAnchorElement => {
  const anchor = root.querySelector('a');

  if (anchor === null) {
    throw new Error('no anchor');
  }

  return anchor;
};

const titleOf = (root: HTMLElement): HTMLElement => {
  const title = root.querySelector<HTMLElement>('[data-blok-testid="page-title"]');

  if (title === null) {
    throw new Error('no title');
  }

  return title;
};

const click = (target: HTMLElement, init: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });

  target.dispatchEvent(event);

  return event;
};

const renderResolved = async (tool: PageTool): Promise<HTMLElement> => {
  const root = tool.render();

  tool.rendered();
  await flush();

  return root;
};

describe('Page tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('render', () => {
    it('renders a mutation-free page root with a link after resolution', async () => {
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Stale roadmap' } },
        config: { resolve: () => ({ title: 'Roadmap' }), href: (id) => `/pages/${id}` },
      }));
      const root = await renderResolved(tool);

      expect(root.getAttribute('data-blok-tool')).toBe('page');
      expect(root.getAttribute('data-blok-mutation-free')).toBe('true');
      expect(anchorOf(root).getAttribute('href')).toBe('/pages/p1');
      expect(titleOf(root).textContent).toBe('Roadmap');
    });

    it('shows an authorized title as text, never as markup', async () => {
      const evil = '<img src=x onerror=alert(1)>';
      const tool = new PageTool(createOptions({ config: { resolve: () => ({ title: evil }) } }));
      const root = await renderResolved(tool);

      expect(titleOf(root).textContent).toBe(evil);
      expect(root.querySelector('img')).toBeNull();
    });

    it('drops a javascript: href from the host', async () => {
      const tool = new PageTool(createOptions({ config: { resolve: () => ({}), href: () => 'javascript:alert(1)' } }));
      const root = await renderResolved(tool);

      expect(anchorOf(root).hasAttribute('href')).toBe(false);
    });

    it('renders no href when the host gives no href()', async () => {
      const root = await renderResolved(new PageTool(createOptions({ config: { resolve: () => ({}) } })));

      expect(anchorOf(root).hasAttribute('href')).toBe(false);
    });

    it('keeps resolved metadata without a URL when the host href throws', async () => {
      const tool = new PageTool(createOptions({
        config: {
          resolve: () => ({ title: 'Roadmap' }),
          href: () => { throw new Error('URL unavailable'); },
        },
      }));
      const root = await renderResolved(tool);

      expect(titleOf(root).textContent).toBe('Roadmap');
      expect(anchorOf(root).hasAttribute('href')).toBe(false);
    });

    it('removes a stale URL when the host href later throws', async () => {
      let failHref = false;
      const tool = new PageTool(createOptions({
        config: {
          resolve: () => ({ title: 'Roadmap' }),
          href: () => {
            if (failHref) {
              throw new Error('URL unavailable');
            }

            return '/pages/p1';
          },
        },
      }));
      const root = await renderResolved(tool);

      expect(anchorOf(root).getAttribute('href')).toBe('/pages/p1');
      failHref = true;
      expect(() => tool.setData({ pageId: 'p1' })).not.toThrow();
      expect(anchorOf(root).hasAttribute('href')).toBe(false);
    });

    it('shows a localized placeholder for an authorized page without a title', async () => {
      const root = await renderResolved(new PageTool(createOptions({ config: { resolve: () => ({}) } })));

      expect(titleOf(root).textContent).toBe('tools.page.untitled');
      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('untitled');
    });

    it('treats a whitespace-only authorized title as untitled', async () => {
      const root = await renderResolved(new PageTool(createOptions({ config: { resolve: () => ({ title: '   ' }) } })));

      expect(titleOf(root).textContent).toBe('tools.page.untitled');
    });

    it('shows an authorized emoji icon as text', async () => {
      const root = await renderResolved(new PageTool(createOptions({
        config: { resolve: () => ({ title: 'A', icon: { type: 'emoji', value: '🗺' } }) },
      })));
      const icon = root.querySelector('[data-blok-testid="page-icon"]');

      expect(icon?.textContent).toBe('🗺');
      expect(icon?.querySelector('svg')).toBeNull();
    });

    it('shows an authorized image icon from a safe url', async () => {
      const root = await renderResolved(new PageTool(createOptions({
        config: { resolve: () => ({ icon: { type: 'image', url: 'https://cdn.test/i.png' } }) },
      })));
      const img = root.querySelector('[data-blok-testid="page-icon"] img');

      expect(img?.getAttribute('src')).toBe('https://cdn.test/i.png');
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('falls back to the page glyph when an authorized image icon url is unsafe', async () => {
      const root = await renderResolved(new PageTool(createOptions({
        config: { resolve: () => ({ icon: { type: 'image', url: 'javascript:alert(1)' } }) },
      })));
      const icon = root.querySelector('[data-blok-testid="page-icon"]');

      expect(icon?.querySelector('img')).toBeNull();
      expect(icon?.querySelector('svg')).not.toBeNull();
    });

    it('falls back to the page glyph when the saved icon is malformed', () => {
      const root = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { icon: { type: 'emoji' } as never } },
      })).render();

      expect(root.querySelector('[data-blok-testid="page-icon"] svg')).not.toBeNull();
    });

    it('leaves the keyboard to Blok, so undo and Escape still work after a click', () => {
      const root = new PageTool(createOptions()).render();

      expect(anchorOf(root).hasAttribute('data-blok-keyboard-owner')).toBe(false);
    });

    it('keeps the link out of the tab order and stops a primary mousedown from focusing it', () => {
      const root = new PageTool(createOptions({ config: { href: (id) => `/p/${id}` } })).render();
      const link = anchorOf(root);
      const press = (button: number): MouseEvent => {
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button });

        link.dispatchEvent(event);

        return event;
      };

      expect(link.tabIndex).toBe(-1);
      expect(press(0).defaultPrevented).toBe(true);
      expect(press(1).defaultPrevented).toBe(false);
    });
  });

  describe('click', () => {
    it('opens the authorized page through the host on a plain left click', async () => {
      const open = vi.fn();
      const root = await renderResolved(new PageTool(createOptions({
        config: { resolve: () => ({}), open, href: (id) => `/p/${id}` },
      })));
      const event = click(anchorOf(root));

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('p1', { event });
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      ['meta', { metaKey: true }],
      ['ctrl', { ctrlKey: true }],
      ['shift', { shiftKey: true }],
      ['alt', { altKey: true }],
      ['non-primary button', { button: 1 }],
    ])('leaves a %s click to the browser', async (_name, init) => {
      const open = vi.fn();
      const root = await renderResolved(new PageTool(createOptions({
        config: { resolve: () => ({}), open, href: (id) => `/p/${id}` },
      })));
      const event = click(anchorOf(root), init);

      expect(open).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('lets an authorized link navigate when the host gives no open()', async () => {
      const root = await renderResolved(new PageTool(createOptions({
        config: { resolve: () => ({}), href: (id) => `/p/${id}` },
      })));
      const event = click(anchorOf(root));

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('context menu actions', () => {
    it('marks the page link as a block-menu surface', () => {
      const root = new PageTool(createOptions({
        config: { href: (id) => `/pages/${id}` },
      })).render();

      expect(anchorOf(root).hasAttribute('data-blok-block-context-menu')).toBe(true);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('opens a page URL in a new tab', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      const tool = new PageTool(createOptions({
        config: { resolve: () => ({}), href: (id) => `https://workspace.test/pages/${id}` },
      }));

      tool.render();
      tool.rendered();
      await flush();
      const settings = tool.renderSettings() as Array<{ name?: string; title?: string; onActivate?: () => void }>;
      const action = settings.find((item) => item.name === 'page-open-new-tab');

      expect(action?.title).toBe('tools.file.previewOpenInNewTab');
      action?.onActivate?.();
      expect(open).toHaveBeenCalledWith('https://workspace.test/pages/p1', '_blank', 'noopener,noreferrer');
    });

    it('does not open a stale settings action after access is denied', async () => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);
      let denied = false;
      let notify: (() => void) | undefined;
      const tool = new PageTool(createOptions({
        config: {
          resolve: () => denied ? { access: 'none' } : { title: 'Allowed' },
          subscribe: (_id, onChange) => { notify = onChange; },
          href: () => 'https://workspace.test/pages/p1',
        },
      }));

      tool.render();
      tool.rendered();
      await flush();
      const settings = tool.renderSettings() as Array<{ name?: string; onActivate?: () => void }>;
      const action = settings.find((item) => item.name === 'page-open-new-tab');

      denied = true;
      notify?.();
      await flush();
      action?.onActivate?.();

      expect(opened).not.toHaveBeenCalled();
    });

    it('does not duplicate the built-in copy-link tune', async () => {
      const tool = new PageTool(createOptions({
        config: { resolve: () => ({}), href: (id) => `https://workspace.test/pages/${id}` },
      }));

      tool.render();
      tool.rendered();
      await flush();
      const settings = tool.renderSettings() as Array<{ name?: string }>;

      expect(settings.some((item) => item.name === 'page-copy-url')).toBe(false);
      expect(PageTool.copyAsLink({ pageId: 'p1' }, { href: (id) => `https://workspace.test/pages/${id}` })?.url)
        .toBe('https://workspace.test/pages/p1');
    });

    it('does not copy a link when the host href throws', () => {
      expect(PageTool.copyAsLink({ pageId: 'p1' }, {
        href: () => { throw new Error('URL unavailable'); },
      })).toBeNull();
    });

    it('does not offer a new-tab action when the host href later throws', async () => {
      let failHref = false;
      const tool = new PageTool(createOptions({
        config: {
          resolve: () => ({ title: 'Roadmap' }),
          href: () => {
            if (failHref) {
              throw new Error('URL unavailable');
            }

            return '/pages/p1';
          },
        },
      }));

      await renderResolved(tool);
      failHref = true;
      const settings = tool.renderSettings() as Array<{ name?: string }>;

      expect(settings.some((item) => item.name === 'page-open-new-tab')).toBe(false);
    });

    it('does not offer navigation for a missing page or unsafe URL', async () => {
      const missing = new PageTool(createOptions({
        config: { href: () => 'https://workspace.test/pages/p1', resolve: () => null },
      }));
      missing.render();
      missing.rendered();
      await flush();
      const missingSettings = missing.renderSettings() as Array<{ name?: string }>;
      const unsafe = new PageTool(createOptions({
        config: { resolve: () => ({}), href: () => 'javascript:alert(1)' },
      }));

      unsafe.render();
      unsafe.rendered();
      await flush();
      const unsafeSettings = unsafe.renderSettings() as Array<{ name?: string }>;

      expect(missingSettings.some((item) => item.name === 'page-open-new-tab')).toBe(false);
      expect(unsafeSettings.some((item) => item.name === 'page-open-new-tab')).toBe(false);
    });
  });

  describe('onNavigationEnter (Enter in navigation mode)', () => {
    const enter = (init: KeyboardEventInit = {}): KeyboardEvent =>
      new KeyboardEvent('keydown', { key: 'Enter', ...init });

    it('opens the authorized page through the host', async () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({ config: { resolve: () => ({}), open, href: (id) => `/p/${id}` } }));

      await renderResolved(tool);
      const event = enter({ metaKey: true });

      expect(tool.onNavigationEnter(event)).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('p1', { event });
    });

    it('opens an authorized untitled page too', async () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({ config: { resolve: () => ({}), open } }));

      await renderResolved(tool);

      expect(tool.onNavigationEnter(enter())).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('opens the authorized page in read-only mode', async () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({ config: { resolve: () => ({}), open }, readOnly: true }));

      await renderResolved(tool);

      expect(tool.onNavigationEnter(enter())).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('follows the link like a click when the host gives no open()', async () => {
      const tool = new PageTool(createOptions({ config: { resolve: () => ({}), href: (id) => `/p/${id}` } }));
      const root = await renderResolved(tool);
      const clicks: MouseEvent[] = [];

      anchorOf(root).addEventListener('click', (event) => {
        clicks.push(event);
        // jsdom has no navigation.
        event.preventDefault();
      });

      expect(tool.onNavigationEnter(enter())).toBe(true);
      expect(clicks).toHaveLength(1);
    });

    it.each([
      ['meta', { metaKey: true }],
      ['ctrl', { ctrlKey: true }],
    ])('opens a new tab on %s+Enter when the host gives no open()', async (_name, init) => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);
      const tool = new PageTool(createOptions({ config: { resolve: () => ({}), href: (id) => `/p/${id}` } }));
      const root = await renderResolved(tool);
      const clicks = vi.fn();

      anchorOf(root).addEventListener('click', clicks);

      expect(tool.onNavigationEnter(enter(init))).toBe(true);
      expect(opened).toHaveBeenCalledWith('/p/p1', '_blank', 'noopener');
      expect(clicks).not.toHaveBeenCalled();
    });

    it('does nothing when there is no open() and no href', async () => {
      const tool = new PageTool(createOptions({ config: { resolve: () => ({}) } }));

      await renderResolved(tool);

      expect(tool.onNavigationEnter(enter())).toBe(false);
    });

    it.each([
      ['missing', (): Promise<null> => Promise.resolve(null)],
      ['no-access', (): { access: 'none' } => ({ access: 'none' })],
    ])('does not open a %s page', async (_name, resolve) => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({
        config: { resolve, open, href: (id) => `/p/${id}` },
      }));

      await renderResolved(tool);

      expect(tool.onNavigationEnter(enter())).toBe(_name === 'no-access');
      expect(open).not.toHaveBeenCalled();
      tool.removed();
    });
  });

  describe('resolve', () => {
    it('shows a newer authorized title without writing to the document', async () => {
      const dispatchChange = vi.fn();
      const resolve = vi.fn().mockResolvedValue({ title: 'New' });
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Old' } },
        config: { resolve },
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith('p1');
      expect(dispatchChange).not.toHaveBeenCalled();
      expect(tool.save()).toEqual({ pageId: 'p1' });
      expect(titleOf(root).textContent).toBe('New');
    });

    it('accepts a synchronous resolve result', async () => {
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1' },
        config: { resolve: () => ({ title: 'Sync', icon: { type: 'emoji', value: '📄' } }) },
        dispatchChange,
      }));

      const root = await renderResolved(tool);

      expect(titleOf(root).textContent).toBe('Sync');
      expect(root.querySelector('[data-blok-testid="page-icon"]')?.textContent).toBe('📄');
      expect(tool.save()).toEqual({ pageId: 'p1' });
      expect(dispatchChange).not.toHaveBeenCalled();
    });

    it('does not write resolved metadata even when it matches the old cache', async () => {
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Same', icon: { type: 'emoji', value: '📄' } } },
        config: { resolve: () => Promise.resolve({ icon: { type: 'emoji', value: '📄' }, title: 'Same' }) },
        dispatchChange,
      }));

      tool.render();
      tool.rendered();
      await flush();

      expect(dispatchChange).not.toHaveBeenCalled();
    });

    it('writes nothing when the host knows nothing (undefined)', async () => {
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Kept' } },
        config: { resolve: () => undefined },
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      expect(dispatchChange).not.toHaveBeenCalled();
      expect(titleOf(root).textContent).toBe('tools.page.unresolved');
    });

    it('resolves only once, even when rendered() runs again after a move', async () => {
      const resolve = vi.fn().mockResolvedValue({ title: 'T' });
      const tool = new PageTool(createOptions({ config: { resolve } }));

      tool.render();
      tool.rendered();
      tool.rendered();
      await flush();

      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('shows the missing state and keeps the block when the page does not exist', async () => {
      const open = vi.fn();
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Gone' } },
        config: { resolve: () => Promise.resolve(null), open, href: (id) => `/p/${id}` },
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      const anchor = anchorOf(root);

      expect(anchor.getAttribute('data-blok-page-state')).toBe('missing');
      expect(anchor.className).not.toContain('text-text-primary');
      expect(anchor.className).not.toMatch(/(^|\s)can-hover:hover:bg-item-hover-bg(\s|$)/);
      expect(anchor.hasAttribute('href')).toBe(false);
      expect(anchor.getAttribute('aria-disabled')).toBe('true');
      expect(titleOf(root).textContent).toBe('tools.page.missing');

      click(anchor);

      expect(open).not.toHaveBeenCalled();
      expect(dispatchChange).not.toHaveBeenCalled();
      expect(tool.save()).toEqual({ pageId: 'p1' });
    });

    it('shows no access and hides the cached title', async () => {
      const open = vi.fn();
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Secret plans' } },
        config: { resolve: () => ({ access: 'none' }), open, href: (id) => `/p/${id}` },
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      const anchor = anchorOf(root);

      expect(anchor.getAttribute('data-blok-page-state')).toBe('no-access');
      expect(anchor.hasAttribute('href')).toBe(false);
      expect(anchor.getAttribute('role')).toBe('button');
      expect(anchor.getAttribute('aria-haspopup')).toBe('dialog');
      expect(root.textContent).not.toContain('Secret plans');
      expect(titleOf(root).textContent).toBe('tools.page.noAccess');

      click(anchor);

      expect(open).not.toHaveBeenCalled();
      expect(dispatchChange).not.toHaveBeenCalled();
      tool.removed();
    });

    it('shows a fresh title in read-only mode but never writes it', async () => {
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Old' } },
        config: { resolve: () => Promise.resolve({ title: 'New' }) },
        readOnly: true,
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      expect(titleOf(root).textContent).toBe('New');
      expect(dispatchChange).not.toHaveBeenCalled();
      expect(tool.save()).toEqual({ pageId: 'p1' });
    });

    it('resolves again without saving metadata when the host says the page changed', async () => {
      const dispatchChange = vi.fn();
      let title = 'Old';
      let changed: (() => void) | undefined;
      const subscribe = vi.fn((_id: string, onChange: () => void) => {
        changed = onChange;
      });
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Old' } },
        config: { resolve: () => ({ title }), subscribe },
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();
      title = 'Renamed in another tab';
      changed?.();
      await flush();

      expect(titleOf(root).textContent).toBe('Renamed in another tab');
      expect(tool.save()).toEqual({ pageId: 'p1' });
      expect(dispatchChange).not.toHaveBeenCalled();
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledWith('p1', expect.any(Function));
    });

    it('stops listening when the block is removed or destroyed', () => {
      const unsubscribe = vi.fn();
      const removed = new PageTool(createOptions({ config: { subscribe: () => unsubscribe } }));
      const destroyed = new PageTool(createOptions({ config: { subscribe: () => unsubscribe } }));

      removed.render();
      removed.rendered();
      removed.removed();
      destroyed.render();
      destroyed.rendered();
      destroyed.destroy();

      expect(unsubscribe).toHaveBeenCalledTimes(2);
    });

    it('listens to the new page when undo or a peer points the block elsewhere', () => {
      const unsubscribe = vi.fn();
      const subscribe = vi.fn(() => unsubscribe);
      const tool = new PageTool(createOptions({ config: { subscribe } }));

      tool.render();
      tool.rendered();
      tool.setData({ pageId: 'p2' });

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenLastCalledWith('p2', expect.any(Function));
    });

    it('a probe block never listens', () => {
      const subscribe = vi.fn();
      const tool = new PageTool(createOptions({ origin: 'probe', config: { subscribe } }));

      tool.render();
      tool.rendered();

      expect(subscribe).not.toHaveBeenCalled();
    });

    it('ignores a resolve that lands after the block was removed', async () => {
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Old' } },
        config: { resolve: () => Promise.resolve({ title: 'New' }) },
        dispatchChange,
      }));

      tool.render();
      tool.rendered();
      tool.removed();
      await flush();

      expect(dispatchChange).not.toHaveBeenCalled();
    });

    it('logs nothing and stays neutral when resolve throws', async () => {
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Kept' } },
        config: { resolve: () => Promise.reject(new Error('offline')) },
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      expect(dispatchChange).not.toHaveBeenCalled();
      expect(titleOf(root).textContent).toBe('tools.page.unresolved');
    });
  });

  describe('save and data', () => {
    it('saves only pageId from legacy input', () => {
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Roadmap', icon: { type: 'emoji', value: '🗺' } } },
      }));
      const saved = tool.save();

      expect(Object.keys(saved)).toEqual(['pageId']);
      expect(saved).toEqual({ pageId: 'p1' });
    });

    it('omits an empty cache', () => {
      expect(new PageTool(createOptions({ data: { pageId: 'p1' } })).save()).toEqual({ pageId: 'p1' });
    });

    it('validates only a non-empty pageId', () => {
      const tool = new PageTool(createOptions());

      expect(tool.validate({ pageId: 'p1' })).toBe(true);
      expect(tool.validate({ pageId: '' })).toBe(false);
      expect(tool.validate({} as PageData)).toBe(false);
    });

    it('keeps cached text byte-identical through the sanitizer', () => {
      const title = 'A <b>bold</b> & "plain" </p> title';
      const [cleaned] = sanitizeBlocks(
        [{ tool: 'page', data: { pageId: 'p1', cache: { title, icon: { type: 'image', url: 'https://x.test/a?b=1&c=2' } } } }],
        () => PageTool.sanitize,
        { b: true, a: { href: true } }
      );

      expect(cleaned.data).toEqual({ pageId: 'p1', cache: { title, icon: { type: 'image', url: 'https://x.test/a?b=1&c=2' } } });
    });

    it('does not export legacy cached text when turned into text', () => {
      const exported = convertBlockDataToString(
        { pageId: 'p1', cache: { title: '<i>x</i> & y' } },
        PageTool.conversionConfig
      );

      expect(exported).toBe('Page');
      expect(convertBlockDataToString({ pageId: 'p1' }, PageTool.conversionConfig)).toBe('Page');
    });
  });

  describe('new page from the toolbox', () => {
    it('mints an id, creates the page once, saves the id, then opens it', async () => {
      const calls: string[] = [];
      const dispatchChange = vi.fn(() => calls.push('dispatch'));
      const create = vi.fn(() => {
        calls.push('create');

        return Promise.resolve();
      });
      const open = vi.fn(() => calls.push('open'));
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: { create, open },
        origin: 'user',
        dispatchChange,
      }));

      const minted = tool.save().pageId;

      expect(minted).toMatch(/^[A-Za-z0-9_-]{10}$/);

      tool.render();
      tool.rendered();
      tool.rendered();
      await flush();

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({ pageId: minted });
      expect(dispatchChange).toHaveBeenCalledWith({ derived: true });
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(minted, {});
      expect(calls.slice(0, 3)).toEqual(['dispatch', 'create', 'open']);
      expect(tool.save().pageId).toBe(minted);
    });

    it('does not create a page after its pointer changes during insertion', async () => {
      const create = vi.fn();
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: { create },
        origin: 'user',
        dispatchChange,
      }));

      tool.render();
      tool.rendered();
      tool.setData({ pageId: 'replacement' });
      await flush();

      expect(create).not.toHaveBeenCalled();
      expect(dispatchChange).not.toHaveBeenCalled();
      expect(tool.save().pageId).toBe('replacement');
    });

    it('keeps the id and does not open when create fails', async () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: { create: () => Promise.reject(new Error('no')), open },
        origin: 'user',
      }));
      const minted = tool.save().pageId;

      tool.render();
      tool.rendered();
      await flush();

      expect(open).not.toHaveBeenCalled();
      expect(tool.save().pageId).toBe(minted);
    });

    it('keeps a failed creation visibly missing when resolve has no answer', async () => {
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: {
          create: () => Promise.reject(new Error('creation failed')),
          resolve: () => undefined,
        },
        origin: 'user',
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('missing');
      expect(titleOf(root).textContent).toBe('tools.page.missing');
    });

    it('does not open a page whose block was removed while it was being created', async () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: { create: () => Promise.resolve(), open },
        origin: 'user',
      }));

      tool.render();
      tool.rendered();
      tool.removed();
      await flush();

      expect(open).not.toHaveBeenCalled();
    });

    it('creates but does not open a page inserted through the API', async () => {
      const create = vi.fn().mockResolvedValue(undefined);
      const open = vi.fn();
      const tool = new PageTool(createOptions({ data: { pageId: '' }, config: { create, open }, origin: 'api' }));

      tool.render();
      tool.rendered();
      await flush();

      expect(create).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
    });

    it('resolves the new page only after it was created', async () => {
      const calls: string[] = [];
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: {
          create: () => {
            calls.push('create');
          },
          resolve: () => {
            calls.push('resolve');

            return { title: 'T' };
          },
        },
        origin: 'user',
      }));

      tool.render();
      tool.rendered();
      await flush();

      expect(calls).toEqual(['create', 'resolve']);
    });

    it.each<[string, Pick<Setup, 'origin' | 'replaySource'>]>([
      ['load', { origin: 'load' }],
      ['own undo/redo', { origin: 'replay', replaySource: 'history' }],
      ['remote change', { origin: 'replay', replaySource: 'remote' }],
      ['paste', { origin: 'paste' }],
      ['probe', { origin: 'probe' }],
      ['convert', { origin: 'convert' }],
    ])('never mints, creates, opens or resolves on %s', async (_name, setup) => {
      const create = vi.fn();
      const open = vi.fn();
      const resolve = vi.fn();
      const href = vi.fn(() => '/p');
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: { create, open, resolve, href },
        dispatchChange,
        ...setup,
      }));

      tool.render();
      tool.rendered();
      await flush();

      expect(tool.save().pageId).toBe('');
      expect(create).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
      expect(href).not.toHaveBeenCalled();
      expect(dispatchChange).not.toHaveBeenCalled();
    });

    it('does not create or open an existing page on undo/redo or a peer change', async () => {
      const create = vi.fn();
      const open = vi.fn();

      for (const replaySource of ['history', 'remote'] as const) {
        const tool = new PageTool(createOptions({
          data: { pageId: 'p1' },
          config: { create, open },
          origin: 'replay',
          replaySource,
        }));

        tool.render();
        tool.rendered();
      }
      await flush();

      expect(create).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('a failed create', () => {
    it('shows the page as missing, with no link to follow', async () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: { create: () => Promise.reject(new Error('no')), open, href: (id) => `/p/${id}` },
        origin: 'user',
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('missing');
      expect(anchorOf(root).hasAttribute('href')).toBe(false);
      click(anchorOf(root));
      expect(open).not.toHaveBeenCalled();
    });

    it('still asks resolve, so a page the host made after all comes back', async () => {
      const resolve = vi.fn().mockResolvedValue({ title: 'Made anyway' });
      const tool = new PageTool(createOptions({
        data: { pageId: '' },
        config: { create: () => Promise.reject(new Error('timeout')), resolve },
        origin: 'user',
      }));
      const root = tool.render();

      tool.rendered();
      await flush();

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('normal');
      expect(titleOf(root).textContent).toBe('Made anyway');
    });
  });

  describe('setData (undo/redo and peers)', () => {
    it('ignores a same-page legacy cache without resolving or writing', async () => {
      const dispatchChange = vi.fn();
      const resolve = vi.fn().mockResolvedValue({ title: 'Mine' });
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Old' } },
        config: { resolve },
        dispatchChange,
      }));
      const root = await renderResolved(tool);

      resolve.mockClear();
      expect(tool.setData({ pageId: 'p1', cache: { title: 'Theirs' } })).toBe(true);
      await flush();

      expect(resolve).not.toHaveBeenCalled();
      expect(dispatchChange).not.toHaveBeenCalled();
      expect(titleOf(root).textContent).toBe('Mine');
      expect(tool.save()).toEqual({ pageId: 'p1' });
    });

    it('drops a missing verdict and rechecks access when the block points elsewhere', async () => {
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1' },
        config: {
          resolve: (id) => id === 'p1' ? null : { title: 'Other' },
          href: (id) => `/p/${id}`,
        },
      }));
      const root = await renderResolved(tool);

      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('missing');
      tool.setData({ pageId: 'p2', cache: { title: 'Legacy other' } });
      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('unresolved');
      expect(anchorOf(root).hasAttribute('href')).toBe(false);
      await flush();

      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('normal');
      expect(anchorOf(root).getAttribute('href')).toBe('/p/p2');
      expect(titleOf(root).textContent).toBe('Other');
    });

    it('ignores a resolve for the old page that lands after the page changed', async () => {
      const dispatchChange = vi.fn();
      const pending: Array<(info: { title: string }) => void> = [];
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'One' } },
        config: { resolve: () => new Promise((resolve) => pending.push(resolve)) },
        dispatchChange,
      }));
      const root = tool.render();

      tool.rendered();
      await flush();
      tool.setData({ pageId: 'p2', cache: { title: 'Two' } });
      await flush();
      pending[0]?.({ title: 'Stale one' });
      await flush();

      expect(dispatchChange).not.toHaveBeenCalled();
      expect(titleOf(root).textContent).toBe('tools.page.unresolved');
      pending[1]?.({ title: 'Fresh two' });
      await flush();
      expect(titleOf(root).textContent).toBe('Fresh two');
      expect(tool.save()).toEqual({ pageId: 'p2' });
    });

    it('discards incoming legacy cache data', () => {
      const tool = new PageTool(createOptions());
      const root = tool.render();

      tool.setData({ pageId: 'p1', cache: { title: 'T', icon: { type: 'emoji' } as never } });

      expect(root.textContent).not.toContain('T');
      expect(tool.save()).toEqual({ pageId: 'p1' });
    });
  });

  describe('read-only, then editable', () => {
    it('keeps resolved metadata ephemeral when editing turns on', async () => {
      const dispatchChange = vi.fn();
      const resolve = vi.fn().mockResolvedValue({ title: 'New' });
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Old' } },
        config: { resolve },
        readOnly: true,
        dispatchChange,
      }));
      const root = await renderResolved(tool);

      tool.setReadOnly(false);
      tool.setReadOnly(true);
      tool.setReadOnly(false);
      await flush();

      expect(dispatchChange).not.toHaveBeenCalled();
      expect(tool.save()).toEqual({ pageId: 'p1' });
      expect(titleOf(root).textContent).toBe('New');
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('shows a page the host reports untitled as untitled, not the old cached title', async () => {
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Old' } },
        config: { resolve: () => ({}) },
        readOnly: true,
      }));
      const root = await renderResolved(tool);

      expect(titleOf(root).textContent).toBe('tools.page.untitled');
    });
  });

  describe('hover preview', () => {
    const preview = (): HTMLElement | null => document.querySelector('[data-blok-testid="page-hover-preview"]');

    const hoverOver = (link: HTMLElement): void => {
      link.dispatchEvent(new MouseEvent('mouseenter'));
    };

    const mount = async (setup: Setup): Promise<{ tool: PageTool; root: HTMLElement }> => {
      const tool = new PageTool(createOptions(setup));
      const root = tool.render();

      document.body.appendChild(root);
      tool.rendered();
      await flush();

      return { tool, root };
    };

    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = '';
    });

    it('owns its link, so Blok shows no link card for it', async () => {
      const { root } = await mount({ config: { resolve: () => ({ title: 'Roadmap' }) } });

      expect(anchorOf(root).closest('[data-blok-link-owner]')).not.toBeNull();
    });

    it('shows the page icon, its path and its title after a hover pause', async () => {
      const { root } = await mount({
        data: { pageId: 'p1', cache: { title: 'Roadmap' } },
        config: { resolve: () => ({ title: 'Roadmap', icon: { type: 'emoji', value: '🚀' }, path: ['Home', 'Plans'] }) },
      });

      vi.useFakeTimers();
      hoverOver(anchorOf(root));
      vi.advanceTimersByTime(300);
      expect(preview()).toBeNull();

      vi.advanceTimersByTime(200);
      const card = preview();

      expect(card?.querySelector('[data-blok-testid="page-hover-preview-title"]')?.textContent).toBe('Roadmap');
      expect(card?.querySelector('[data-blok-testid="page-hover-preview-path"]')?.textContent).toBe('Home / Plans');
      expect(card?.querySelector('[data-blok-testid="page-hover-preview-icon"]')?.textContent).toBe('🚀');
      expect(card?.hasAttribute('data-blok-top-layer')).toBe(true);
      // Blok's utilities and tokens apply only inside an interface root.
      expect(card?.getAttribute('data-blok-interface')).toBe('page-hover-preview');
      expect(card?.style.boxSizing).toBe('border-box');
    });

    it('shows the start of the page content, as plain lines', async () => {
      const preview = vi.fn(() => Promise.resolve([
        { type: 'header', data: { text: 'Goals', level: 2 } },
        { type: 'paragraph', data: { text: 'Ship <b>fast</b> &amp; safe' } },
        { type: 'paragraph', data: { text: '' } },
        { type: 'list', data: { text: 'First', style: 'unordered' } },
        { type: 'image', data: { url: 'x.png' } },
      ]));
      const { root } = await mount({ config: { resolve: () => ({ title: 'Roadmap' }), preview } });

      vi.useFakeTimers();
      hoverOver(anchorOf(root));
      await vi.advanceTimersByTimeAsync(500);

      const lines = [...document.querySelectorAll('[data-blok-testid="page-hover-preview-line"]')];

      expect(lines.map((line) => line.textContent)).toEqual(['Goals', 'Ship fast & safe', '• First']);
      expect(lines[0].getAttribute('data-blok-preview-heading')).toBe('true');
      expect(lines.every((line) => line.classList.contains('pl-1'))).toBe(true);
      expect(preview).toHaveBeenCalledWith('p1');
      expect(document.querySelector('[data-blok-testid="page-hover-preview-content"] script, [data-blok-testid="page-hover-preview-content"] b')).toBeNull();
    });

    it('numbers ordered items, restarting after other blocks, and marks to-dos', () => {
      expect(previewLines([
        { type: 'list', data: { text: 'a', style: 'ordered' } },
        { type: 'list', data: { text: 'b', style: 'ordered' } },
        { type: 'paragraph', data: { text: 'break' } },
        { type: 'list', data: { text: 'c', style: 'ordered' } },
        { type: 'list', data: { text: 'done', style: 'checklist', checked: true } },
        { type: 'list', data: { text: 'todo', style: 'checklist' } },
      ]).map((line) => line.text)).toEqual(['1. a', '2. b', 'break', '1. c', '☑ done', '☐ todo']);
    });

    it('asks for the content once per hover, and still shows the card when it fails', async () => {
      const preview = vi.fn(() => Promise.reject(new Error('offline')));
      const { root } = await mount({ config: { resolve: () => ({ title: 'Roadmap' }), preview } });

      vi.useFakeTimers();
      hoverOver(anchorOf(root));
      await vi.advanceTimersByTimeAsync(500);

      expect(preview).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-blok-testid="page-hover-preview"]')).not.toBeNull();
      expect(document.querySelector('[data-blok-testid="page-hover-preview-content"]')).toBeNull();
    });

    it('names an untitled page and leaves out an empty path', async () => {
      const { root } = await mount({ config: { resolve: () => ({}) } });

      vi.useFakeTimers();
      hoverOver(anchorOf(root));
      vi.advanceTimersByTime(500);

      expect(preview()?.querySelector('[data-blok-testid="page-hover-preview-title"]')?.textContent).toBe('tools.page.untitled');
      expect(preview()?.querySelector('[data-blok-testid="page-hover-preview-path"]')).toBeNull();
    });

    it('goes as soon as the pointer leaves the page block, even onto the card', async () => {
      const { root } = await mount({ config: { resolve: () => ({ title: 'Roadmap' }) } });
      const link = anchorOf(root);

      vi.useFakeTimers();
      hoverOver(link);
      vi.advanceTimersByTime(500);

      const card = preview();

      expect(card).not.toBeNull();
      link.dispatchEvent(new MouseEvent('mouseleave'));
      card?.dispatchEvent(new MouseEvent('mouseenter'));
      expect(preview()).toBeNull();
      vi.advanceTimersByTime(1000);
      expect(preview()).toBeNull();
    });

    it('lets the pointer pass through the card, so it never holds a hover', async () => {
      const { root } = await mount({ config: { resolve: () => ({ title: 'Roadmap' }) } });

      vi.useFakeTimers();
      hoverOver(anchorOf(root));
      vi.advanceTimersByTime(500);

      expect(preview()?.style.pointerEvents).toBe('none');
    });

    it('never shows for a page that is missing', async () => {
      const { root } = await mount({ data: { pageId: 'p1' }, config: { resolve: () => null } });

      vi.useFakeTimers();
      hoverOver(anchorOf(root));
      vi.advanceTimersByTime(1000);

      expect(preview()).toBeNull();
    });

    it('goes away when the block is removed or the link is pressed', async () => {
      const { tool, root } = await mount({ config: { resolve: () => ({ title: 'Roadmap' }) } });

      vi.useFakeTimers();
      hoverOver(anchorOf(root));
      vi.advanceTimersByTime(500);
      anchorOf(root).dispatchEvent(new MouseEvent('mousedown', { button: 0, cancelable: true }));
      vi.advanceTimersByTime(500);
      expect(preview()).toBeNull();

      hoverOver(anchorOf(root));
      vi.advanceTimersByTime(500);
      tool.removed();
      vi.advanceTimersByTime(500);
      expect(preview()).toBeNull();
    });
  });

  describe('static surface', () => {
    it('declares a basic toolbox entry', () => {
      const toolbox = PageTool.toolbox;

      expect(Array.isArray(toolbox)).toBe(false);
      expect(toolbox).toMatchObject({
        titleKey: 'page',
        section: 'basic',
        preview: { render: renderPagePreview, descriptionKey: 'toolbox.preview.page' },
      });
      expect(toolbox).toHaveProperty('searchTerms', expect.arrayContaining(['page', 'subpage', 'document']));
    });

    it('supports read-only mode in place', () => {
      const tool = new PageTool(createOptions());

      expect(PageTool.isReadOnlySupported).toBe(true);
      expect(() => tool.setReadOnly(true)).not.toThrow();
    });
  });

  describe('copyAsLink (copy, duplicate and paste carry a link, not a second block)', () => {
    it('links to the absolute page url without leaking a legacy cached title', () => {
      const link = PageTool.copyAsLink(
        { pageId: 'p1', cache: { title: 'Plans' } },
        { href: (pageId) => `/editor/page/${pageId}` }
      );

      expect(link).toEqual({ url: new URL('/editor/page/p1', document.baseURI).href, text: 'Page' });
      expect(link?.url.startsWith('http')).toBe(true);
    });

    it('uses neutral text for an untitled page', () => {
      expect(PageTool.copyAsLink({ pageId: 'p1' }, { href: () => 'https://x.test/p1' })).toEqual({
        url: 'https://x.test/p1',
        text: 'Page',
      });
    });

    it('returns null without an href config', () => {
      expect(PageTool.copyAsLink({ pageId: 'p1' }, {})).toBeNull();
    });

    it('returns null for an unsafe href or an empty page id', () => {
      expect(PageTool.copyAsLink({ pageId: 'p1' }, { href: () => 'javascript:alert(1)' })).toBeNull();
      expect(PageTool.copyAsLink({ pageId: '' }, { href: () => 'https://x.test/' })).toBeNull();
    });
  });
});
