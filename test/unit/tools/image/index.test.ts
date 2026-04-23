import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { ImageTool } from '../../../../src/tools/image';
import { updateOverlayCompact } from '../../../../src/tools/image/ui';
import type { ImageData, ImageConfig } from '../../../../types/tools/image';
import type { API, BlockToolConstructorOptions, BlockAPI, FilePasteEvent, PatternPasteEvent } from '../../../../types';

const createMockApi = (): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
} as unknown as API);

const createMockBlock = (): BlockAPI => ({
  id: 'b1',
  name: 'image',
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const createOptions = (
  data: Partial<ImageData> = {},
  config: ImageConfig = {},
  block?: BlockAPI
): BlockToolConstructorOptions<ImageData, ImageConfig> => ({
  data: { url: '', ...data } as ImageData,
  config,
  api: createMockApi(),
  block: block ?? createMockBlock(),
  readOnly: false,
});

describe('ImageTool — RENDERED state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('render() returns a wrapper containing an <img> when data.url is present', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const img = root.querySelector('img');
    expect(img).not.toBeNull();
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/y.png');
  });

  it('save() returns the persisted shape', () => {
    const tool = new ImageTool(createOptions({
      url: 'https://x/y.png',
      caption: 'hi',
      width: 50,
      alignment: 'center',
      alt: 'pic',
    }));
    const root = tool.render();
    expect(tool.save(root)).toEqual({
      url: 'https://x/y.png',
      caption: 'hi',
      width: 50,
      alignment: 'center',
      alt: 'pic',
    });
  });

  it('validate({ url: "" }) returns false', () => {
    const tool = new ImageTool(createOptions());
    expect(tool.validate({ url: '' } as ImageData)).toBe(false);
  });

  it('validate({ url: "https://..." }) returns true', () => {
    const tool = new ImageTool(createOptions());
    expect(tool.validate({ url: 'https://x/y.png' } as ImageData)).toBe(true);
  });
});

describe('ImageTool — onPaste', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('onPaste(pattern) sets data.url and renders image', async () => {
    const tool = new ImageTool(createOptions());
    const root = tool.render();
    const event = new CustomEvent('paste', {
      detail: { key: 'image', data: 'https://x/y.png' },
    }) as PatternPasteEvent;
    Object.defineProperty(event, 'type', { value: 'pattern' });
    tool.onPaste(event);
    await Promise.resolve();
    expect(tool.save().url).toBe('https://x/y.png');
    const img = root.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/y.png');
  });

  it('onPaste(file) routes through Uploader and sets blob URL', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const tool = new ImageTool(createOptions());
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(tool.save().url).toBe('blob:fake');
    const img = root.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('blob:fake');
  });
});

describe('ImageTool — EMPTY state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders empty-state with file + tab buttons when data.url is empty', () => {
    const tool = new ImageTool(createOptions());
    const root = tool.render();
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
    expect(root.querySelector('[data-tab="embed"]')).not.toBeNull();
  });

  it('submitting URL via empty-state transitions to RENDERED', async () => {
    const tool = new ImageTool(createOptions());
    const root = tool.render();
    const embedTab = root.querySelector<HTMLButtonElement>('[data-tab="embed"]');
    if (!embedTab) throw new Error('embed tab missing');
    embedTab.click();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = 'https://x/y.png';
    const submit = root.querySelector<HTMLButtonElement>('[data-action="submit-url"]');
    if (!submit) throw new Error('submit missing');
    submit.click();
    await new Promise((r) => setTimeout(r, 0));
    const img = root.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/y.png');
  });
});

describe('ImageTool — overlay actions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders overlay when data.url is set and not readOnly', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="image-overlay"]')).not.toBeNull();
  });

  it('does not render overlay in readOnly mode', () => {
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/y.png' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-role="image-overlay"]')).toBeNull();
  });

  it('clicking a popover alignment option sets that exact value and dispatches change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const openPopover = (): void => {
      root.querySelector<HTMLButtonElement>('[data-action="align-trigger"]')?.click();
    };
    openPopover();
    root.querySelector<HTMLButtonElement>('[data-action="align-right"]')?.click();
    expect(tool.save().alignment).toBe('right');
    openPopover();
    root.querySelector<HTMLButtonElement>('[data-action="align-left"]')?.click();
    expect(tool.save().alignment).toBe('left');
    openPopover();
    root.querySelector<HTMLButtonElement>('[data-action="align-center"]')?.click();
    expect(tool.save().alignment).toBe('center');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('alignment trigger exposes current alignment on data-current', () => {
    const tool = new ImageTool(createOptions({ url: 'u', alignment: 'right' }));
    const root = tool.render();
    const trigger = root.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
    expect(trigger?.getAttribute('data-current')).toBe('right');
  });

  it('clicking replace returns the tool to EMPTY state', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const replace = root.querySelector<HTMLButtonElement>('[data-action="replace"]');
    if (!replace) throw new Error('replace missing');
    replace.click();
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('img is a direct child of .blok-image-inner — no frame wrapper, image itself is the container', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    const img = root.querySelector('img');
    if (!figure || !img) throw new Error('dom missing');
    expect(img.parentElement).toBe(figure);
    expect(root.querySelector('.blok-image-frame')).toBeNull();
  });

  it('getToolbarAnchorElement() returns the image wrapper so block toolbar centers at image top, not on the caption', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', caption: 'hi' }));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    if (!figure) throw new Error('figure missing');
    expect(tool.getToolbarAnchorElement()).toBe(figure);
  });

  it('getContentOffset() returns horizontal offset of the image figure relative to tool root (content area) so block toolbar (+ / ⋮⋮) aligns with image left edge, not the wider block wrapper that includes the left gutter', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', width: 60, alignment: 'center' }));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    if (!figure) throw new Error('figure missing');

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 0, right: 700, bottom: 100, width: 600, height: 100, x: 100, y: 0, toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue({
      left: 220, top: 0, right: 580, bottom: 100, width: 360, height: 100, x: 220, y: 0, toJSON: () => ({}),
    } as DOMRect);

    expect(tool.getContentOffset(figure)).toEqual({ left: 120 });
  });

  it('getContentOffset() returns undefined when figure is missing (empty state)', () => {
    const tool = new ImageTool(createOptions());
    tool.render();
    expect(tool.getContentOffset(document.createElement('div'))).toBeUndefined();
  });

  it('getContentOffset() returns undefined when image fills the content area (no horizontal offset to apply)', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    if (!figure) throw new Error('figure missing');

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 0, right: 700, bottom: 100, width: 600, height: 100, x: 100, y: 0, toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 0, right: 700, bottom: 100, width: 600, height: 100, x: 100, y: 0, toJSON: () => ({}),
    } as DOMRect);

    expect(tool.getContentOffset(figure)).toBeUndefined();
  });
});

describe('ImageTool — renderSettings (block settings menu)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const names = (cfg: unknown[]): string[] =>
    cfg.map((i) => (i as { name?: string }).name ?? '');

  it('returns download + copy-url items matching the 3-dots popover', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    expect(Array.isArray(items)).toBe(true);
    expect(names(items)).toContain('image-download');
    expect(names(items)).toContain('image-copy-url');
  });

  it('does not expose a size submenu (inline resize handles cover sizing)', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', size: 'lg' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    expect(names(items)).not.toContain('image-size');
  });

  it('activating copy-url writes the image URL to the clipboard', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const copy = items.find((i) => (i as { name?: string }).name === 'image-copy-url') as {
      onActivate?: () => void;
    };
    copy.onActivate?.();
    expect(writeText).toHaveBeenCalledWith('https://x/y.png');
  });

  it('duplicates every inline-toolbar action in the 3-dots menu', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const nameList = names(items);
    expect(nameList).toEqual(expect.arrayContaining([
      'image-alignment',
      'image-caption',
      'image-replace',
      'image-crop',
      'image-fullscreen',
      'image-download',
      'image-copy-url',
    ]));
  });

  it('alignment item has left/center/right children with isActive reflecting current alignment', () => {
    const tool = new ImageTool(createOptions({ url: 'u', alignment: 'right' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const align = items.find((i) => (i as { name?: string }).name === 'image-alignment') as {
      children?: { items?: Array<{ title?: string; isActive?: boolean; onActivate?: () => void }> };
    };
    const children = align.children?.items ?? [];
    const titles = children.map((c) => c.title ?? '');
    expect(titles).toEqual(expect.arrayContaining([
      'tools.image.alignmentLeft',
      'tools.image.alignmentCenter',
      'tools.image.alignmentRight',
    ]));
    expect(children.find((c) => c.title === 'tools.image.alignmentRight')?.isActive).toBe(true);
  });

  it('activating an alignment child updates data.alignment and dispatches change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const align = items.find((i) => (i as { name?: string }).name === 'image-alignment') as {
      children?: { items?: Array<{ title?: string; onActivate?: () => void }> };
    };
    align.children?.items?.find((c) => c.title === 'tools.image.alignmentLeft')?.onActivate?.();
    expect(tool.save().alignment).toBe('left');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('caption item toggles captionVisible and reflects current state via isActive', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    let items = tool.renderSettings() as unknown[];
    let caption = items.find((i) => (i as { name?: string }).name === 'image-caption') as {
      isActive?: boolean;
      onActivate?: () => void;
    };
    expect(caption.isActive).toBe(true);
    caption.onActivate?.();
    expect(tool.save().captionVisible).toBe(false);
    expect(root.getAttribute('data-caption')).toBe('off');
    items = tool.renderSettings() as unknown[];
    caption = items.find((i) => (i as { name?: string }).name === 'image-caption') as {
      isActive?: boolean;
      onActivate?: () => void;
    };
    expect(caption.isActive).toBe(false);
  });

  it('activating replace transitions the tool back to EMPTY state', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const items = tool.renderSettings() as unknown[];
    const replace = items.find((i) => (i as { name?: string }).name === 'image-replace') as {
      onActivate?: () => void;
    };
    replace.onActivate?.();
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('activating crop opens the crop modal', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const crop = items.find((i) => (i as { name?: string }).name === 'image-crop') as {
      onActivate?: () => void;
    };
    crop.onActivate?.();
    expect(document.querySelector('[data-role="image-crop-modal"], [role="dialog"][aria-label="Crop image"]')).not.toBeNull();
    document.body.replaceChildren();
  });

  it('activating fullscreen opens the lightbox dialog', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const full = items.find((i) => (i as { name?: string }).name === 'image-fullscreen') as {
      onActivate?: () => void;
    };
    full.onActivate?.();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    document.body.replaceChildren();
  });
});

describe('ImageTool — more button opens BlockSettings', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('clicking overlay "..." opens BlockSettings anchored to three-dots button and placed to its right', () => {
    const toggleBlockSettings = vi.fn();
    const api = {
      styles: { block: 'blok-block' },
      i18n: { t: (k: string) => k, has: () => false },
      events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      toolbar: { toggleBlockSettings },
    } as unknown as API;
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/y.png' }), api });
    const root = tool.render();
    const more = root.querySelector<HTMLButtonElement>('[data-action="more"]');
    if (!more) throw new Error('more button missing');
    more.click();
    expect(toggleBlockSettings).toHaveBeenCalledWith(true, more, { placeLeftOfAnchor: false });
  });

  it('does not render a custom more-popover inside the figure', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="image-popover"]')).toBeNull();
  });
});

describe('ImageTool — overlay stays visible while block settings popover open', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  /**
   * Build an api stub with a capturing events bus and a toolbar.toggleBlockSettings spy.
   */
  const createApiStub = (): {
    api: API;
    emit: (name: string) => void;
    toggleBlockSettings: ReturnType<typeof vi.fn>;
  } => {
    const handlers = new Map<string, Array<(data?: unknown) => void>>();
    const toggleBlockSettings = vi.fn();
    const api = {
      styles: { block: 'blok-block' },
      i18n: { t: (k: string) => k, has: () => false },
      events: {
        on: (name: string, cb: (data?: unknown) => void): void => {
          const arr = handlers.get(name) ?? [];
          arr.push(cb);
          handlers.set(name, arr);
        },
        off: (name: string, cb: (data?: unknown) => void): void => {
          const arr = handlers.get(name) ?? [];
          handlers.set(name, arr.filter((h) => h !== cb));
        },
        emit: vi.fn(),
      },
      toolbar: { toggleBlockSettings },
    } as unknown as API;
    const emit = (name: string): void => {
      (handlers.get(name) ?? []).forEach((h) => h());
    };
    return { api, emit, toggleBlockSettings };
  };

  it('sets data-settings-open="true" on the tool root when the three-dots button opens block settings', () => {
    const { api } = createApiStub();
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/y.png' }), api });
    const root = tool.render();
    const more = root.querySelector<HTMLButtonElement>('[data-action="more"]');
    if (!more) throw new Error('more button missing');
    more.click();
    expect(root.getAttribute('data-settings-open')).toBe('true');
  });

  it('removes data-settings-open when block-settings-closed event fires', () => {
    const { api, emit } = createApiStub();
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/y.png' }), api });
    const root = tool.render();
    root.querySelector<HTMLButtonElement>('[data-action="more"]')?.click();
    expect(root.getAttribute('data-settings-open')).toBe('true');
    emit('block-settings-closed');
    expect(root.getAttribute('data-settings-open')).toBeNull();
  });
});

describe('ImageTool — resize', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function stubRect(el: Element, width: number, left = 0): void {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 100,
        height: 100,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }

  it('updates data.width and dispatches change after resize commit', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', width: 100 }, {}, block));
    const root = tool.render();
    const figure = root.querySelector('figure');
    if (!figure) throw new Error('figure missing');
    stubRect(root, 1000);
    stubRect(figure, 1000);
    const handle = root.querySelector<HTMLElement>('[data-role="resize-handle"][data-edge="right"]');
    if (!handle) throw new Error('handle missing');
    handle.setPointerCapture = (): void => undefined;
    handle.releasePointerCapture = (): void => undefined;
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1000, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 700, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 700, bubbles: true }));
    expect(tool.save().width).toBe(40);
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('uses parent root width as the 100% reference, not the figure width', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const figure = root.querySelector('figure');
    if (!figure) throw new Error('figure missing');
    // parent (root) is 1000px; figure currently 520px (e.g. data-size="md").
    // Tiny rightward drag MUST stay near 60% — not snap to 100% just because
    // the resizer mistakenly sized against the figure itself.
    stubRect(root, 1000);
    stubRect(figure, 520);
    const handle = root.querySelector<HTMLElement>('[data-role="resize-handle"][data-edge="right"]');
    if (!handle) throw new Error('handle missing');
    handle.setPointerCapture = (): void => undefined;
    handle.releasePointerCapture = (): void => undefined;
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 520, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 560, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 560, bubbles: true }));
    expect(tool.save().width).toBe(60);
  });
});

describe('ImageTool — fullscreen triggers', () => {
  it('clicking the image opens lightbox', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const img = root.querySelector('img');
    if (!img) throw new Error('img missing');
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
});

describe('ImageTool — blob lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('revokes blob URLs in removed()', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const tool = new ImageTool(createOptions({ url: 'blob:abc' }));
    tool.render();
    tool.removed();
    expect(revoke).toHaveBeenCalledWith('blob:abc');
  });

  it('does not revoke non-blob URLs', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    tool.render();
    tool.removed();
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('ImageTool — data attributes on root', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('applies data-state reflecting the tool state', () => {
    const tool = new ImageTool(createOptions());
    const root = tool.render();
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('rendered state has data-state="rendered" with size/align/frame/rounded/caption/alt defaults', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(root.getAttribute('data-size')).toBe('md');
    expect(root.getAttribute('data-align')).toBe('center');
    expect(root.getAttribute('data-frame')).toBe('none');
    expect(root.getAttribute('data-rounded')).toBe('on');
    expect(root.getAttribute('data-caption')).toBe('on');
    expect(root.getAttribute('data-alt')).toBe('none');
  });

  it('reflects persisted data in data attributes', () => {
    const tool = new ImageTool(createOptions({
      url: 'u',
      size: 'lg',
      alignment: 'right',
      frame: 'shadow',
      rounded: false,
      captionVisible: false,
      alt: 'hello',
    }));
    const root = tool.render();
    expect(root.getAttribute('data-size')).toBe('lg');
    expect(root.getAttribute('data-align')).toBe('right');
    expect(root.getAttribute('data-frame')).toBe('shadow');
    expect(root.getAttribute('data-rounded')).toBe('off');
    expect(root.getAttribute('data-caption')).toBe('off');
    expect(root.getAttribute('data-alt')).toBe('set');
  });
});

describe('ImageTool — alt button next to caption', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders alt-edit button inside the caption row when not readOnly', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const btn = root.querySelector<HTMLButtonElement>('.blok-image-caption-row [data-action="alt-edit"]');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('Alt');
  });

  it('does not render alt-edit button in readOnly mode', () => {
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-action="alt-edit"]')).toBeNull();
  });

  it('clicking alt-edit opens an inline popover that persists committed value', () => {
    if (!('popover' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'popover', {
        configurable: true,
        get(this: HTMLElement) { return this.getAttribute('popover'); },
        set(this: HTMLElement, v: string) { this.setAttribute('popover', v); },
      });
    }
    if (typeof (HTMLElement.prototype as unknown as { showPopover?: () => void }).showPopover !== 'function') {
      (HTMLElement.prototype as unknown as { showPopover: () => void }).showPopover = function showPopover() {};
      (HTMLElement.prototype as unknown as { hidePopover: () => void }).hidePopover = function hidePopover() {};
    }
    const promptSpy = vi.spyOn(window, 'prompt');
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-action="alt-edit"]')?.click();
    expect(promptSpy).not.toHaveBeenCalled();
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    );
    expect(textarea).not.toBeNull();
    textarea!.value = 'pretty picture';
    textarea!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(tool.save().alt).toBe('pretty picture');
    expect(block.dispatchChange).toHaveBeenCalled();
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    root.remove();
  });

  it('overlay no longer carries an alt button — alt only lives by the caption', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const overlay = root.querySelector<HTMLElement>('[data-role="image-overlay"]');
    if (!overlay) throw new Error('overlay missing');
    expect(overlay.querySelector('[data-action="alt"]')).toBeNull();
  });
});

describe('ImageTool — overlay stays visible while alt popover open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!('popover' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'popover', {
        configurable: true,
        get(this: HTMLElement) { return this.getAttribute('popover'); },
        set(this: HTMLElement, v: string) { this.setAttribute('popover', v); },
      });
    }
    if (typeof (HTMLElement.prototype as unknown as { showPopover?: () => void }).showPopover !== 'function') {
      (HTMLElement.prototype as unknown as { showPopover: () => void }).showPopover = function showPopover() {};
      (HTMLElement.prototype as unknown as { hidePopover: () => void }).hidePopover = function hidePopover() {};
    }
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('sets data-alt-open="true" on the tool root while the alt popover is open', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-action="alt-edit"]')?.click();
    expect(root.getAttribute('data-alt-open')).toBe('true');
    root.remove();
  });

  it('removes data-alt-open after saving the alt text via Enter', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-action="alt-edit"]')?.click();
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    textarea.value = 'alt';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(root.getAttribute('data-alt-open')).toBeNull();
    root.remove();
  });

  it('removes data-alt-open after cancelling via Escape', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-action="alt-edit"]')?.click();
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(root.getAttribute('data-alt-open')).toBeNull();
    root.remove();
  });
});

describe('ImageTool — caption toggle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('caption-toggle flips captionVisible and updates data-caption', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    expect(root.getAttribute('data-caption')).toBe('on');
    root.querySelector<HTMLButtonElement>('[data-action="caption-toggle"]')?.click();
    expect(root.getAttribute('data-caption')).toBe('off');
    expect(tool.save().captionVisible).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-action="caption-toggle"]')?.click();
    expect(root.getAttribute('data-caption')).toBe('on');
    expect(tool.save().captionVisible).toBe(true);
  });

  it('hides the alt-edit button when the caption is hidden', () => {
    const tool = new ImageTool(createOptions({ url: 'u', captionVisible: false }));
    const root = tool.render();
    expect(root.querySelector('[data-action="alt-edit"]')).toBeNull();
  });

  it('restores the alt-edit button after toggling the caption back on', () => {
    const tool = new ImageTool(createOptions({ url: 'u', captionVisible: false }));
    const root = tool.render();
    expect(root.querySelector('[data-action="alt-edit"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-action="caption-toggle"]')?.click();
    expect(root.querySelector('[data-action="alt-edit"]')).not.toBeNull();
  });
});

describe('ImageTool — upload progression', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('shows uploading state with filename during file upload', async () => {
    let resolveUpload!: (v: { url: string; fileName: string }) => void;
    const uploadByFile = (_file: File): Promise<{ url: string; fileName: string }> =>
      new Promise((r) => { resolveUpload = r; });
    const tool = new ImageTool(createOptions(
      {},
      { uploader: { uploadByFile } }
    ));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await Promise.resolve();
    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.querySelector('[data-role="uploading"]')).not.toBeNull();
    expect(root.querySelector('[data-role="filename"]')?.textContent).toBe('p.png');
    resolveUpload({ url: 'https://cdn/p.png', fileName: 'p.png' });
    await new Promise((r) => setTimeout(r, 0));
    expect(root.getAttribute('data-state')).toBe('rendered');
  });

  it('cancel button during upload returns to empty state', async () => {
    const tool = new ImageTool(createOptions(
      {},
      { uploader: { uploadByFile: () => new Promise(() => undefined) } }
    ));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await Promise.resolve();
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
    expect(root.getAttribute('data-state')).toBe('empty');
  });
});

describe('ImageTool — error state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('surfaces error-state element when upload rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tool = new ImageTool(createOptions(
      {},
      { uploader: { uploadByFile: () => Promise.reject(new Error('boom')) } }
    ));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-role="error-state"]')).not.toBeNull();
    expect(root.querySelector('[data-action="replace"]')).not.toBeNull();
  });

  it('upload error shows BOTH retry and replace buttons', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tool = new ImageTool(createOptions(
      {},
      { uploader: { uploadByFile: () => Promise.reject(new Error('boom')) } }
    ));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(root.querySelector('[data-action="replace"]')).not.toBeNull();
  });

  it('retry after file upload error re-runs the uploader with the same file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const uploadByFile = vi.fn().mockRejectedValue(new Error('boom'));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(uploadByFile).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(uploadByFile).toHaveBeenCalledTimes(2);
    expect(uploadByFile).toHaveBeenLastCalledWith(file);
  });

  it('retry after URL fetch error re-runs uploader with the same URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const uploadByUrl = vi.fn().mockRejectedValue(new Error('404'));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();
    const embed = root.querySelector<HTMLButtonElement>('[data-tab="embed"]');
    if (!embed) throw new Error('embed tab missing');
    embed.click();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = 'https://x/404.png';
    root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(root.querySelector('[data-action="replace"]')).not.toBeNull();
    expect(uploadByUrl).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(uploadByUrl).toHaveBeenCalledTimes(2);
    expect(uploadByUrl).toHaveBeenLastCalledWith('https://x/404.png');
  });

  it('retry click keeps error card mounted while upload is in flight (no flash to loading)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let resolveRetry!: () => void;
    const uploadByFile = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(() => new Promise<{ url: string; fileName: string }>((r) => {
        resolveRetry = () => r({ url: 'https://cdn/ok.png', fileName: 'p.png' });
      }));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    const errorEl = root.querySelector('[data-role="error-state"]');
    expect(errorEl).not.toBeNull();
    const retryBtn = root.querySelector<HTMLButtonElement>('[data-action="retry"]');
    if (!retryBtn) throw new Error('retry missing');
    retryBtn.click();
    await Promise.resolve();
    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-role="uploading"]')).toBeNull();
    expect(root.querySelector('[data-role="error-state"]')).toBe(errorEl);
    expect(root.getAttribute('data-retrying')).toBe('true');
    expect(retryBtn.disabled).toBe(true);
    resolveRetry();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(root.getAttribute('data-retrying')).toBeNull();
  });

  it('retry click that fails again keeps the same error card and clears retrying flag', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const uploadByFile = vi.fn().mockRejectedValue(new Error('still broken'));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.getAttribute('data-retrying')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(false);
  });

  it('replace on error transitions to empty state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tool = new ImageTool(createOptions(
      {},
      { uploader: { uploadByFile: () => Promise.reject(new Error('boom')) } }
    ));
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'p.png', { type: 'image/png' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    root.querySelector<HTMLButtonElement>('[data-action="replace"]')?.click();
    expect(root.getAttribute('data-state')).toBe('empty');
  });
});

describe('updateOverlayCompact', () => {
  it('sets data-compact="true" when width below threshold', () => {
    const el = document.createElement('div');
    updateOverlayCompact(el, 200);
    expect(el.getAttribute('data-compact')).toBe('true');
  });

  it('removes data-compact when width at or above threshold', () => {
    const el = document.createElement('div');
    el.setAttribute('data-compact', 'true');
    updateOverlayCompact(el, 600);
    expect(el.getAttribute('data-compact')).toBeNull();
  });

  it('zero width (detached) does not force compact', () => {
    const el = document.createElement('div');
    updateOverlayCompact(el, 0);
    expect(el.getAttribute('data-compact')).toBeNull();
  });
});

describe('ImageTool — compact toolbar when figure is narrow', () => {
  let callbacks: ResizeObserverCallback[] = [];
  let OriginalResizeObserver: typeof ResizeObserver;

  beforeAll(() => {
    OriginalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class MockRO {
      constructor(cb: ResizeObserverCallback) { callbacks.push(cb); }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });
  afterAll(() => {
    window.ResizeObserver = OriginalResizeObserver;
  });
  beforeEach(() => { callbacks = []; vi.clearAllMocks(); });
  afterEach(() => vi.restoreAllMocks());

  it('applies data-compact="true" to overlay when figure width is narrow', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    const overlay = root.querySelector<HTMLElement>('[data-role="image-overlay"]');
    if (!figure || !overlay) throw new Error('dom missing');
    Object.defineProperty(figure, 'clientWidth', { configurable: true, value: 200 });
    for (const cb of callbacks) cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(overlay.getAttribute('data-compact')).toBe('true');
  });

  it('removes data-compact when figure widens', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    const overlay = root.querySelector<HTMLElement>('[data-role="image-overlay"]');
    if (!figure || !overlay) throw new Error('dom missing');
    Object.defineProperty(figure, 'clientWidth', { configurable: true, value: 200 });
    for (const cb of callbacks) cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(overlay.getAttribute('data-compact')).toBe('true');
    Object.defineProperty(figure, 'clientWidth', { configurable: true, value: 600 });
    for (const cb of callbacks) cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(overlay.getAttribute('data-compact')).toBeNull();
  });
});

describe('ImageTool — lightbox navigation wiring', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach((el) => el.remove());
  });

  const makeApiWithImages = (images: Array<{ id: string; data: ImageData | { url?: string } }>): API => {
    const blockStubs = images.map(({ id, data }) => ({
      id,
      name: 'image',
      preservedData: data,
    } as unknown as BlockAPI));

    return {
      styles: { block: 'blok-block' },
      i18n: { t: (k: string) => k, has: () => false },
      blocks: {
        getBlocksCount: (): number => blockStubs.length,
        getBlockByIndex: (i: number): BlockAPI | undefined => blockStubs[i],
      },
    } as unknown as API;
  };

  it('clicking the image opens lightbox with nav when the page has multiple image blocks', () => {
    const api = makeApiWithImages([
      { id: 'b1', data: { url: 'https://x/a.png', alt: 'a' } },
      { id: 'b2', data: { url: 'https://x/b.png', alt: 'b' } },
      { id: 'b3', data: { url: 'https://x/c.png', alt: 'c' } },
    ]);
    const block = { ...createMockBlock(), id: 'b2' } as BlockAPI;
    const tool = new ImageTool({
      ...createOptions({ url: 'https://x/b.png', alt: 'b' }, {}, block),
      api,
    });
    const root = tool.render();
    const imgEl = root.querySelector<HTMLImageElement>('img');
    if (!imgEl) throw new Error('img missing');
    imgEl.click();
    const nav = document.querySelector('[data-role="lightbox-nav"]');
    expect(nav).not.toBeNull();
    // Starts on current block (index 1) → prev enabled, next enabled
    const prev = document.querySelector<HTMLButtonElement>('[data-action="lightbox-prev"]');
    const next = document.querySelector<HTMLButtonElement>('[data-action="lightbox-next"]');
    expect(prev?.disabled).toBe(false);
    expect(next?.disabled).toBe(false);
    // Clicking next advances to b3
    next?.click();
    const dialogImg = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    expect(dialogImg?.getAttribute('src')).toBe('https://x/c.png');
  });

  it('does not render nav when page has only one image block', () => {
    const api = makeApiWithImages([
      { id: 'b1', data: { url: 'https://x/a.png' } },
    ]);
    const block = { ...createMockBlock(), id: 'b1' } as BlockAPI;
    const tool = new ImageTool({
      ...createOptions({ url: 'https://x/a.png' }, {}, block),
      api,
    });
    const root = tool.render();
    const imgEl = root.querySelector<HTMLImageElement>('img');
    if (!imgEl) throw new Error('img missing');
    imgEl.click();
    expect(document.querySelector('[data-role="lightbox-nav"]')).toBeNull();
  });

  it('skips non-image blocks and blocks with empty url when collecting navigation items', () => {
    const blockStubs: BlockAPI[] = [
      { id: 'p1', name: 'paragraph', preservedData: { text: 'hi' } },
      { id: 'i1', name: 'image', preservedData: { url: 'https://x/a.png' } },
      { id: 'i2', name: 'image', preservedData: { url: '' } },
      { id: 'i3', name: 'image', preservedData: { url: 'https://x/c.png' } },
    ] as unknown as BlockAPI[];
    const api = {
      styles: { block: 'blok-block' },
      i18n: { t: (k: string) => k, has: () => false },
      blocks: {
        getBlocksCount: (): number => blockStubs.length,
        getBlockByIndex: (i: number): BlockAPI | undefined => blockStubs[i],
      },
    } as unknown as API;
    const block = { ...createMockBlock(), id: 'i1' } as BlockAPI;
    const tool = new ImageTool({
      ...createOptions({ url: 'https://x/a.png' }, {}, block),
      api,
    });
    const root = tool.render();
    const imgEl = root.querySelector<HTMLImageElement>('img');
    if (!imgEl) throw new Error('img missing');
    imgEl.click();
    const nav = document.querySelector('[data-role="lightbox-nav"]');
    expect(nav).not.toBeNull();
    // Current image i1 is first in the navigable list → prev disabled, next enabled (i3 after)
    const prev = document.querySelector<HTMLButtonElement>('[data-action="lightbox-prev"]');
    const next = document.querySelector<HTMLButtonElement>('[data-action="lightbox-next"]');
    expect(prev?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);
    next?.click();
    const dialogImg = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    expect(dialogImg?.getAttribute('src')).toBe('https://x/c.png');
  });
});

