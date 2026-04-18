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

  it('clicking align cycles alignment left → center → right → left and dispatches change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const align = root.querySelector<HTMLButtonElement>('[data-action="align"]');
    if (!align) throw new Error('align missing');
    align.click();
    expect(tool.save().alignment).toBe('left');
    align.click();
    expect(tool.save().alignment).toBe('center');
    align.click();
    expect(tool.save().alignment).toBe('right');
    align.click();
    expect(tool.save().alignment).toBe('left');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('clicking replace returns the tool to EMPTY state', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const replace = root.querySelector<HTMLButtonElement>('[data-action="replace"]');
    if (!replace) throw new Error('replace missing');
    replace.click();
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
  });
});

describe('ImageTool — resize', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('updates data.width and dispatches change after resize commit', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', width: 100 }, {}, block));
    const root = tool.render();
    const figure = root.querySelector('figure');
    if (!figure) throw new Error('figure missing');
    Object.defineProperty(figure, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 1000, width: 1000, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const handle = root.querySelector<HTMLElement>('[data-role="resize-handle"][data-edge="right"]');
    if (!handle) throw new Error('handle missing');
    handle.setPointerCapture = () => undefined;
    handle.releasePointerCapture = () => undefined;
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1000, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 400, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 400, bubbles: true }));
    expect(tool.save().width).toBe(40);
    expect(block.dispatchChange).toHaveBeenCalled();
  });
});
