import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoTool } from '../../../../src/tools/video';
import type { VideoData, VideoConfig } from '../../../../types/tools/video';
import type { API, BlockToolConstructorOptions, BlockAPI, FilePasteEvent, PatternPasteEvent } from '../../../../types';

const createMockApi = (): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
} as unknown as API);

const createMockBlock = (): BlockAPI => ({
  id: 'b1',
  name: 'video',
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const createOptions = (
  data: Partial<VideoData> = {},
  config: VideoConfig = {},
  block?: BlockAPI
): BlockToolConstructorOptions<VideoData, VideoConfig> => ({
  data: { url: '', ...data } as VideoData,
  config,
  api: createMockApi(),
  block: block ?? createMockBlock(),
  readOnly: false,
});

describe('VideoTool — RENDERED state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('render() returns a <video> wired to a custom control surface (no native controls)', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    const video = root.querySelector('video');
    expect(video).not.toBeNull();
    if (!video) throw new Error('video missing');
    expect(video.getAttribute('src')).toBe('https://x/y.mp4');
    expect(video.hasAttribute('controls')).toBe(false);
    expect(root.querySelector('[data-role="video-controls"]')).not.toBeNull();
    expect(root.querySelector('[data-role="video-controls"] [data-action="play-toggle"]')).not.toBeNull();
  });

  it('attaches custom controls even in read-only mode (viewers can still play)', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'https://x/y.mp4' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-role="video-controls"]')).not.toBeNull();
  });

  it('save() returns the persisted shape', () => {
    const tool = new VideoTool(createOptions({
      url: 'https://x/y.mp4',
      caption: 'hi',
      width: 50,
      alignment: 'center',
      fileName: 'y.mp4',
      mimeType: 'video/mp4',
    }));
    const root = tool.render();
    expect(tool.save(root)).toEqual({
      url: 'https://x/y.mp4',
      caption: 'hi',
      width: 50,
      alignment: 'center',
      fileName: 'y.mp4',
      mimeType: 'video/mp4',
    });
  });

  it('validate({ url: "" }) returns false, non-empty returns true', () => {
    const tool = new VideoTool(createOptions());
    expect(tool.validate({ url: '' } as VideoData)).toBe(false);
    expect(tool.validate({ url: 'https://x/y.mp4' } as VideoData)).toBe(true);
  });

  it('applies data-state / data-align / data-caption attributes on the root', () => {
    const tool = new VideoTool(createOptions({ url: 'u', alignment: 'right', captionVisible: false }));
    const root = tool.render();
    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(root.getAttribute('data-align')).toBe('right');
    expect(root.getAttribute('data-caption')).toBe('off');
  });
});

describe('VideoTool — theater mode', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const figureOf = (root: HTMLElement): HTMLElement => {
    const fig = root.querySelector<HTMLElement>('[data-role="video-figure"]');
    if (!fig) throw new Error('figure missing');
    return fig;
  };
  const enterTheater = (root: HTMLElement): void => {
    figureOf(root).dispatchEvent(new CustomEvent('blok-video-theater', { detail: { on: true } }));
  };

  it('never persists theater state in save()', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4', width: 50 }));
    const root = tool.render();
    enterTheater(root);
    expect(tool.save(root)).not.toHaveProperty('theater');
    expect(tool.save(root).width).toBe(50);
  });

  it('re-applies theater after a re-render (read-only toggle)', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    enterTheater(root);
    tool.setReadOnly(true);
    expect(figureOf(root).getAttribute('data-theater')).toBe('true');
  });

  it('does not corrupt the saved width when theater toggles', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4', width: 50 }));
    const root = tool.render();
    const fig = figureOf(root);
    expect(fig.style.width).toBe('50%');
    enterTheater(root);
    // theater widens via CSS !important — the inline width is never mutated
    expect(fig.style.width).toBe('50%');
    expect(tool.save(root).width).toBe(50);
  });
});

describe('VideoTool — statics', () => {
  it('toolbox exposes the video title key', () => {
    expect(VideoTool.toolbox).toMatchObject({ titleKey: 'video' });
  });

  it('isReadOnlySupported is true', () => {
    expect(VideoTool.isReadOnlySupported).toBe(true);
  });

  it('pasteConfig accepts video/* files and a URL pattern', () => {
    const { pasteConfig } = VideoTool;
    if (pasteConfig === false) throw new Error('pasteConfig is false');
    expect(pasteConfig.files?.mimeTypes).toContain('video/*');
    expect(pasteConfig.patterns?.video).toBeInstanceOf(RegExp);
    expect(pasteConfig.patterns?.video.test('https://cdn.example.com/clip.mp4')).toBe(true);
  });
});

describe('VideoTool — onPaste', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('onPaste(pattern) sets data.url and renders the video', async () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();
    const event = new CustomEvent('paste', { detail: { key: 'video', data: 'https://x/y.mp4' } }) as PatternPasteEvent;
    Object.defineProperty(event, 'type', { value: 'pattern' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(tool.save().url).toBe('https://x/y.mp4');
    expect(root.querySelector('video')?.getAttribute('src')).toBe('https://x/y.mp4');
  });

  it('onPaste(file) routes through the uploader and sets a blob URL', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const tool = new VideoTool(createOptions());
    const root = tool.render();
    const file = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(tool.save().url).toBe('blob:fake');
    expect(root.querySelector('video')?.getAttribute('src')).toBe('blob:fake');
  });
});

describe('VideoTool — EMPTY state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders empty-state with file input + embed tab when data.url is empty', () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
    expect(root.querySelector('[data-tab="embed"]')).not.toBeNull();
  });

  it('submitting a URL via embed tab transitions to RENDERED', async () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();
    root.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = 'https://x/y.mp4';
    root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector('video')?.getAttribute('src')).toBe('https://x/y.mp4');
  });
});

describe('VideoTool — overlay actions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders overlay when data.url is set and not readOnly', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="video-overlay"]')).not.toBeNull();
  });

  it('does not render overlay in readOnly mode', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'https://x/y.mp4' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-role="video-overlay"]')).toBeNull();
  });

  it('clicking a popover alignment option sets that exact value and dispatches change', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const open = (): void => {
      root.querySelector<HTMLButtonElement>('[data-action="align-trigger"]')?.click();
    };
    open();
    root.querySelector<HTMLButtonElement>('[data-action="align-right"]')?.click();
    expect(tool.save().alignment).toBe('right');
    open();
    root.querySelector<HTMLButtonElement>('[data-action="align-left"]')?.click();
    expect(tool.save().alignment).toBe('left');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('caption-toggle flips captionVisible and updates data-caption', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    const root = tool.render();
    expect(root.getAttribute('data-caption')).toBe('on');
    root.querySelector<HTMLButtonElement>('[data-action="caption-toggle"]')?.click();
    expect(root.getAttribute('data-caption')).toBe('off');
    expect(tool.save().captionVisible).toBe(false);
  });

  it('clicking replace returns the tool to EMPTY state', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    root.querySelector<HTMLButtonElement>('[data-action="replace"]')?.click();
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
  });
});

describe('VideoTool — getToolbarAnchorElement', () => {
  it('returns the figure so the toolbar centers on the player, not the caption', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4', caption: 'hi' }));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('[data-role="video-figure"]');
    expect(tool.getToolbarAnchorElement()).toBe(figure);
  });
});

describe('VideoTool — resize', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function stubRect(el: Element, width: number, left = 0): void {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left, right: left + width, width, top: 0, bottom: 100, height: 100, x: left, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
  }

  it('updates data.width and dispatches change after resize commit', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', width: 100 }, {}, block));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('[data-role="video-figure"]');
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
});

describe('VideoTool — setReadOnly', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('removes the overlay and locks the caption when read-only is enabled', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="video-overlay"]')).not.toBeNull();
    tool.setReadOnly(true);
    expect(root.querySelector('[data-role="video-overlay"]')).toBeNull();
    const caption = root.querySelector('[data-role="video-caption"]');
    expect(caption?.getAttribute('contenteditable')).toBe('false');
  });

  it('restores the overlay when read-only is disabled again', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'https://x/y.mp4' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-role="video-overlay"]')).toBeNull();
    tool.setReadOnly(false);
    expect(root.querySelector('[data-role="video-overlay"]')).not.toBeNull();
  });
});

describe('VideoTool — renderSettings', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const names = (cfg: unknown[]): string[] => cfg.map((i) => (i as { name?: string }).name ?? '');

  it('exposes alignment / caption / replace / download / copy-url items', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    expect(names(items)).toEqual(expect.arrayContaining([
      'video-alignment',
      'video-caption',
      'video-replace',
      'video-download',
      'video-copy-url',
    ]));
  });

  it('activating copy-url writes the video URL to the clipboard', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    const copy = items.find((i) => (i as { name?: string }).name === 'video-copy-url') as { onActivate?: () => void };
    copy.onActivate?.();
    expect(writeText).toHaveBeenCalledWith('https://x/y.mp4');
  });
});

describe('VideoTool — blob lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('revokes blob URLs in removed()', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const tool = new VideoTool(createOptions({ url: 'blob:abc' }));
    tool.render();
    tool.removed();
    expect(revoke).toHaveBeenCalledWith('blob:abc');
  });

  it('does not revoke non-blob URLs', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    tool.render();
    tool.removed();
    expect(revoke).not.toHaveBeenCalled();
  });
});
