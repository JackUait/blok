import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoTool } from '../../../../src/tools/video';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconVideo,
} from '../../../../src/components/icons';
import type { VideoAlignment, VideoConfig, VideoData } from '../../../../types/tools/video';
import type {
  API,
  BlockAPI,
  BlockToolConstructorOptions,
  FilePasteEvent,
  PasteEvent,
  PatternPasteEvent,
} from '../../../../types';

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
  block?: BlockAPI,
  api?: API
): BlockToolConstructorOptions<VideoData, VideoConfig> => ({
  data: { url: '', ...data },
  config,
  api: api ?? createMockApi(),
  block: block ?? createMockBlock(),
  readOnly: false,
});

/** Every settings entry the tool can emit, flattened to the fields under test. */
interface SettingsEntry {
  name?: string;
  title?: string;
  icon?: string;
  isActive?: boolean;
  isDisabled?: boolean;
  closeOnActivate?: boolean;
  onActivate?: () => void;
  children?: { items: SettingsEntry[] };
}

const settingsOf = (tool: VideoTool): SettingsEntry[] =>
  tool.renderSettings() as unknown as SettingsEntry[];

const findItem = (tool: VideoTool, name: string): SettingsEntry | undefined =>
  settingsOf(tool).find((item) => item.name === name);

const alignmentChildren = (tool: VideoTool): SettingsEntry[] =>
  findItem(tool, 'video-alignment')?.children?.items ?? [];

const pickAlignment = (tool: VideoTool, value: string): void => {
  alignmentChildren(tool).find((child) => child.name === `video-alignment-${value}`)?.onActivate?.();
};

const mustFigure = (root: HTMLElement): HTMLElement => {
  const figure = root.querySelector<HTMLElement>('[data-role="video-figure"]');

  if (!figure) throw new Error('figure missing');

  return figure;
};

const mustVideo = (root: HTMLElement): HTMLVideoElement => {
  const video = root.querySelector('video');

  if (!video) throw new Error('video missing');

  return video;
};

const errorText = (root: HTMLElement): string | null =>
  root.querySelector('[data-role="video-error"] span')?.textContent ?? null;

const videoFile = (name = 'clip.mp4', type = 'video/mp4', bytes = 8): File =>
  new File([new Uint8Array(bytes)], name, { type });

const flush = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const pasteFile = async (tool: VideoTool, file: File): Promise<void> => {
  const event = new CustomEvent('paste', { detail: { file } }) as unknown as FilePasteEvent;

  Object.defineProperty(event, 'type', { value: 'file' });
  tool.onPaste(event);
  await flush();
};

const submitUrl = async (root: HTMLElement, url: string): Promise<void> => {
  root.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
  const input = root.querySelector<HTMLInputElement>('input[type="url"]');

  if (!input) throw new Error('url input missing');
  input.value = url;
  root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
  await flush();
};

/** Feeds a file through the empty state's own picker, not through onPaste. */
const chooseFile = (root: HTMLElement, file: File): void => {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]');

  if (!input) throw new Error('file input missing');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
};

const stubRect = (el: Element, width: number, left = 0): void => {
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
};

const mustHandle = (root: HTMLElement, edge: 'left' | 'right'): HTMLElement => {
  const handle = root.querySelector<HTMLElement>(`[data-role="resize-handle"][data-edge="${edge}"]`);

  if (!handle) throw new Error(`${edge} handle missing`);
  handle.setPointerCapture = (): void => undefined;
  handle.releasePointerCapture = (): void => undefined;

  return handle;
};

const drag = (handle: HTMLElement, fromX: number, toX: number, release = true): void => {
  handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: fromX, bubbles: true }));
  handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: toX, bubbles: true }));
  if (release) {
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: toX, bubbles: true }));
  }
};

describe('VideoTool — constructor and statics', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('defaults a missing url to the empty string so the block opens in EMPTY', () => {
    const tool = new VideoTool({
      ...createOptions(),
      data: {} as unknown as VideoData,
    });
    const root = tool.render();

    expect(tool.save().url).toBe('');
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('constructs without any data at all', () => {
    const tool = new VideoTool({
      ...createOptions(),
      data: undefined as unknown as VideoData,
    });

    expect(tool.save().url).toBe('');
  });

  it('stamps the tool marker and the default align/caption/controls state on the root', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();

    expect(root.getAttribute('data-blok-tool')).toBe('video');
    expect(root.getAttribute('data-align')).toBe('center');
    expect(root.getAttribute('data-caption')).toBe('on');
    expect(root.getAttribute('data-controls')).toBe('on');
  });

  it('advertises the exact toolbox entry the slash menu searches on', () => {
    expect(VideoTool.toolbox).toStrictEqual({
      icon: IconVideo,
      titleKey: 'video',
      searchTerms: ['video', 'movie', 'clip', 'player', 'mp4', 'media'],
      section: 'media',
    });
  });

  it('advertises the video asset kind so hosts can reconcile stored URLs', () => {
    expect(VideoTool.assetKind).toBe('video');
  });

  it('rejects a non-string url even when it has a length', () => {
    const tool = new VideoTool(createOptions());

    expect(tool.validate({ url: ['https://x/y.mp4'] as unknown as string })).toBe(false);
    expect(tool.validate({ url: '' })).toBe(false);
    expect(tool.validate({ url: 'https://x/y.mp4' })).toBe(true);
  });
});

describe('VideoTool — save()', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('omits every optional key that was never set', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    tool.render();

    // toStrictEqual, not toEqual: `{ caption: undefined }` would pass toEqual and
    // hide a guard that stopped omitting unset keys.
    expect(tool.save()).toStrictEqual({ url: 'https://x/y.mp4' });
  });

  it('round-trips every stored field across a save', () => {
    const stored: VideoData = {
      url: 'https://x/y.mp4',
      caption: 'Sunset over the bay',
      captionVisible: false,
      width: 60,
      alignment: 'right',
      autoplay: true,
      loop: true,
      hideControls: true,
      fileName: 'y.mp4',
      mimeType: 'video/mp4',
      aspectRatio: '4 / 3',
    };
    const tool = new VideoTool(createOptions(stored));

    tool.render();

    expect(tool.save()).toStrictEqual(stored);
  });
});

describe('VideoTool — toolbar anchoring and content offset', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('answers the anchor and offset queries before render() ever runs', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    expect(tool.getToolbarAnchorElement()).toBeUndefined();
    expect(tool.getContentOffset(document.createElement('div'))).toBeUndefined();
  });

  it('reports no offset while the block is still in the empty state', () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();

    expect(tool.getContentOffset(root)).toBeUndefined();
  });

  it('offsets the toolbar by the figure inset inside the root', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();

    stubRect(root, 1000, 100);
    stubRect(mustFigure(root), 800, 130);

    expect(tool.getContentOffset(root)).toStrictEqual({ left: 30 });
  });

  it('reports no offset when the figure is flush with the root', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();

    stubRect(root, 1000, 100);
    stubRect(mustFigure(root), 1000, 100);

    expect(tool.getContentOffset(root)).toBeUndefined();
  });
});

describe('VideoTool — block settings copy', () => {
  const LOCALIZED: Record<string, string> = {
    'tools.video.alignment': 'L10n alignment',
    'tools.video.alignmentLeft': 'L10n align left',
    'tools.video.alignmentCenter': 'L10n align center',
    'tools.video.alignmentRight': 'L10n align right',
    'tools.video.caption': 'L10n caption',
    'tools.video.autoplay': 'L10n autoplay',
    'tools.video.loop': 'L10n loop',
    'tools.video.hideControls': 'L10n hide controls',
    'tools.video.replace': 'L10n replace',
    'tools.video.download': 'L10n download',
    'tools.video.copyUrl': 'L10n copy url',
  };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const titlesOf = (tool: VideoTool): Record<string, string | undefined> => {
    const items = settingsOf(tool);
    const out: Record<string, string | undefined> = {};

    for (const item of items) {
      if (item.name !== undefined) out[item.name] = item.title;
    }
    for (const child of alignmentChildren(tool)) {
      if (child.name !== undefined) out[child.name] = child.title;
    }

    return out;
  };

  it('uses the host translations for every settings entry', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, undefined, createMockApi(LOCALIZED)));

    tool.render();

    expect(titlesOf(tool)).toStrictEqual({
      'video-alignment': 'L10n alignment',
      'video-alignment-left': 'L10n align left',
      'video-alignment-center': 'L10n align center',
      'video-alignment-right': 'L10n align right',
      'video-caption': 'L10n caption',
      'video-autoplay': 'L10n autoplay',
      'video-loop': 'L10n loop',
      'video-hide-controls': 'L10n hide controls',
      'video-replace': 'L10n replace',
      'video-download': 'L10n download',
      'video-copy-url': 'L10n copy url',
    });
  });

  it('falls back to the English copy when the host registered no messages', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));

    tool.render();

    expect(titlesOf(tool)).toStrictEqual({
      'video-alignment': 'Alignment',
      'video-alignment-left': 'Align left',
      'video-alignment-center': 'Align center',
      'video-alignment-right': 'Align right',
      'video-caption': 'Caption',
      'video-autoplay': 'Autoplay',
      'video-loop': 'Loop',
      'video-hide-controls': 'Hide controls',
      'video-replace': 'Replace video',
      'video-download': 'Download',
      'video-copy-url': 'Copy URL',
    });
  });

  it('closes the settings popover after every leaf action', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));

    tool.render();

    const leaves = [
      'video-caption',
      'video-autoplay',
      'video-loop',
      'video-hide-controls',
      'video-replace',
      'video-download',
      'video-copy-url',
    ];

    for (const name of leaves) {
      expect(findItem(tool, name)?.closeOnActivate).toBe(true);
    }
    for (const child of alignmentChildren(tool)) {
      expect(child.closeOnActivate).toBe(true);
    }
  });
});

describe('VideoTool — block settings state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const ICON_FOR: Record<VideoAlignment, string> = {
    left: IconAlignLeft,
    center: IconAlignCenter,
    right: IconAlignRight,
  };

  it.each<VideoAlignment>(['left', 'center', 'right'])(
    'marks only %s active and mirrors its icon on the parent entry',
    (alignment) => {
      const tool = new VideoTool(createOptions({ url: 'u', alignment }));

      tool.render();

      expect(findItem(tool, 'video-alignment')?.icon).toBe(ICON_FOR[alignment]);
      expect(alignmentChildren(tool).map((child) => child.isActive)).toEqual([
        alignment === 'left',
        alignment === 'center',
        alignment === 'right',
      ]);
    }
  );

  it('names the three alignment children after the values they store', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));

    tool.render();

    expect(alignmentChildren(tool).map((child) => child.name)).toEqual([
      'video-alignment-left',
      'video-alignment-center',
      'video-alignment-right',
    ]);
  });

  it('treats a block with no stored alignment as centered', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));

    tool.render();

    expect(findItem(tool, 'video-alignment')?.icon).toBe(IconAlignCenter);
    expect(alignmentChildren(tool).map((child) => child.isActive)).toEqual([false, true, false]);
  });

  it('survives an alignment value that is not one of the three', () => {
    const tool = new VideoTool(createOptions({
      url: 'u',
      alignment: 'diagonal' as unknown as VideoAlignment,
    }));

    tool.render();

    expect(findItem(tool, 'video-alignment')?.icon).toBe(IconAlignCenter);
    expect(alignmentChildren(tool).map((child) => child.isActive)).toEqual([false, false, false]);
  });

  it('mirrors caption visibility in all three stored states', () => {
    const activeFor = (data: Partial<VideoData>): boolean | undefined => {
      const tool = new VideoTool(createOptions({ url: 'u', ...data }));

      tool.render();

      return findItem(tool, 'video-caption')?.isActive;
    };

    expect(activeFor({})).toBe(true);
    expect(activeFor({ captionVisible: true })).toBe(true);
    expect(activeFor({ captionVisible: false })).toBe(false);
  });

  it('leaves Autoplay inactive until the tune is stored', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));

    tool.render();

    expect(findItem(tool, 'video-autoplay')?.isActive).toBe(false);
  });

  it('marks Loop active when the tune is stored', () => {
    const tool = new VideoTool(createOptions({ url: 'u', loop: true }));

    tool.render();

    expect(findItem(tool, 'video-loop')?.isActive).toBe(true);
  });
});

describe('VideoTool — onPaste', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('ignores a paste that is neither a pattern nor a file', () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();
    const event = new CustomEvent('paste', {
      detail: { data: document.createElement('div') },
    }) as unknown as PasteEvent;

    Object.defineProperty(event, 'type', { value: 'tag' });

    expect(() => tool.onPaste(event)).not.toThrow();
    expect(tool.save().url).toBe('');
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('renders a pattern-pasted URL', async () => {
    const tool = new VideoTool(createOptions());
    const root = tool.render();
    const event = new CustomEvent('paste', {
      detail: { key: 'video', data: 'https://x/y.mp4' },
    }) as PatternPasteEvent;

    Object.defineProperty(event, 'type', { value: 'pattern' });
    tool.onPaste(event);
    await flush();

    expect(root.getAttribute('data-state')).toBe('rendered');
  });
});

describe('VideoTool — upload lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('switches to the loading card the moment a picked file starts uploading', () => {
    const uploadByFile = (): Promise<{ url: string }> => new Promise(() => undefined);
    const tool = new VideoTool(createOptions(
      {},
      { uploader: { uploadByFile } },
      undefined,
      createMockApi({ 'tools.image.uploadingLabel': 'L10n uploading file' })
    ));
    const root = tool.render();

    chooseFile(root, videoFile());

    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.querySelector('[data-role="uploading"]')).not.toBeNull();
    expect(root.querySelector('[data-role="filename"]')?.textContent).toBe('clip.mp4');
    // A file upload keeps the generic image "uploading" label; only the URL path
    // substitutes the video-specific status copy.
    expect(root.querySelector('.blok-image-uploading__label')?.textContent)
      .toBe('L10n uploading file');
  });

  it('labels a URL upload with the video status copy and shows no filename', async () => {
    const uploadByUrl = (): Promise<{ url: string }> => new Promise(() => undefined);
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();

    await submitUrl(root, 'https://x/y.mp4');

    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.querySelector('.blok-image-uploading__label')?.textContent).toBe('Uploading…');
    expect(root.querySelector('[data-role="filename"]')).toBeNull();
  });

  it('cancelling an in-flight upload returns the block to the empty state', () => {
    const uploadByFile = (): Promise<{ url: string }> => new Promise(() => undefined);
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    chooseFile(root, videoFile());
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();

    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('feeds file upload progress into the progress card', () => {
    let report: ((percent: number) => void) | undefined;
    const uploadByFile = (
      _file: File,
      ctx?: { onProgress?(percent: number): void }
    ): Promise<{ url: string }> => {
      report = ctx?.onProgress;

      return new Promise(() => undefined);
    };
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    chooseFile(root, videoFile());

    expect(typeof report).toBe('function');
    report?.(42);
    expect(root.querySelector('[data-role="pct"]')?.textContent).toBe('42%');
  });

  it('feeds URL upload progress into the progress card', async () => {
    let report: ((percent: number) => void) | undefined;
    const uploadByUrl = (
      _url: string,
      ctx?: { onProgress?(percent: number): void }
    ): Promise<{ url: string }> => {
      report = ctx?.onProgress;

      return new Promise(() => undefined);
    };
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();

    await submitUrl(root, 'https://x/y.mp4');

    expect(typeof report).toBe('function');
    report?.(77);
    expect(root.querySelector('[data-role="pct"]')?.textContent).toBe('77%');
  });

  it('ignores a late file-progress report after the card is gone', async () => {
    let report: ((percent: number) => void) | undefined;
    const uploadByFile = (
      _file: File,
      ctx?: { onProgress?(percent: number): void }
    ): Promise<{ url: string }> => {
      report = ctx?.onProgress;

      return Promise.resolve({ url: 'https://cdn/hosted.mp4' });
    };
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    chooseFile(root, videoFile());
    await flush();

    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(() => report?.(50)).not.toThrow();
  });

  it('ignores a late URL-progress report after the card is gone', async () => {
    let report: ((percent: number) => void) | undefined;
    const uploadByUrl = (
      _url: string,
      ctx?: { onProgress?(percent: number): void }
    ): Promise<{ url: string }> => {
      report = ctx?.onProgress;

      return Promise.resolve({ url: 'https://cdn/hosted.mp4' });
    };
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();

    await submitUrl(root, 'https://x/y.mp4');

    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(() => report?.(50)).not.toThrow();
  });

  it('prefers the hosted filename and records the source mime type', async () => {
    const block = createMockBlock();
    const uploadByFile = vi.fn().mockResolvedValue({
      url: 'https://cdn/hosted.mp4',
      fileName: 'hosted.mp4',
    });
    const tool = new VideoTool(createOptions(
      { fileName: 'previous.mp4' },
      { uploader: { uploadByFile } },
      block
    ));
    const root = tool.render();

    await pasteFile(tool, videoFile());

    expect(tool.save().fileName).toBe('hosted.mp4');
    expect(tool.save().mimeType).toBe('video/mp4');
    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to the picked filename when the host returns none', async () => {
    const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/hosted.mp4' });
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile } }));

    tool.render();
    await pasteFile(tool, videoFile('holiday.mp4'));

    expect(tool.save().fileName).toBe('holiday.mp4');
  });

  it('keeps the stored mime type when a URL upload replaces the source', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/hosted.mp4' });
    const tool = new VideoTool(createOptions(
      { mimeType: 'video/webm' },
      { uploader: { uploadByUrl } }
    ));
    const root = tool.render();

    await submitUrl(root, 'https://x/y.mp4');

    expect(tool.save().mimeType).toBe('video/webm');
  });
});

describe('VideoTool — failed uploads', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('shows the English upload-failed copy when the host rejects with a plain error', async () => {
    const uploadByFile = vi.fn().mockRejectedValue(new Error('network down'));
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    await pasteFile(tool, videoFile());

    expect(root.getAttribute('data-state')).toBe('error');
    expect(errorText(root)).toBe('Upload failed');
    expect(root.querySelector('.blok-video-error-state')).not.toBeNull();
  });

  it('localizes the upload-failed copy for a plain error', async () => {
    const uploadByFile = vi.fn().mockRejectedValue(new Error('network down'));
    const tool = new VideoTool(createOptions(
      {},
      { uploader: { uploadByFile } },
      undefined,
      createMockApi({ 'tools.video.errorUploadFailed': 'L10n upload failed' })
    ));
    const root = tool.render();

    await pasteFile(tool, videoFile());

    expect(errorText(root)).toBe('L10n upload failed');
  });

  it('routes an unsupported file type through the generic failure key', async () => {
    const tool = new VideoTool(createOptions(
      {},
      {},
      undefined,
      createMockApi({ 'tools.video.errorUploadFailed': 'L10n upload failed' })
    ));
    const root = tool.render();

    await pasteFile(tool, videoFile('poster.png', 'image/png'));

    expect(errorText(root)).toBe('L10n upload failed');
  });

  it('offers a real Replace button in the error state', async () => {
    const uploadByFile = vi.fn().mockRejectedValue(new Error('network down'));
    const tool = new VideoTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    await pasteFile(tool, videoFile());

    const retry = root.querySelector<HTMLButtonElement>(
      '[data-role="video-error"] [data-action="replace"]'
    );

    expect(retry?.type).toBe('button');
    expect(retry?.className).toBe('blok-video-retry');
    expect(retry?.textContent).toBe('Replace');
  });

  it('localizes the Replace button in the error state', async () => {
    const uploadByFile = vi.fn().mockRejectedValue(new Error('network down'));
    const tool = new VideoTool(createOptions(
      {},
      { uploader: { uploadByFile } },
      undefined,
      createMockApi({ 'tools.video.errorReplace': 'L10n replace' })
    ));
    const root = tool.render();

    await pasteFile(tool, videoFile());

    expect(root.querySelector('[data-role="video-error"] [data-action="replace"]')?.textContent)
      .toBe('L10n replace');
  });
});

describe('VideoTool — media element wiring', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('mounts the control surface inside the media wrapper, not on the figure', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();
    const controls = root.querySelector('[data-role="video-controls"]');

    expect(controls?.parentElement).toBe(root.querySelector('[data-role="video-media"]'));
  });

  it('stops listening for media errors once the block has moved on', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/broken.mp4' }));
    const root = tool.render();
    const video = mustVideo(root);

    video.dispatchEvent(new Event('error'));
    expect(root.getAttribute('data-state')).toBe('error');

    root.querySelector<HTMLButtonElement>('[data-role="video-error"] [data-action="replace"]')?.click();
    expect(root.getAttribute('data-state')).toBe('empty');

    // The detached element still holds the listener; a second error must not drag
    // the block back out of the empty state the author just chose.
    video.dispatchEvent(new Event('error'));
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('leaves loop off on a controls-free player when the tune is unset', () => {
    const tool = new VideoTool(createOptions({ url: 'u', hideControls: true }));
    const root = tool.render();

    expect(mustVideo(root).loop).toBe(false);
  });

  it('seeds the player and its loop row from the stored Loop tune', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    const root = tool.render();

    expect(mustVideo(root).loop).toBe(false);
    expect(root.querySelector('[data-action="loop"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('never autoplays for a viewer when the tune is unset', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'u' }), readOnly: true });
    const root = tool.render();

    expect(mustVideo(root).hasAttribute('autoplay')).toBe(false);
    expect(mustVideo(root).hasAttribute('muted')).toBe(false);
  });

  it('writes empty attribute values for the viewer autoplay pair', () => {
    const tool = new VideoTool({ ...createOptions({ url: 'u', autoplay: true }), readOnly: true });
    const root = tool.render();

    expect(mustVideo(root).getAttribute('muted')).toBe('');
    expect(mustVideo(root).getAttribute('autoplay')).toBe('');
  });
});

describe('VideoTool — intrinsic aspect ratio', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const setDimensions = (video: HTMLVideoElement, width: number, height: number): void => {
    Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
  };

  it('persists the intrinsic ratio the first time metadata arrives', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const video = mustVideo(root);

    setDimensions(video, 1920, 1080);
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(tool.save().aspectRatio).toBe('1920 / 1080');
    expect(root.querySelector<HTMLElement>('[data-role="video-media"]')?.style.aspectRatio)
      .toBe('1920 / 1080');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('ignores metadata that reports a zero width', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    const video = mustVideo(tool.render());

    setDimensions(video, 0, 1080);
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(tool.save().aspectRatio).toBeUndefined();
    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('ignores metadata that reports a zero height', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    const video = mustVideo(tool.render());

    setDimensions(video, 1920, 0);
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(tool.save().aspectRatio).toBeUndefined();
    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('does not report a change when the ratio already matches what is stored', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', aspectRatio: '1920 / 1080' }, {}, block));
    const video = mustVideo(tool.render());

    setDimensions(video, 1920, 1080);
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(block.dispatchChange).not.toHaveBeenCalled();
    expect(tool.save().aspectRatio).toBe('1920 / 1080');
  });

  it('reads the intrinsic size only once per rendered player', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    const video = mustVideo(tool.render());

    setDimensions(video, 1920, 1080);
    video.dispatchEvent(new Event('loadedmetadata'));

    setDimensions(video, 640, 480);
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(tool.save().aspectRatio).toBe('1920 / 1080');
  });
});

describe('VideoTool — theater mode', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('does not open theater mode on a plain render', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));
    const root = tool.render();

    expect(mustFigure(root).getAttribute('data-theater')).not.toBe('true');
    expect(root.querySelector('[data-action="theater"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('re-renders a theater-mode block that has no control surface', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4', hideControls: true }));
    const root = tool.render();

    mustFigure(root).dispatchEvent(new CustomEvent('blok-video-theater', { detail: { on: true } }));

    expect(() => tool.setReadOnly(true)).not.toThrow();
  });
});

describe('VideoTool — caption row', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const mustCaption = (root: HTMLElement): HTMLElement => {
    const caption = root.querySelector<HTMLElement>('[data-role="video-caption"]');

    if (!caption) throw new Error('caption missing');

    return caption;
  };

  it('renders the stored caption text', () => {
    const tool = new VideoTool(createOptions({ url: 'u', caption: 'Sunset over the bay' }));

    expect(mustCaption(tool.render()).textContent).toBe('Sunset over the bay');
  });

  it('renders an empty caption field when nothing is stored', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));

    expect(mustCaption(tool.render()).textContent).toBe('');
  });

  it('hides the caption row from viewers when the caption is turned off', () => {
    const tool = new VideoTool({
      ...createOptions({ url: 'u', captionVisible: false }),
      readOnly: true,
    });
    const root = tool.render();

    expect(root.querySelector('[data-role="video-caption-row"]')).toBeNull();
  });

  it('keeps the caption row for editors even when the caption is turned off', () => {
    const tool = new VideoTool(createOptions({ url: 'u', captionVisible: false }));
    const root = tool.render();

    expect(root.querySelector('[data-role="video-caption-row"]')).not.toBeNull();
  });

  it('keeps the caption row for viewers when the caption is on', () => {
    const tool = new VideoTool({
      ...createOptions({ url: 'u', captionVisible: true }),
      readOnly: true,
    });
    const root = tool.render();

    expect(root.querySelector('[data-role="video-caption-row"]')).not.toBeNull();
  });

  it('commits an edited caption and reports the change', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u' }, {}, block));
    const caption = mustCaption(tool.render());

    caption.textContent = 'Sunset over the bay';
    caption.dispatchEvent(new FocusEvent('blur'));

    expect(tool.save().caption).toBe('Sunset over the bay');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('does not report a caption blur that changed nothing', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', caption: 'unchanged' }, {}, block));

    mustCaption(tool.render()).dispatchEvent(new FocusEvent('blur'));

    expect(block.dispatchChange).not.toHaveBeenCalled();
    expect(tool.save().caption).toBe('unchanged');
  });
});

describe('VideoTool — resize handles', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('attaches a handle on each side of the player', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    const root = tool.render();

    expect([...root.querySelectorAll('[data-role="resize-handle"]')]
      .map((handle) => handle.getAttribute('data-edge')))
      .toEqual(['left', 'right']);
  });

  it('measures the drag against the layout container, not the player itself', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', width: 50 }, {}, block));
    const root = tool.render();

    // Container and figure must differ, or a handle measuring the wrong element
    // still lands on the same percentage.
    stubRect(root, 1000);
    stubRect(mustFigure(root), 500);
    drag(mustHandle(root, 'right'), 1000, 1100);

    expect(tool.save().width).toBe(70);
  });

  it('anchors the drag on the stored alignment', () => {
    const tool = new VideoTool(createOptions({ url: 'u', width: 50, alignment: 'left' }));
    const root = tool.render();

    stubRect(root, 1000);
    stubRect(mustFigure(root), 500);
    drag(mustHandle(root, 'right'), 1000, 1100);

    // Left-anchored: one edge moves, so the width follows the pointer 1:1.
    expect(tool.save().width).toBe(60);
  });

  it('previews the width on the figure while the drag is still in flight', () => {
    const tool = new VideoTool(createOptions({ url: 'u', width: 50 }));
    const root = tool.render();
    const figure = mustFigure(root);

    stubRect(root, 1000);
    stubRect(figure, 500);
    drag(mustHandle(root, 'right'), 1000, 1100, false);

    expect(figure.style.width).toBe('70%');
  });

  it('detaches stale handles so a drag after removed() cannot resize the block', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', width: 100 }, {}, block));
    const root = tool.render();
    const handle = mustHandle(root, 'right');

    stubRect(root, 1000);
    stubRect(mustFigure(root), 1000);
    tool.removed();
    drag(handle, 1000, 800);

    expect(tool.save().width).toBe(100);
    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('detaches stale handles so a drag after a re-render cannot resize the block', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', width: 100 }, {}, block));
    const root = tool.render();
    const handle = mustHandle(root, 'right');

    stubRect(root, 1000);
    stubRect(mustFigure(root), 1000);
    pickAlignment(tool, 'left');
    drag(handle, 1000, 800);

    expect(tool.save().width).toBe(100);
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });
});

describe('VideoTool — tunes and lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('ignores a re-pick of the alignment already in use', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', alignment: 'right' }, {}, block));

    tool.render();
    pickAlignment(tool, 'right');

    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('re-renders the root alignment marker when the alignment changes', () => {
    const tool = new VideoTool(createOptions({ url: 'u' }));
    const root = tool.render();

    pickAlignment(tool, 'left');

    expect(root.getAttribute('data-align')).toBe('left');
  });

  it('turning the caption back on stores captionVisible true', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', captionVisible: false }, {}, block));

    tool.render();
    findItem(tool, 'video-caption')?.onActivate?.();

    expect(tool.save().captionVisible).toBe(true);
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('turning the caption off from an explicit true stores false', () => {
    const tool = new VideoTool(createOptions({ url: 'u', captionVisible: true }));

    tool.render();
    findItem(tool, 'video-caption')?.onActivate?.();

    expect(tool.save().captionVisible).toBe(false);
  });

  it('toggling Autoplay re-renders the viewer player with the autoplay pair', () => {
    const block = createMockBlock();
    const tool = new VideoTool({ ...createOptions({ url: 'u' }, {}, block), readOnly: true });
    const root = tool.render();

    findItem(tool, 'video-autoplay')?.onActivate?.();

    expect(mustVideo(root).getAttribute('autoplay')).toBe('');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('toggling Loop off clears the stored flag', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions({ url: 'u', loop: true }, {}, block));

    tool.render();
    findItem(tool, 'video-loop')?.onActivate?.();

    expect(tool.save().loop).toBeUndefined();
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('toggling Loop on re-renders the player with looping enabled', () => {
    const tool = new VideoTool(createOptions({ url: 'u', hideControls: true }));
    const root = tool.render();

    findItem(tool, 'video-loop')?.onActivate?.();

    expect(mustVideo(root).loop).toBe(true);
  });

  it('replace clears only the url and keeps the rest of the block data', () => {
    const block = createMockBlock();
    const tool = new VideoTool(createOptions(
      { url: 'https://x/y.mp4', caption: 'Sunset over the bay', width: 60, alignment: 'right' },
      {},
      block
    ));

    tool.render();
    findItem(tool, 'video-replace')?.onActivate?.();

    expect(tool.save()).toStrictEqual({
      url: '',
      caption: 'Sunset over the bay',
      width: 60,
      alignment: 'right',
    });
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('toggles read-only before the block has ever rendered', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    expect(() => tool.setReadOnly(true)).not.toThrow();
  });

  it('removes a block that never attached a control surface', () => {
    const tool = new VideoTool(createOptions());

    tool.render();

    expect(() => tool.removed()).not.toThrow();
  });
});

describe('VideoTool — Download action', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  /** Captures the anchor the tool clicks, without stubbing out the DOM insertion. */
  const captureDownloadAnchor = (): { anchors: HTMLAnchorElement[]; attached: boolean[] } => {
    const anchors: HTMLAnchorElement[] = [];
    const attached: boolean[] = [];

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ): void {
      anchors.push(this);
      attached.push(document.body.contains(this));
    });

    return { anchors, attached };
  };

  const download = (tool: VideoTool): void => {
    findItem(tool, 'video-download')?.onActivate?.();
  };

  it('downloads an http(s) source through a fully configured anchor', () => {
    const { anchors, attached } = captureDownloadAnchor();
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4', fileName: 'holiday.mp4' }));

    tool.render();
    download(tool);

    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe('https://x/y.mp4');
    expect(anchors[0].download).toBe('holiday.mp4');
    expect(anchors[0].target).toBe('_blank');
    expect(anchors[0].rel).toBe('noopener');
    expect(attached).toEqual([true]);
    // The anchor is a transient carrier — leaving it behind litters the document
    // with one dead node per download.
    expect(document.body.contains(anchors[0])).toBe(false);
  });

  it('leaves the download name empty when the block never learned a filename', () => {
    const { anchors } = captureDownloadAnchor();
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    tool.render();
    download(tool);

    expect(anchors[0].download).toBe('');
  });

  it('refuses a stored javascript: URL and disables the menu entry', () => {
    const { anchors } = captureDownloadAnchor();
    const tool = new VideoTool(createOptions({ url: 'javascript:fetch("/admin/api")' }));

    tool.render();

    expect(findItem(tool, 'video-download')?.isDisabled).toBe(true);
    download(tool);
    expect(anchors).toEqual([]);
  });

  it('keeps the Download entry enabled for an http(s) source', () => {
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    tool.render();

    expect(findItem(tool, 'video-download')?.isDisabled).toBe(false);
  });
});

describe('VideoTool — Copy URL action', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  const setClipboard = (value: unknown): void => {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  };

  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    vi.restoreAllMocks();
    // defineProperty is not a mock, so restoreAllMocks cannot undo it.
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  const copy = (tool: VideoTool): void => {
    findItem(tool, 'video-copy-url')?.onActivate?.();
  };

  it('copies the stored URL when the clipboard is available', () => {
    const writeText = vi.fn();

    setClipboard({ writeText });
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    tool.render();
    copy(tool);

    expect(writeText).toHaveBeenCalledWith('https://x/y.mp4');
  });

  it('does nothing when the browser exposes no clipboard', () => {
    setClipboard(undefined);
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    tool.render();

    expect(() => copy(tool)).not.toThrow();
  });

  it('does nothing when the clipboard cannot write text', () => {
    setClipboard({});
    const tool = new VideoTool(createOptions({ url: 'https://x/y.mp4' }));

    tool.render();

    expect(() => copy(tool)).not.toThrow();
  });
});
