import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImageTool } from '../../../../src/tools/image';
import type { ImageData, ImageConfig } from '../../../../types/tools/image';
import type { API, BlockToolConstructorOptions, BlockAPI, FilePasteEvent, PatternPasteEvent } from '../../../../types';

const createMockApi = (): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k },
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
});

describe('ImageTool — renderSettings (block settings menu)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const names = (cfg: unknown[]): string[] =>
    cfg.map((i) => (i as { name?: string }).name ?? '');

  it('returns size + download + copy-url items matching the 3-dots popover', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    expect(Array.isArray(items)).toBe(true);
    expect(names(items)).toContain('image-size');
    expect(names(items)).toContain('image-download');
    expect(names(items)).toContain('image-copy-url');
  });

  it('size item has children for small/medium/large/full, with isActive reflecting current size', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', size: 'lg' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const size = items.find((i) => (i as { name?: string }).name === 'image-size') as {
      children?: { items?: Array<{ title?: string; isActive?: boolean; onActivate?: () => void }> };
    };
    const children = size.children?.items ?? [];
    const titles = children.map((c) => c.title ?? '');
    expect(titles).toEqual(expect.arrayContaining(['Small', 'Medium', 'Large', 'Full']));
    const large = children.find((c) => c.title === 'Large');
    expect(large?.isActive).toBe(true);
  });

  it('activating a size child updates data.size and dispatches change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', size: 'md' }, {}, block));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const size = items.find((i) => (i as { name?: string }).name === 'image-size') as {
      children?: { items?: Array<{ title?: string; onActivate?: () => void }> };
    };
    const full = size.children?.items?.find((c) => c.title === 'Full');
    full?.onActivate?.();
    expect(tool.save().size).toBe('full');
    expect(block.dispatchChange).toHaveBeenCalled();
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
});

describe('ImageTool — more button opens BlockSettings', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('clicking overlay "..." opens BlockSettings anchored to three-dots button and placed to its right', () => {
    const toggleBlockSettings = vi.fn();
    const api = {
      styles: { block: 'blok-block' },
      i18n: { t: (k: string) => k },
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
      i18n: { t: (k: string) => k },
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
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 400, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 400, bubbles: true }));
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
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 600, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 600, bubbles: true }));
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
});

