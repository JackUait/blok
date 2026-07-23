import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoTool } from '../../../../src/tools/video';
import type { VideoData, VideoConfig } from '../../../../types/tools/video';
import type { API, BlockToolConstructorOptions, BlockAPI, FilePasteEvent, PatternPasteEvent } from '../../../../types';

const createMockApi = (messages: Record<string, string> = {}): API => ({
  styles: { block: 'blok-block' },
  i18n: {
    t: (k: string) => messages[k] ?? k,
    has: (k: string) => k in messages,
  },
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
  data: { url: '', ...data },
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

  it('uses the localized caption placeholder when config does not override it', () => {
    const tool = new VideoTool({
      ...createOptions({ url: 'https://x/y.mp4' }),
      api: createMockApi({ 'tools.video.captionPlaceholder': 'Videobeschriftung schreiben…' }),
    });
    const root = tool.render();

    expect(root.querySelector('[data-role="video-caption"]')?.getAttribute('data-placeholder'))
      .toBe('Videobeschriftung schreiben…');
  });

  it('attaches custom controls even in read-only mode (viewers can still play)', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'https://x/y.mp4' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-role="video-controls"]')).not.toBeNull();
  });

  it('omits the control surface when hideControls is set (clean, control-free frame)', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4', hideControls: true }));
    const root = tool.render();
    const video = root.querySelector('video');
    expect(video).not.toBeNull();
    // No custom chrome and no native controls — just the bare media surface.
    expect(root.querySelector('[data-role="video-controls"]')).toBeNull();
    expect(video?.hasAttribute('controls')).toBe(false);
    expect(root.getAttribute('data-controls')).toBe('off');
  });

  it('keeps loop wiring intact even with controls hidden (loop is content)', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4', hideControls: true, loop: true }));
    const root = tool.render();
    expect(root.querySelector('video')?.loop).toBe(true);
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
    expect(tool.validate({ url: '' })).toBe(false);
    expect(tool.validate({ url: 'https://x/y.mp4' })).toBe(true);
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

  it('shows a URL upload status once without inventing a filename', async () => {
    const uploadByUrl = (): Promise<{ url: string }> => new Promise(() => undefined);
    const tool = new VideoTool({
      ...createOptions({}, { uploader: { uploadByUrl } }),
      api: createMockApi({
        'tools.image.uploadingLabel': 'Localized file upload',
        'tools.video.uploading': 'Localized video URL upload…',
      }),
    });
    const root = tool.render();
    root.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = 'https://x/y.mp4';

    root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
    await Promise.resolve();

    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.querySelector('.blok-image-uploading__label')?.textContent)
      .toBe('Localized video URL upload…');
    expect(root.querySelector('[data-role="filename"]')).toBeNull();
  });

  it('with sources "url" ignores a pasted file (no upload)', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const tool = new VideoTool(createOptions({}, { sources: 'url' }));
    tool.render();
    const file = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(tool.save().url).toBe('');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('with sources "upload" ignores a pasted URL pattern (no url set)', async () => {
    const tool = new VideoTool(createOptions({}, { sources: 'upload' }));
    tool.render();
    const event = new CustomEvent('paste', { detail: { key: 'video', data: 'https://x/y.mp4' } }) as PatternPasteEvent;
    Object.defineProperty(event, 'type', { value: 'pattern' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(tool.save().url).toBe('');
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

  it('shows human-readable copy (not a raw error code) when the file exceeds maxSize', async () => {
    const tool = new VideoTool(createOptions({}, { maxSize: 5 }));
    const root = tool.render();
    const file = new File([new Uint8Array(50)], 'big.mp4', { type: 'video/mp4' });
    const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await new Promise((r) => setTimeout(r, 0));
    const msg = root.querySelector('[data-role="video-error"] span');
    expect(msg?.textContent).toBe('tools.video.errorFileTooLarge');
    expect(msg?.textContent).not.toContain('FILE_TOO_LARGE');
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

describe('VideoTool — editor actions (block settings)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  type SettingsItem = {
    name?: string;
    isActive?: boolean;
    onActivate?: () => void;
    children?: { items: SettingsItem[] };
  };
  const settings = (tool: VideoTool): SettingsItem[] => tool.renderSettings() as unknown as SettingsItem[];
  const find = (items: SettingsItem[], name: string): SettingsItem | undefined =>
    items.find((i) => i.name === name);

  it('never renders the floating overlay toolbar — actions live in block settings', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="video-overlay"]')).toBeNull();
  });

  it('never renders the floating overlay in readOnly mode either', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'https://x/y.mp4' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-role="video-overlay"]')).toBeNull();
  });

  it('block-settings alignment option sets that exact value and dispatches change', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    tool.render();
    const pick = (value: string): void => {
      find(settings(tool), 'video-alignment')?.children?.items
        .find((c) => c.name === `video-alignment-${value}`)?.onActivate?.();
    };
    pick('right');
    expect(tool.save().alignment).toBe('right');
    pick('left');
    expect(tool.save().alignment).toBe('left');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('block-settings caption item flips captionVisible and updates data-caption', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    const root = tool.render();
    expect(root.getAttribute('data-caption')).toBe('on');
    find(settings(tool), 'video-caption')?.onActivate?.();
    expect(root.getAttribute('data-caption')).toBe('off');
    expect(tool.save().captionVisible).toBe(false);
  });

  it('applies the configured glow level to the player (Blok config, not a block tune)', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }, { glow: 'more' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="video-ambient"]')?.getAttribute('data-glow')).toBe('more');
  });

  it('defaults the glow level to "minimal" when the config omits it', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="video-ambient"]')?.getAttribute('data-glow')).toBe('minimal');
  });

  it('does not expose a Glow block tune (it lives in the Blok config now)', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    tool.render();
    const items = tool.renderSettings() as unknown[];
    expect(items.map((i) => (i as { name?: string }).name)).not.toContain('video-glow');
  });

  it('exposes Autoplay and Loop block tunes reflecting the persisted state', () => {
    const tool = new VideoTool(createOptions({ url: 'u', autoplay: true }));
    tool.render();
    const items = settings(tool);
    expect(items.map((i) => i.name)).toEqual(expect.arrayContaining(['video-autoplay', 'video-loop']));
    expect(find(items, 'video-autoplay')?.isActive).toBe(true);
    expect(find(items, 'video-loop')?.isActive).toBe(false);
  });

  it('toggling the Autoplay and Loop tunes persists the flags and dispatches', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    tool.render();
    find(settings(tool), 'video-autoplay')?.onActivate?.();
    find(settings(tool), 'video-loop')?.onActivate?.();
    expect(tool.save().autoplay).toBe(true);
    expect(tool.save().loop).toBe(true);
    expect(block.dispatchChange).toHaveBeenCalled();
    // toggling back clears them
    find(settings(tool), 'video-autoplay')?.onActivate?.();
    expect(tool.save().autoplay).toBeUndefined();
  });

  it('exposes a Hide controls block tune reflecting the persisted state', () => {
    const tool = new VideoTool(createOptions({ url: 'u', hideControls: true }));
    tool.render();
    const items = settings(tool);
    expect(items.map((i) => i.name)).toContain('video-hide-controls');
    expect(find(items, 'video-hide-controls')?.isActive).toBe(true);
  });

  it('Hide controls tune defaults to inactive when unset', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    tool.render();
    expect(find(settings(tool), 'video-hide-controls')?.isActive).toBe(false);
  });

  it('toggling the Hide controls tune persists the flag, re-renders, and dispatches', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    expect(root.querySelector('[data-role="video-controls"]')).not.toBeNull();
    find(settings(tool), 'video-hide-controls')?.onActivate?.();
    expect(tool.save().hideControls).toBe(true);
    expect(root.querySelector('[data-role="video-controls"]')).toBeNull();
    expect(block.dispatchChange).toHaveBeenCalled();
    // toggling back clears it and restores the controls
    find(settings(tool), 'video-hide-controls')?.onActivate?.();
    expect(tool.save().hideControls).toBeUndefined();
    expect(root.querySelector('[data-role="video-controls"]')).not.toBeNull();
  });

  it('read-only autoplay renders a muted, looping gif-style player', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'u', autoplay: true, loop: true }), readOnly: true });
    const root = tool.render();
    const v = root.querySelector('video');
    expect(v?.muted).toBe(true);
    expect(v?.hasAttribute('autoplay')).toBe(true);
    expect(v?.loop).toBe(true);
  });

  it('does not autoplay in edit mode (autoplay is a read-only viewer affordance)', () => {
    const tool = new VideoTool(createOptions({ url: 'u', autoplay: true, loop: true }));
    const root = tool.render();
    const v = root.querySelector('video');
    expect(v?.hasAttribute('autoplay')).toBe(false);
    expect(v?.muted).toBe(false);
    // loop still applies in edit mode — it is content, not an autoplay affordance
    expect(v?.loop).toBe(true);
  });

  it('block-settings replace item returns the tool to EMPTY state', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    find(settings(tool), 'video-replace')?.onActivate?.();
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
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 800, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 800, bubbles: true }));
    expect(tool.save().width).toBe(60);
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('floors the player width at the 440px minimum when dragged narrower', () => {
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
    // Drag the edge way past the left wall — width wants to collapse to ~0.
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 0, bubbles: true }));
    // 440px floor on a 1000px container → 44%, not the global 10%.
    expect(tool.save().width).toBe(44);
  });

  it('flags the figure as resize-blocked while dragged past the floor, clears on commit', () => {
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
    // Yank past the wall — width pins at the floor.
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 0, bubbles: true }));
    expect(figure.getAttribute('data-resize-blocked')).toBe('true');
    // Releasing clears the blocked state.
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 0, bubbles: true }));
    expect(figure.getAttribute('data-resize-blocked')).not.toBe('true');
  });
});

describe('VideoTool — setReadOnly', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('removes editing affordances and locks the caption when read-only is enabled', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="resize-handle"]')).not.toBeNull();
    tool.setReadOnly(true);
    expect(root.querySelector('[data-role="resize-handle"]')).toBeNull();
    const caption = root.querySelector('[data-role="video-caption"]');
    expect(caption?.getAttribute('contenteditable')).toBe('false');
  });

  it('restores editing affordances when read-only is disabled again', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'https://x/y.mp4' }), readOnly: true });
    const root = tool.render();
    expect(root.querySelector('[data-role="resize-handle"]')).toBeNull();
    tool.setReadOnly(false);
    expect(root.querySelector('[data-role="resize-handle"]')).not.toBeNull();
    const caption = root.querySelector('[data-role="video-caption"]');
    expect(caption?.getAttribute('contenteditable')).toBe('true');
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
    // Glow is a Blok-config option now, not a per-block tune.
    expect(names(items)).not.toContain('video-glow');
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

/**
 * Regression: a saved `data.url` pointing at something the browser cannot decode
 * (a provider watch page, a dead link, a 404) used to stay in RENDERED forever —
 * the block painted a black 16:9 box with 0:00/0:00 controls and never said why.
 * The <video> element's own `error` event was never listened to.
 */
describe('VideoTool — media playback failure', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('surfaces the ERROR state when the media element fails to load its source', () => {
    const tool = new VideoTool(createOptions({ url: 'https://vkvideo.ru/video-1_2' }));
    const root = tool.render();
    const video = root.querySelector('video');
    if (!video) throw new Error('video missing');

    video.dispatchEvent(new Event('error'));

    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-role="video-error"] span')?.textContent)
      .toBe("This video can't be played");
  });

  it('offers Replace after a playback failure while editing', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/broken.mp4' }));
    const root = tool.render();
    root.querySelector('video')?.dispatchEvent(new Event('error'));

    expect(root.querySelector('[data-role="video-error"] [data-action="replace"]')).not.toBeNull();
  });

  it('does not offer Replace to read-only viewers', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'https://x/broken.mp4' }), readOnly: true });
    const root = tool.render();
    root.querySelector('video')?.dispatchEvent(new Event('error'));

    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-role="video-error"] [data-action="replace"]')).toBeNull();
  });

  it('keeps the saved url so the failure is recoverable, not destructive', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/broken.mp4' }));
    const root = tool.render();
    root.querySelector('video')?.dispatchEvent(new Event('error'));

    expect(tool.save().url).toBe('https://x/broken.mp4');
  });
});

/**
 * Regression: the URL field accepted ANY http(s) URL and dropped it straight into
 * `<video src>`, while the paste path required a direct media URL. A provider watch
 * page (VK, YouTube, …) therefore produced a permanently black player.
 */
describe('VideoTool — URL field validation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const submitUrl = async (tool: VideoTool, root: HTMLElement, url: string): Promise<void> => {
    root.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = url;
    root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
  };

  it('rejects a provider watch page instead of dropping it into <video src>', async () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();

    await submitUrl(tool, root, 'https://vkvideo.ru/playlist/-226723792_5/video-226723792_456239233?t=11m38s');

    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-role="video-error"] span')?.textContent)
      .toBe('Link a video file (.mp4, .webm, .mov), or use an embed block');
    expect(root.querySelector('video')).toBeNull();
  });

  it('rejects an unrecognised page URL that is not a media file', async () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();

    await submitUrl(tool, root, 'https://example.com/watch/some-video');

    expect(root.getAttribute('data-state')).toBe('error');
    expect(root.querySelector('[data-role="video-error"] span')?.textContent)
      .toBe('Link a video file (.mp4, .webm, .mov), or use an embed block');
  });

  it('accepts a direct media URL', async () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();

    await submitUrl(tool, root, 'https://cdn.example.com/clip.webm?token=abc');

    expect(root.querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.com/clip.webm?token=abc');
  });

  it('leaves the decision to the host when uploadByUrl is configured', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn.example.com/hosted.mp4' });
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();

    await submitUrl(tool, root, 'https://vkvideo.ru/video-1_2');

    expect(uploadByUrl).toHaveBeenCalledWith('https://vkvideo.ru/video-1_2', expect.anything());
    expect(root.querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.com/hosted.mp4');
  });
});
