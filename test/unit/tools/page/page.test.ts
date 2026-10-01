import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PageTool } from '../../../../src/tools/page';
import type { PageConfig, PageData } from '../../../../src/tools/page/types';
import { renderPagePreview } from '../../../../src/tools/page/preview';
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

describe('Page tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('render', () => {
    it('renders a mutation-free page root with a link to the page', () => {
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Roadmap' } },
        config: { href: (id) => `/pages/${id}` },
      }));
      const root = tool.render();

      expect(root.getAttribute('data-blok-tool')).toBe('page');
      expect(root.getAttribute('data-blok-mutation-free')).toBe('true');
      expect(anchorOf(root).getAttribute('href')).toBe('/pages/p1');
      expect(titleOf(root).textContent).toBe('Roadmap');
    });

    it('shows the title as text, never as markup', () => {
      const evil = '<img src=x onerror=alert(1)>';
      const tool = new PageTool(createOptions({ data: { pageId: 'p1', cache: { title: evil } } }));
      const root = tool.render();

      expect(titleOf(root).textContent).toBe(evil);
      expect(root.querySelector('img')).toBeNull();
    });

    it('drops a javascript: href from the host', () => {
      const tool = new PageTool(createOptions({ config: { href: () => 'javascript:alert(1)' } }));
      const root = tool.render();

      expect(anchorOf(root).hasAttribute('href')).toBe(false);
    });

    it('renders no href when the host gives no href()', () => {
      const root = new PageTool(createOptions()).render();

      expect(anchorOf(root).hasAttribute('href')).toBe(false);
    });

    it('shows a localized placeholder for a page without a title', () => {
      const root = new PageTool(createOptions({ data: { pageId: 'p1' } })).render();

      expect(titleOf(root).textContent).toBe('tools.page.untitled');
      expect(anchorOf(root).getAttribute('data-blok-page-state')).toBe('untitled');
    });

    it('treats a whitespace-only title as untitled', () => {
      const root = new PageTool(createOptions({ data: { pageId: 'p1', cache: { title: '   ' } } })).render();

      expect(titleOf(root).textContent).toBe('tools.page.untitled');
    });

    it('shows an emoji icon as text', () => {
      const root = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'A', icon: { type: 'emoji', value: '🗺' } } },
      })).render();
      const icon = root.querySelector('[data-blok-testid="page-icon"]');

      expect(icon?.textContent).toBe('🗺');
      expect(icon?.querySelector('svg')).toBeNull();
    });

    it('shows an image icon from a safe url', () => {
      const root = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { icon: { type: 'image', url: 'https://cdn.test/i.png' } } },
      })).render();
      const img = root.querySelector('[data-blok-testid="page-icon"] img');

      expect(img?.getAttribute('src')).toBe('https://cdn.test/i.png');
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('falls back to the page glyph when the image icon url is unsafe', () => {
      const root = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { icon: { type: 'image', url: 'javascript:alert(1)' } } },
      })).render();
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

    it('gives the link its own keyboard so Enter on it follows the link', () => {
      const root = new PageTool(createOptions()).render();

      expect(anchorOf(root).hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });
  });

  describe('click', () => {
    it('opens the page through the host on a plain left click', () => {
      const open = vi.fn();
      const root = new PageTool(createOptions({ config: { open, href: (id) => `/p/${id}` } })).render();
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
    ])('leaves a %s click to the browser', (_name, init) => {
      const open = vi.fn();
      const root = new PageTool(createOptions({ config: { open, href: (id) => `/p/${id}` } })).render();
      const event = click(anchorOf(root), init);

      expect(open).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('lets the link navigate when the host gives no open()', () => {
      const root = new PageTool(createOptions({ config: { href: (id) => `/p/${id}` } })).render();
      const event = click(anchorOf(root));

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('activate (Enter in navigation mode)', () => {
    const enter = (init: KeyboardEventInit = {}): KeyboardEvent =>
      new KeyboardEvent('keydown', { key: 'Enter', ...init });

    it('opens the page through the host', () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({ config: { open, href: (id) => `/p/${id}` } }));

      tool.render();
      const event = enter({ metaKey: true });

      expect(tool.activate(event)).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('p1', { event });
    });

    it('opens an untitled page too', () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({ data: { pageId: 'p1' }, config: { open } }));

      tool.render();

      expect(tool.activate(enter())).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('opens the page in read-only mode', () => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({ config: { open }, readOnly: true }));

      tool.render();

      expect(tool.activate(enter())).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('follows the link like a click when the host gives no open()', () => {
      const tool = new PageTool(createOptions({ config: { href: (id) => `/p/${id}` } }));
      const root = tool.render();
      const clicks: MouseEvent[] = [];

      anchorOf(root).addEventListener('click', (event) => {
        clicks.push(event);
        // jsdom has no navigation.
        event.preventDefault();
      });

      expect(tool.activate(enter())).toBe(true);
      expect(clicks).toHaveLength(1);
    });

    it('does nothing when there is no open() and no href', () => {
      const tool = new PageTool(createOptions());

      tool.render();

      expect(tool.activate(enter())).toBe(false);
    });

    it.each([
      ['missing', (): Promise<null> => Promise.resolve(null)],
      ['no-access', (): { access: 'none' } => ({ access: 'none' })],
    ])('does not open a %s page', async (_name, resolve) => {
      const open = vi.fn();
      const tool = new PageTool(createOptions({
        config: { resolve, open, href: (id) => `/p/${id}` },
      }));

      tool.render();
      tool.rendered();
      await flush();

      expect(tool.activate(enter())).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('refreshes the cached title when the host knows a newer one', async () => {
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
      expect(dispatchChange).toHaveBeenCalledTimes(1);
      expect(dispatchChange).toHaveBeenCalledWith({ derived: true });
      expect(tool.save()).toEqual({ pageId: 'p1', cache: { title: 'New' } });
      expect(titleOf(root).textContent).toBe('New');
    });

    it('accepts a synchronous resolve result', async () => {
      const dispatchChange = vi.fn();
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1' },
        config: { resolve: () => ({ title: 'Sync', icon: { type: 'emoji', value: '📄' } }) },
        dispatchChange,
      }));

      tool.render();
      tool.rendered();
      await flush();

      expect(tool.save()).toEqual({ pageId: 'p1', cache: { title: 'Sync', icon: { type: 'emoji', value: '📄' } } });
    });

    it('writes nothing when the host returns what is already cached', async () => {
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
      expect(titleOf(root).textContent).toBe('Kept');
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
      expect(tool.save()).toEqual({ pageId: 'p1', cache: { title: 'Gone' } });
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
      expect(anchor.getAttribute('aria-disabled')).toBe('true');
      expect(root.textContent).not.toContain('Secret plans');
      expect(titleOf(root).textContent).toBe('tools.page.noAccess');

      click(anchor);

      expect(open).not.toHaveBeenCalled();
      expect(dispatchChange).not.toHaveBeenCalled();
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
      expect(tool.save()).toEqual({ pageId: 'p1', cache: { title: 'Old' } });
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

    it('logs nothing and keeps the cache when resolve throws', async () => {
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
      expect(titleOf(root).textContent).toBe('Kept');
    });
  });

  describe('save and data', () => {
    it('saves only pageId and cache — never a top-level title', () => {
      const tool = new PageTool(createOptions({
        data: { pageId: 'p1', cache: { title: 'Roadmap', icon: { type: 'emoji', value: '🗺' } } },
      }));
      const saved = tool.save();

      expect(Object.keys(saved).sort()).toEqual(['cache', 'pageId']);
      expect(saved).toEqual({ pageId: 'p1', cache: { title: 'Roadmap', icon: { type: 'emoji', value: '🗺' } } });
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

    it('exports the title as escaped text so turn-into-text keeps it literal', () => {
      const exported = convertBlockDataToString(
        { pageId: 'p1', cache: { title: '<i>x</i> & y' } },
        PageTool.conversionConfig
      );

      expect(exported).toBe('&lt;i&gt;x&lt;/i&gt; &amp; y');
      expect(convertBlockDataToString({ pageId: 'p1' }, PageTool.conversionConfig)).toBe('');
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
});
