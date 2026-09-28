import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoTool } from '../../../../src/tools/video';
import type { VideoData, VideoConfig } from '../../../../types/tools/video';
import type { API, BlockToolConstructorOptions, BlockAPI, FilePasteEvent, PatternPasteEvent } from '../../../../types';
import type { MediaConfig } from '../../../../types/configs/media';

vi.mock('../../../../src/components/media-variants/video-variants', () => ({
  produceVideoVariant: vi.fn(async () => null),
}));
import { produceVideoVariant } from '../../../../src/components/media-variants/video-variants';
const mockProduce = vi.mocked(produceVideoVariant);

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

  it('turns the video preview into the upload progress', async () => {
    const uploadByUrl = (): Promise<{ url: string }> => new Promise(() => undefined);
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();
    root.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = 'https://x/y.mp4';

    root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
    await Promise.resolve();

    expect(root.querySelector('[data-role="uploading"] [data-blok-media-preview="video"]')).not.toBeNull();
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

  it('localizes an unplayable-media failure', () => {
    const tool = new VideoTool({
      ...createOptions({ url: 'https://x/broken.mp4' }),
      api: createMockApi({ 'tools.video.errorUnplayable': 'Dieses Video kann nicht abgespielt werden' }),
    });
    const root = tool.render();

    root.querySelector('video')?.dispatchEvent(new Event('error'));

    expect(root.querySelector('[data-role="video-error"] span')?.textContent)
      .toBe('Dieses Video kann nicht abgespielt werden');
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

  it('localizes the non-media URL guidance', async () => {
    const tool = new VideoTool({
      ...createOptions(),
      api: createMockApi({
        'tools.video.errorNotMediaUrl': 'Verknüpfe eine Videodatei oder verwende einen Einbettungsblock',
      }),
    });
    const root = tool.render();

    await submitUrl(tool, root, 'https://example.com/watch/not-a-file');

    expect(root.querySelector('[data-role="video-error"] span')?.textContent)
      .toBe('Verknüpfe eine Videodatei oder verwende einen Einbettungsblock');
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

describe('VideoTool — Download is scheme-gated (stored XSS)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  /** Records the href of every anchor that is actually clicked. */
  const captureClickedHrefs = (): string[] => {
    const hrefs: string[] = [];

    vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      if (node instanceof HTMLAnchorElement) {
        const anchor: HTMLAnchorElement = node;

        vi.spyOn(anchor, 'click').mockImplementation(() => {
          hrefs.push(anchor.getAttribute('href') ?? '');
        });
      }

      return node;
    });

    return hrefs;
  };

  const downloadItem = (tool: VideoTool): Record<string, unknown> | undefined =>
    (tool.renderSettings() as unknown[])
      .find((item) => (item as { name?: string }).name === 'video-download') as Record<string, unknown> | undefined;

  it('does not navigate to a stored javascript: URL', () => {
    const hrefs = captureClickedHrefs();
    const tool = new VideoTool(createOptions({ url: 'javascript:fetch("/admin/api")' }));

    tool.render();
    (downloadItem(tool)?.onActivate as (() => void) | undefined)?.();

    expect(hrefs).toEqual([]);
  });

  it('disables the Download item when the stored URL is not downloadable', () => {
    const tool = new VideoTool(createOptions({ url: 'javascript:alert(1)' }));

    tool.render();

    expect(downloadItem(tool)?.isDisabled).toBe(true);
  });

  it('still downloads http(s) URLs', () => {
    const hrefs = captureClickedHrefs();
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    tool.render();
    expect(downloadItem(tool)?.isDisabled).not.toBe(true);
    (downloadItem(tool)?.onActivate as (() => void) | undefined)?.();

    expect(hrefs).toEqual(['https://x/y.mp4']);
  });
});

describe('VideoTool — an upload belongs to the pick that started it', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const pasteClip = (tool: VideoTool): void => {
    const event = new CustomEvent('paste', { detail: { file: new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' }) } }) as FilePasteEvent;
    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
  };

  const heldUpload = (): { uploadByFile: () => Promise<{ url: string }>; resolve: (url: string) => void } => {
    const gate: { resolve: (url: string) => void } = { resolve: () => undefined };

    return {
      uploadByFile: () => new Promise((r) => {
        gate.resolve = (url) => r({ url });
      }),
      resolve: (url) => gate.resolve(url),
    };
  };

  it('saves the picked file name as an edit when the pick starts the upload', () => {
    const block = createMockBlock();
    const { uploadByFile } = heldUpload();
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile } }, block));
    tool.render();

    pasteClip(tool);

    expect(tool.save().fileName).toBe('clip.mp4');
    expect(block.dispatchChange).toHaveBeenCalledWith();
  });

  it('reports the finished upload as derived, not as a new edit', async () => {
    const block = createMockBlock();
    const upload = heldUpload();
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile: upload.uploadByFile } }, block));
    tool.render();
    pasteClip(tool);
    await Promise.resolve();

    upload.resolve('https://cdn/clip.mp4');
    await new Promise((r) => setTimeout(r, 0));

    expect(tool.save().url).toBe('https://cdn/clip.mp4');
    expect(block.dispatchChange).toHaveBeenLastCalledWith({ derived: true, from: ['fileName'] });
  });

  it('drops an upload that finishes after it was cancelled', async () => {
    const upload = heldUpload();
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile: upload.uploadByFile } }));
    const root = tool.render();
    pasteClip(tool);
    await Promise.resolve();
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();

    upload.resolve('https://cdn/clip.mp4');
    await new Promise((r) => setTimeout(r, 0));

    expect(tool.save().url).toBe('');
  });

  it('keeps a pasted video link a tracked edit', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({}, {}, block));
    tool.render();
    const event = new CustomEvent('paste', { detail: { key: 'video', data: 'https://x/y.mp4' } }) as PatternPasteEvent;
    Object.defineProperty(event, 'type', { value: 'pattern' });

    tool.onPaste(event);

    expect(block.dispatchChange).toHaveBeenLastCalledWith();
  });
});

describe('VideoTool — variants', () => {
  const variants = [{ url: 'https://x/a.webm', mimeType: 'video/webm' }, { url: 'https://x/a.mp4', mimeType: 'video/mp4' }];

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('saves clean variants and drops malformed ones', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/a.mp4', variants: [variants[0], { url: 'javascript:1', mimeType: 'video/mp4' }, variants[1]] }));

    expect(tool.save().variants).toEqual(variants);
  });

  it('drops old variants when the user pastes a link instead', async () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/a.mp4', variants }));

    tool.render();
    const event = new CustomEvent('paste', { detail: { key: 'video', data: 'https://y/b.mp4' } }) as PatternPasteEvent;

    Object.defineProperty(event, 'type', { value: 'pattern' });
    tool.onPaste(event);
    await vi.waitFor(() => expect(tool.save().url).toBe('https://y/b.mp4'));

    expect(tool.save().variants).toBeUndefined();
  });

  it('drops old variants when a new file is uploaded', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new');
    const tool = new VideoTool(createOptions({ url: 'https://x/a.mp4', variants }));

    tool.render();
    const event = new CustomEvent('paste', { detail: { file: new File([new Uint8Array(4)], 'b.mp4', { type: 'video/mp4' }) } }) as FilePasteEvent;

    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
    await vi.waitFor(() => expect(tool.save().url).toBe('blob:new'));

    expect(tool.save().variants).toBeUndefined();
  });
});

describe('VideoTool — background formats', () => {
  const WEBM = 'video/webm; codecs="vp09.00.10.08, opus"';
  const webm = { file: new Blob(['w'], { type: WEBM }), mimeType: WEBM };

  const loader = async (): Promise<unknown> => ({});

  const toolWith = (media?: MediaConfig, blocks?: unknown): VideoTool => {
    const api = { ...createMockApi(), config: { media }, ...(blocks === undefined ? {} : { blocks }) } as unknown as API;

    return new VideoTool({ ...createOptions({}, { uploader: { uploadByFile: async (f: File) => ({ url: `https://cdn/${f.name}` }) } }), api });
  };

  const pasteFile = (tool: VideoTool): void => {
    const event = new CustomEvent('paste', { detail: { file: new File([new Uint8Array(4)], 'clip.mov', { type: 'video/quicktime' }) } }) as FilePasteEvent;

    Object.defineProperty(event, 'type', { value: 'file' });
    tool.onPaste(event);
  };

  const idle = async (): Promise<void> => {
    const { hasPendingMediaJobs } = await import('../../../../src/components/media-variants/media-queue');

    await vi.waitFor(() => expect(hasPendingMediaJobs()).toBe(false));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProduce.mockResolvedValue(null);
  });
  afterEach(async () => {
    await idle();
    vi.restoreAllMocks();
  });

  it('saves the original at once, then adds the formats it could make', async () => {
    const release: { go: () => void } = { go: () => undefined };

    mockProduce.mockImplementation(async (_file, format) => {
      if (format !== 'webm') return null;
      await new Promise<void>((r) => {
        release.go = r;
      });

      return webm;
    });
    const tool = toolWith({ formats: { video: ['webm'] }, mediabunny: loader });
    const root = tool.render();

    pasteFile(tool);
    await vi.waitFor(() => expect(tool.save().url).toBe('https://cdn/clip.mov'));
    const player = root.querySelector('video');

    expect(tool.save().variants).toBeUndefined();

    release.go();
    await idle();

    expect(tool.save()).toMatchObject({
      url: 'https://cdn/clip.mov',
      variants: [{ url: 'https://cdn/clip.webm', mimeType: WEBM }, { url: 'https://cdn/clip.mov', mimeType: 'video/quicktime' }],
    });
    // The playing video is not rebuilt under the viewer.
    expect(root.querySelector('video')).toBe(player);
  });

  it('switches url to the MP4 and records its type once one is made', async () => {
    const MP4 = 'video/mp4; codecs="avc1.64001f, mp4a.40.2"';

    mockProduce.mockImplementation(async (_file, format) => (format === 'mp4' ? { file: new Blob(['m'], { type: MP4 }), mimeType: MP4 } : null));
    const tool = toolWith({ formats: { video: ['mp4'] }, mediabunny: loader });

    tool.render();
    pasteFile(tool);
    await vi.waitFor(() => expect(tool.save().url).toBe('https://cdn/clip.mp4'));

    expect(tool.save().mimeType).toBe('video/mp4');
    // A download of url must not carry the original's extension.
    expect(tool.save().fileName).toBe('clip.mp4');
  });

  it('does nothing extra when no video formats are set', async () => {
    const tool = toolWith({ formats: { image: ['jpeg'] } });

    tool.render();
    pasteFile(tool);
    await vi.waitFor(() => expect(tool.save().url).toBe('https://cdn/clip.mov'));
    await idle();

    expect(mockProduce).not.toHaveBeenCalled();
  });

  it('does not write a finished format onto a video the user replaced', async () => {
    const release: { go: () => void } = { go: () => undefined };

    mockProduce.mockImplementation(async () => {
      await new Promise<void>((r) => {
        release.go = r;
      });

      return webm;
    });
    const tool = toolWith({ formats: { video: ['webm'] }, mediabunny: loader });

    tool.render();
    pasteFile(tool);
    await vi.waitFor(() => expect(mockProduce).toHaveBeenCalled());

    const link = new CustomEvent('paste', { detail: { key: 'video', data: 'https://y/other.mp4' } }) as PatternPasteEvent;

    Object.defineProperty(link, 'type', { value: 'pattern' });
    tool.onPaste(link);
    await vi.waitFor(() => expect(tool.save().url).toBe('https://y/other.mp4'));
    release.go();
    await idle();

    expect(tool.save().variants).toBeUndefined();
    expect(tool.save().url).toBe('https://y/other.mp4');
  });

  it('shows a converting status while it works, and removes it after', async () => {
    const release: { go: () => void } = { go: () => undefined };

    mockProduce.mockImplementation(async (_file, _format, opts) => {
      opts.onProgress?.(0.4);
      await new Promise<void>((r) => {
        release.go = r;
      });

      return webm;
    });
    const tool = toolWith({ formats: { video: ['webm'] }, mediabunny: loader });
    const root = tool.render();

    pasteFile(tool);
    await vi.waitFor(() => expect(root.querySelector('[data-blok-testid="video-converting"]')?.textContent).toBe('tools.image.converting 40%'));
    expect(root.querySelector('[data-blok-testid="video-converting"]')?.getAttribute('role')).toBe('status');

    release.go();
    await idle();

    expect(root.querySelector('[data-blok-testid="video-converting"]')).toBeNull();
  });

  it('converts nothing when the host has not provided Mediabunny', async () => {
    const tool = toolWith({ formats: { video: ['webm'] } });

    tool.render();
    pasteFile(tool);
    await vi.waitFor(() => expect(tool.save().url).toBe('https://cdn/clip.mov'));
    await idle();

    expect(mockProduce).not.toHaveBeenCalled();
    expect(tool.save().variants).toBeUndefined();
  });

  it('hands the host loader to the converter', async () => {
    mockProduce.mockResolvedValue(webm);
    const tool = toolWith({ formats: { video: ['webm'] }, mediabunny: loader });

    tool.render();
    pasteFile(tool);
    await vi.waitFor(() => expect(mockProduce).toHaveBeenCalled());

    expect(mockProduce.mock.calls[0][2]).toMatchObject({ load: loader });
  });

  it('uses the renditions a host convert hook returns', async () => {
    const convert = vi.fn(async () => [webm]);
    const tool = toolWith({ formats: { video: ['webm'] }, convert });

    tool.render();
    pasteFile(tool);
    await vi.waitFor(() => expect(tool.save().variants?.[0]?.url).toBe('https://cdn/clip.webm'));

    expect(convert).toHaveBeenCalledWith(expect.any(File), ['webm'], expect.objectContaining({ kind: 'video' }));
    expect(mockProduce).not.toHaveBeenCalled();
  });

  describe('when the block goes away', () => {
    const blocking = (): { go: () => void; calls: Array<{ signal?: AbortSignal; onProgress?: (f: number) => void }> } => {
      const handle = { go: (): void => undefined, calls: [] as Array<{ signal?: AbortSignal; onProgress?: (f: number) => void }> };

      mockProduce.mockImplementation(async (_file, _format, opts) => {
        handle.calls.push(opts);
        await new Promise<void>((r) => {
          handle.go = r;
        });

        return webm;
      });

      return handle;
    };

    it('keeps converting for a block that was only rebuilt, and writes to the rebuilt one', async () => {
      const update = vi.fn(async () => undefined);
      const live = { id: 'b1', name: 'video', save: async () => ({ data: { url: 'https://cdn/clip.mov' } }) };
      const blocks = { getBlocksCount: () => 1, getBlockByIndex: () => live, update };
      const handle = blocking();
      const tool = toolWith({ formats: { video: ['webm'] }, mediabunny: loader }, blocks);

      tool.render();
      pasteFile(tool);
      await vi.waitFor(() => expect(handle.calls).toHaveLength(1));
      tool.removed();
      await Promise.resolve();
      handle.go();
      await idle();

      expect(handle.calls[0].signal?.aborted).toBe(false);
      await vi.waitFor(() => expect(update).toHaveBeenCalledWith('b1', {
        url: 'https://cdn/clip.mov',
        variants: [{ url: 'https://cdn/clip.webm', mimeType: WEBM }, { url: 'https://cdn/clip.mov', mimeType: 'video/quicktime' }],
      }));
    });

    it('cancels the conversion of a deleted block and converts nothing more', async () => {
      const blocks = { getBlocksCount: () => 0, getBlockByIndex: () => undefined, update: vi.fn() };
      const handle = blocking();
      const tool = toolWith({ formats: { video: ['webm', 'av1'] }, mediabunny: loader }, blocks);

      tool.render();
      pasteFile(tool);
      await vi.waitFor(() => expect(handle.calls).toHaveLength(1));
      tool.removed();
      await vi.waitFor(() => expect(handle.calls[0].signal?.aborted).toBe(true));
      handle.go();
      await idle();

      expect(handle.calls).toHaveLength(1);
      expect(blocks.update).not.toHaveBeenCalled();
    });

    it('gives up on a conversion that shows no progress for ten minutes', async () => {
      const handle = blocking();
      const tool = toolWith({ formats: { video: ['webm'] }, mediabunny: loader });

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        tool.render();
        pasteFile(tool);
        await vi.waitFor(() => expect(handle.calls).toHaveLength(1));

        vi.advanceTimersByTime(9 * 60_000);
        expect(handle.calls[0].signal?.aborted).toBe(false);
        // Progress restarts the clock.
        handle.calls[0].onProgress?.(0.5);
        vi.advanceTimersByTime(9 * 60_000);
        expect(handle.calls[0].signal?.aborted).toBe(false);

        vi.advanceTimersByTime(60_000);
        expect(handle.calls[0].signal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
        handle.go();
      }
    });

    it('cancels when the tool is destroyed with the editor', async () => {
      const handle = blocking();
      const tool = toolWith({ formats: { video: ['webm', 'av1'] }, mediabunny: loader });

      tool.render();
      pasteFile(tool);
      await vi.waitFor(() => expect(handle.calls).toHaveLength(1));
      // A torn-down editor answers no block queries, which is how the tool tells it from a rebuild.
      tool.destroy();

      await vi.waitFor(() => expect(handle.calls[0].signal?.aborted).toBe(true));
      handle.go();
      await idle();
      expect(handle.calls).toHaveLength(1);
      expect(tool.save().variants).toBeUndefined();
    });
  });
});

