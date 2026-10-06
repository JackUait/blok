import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { PageConfig, PageData, PageIcon, PageInfo } from '../../../../src/tools/page/types';

const picker = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  handlers: null as null | { onSelect: (native: string) => void; onRemove: () => void },
}));

vi.mock('../../../../src/tools/callout/emoji-picker', () => ({
  prefetchEmojiPickerData: vi.fn(),
  EmojiPicker: class {
    private readonly element = document.createElement('div');

    constructor(options: { onSelect: (native: string) => void; onRemove: () => void }) {
      picker.handlers = options;
    }

    public getElement(): HTMLElement {
      return this.element;
    }

    public isOpen(): boolean {
      return false;
    }

    public open(anchor: HTMLElement, rect?: DOMRect, handlers?: { onSelect: (native: string) => void; onRemove: () => void }): Promise<void> {
      if (handlers !== undefined) {
        picker.handlers = handlers;
      }
      picker.open(anchor);

      return Promise.resolve();
    }

    public close(): void {
      picker.close();
    }
  },
}));

const { PageTool } = await import('../../../../src/tools/page');
const { sanitizeBlocks } = await import('../../../../src/components/utils/sanitizer');

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Item = { type?: string; name?: string; title?: string; secondaryLabel?: string; onActivate?: () => void };

const createOptions = (
  config: PageConfig,
  data: Partial<PageData> = { pageId: 'p1' },
  block: { selected?: boolean; dispatchChange?: () => void } = {}
): BlockToolConstructorOptions<PageData, PageConfig> => ({
  api: { i18n: { t: (key: string) => key, has: () => true, getLocale: () => 'en' } } as unknown as API,
  block: { dispatchChange: vi.fn(), selected: false, ...block } as never,
  config,
  readOnly: false,
  data: data as PageData,
  origin: 'load',
});

const mounted: Array<InstanceType<typeof PageTool>> = [];

const mount = async (
  config: PageConfig,
  data?: Partial<PageData>,
  block?: { selected?: boolean; dispatchChange?: () => void }
): Promise<{ tool: InstanceType<typeof PageTool>; root: HTMLElement }> => {
  const tool = new PageTool(createOptions(config, data, block));
  const root = tool.render();

  mounted.push(tool);
  document.body.append(root);
  tool.rendered();
  await flush();

  return { tool, root };
};

const names = (items: Item[]): Array<string | undefined> =>
  items.map((item) => item.type === 'separator' ? '---' : item.name);

const item = (tool: InstanceType<typeof PageTool>, name: string): Item | undefined =>
  (tool.renderSettings() as Item[]).find((entry) => entry.name === name);

const linkOf = (root: HTMLElement): HTMLAnchorElement => {
  const link = root.querySelector('a');

  if (link === null) {
    throw new Error('no link');
  }

  return link;
};

/** A host that keeps what it is told, like a real one. */
const allHooks = (info: PageInfo = { title: 'Roadmap' }): PageConfig => {
  const page = { ...info };

  return {
    resolve: () => ({ ...page }),
    href: (id) => `https://workspace.test/pages/${id}`,
    rename: vi.fn((_id: string, title: string) => {
      page.title = title;
    }),
    setIcon: vi.fn((_id: string, icon: PageIcon | null) => {
      page.icon = icon ?? undefined;
    }),
    peek: vi.fn(),
  };
};

describe('Page tool actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    picker.handlers = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mounted.splice(0).forEach((tool) => tool.removed());
    document.body.replaceChildren();
  });

  describe('menu', () => {
    it('lists color, icon and rename, then the two ways to open', async () => {
      const { tool } = await mount(allHooks());

      expect(names(tool.renderSettings() as Item[])).toEqual([
        'block-color',
        'page-edit-icon',
        'page-rename',
        '---',
        'page-open-new-tab',
        'page-open-side-peek',
      ]);
    });

    it('shows the shortcuts beside rename, new tab and side peek', async () => {
      const { tool } = await mount(allHooks());

      expect(item(tool, 'page-rename')?.secondaryLabel).toMatch(/R$/);
      expect(item(tool, 'page-open-new-tab')?.secondaryLabel).toMatch(/⏎$/);
      expect(item(tool, 'page-open-side-peek')?.secondaryLabel).toMatch(/blockSettings\.clickAction$/);
    });

    it('hides each host action whose hook is missing', async () => {
      const { tool } = await mount({ resolve: () => ({ title: 'Roadmap' }) });

      expect(names(tool.renderSettings() as Item[])).toEqual(['block-color']);
    });

    it('offers only color for a page the user cannot open', async () => {
      const { tool } = await mount({ ...allHooks(), resolve: () => ({ access: 'none' }) });

      expect(names(tool.renderSettings() as Item[])).toEqual(['block-color']);
    });

    it('lays the block menu out as a titled page section that trashes on delete', () => {
      expect(PageTool.blockMenu).toEqual({ titled: true, trash: true });
    });
  });

  describe('color', () => {
    it('saves and paints a block color', async () => {
      const { tool, root } = await mount(allHooks(), { pageId: 'p1', textColor: 'red', backgroundColor: 'blue' });

      expect(tool.save()).toEqual({ pageId: 'p1', textColor: 'red', backgroundColor: 'blue' });
      expect(linkOf(root).style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
      expect(linkOf(root).style.getPropertyValue('background-color')).toBe('var(--blok-color-blue-bg)');
    });

    it('keeps the color when undo or a peer replaces the data', async () => {
      const { tool, root } = await mount(allHooks());

      tool.setData({ pageId: 'p1', backgroundColor: 'green' });

      expect(tool.save()).toEqual({ pageId: 'p1', backgroundColor: 'green' });
      expect(linkOf(root).style.getPropertyValue('background-color')).toBe('var(--blok-color-green-bg)');
    });

    it('keeps the color through the load sanitizer', () => {
      const [cleaned] = sanitizeBlocks(
        [{ tool: 'page', data: { pageId: 'p1', textColor: 'red', backgroundColor: 'blue' } }],
        () => PageTool.sanitize,
        { b: true, a: { href: true } }
      );

      expect(cleaned.data).toEqual({ pageId: 'p1', textColor: 'red', backgroundColor: 'blue' });
    });

    it('drops a color that is not a preset name', async () => {
      const { tool } = await mount(allHooks(), { pageId: 'p1', textColor: 'red;background:url(x)' });

      expect(tool.save()).toEqual({ pageId: 'p1' });
    });
  });

  describe('rename', () => {
    it('swaps the link for a title field and sends the new title to the host', async () => {
      const config = allHooks();
      const { tool, root } = await mount(config);

      item(tool, 'page-rename')?.onActivate?.();
      const input = root.querySelector<HTMLInputElement>('[data-blok-testid="page-rename-input"]');

      expect(input?.value).toBe('Roadmap');
      expect(input?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
      expect(input).toHaveFocus();

      if (input === null) {
        return;
      }
      input.value = '  Plans  ';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();

      expect(config.rename).toHaveBeenCalledWith('p1', 'Plans');
      expect(root.querySelector('[data-blok-testid="page-title"]')?.textContent).toBe('Plans');
    });

    it('sends nothing when Escape cancels or the title is unchanged', async () => {
      const config = allHooks();
      const { tool, root } = await mount(config);

      item(tool, 'page-rename')?.onActivate?.();
      root.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      item(tool, 'page-rename')?.onActivate?.();
      root.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(config.rename).not.toHaveBeenCalled();
      expect(root.querySelector('[data-blok-testid="page-title"]')?.textContent).toBe('Roadmap');
    });

    it('starts on Cmd+Shift+R while the block is selected', async () => {
      const { root } = await mount(allHooks(), undefined, { selected: true });
      const event = new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(root.querySelector('[data-blok-testid="page-rename-input"]')).not.toBeNull();
    });

    it('leaves Cmd+Shift+R to the browser when the block is not selected', async () => {
      const { root } = await mount(allHooks());
      const event = new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(root.querySelector('input')).toBeNull();
    });

    it('stops listening once the block is removed', async () => {
      const { tool, root } = await mount(allHooks(), undefined, { selected: true });

      tool.removed();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));

      expect(root.querySelector('input')).toBeNull();
    });
  });

  describe('edit icon', () => {
    it('opens the emoji picker on the icon and sends the pick to the host', async () => {
      const config = allHooks();
      const { tool, root } = await mount(config);

      item(tool, 'page-edit-icon')?.onActivate?.();

      expect(picker.open).toHaveBeenCalledWith(root.querySelector('[data-blok-testid="page-icon"]'));
      picker.handlers?.onSelect('🚀');
      await flush();

      expect(config.setIcon).toHaveBeenCalledWith('p1', { type: 'emoji', value: '🚀' });
      expect(root.querySelector('[data-blok-testid="page-icon"]')?.textContent).toBe('🚀');
    });

    it('removes the icon through the host', async () => {
      const config = allHooks({ title: 'Roadmap', icon: { type: 'emoji', value: '🚀' } });
      const { tool } = await mount(config);

      item(tool, 'page-edit-icon')?.onActivate?.();
      picker.handlers?.onRemove();

      expect(config.setIcon).toHaveBeenCalledWith('p1', null);
    });
  });

  describe('open in new tab', () => {
    it.each([
      ['meta', { metaKey: true }],
      ['ctrl', { ctrlKey: true }],
    ])('opens a new tab on %s+Shift+Enter even when the host opens pages itself', async (_name, init) => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);
      const open = vi.fn();
      const { tool } = await mount({ ...allHooks(), open });

      expect(tool.onNavigationEnter(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, ...init }))).toBe(true);
      expect(opened).toHaveBeenCalledWith('https://workspace.test/pages/p1', '_blank', 'noopener,noreferrer');
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('side peek', () => {
    it('asks the host to peek from the menu', async () => {
      const config = allHooks();
      const { tool } = await mount(config);

      item(tool, 'page-open-side-peek')?.onActivate?.();

      expect(config.peek).toHaveBeenCalledWith('p1', {});
    });

    it('peeks on Alt+click instead of letting the browser download the link', async () => {
      const config = allHooks();
      const { root } = await mount(config);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, altKey: true });

      linkOf(root).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(config.peek).toHaveBeenCalledWith('p1', { event });
    });

    it('leaves Alt+click to the browser without a peek hook', async () => {
      const { root } = await mount({ resolve: () => ({ title: 'Roadmap' }), href: () => '/p1' });
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, altKey: true });

      linkOf(root).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });
});
