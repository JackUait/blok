import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ImageTool } from '../../../../src/tools/image';
import { URL_PATTERN } from '../../../../src/tools/image/constants';
import { ImageError } from '../../../../src/tools/image/errors';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconImage,
} from '../../../../src/components/icons';
import type {
  ImageAlignment,
  ImageConfig,
  ImageCrop,
  ImageData,
} from '../../../../types/tools/image';
import type {
  API,
  BlockAPI,
  BlockToolConstructorOptions,
  FilePasteEvent,
  HTMLPasteEvent,
  PasteEvent,
  PatternPasteEvent,
} from '../../../../types';
import type * as ImageUiModule from '../../../../src/tools/image/ui';

vi.mock('../../../../src/tools/image/gif-to-webm', () => ({ convertGifToWebm: vi.fn() }));
vi.mock('../../../../src/tools/image/download', () => ({ downloadImage: vi.fn() }));
vi.mock('../../../../src/tools/image/crop-modal', () => ({ openCropModal: vi.fn() }));
vi.mock('../../../../src/tools/image/probe-dimensions', () => ({ probeImageDimensions: vi.fn() }));
vi.mock('../../../../src/tools/image/resizer', () => ({ attachResizeHandle: vi.fn() }));
vi.mock('../../../../src/tools/image/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageUiModule>();

  return { ...actual, openLightbox: vi.fn() };
});

import { convertGifToWebm } from '../../../../src/tools/image/gif-to-webm';
import { downloadImage } from '../../../../src/tools/image/download';
import { openCropModal } from '../../../../src/tools/image/crop-modal';
import { probeImageDimensions } from '../../../../src/tools/image/probe-dimensions';
import { attachResizeHandle } from '../../../../src/tools/image/resizer';
import { openLightbox } from '../../../../src/tools/image/ui';

const mockConvert = vi.mocked(convertGifToWebm);
const mockDownload = vi.mocked(downloadImage);
const mockCropModal = vi.mocked(openCropModal);
const mockProbe = vi.mocked(probeImageDimensions);
const mockAttachResize = vi.mocked(attachResizeHandle);
const mockLightbox = vi.mocked(openLightbox);

/** Detach spies handed back by the mocked modal / resize handle. */
let cropDetach: Mock<() => void>;
let resizeDetach: Mock<() => void>;

const createMockApi = (messages: Record<string, string> = {}): API => ({
  styles: { block: 'blok-block' },
  i18n: {
    t: (k: string) => messages[k] ?? k,
    has: (k: string) => k in messages,
  },
} as unknown as API);

const createMockBlock = (id = 'b-self'): BlockAPI => ({
  id,
  name: 'image',
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const createOptions = (
  data: Partial<ImageData> = {},
  config: ImageConfig = {},
  block?: BlockAPI
): BlockToolConstructorOptions<ImageData, ImageConfig> => ({
  data: { url: '', ...data },
  config,
  api: createMockApi(),
  block: block ?? createMockBlock(),
  readOnly: false,
});

/** Structural view of a block-settings menu entry — MenuConfig is a wide union. */
interface MenuItemShape {
  icon?: string;
  title?: string;
  name?: string;
  isActive?: boolean;
  closeOnActivate?: boolean;
  onActivate?: () => void;
  children?: { items?: MenuItemShape[] };
}

const settingsItems = (tool: ImageTool): MenuItemShape[] =>
  tool.renderSettings() as unknown as MenuItemShape[];

const settingsItem = (tool: ImageTool, name: string): MenuItemShape => {
  const found = settingsItems(tool).find((i) => i.name === name);

  if (!found) throw new Error(`menu item ${name} missing`);

  return found;
};

const el = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);

  if (!found) throw new Error(`missing ${selector}`);

  return found;
};

const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

const pasteFile = (tool: ImageTool, file: File): void => {
  const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;

  Object.defineProperty(event, 'type', { value: 'file' });
  tool.onPaste(event);
};

const pastePattern = (tool: ImageTool, url: string): void => {
  const event = new CustomEvent('paste', { detail: { key: 'image', data: url } }) as PatternPasteEvent;

  Object.defineProperty(event, 'type', { value: 'pattern' });
  tool.onPaste(event);
};

const pasteTag = (tool: ImageTool, node: HTMLElement | null): void => {
  const event = new CustomEvent('paste', { detail: { data: node } }) as HTMLPasteEvent;

  Object.defineProperty(event, 'type', { value: 'tag' });
  tool.onPaste(event);
};

beforeEach(() => {
  vi.clearAllMocks();
  // restoreAllMocks() wipes implementations off vi.fn()s from vi.mock factories,
  // so every default is re-installed here rather than at declaration.
  cropDetach = vi.fn<() => void>();
  resizeDetach = vi.fn<() => void>();
  mockCropModal.mockImplementation(() => cropDetach);
  mockAttachResize.mockImplementation(() => resizeDetach);
  mockProbe.mockResolvedValue(null);
  mockConvert.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // jsdom ships no Web Animations API; tests that add one must not leak it,
  // or the tools's reduced-motion fallback path stops being exercised.
  Reflect.deleteProperty(Element.prototype, 'animate');
  document.body.replaceChildren();
});

describe('ImageTool — save() persists exactly what was set', () => {
  it('omits every optional field that was never set', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));

    // toStrictEqual, not toEqual: an `{ alt: undefined }` key would compare equal
    // under toEqual and hide a save() that writes undefined into the block data.
    expect(tool.save()).toStrictEqual({ url: 'https://x/y.png' });
  });

  it('round-trips every stored field', () => {
    const stored: ImageData = {
      url: 'https://x/y.png',
      caption: 'A caption',
      width: 42,
      alignment: 'right',
      alt: 'alt text',
      fileName: 'y.png',
      size: 'lg',
      frame: 'border',
      rounded: false,
      captionVisible: false,
      naturalWidth: 800,
      naturalHeight: 600,
    };
    const tool = new ImageTool(createOptions(stored));

    expect(tool.save()).toStrictEqual(stored);
  });

  it('keeps falsy-but-set values (rounded false, captionVisible false, width 0)', () => {
    const tool = new ImageTool(createOptions({
      url: 'u',
      rounded: false,
      captionVisible: false,
      width: 0,
      naturalWidth: 0,
      naturalHeight: 0,
    }));

    expect(tool.save()).toStrictEqual({
      url: 'u',
      rounded: false,
      captionVisible: false,
      width: 0,
      naturalWidth: 0,
      naturalHeight: 0,
    });
  });

  it('drops a full-frame rectangular crop instead of persisting a no-op', () => {
    const tool = new ImageTool(createOptions({ url: 'u', crop: { x: 0, y: 0, w: 100, h: 100 } }));

    expect(tool.save()).toStrictEqual({ url: 'u' });
  });

  it.each<[string, ImageCrop]>([
    ['offset from the left', { x: 5, y: 0, w: 100, h: 100 }],
    ['offset from the top', { x: 0, y: 5, w: 100, h: 100 }],
    ['narrower than the source', { x: 0, y: 0, w: 99, h: 100 }],
    ['shorter than the source', { x: 0, y: 0, w: 100, h: 99 }],
  ])('persists a crop that is %s', (_label, crop) => {
    const tool = new ImageTool(createOptions({ url: 'u', crop }));

    expect(tool.save()).toStrictEqual({ url: 'u', crop });
  });

  it('persists a partial crop without inventing a shape key', () => {
    const tool = new ImageTool(createOptions({ url: 'u', crop: { x: 10, y: 10, w: 50, h: 50, shape: 'rect' } }));

    expect(tool.save()).toStrictEqual({ url: 'u', crop: { x: 10, y: 10, w: 50, h: 50 } });
  });

  it.each<['circle' | 'ellipse']>([['circle'], ['ellipse']])(
    'keeps a full-frame %s mask — the shape is the whole point of the crop',
    (shape) => {
      const crop: ImageCrop = { x: 0, y: 0, w: 100, h: 100, shape };
      const tool = new ImageTool(createOptions({ url: 'u', crop }));

      expect(tool.save()).toStrictEqual({ url: 'u', crop });
    }
  );

  it('keeps a partial crop with its mask shape', () => {
    const crop: ImageCrop = { x: 5, y: 5, w: 40, h: 40, shape: 'circle' };
    const tool = new ImageTool(createOptions({ url: 'u', crop }));

    expect(tool.save()).toStrictEqual({ url: 'u', crop });
  });

  it('treats a block created without data as an empty image', () => {
    const tool = new ImageTool({
      ...createOptions(),
      data: undefined as unknown as ImageData,
    });
    const root = tool.render();

    expect(tool.save()).toStrictEqual({ url: '' });
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('treats data without a url as an empty image', () => {
    const tool = new ImageTool({ ...createOptions(), data: {} as ImageData });
    const root = tool.render();

    expect(tool.save().url).toBe('');
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('validate() rejects a non-string url without throwing', () => {
    const tool = new ImageTool(createOptions());

    expect(tool.validate({ url: null as unknown as string })).toBe(false);
  });
});

describe('ImageTool — static tool registration', () => {
  it('exposes the toolbox entry the slash menu and + button read', () => {
    expect(ImageTool.toolbox).toStrictEqual({
      icon: IconImage,
      titleKey: 'image',
      searchTerms: ['image', 'img', 'picture', 'photo', 'media'],
      section: 'media',
    });
  });

  it('renders in read-only documents', () => {
    expect(ImageTool.isReadOnlySupported).toBe(true);
  });

  it('claims the image asset kind so uploads route to the image uploader', () => {
    expect(ImageTool.assetKind).toBe('image');
  });

  it('whitelists exactly the paste surface its handlers read', () => {
    /**
     * Paste law: the sanitizer strips any attribute the tool does not declare
     * here, silently. onPaste reads `src` off the pasted <img>, so `src` (and
     * `alt`, which renderImage restores) must stay whitelisted.
     */
    const { pasteConfig } = ImageTool;

    if (pasteConfig === false) throw new Error('image tool must accept paste');

    expect(pasteConfig).toStrictEqual({
      patterns: { image: URL_PATTERN },
      tags: [{ img: { src: true, alt: true } }],
      files: { mimeTypes: ['image/*'] },
    });
  });
});

describe('ImageTool — renderSettings menu contents', () => {
  it('labels every entry with its own translation key', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();

    expect(settingsItems(tool).map((i) => [i.name, i.title])).toStrictEqual([
      ['image-alignment', 'tools.image.alignment'],
      ['image-caption', 'tools.image.caption'],
      ['image-replace', 'tools.image.replace'],
      ['image-crop', 'tools.image.crop'],
      ['image-fullscreen', 'tools.image.viewFullscreen'],
      ['image-download', 'tools.image.downloadOriginal'],
      ['image-copy-url', 'tools.image.copyUrl'],
    ]);
  });

  it('closes the popover after every entry is activated', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();

    expect(settingsItems(tool).map((i) => i.closeOnActivate)).toStrictEqual([
      undefined, true, true, true, true, true, true,
    ]);
  });

  it('names the alignment children after the value each one applies', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();
    const children = settingsItem(tool, 'image-alignment').children?.items ?? [];

    expect(children.map((c) => [c.name, c.title, c.closeOnActivate])).toStrictEqual([
      ['image-alignment-left', 'tools.image.alignmentLeft', true],
      ['image-alignment-center', 'tools.image.alignmentCenter', true],
      ['image-alignment-right', 'tools.image.alignmentRight', true],
    ]);
  });

  it.each<[ImageAlignment | undefined, boolean[]]>([
    [undefined, [false, true, false]],
    ['left', [true, false, false]],
    ['right', [false, false, true]],
  ])('marks only the stored alignment (%s) active', (alignment, expected) => {
    const tool = new ImageTool(createOptions({ url: 'u', ...(alignment ? { alignment } : {}) }));

    tool.render();
    const children = settingsItem(tool, 'image-alignment').children?.items ?? [];

    expect(children.map((c) => c.isActive)).toStrictEqual(expected);
  });

  it.each<[ImageAlignment, string]>([
    ['left', IconAlignLeft],
    ['center', IconAlignCenter],
    ['right', IconAlignRight],
  ])('shows the %s icon on the alignment entry', (alignment, icon) => {
    const tool = new ImageTool(createOptions({ url: 'u', alignment }));

    tool.render();

    expect(settingsItem(tool, 'image-alignment').icon).toBe(icon);
  });

  it('falls back to the centre icon when the stored alignment is unknown', () => {
    const tool = new ImageTool(createOptions({
      url: 'u',
      alignment: 'justify' as unknown as ImageAlignment,
    }));

    tool.render();

    expect(settingsItem(tool, 'image-alignment').icon).toBe(IconAlignCenter);
  });

  it('activating download hands the stored url and file name to the downloader', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', fileName: 'y.png' }));

    tool.render();
    settingsItem(tool, 'image-download').onActivate?.();

    expect(mockDownload).toHaveBeenCalledWith('https://x/y.png', 'y.png');
  });
});

describe('ImageTool — paste routing', () => {
  it('stores a pasted image URL as-is instead of re-uploading it', async () => {
    const uploadByUrl = vi.fn(async () => ({ url: 'https://cdn/copy.png' }));
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByUrl } }, block));

    tool.render();
    pastePattern(tool, 'https://x/y.png');

    expect(tool.save().url).toBe('https://x/y.png');
    expect(uploadByUrl).not.toHaveBeenCalled();
    expect(block.dispatchChange).toHaveBeenCalled();
    await tick();
    expect(uploadByUrl).not.toHaveBeenCalled();
  });

  it('ignores a pasted <img> that carries no src', async () => {
    const uploadByUrl = vi.fn(async () => ({ url: 'https://cdn/copy.png' }));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();

    pasteTag(tool, document.createElement('img'));
    await tick();

    expect(tool.save().url).toBe('');
    expect(uploadByUrl).not.toHaveBeenCalled();
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('ignores a paste payload with no node at all', async () => {
    const tool = new ImageTool(createOptions());
    const root = tool.render();

    expect(() => { pasteTag(tool, null); }).not.toThrow();
    await tick();
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('ignores a paste payload that is not an element', async () => {
    const tool = new ImageTool(createOptions());
    const root = tool.render();

    expect(() => { pasteTag(tool, {} as unknown as HTMLElement); }).not.toThrow();
    await tick();
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('completes a file upload that reports progress before the block is rendered', async () => {
    const uploadByFile = vi.fn(async (_f: File, ctx?: { onProgress?: (p: number) => void }) => {
      ctx?.onProgress?.(50);

      return { url: 'https://cdn/a.png' };
    });
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();

    expect(tool.save().url).toBe('https://cdn/a.png');
  });

  it('reports upload progress for a pasted URL too', async () => {
    const uploadByUrl = vi.fn(async (_u: string, ctx?: { onProgress?: (p: number) => void }) => {
      ctx?.onProgress?.(35);

      return new Promise<{ url: string }>(() => { /* stays in flight */ });
    });
    const img = document.createElement('img');

    img.setAttribute('src', 'https://x/y.png');
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();

    pasteTag(tool, img);
    await tick();

    expect(el<HTMLElement>(root, '[data-role="fill"]').style.width).toBe('35%');
  });
});

describe('ImageTool — upload results and failures', () => {
  it('keeps the previous file name when the uploader returns none', async () => {
    const uploadByUrl = vi.fn(async () => ({ url: 'https://cdn/new.png' }));
    const tool = new ImageTool(createOptions(
      { url: 'https://x/old.png', fileName: 'holiday.png' },
      { uploader: { uploadByUrl } }
    ));
    const img = document.createElement('img');

    img.setAttribute('src', 'https://x/y.png');
    tool.render();
    pasteTag(tool, img);
    await tick();

    expect(tool.save()).toStrictEqual({ url: 'https://cdn/new.png', fileName: 'holiday.png' });
  });

  it('dispatches a change once the upload lands', async () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({}, {
      uploader: { uploadByFile: async () => ({ url: 'https://cdn/a.png' }) },
    }, block));

    tool.render();
    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();

    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('shows the generic upload copy for an unexpected failure and logs it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* quiet */ });
    const boom = new Error('socket closed');
    const tool = new ImageTool(createOptions({}, {
      uploader: { uploadByFile: async () => { throw boom; } },
    }));
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();

    expect(el(root, '[data-role="error-state"]').textContent)
      .toContain('tools.image.errorUploadFailed');
    expect(consoleError).toHaveBeenCalledWith('[image] upload failed', boom);
  });

  it('does not log a rejection the tool already has copy for', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* quiet */ });
    const tool = new ImageTool(createOptions({}, {
      uploader: { uploadByFile: async () => { throw new ImageError('UPLOAD_FAILED', 'server rejected'); } },
    }));
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();

    expect(consoleError).not.toHaveBeenCalled();
    expect(el(root, '[data-role="error-state"]').textContent)
      .toContain('tools.image.errorUploadFailed');
  });

  it('keeps reporting progress when the user retries a failed upload', async () => {
    const uploadByFile = vi.fn()
      .mockRejectedValueOnce(new ImageError('UPLOAD_FAILED', 'server rejected'))
      .mockResolvedValue({ url: 'https://cdn/a.png' });
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();
    el<HTMLButtonElement>(root, '[data-role="error-state"] [data-action="retry"]').click();

    expect(uploadByFile).toHaveBeenLastCalledWith(
      expect.any(File),
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
  });

  it('disables the retry button while the retry is in flight', async () => {
    const uploadByFile = vi.fn()
      .mockRejectedValueOnce(new ImageError('UPLOAD_FAILED', 'server rejected'))
      .mockImplementation(() => new Promise<{ url: string }>(() => { /* in flight */ }));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();
    const retry = el<HTMLButtonElement>(root, '[data-role="error-state"] [data-action="retry"]');

    retry.click();

    expect(retry.disabled).toBe(true);
    expect(root.getAttribute('data-retrying')).toBe('true');
  });

  it('a freshly rendered image is not flagged as retrying', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(tool.render().hasAttribute('data-retrying')).toBe(false);
  });

  it('marks the tool root so styling can target the image tool', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(tool.render().getAttribute('data-blok-tool')).toBe('image');
  });

  it('resets data-selected on every render', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(tool.render().getAttribute('data-selected')).toBe('false');
  });

  it('labels a file upload with the default uploading copy, not the URL-only variant', async () => {
    const tool = new ImageTool({
      ...createOptions({}, {
        uploader: { uploadByFile: () => new Promise<{ url: string }>(() => { /* in flight */ }) },
      }),
      api: createMockApi({
        'tools.image.uploadingLabel': 'Uploading file',
        'tools.image.uploading': 'Fetching the link',
      }),
    });
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();

    expect(el(root, '.blok-image-uploading__label').textContent).toBe('Uploading file');
    expect(el(root, '[data-role="filename"]').textContent).toBe('a.png');
  });

  it('labels a URL upload with the link-specific copy and invents no file name', async () => {
    const img = document.createElement('img');

    img.setAttribute('src', 'https://x/y.png');
    const tool = new ImageTool({
      ...createOptions({}, {
        uploader: { uploadByUrl: () => new Promise<{ url: string }>(() => { /* in flight */ }) },
      }),
      api: createMockApi({
        'tools.image.uploadingLabel': 'Uploading file',
        'tools.image.uploading': 'Fetching the link',
      }),
    });
    const root = tool.render();

    pasteTag(tool, img);
    await tick();

    expect(el(root, '.blok-image-uploading__label').textContent).toBe('Fetching the link');
    expect(root.querySelector('[data-role="filename"]')).toBeNull();
  });
});

interface UploadCtx { onProgress?: (percent: number) => void }
type UploadFn = (file: File, ctx?: UploadCtx) => Promise<{ url: string; fileName?: string }>;

interface ConvertHarness {
  api: API;
  insert: ReturnType<typeof vi.fn>;
  getBlockIndex: ReturnType<typeof vi.fn>;
}

const createConvertApi = (opts: {
  video?: boolean;
  index?: number;
  videoUpload?: UploadFn;
  messages?: Record<string, string>;
} = {}): ConvertHarness => {
  const insert = vi.fn();
  const getBlockIndex = vi.fn(() => opts.index);
  const api = createMockApi(opts.messages);

  (api as unknown as { blocks: unknown }).blocks = { getBlockIndex, insert };
  (api as unknown as { tools: unknown }).tools = {
    getBlockTools: () => (opts.video === false ? [{ name: 'paragraph' }] : [{ name: 'video' }]),
    getToolsConfig: () => ({
      tools: opts.videoUpload ? { video: { config: { uploader: { uploadByFile: opts.videoUpload } } } } : {},
    }),
  };

  return { api, insert, getBlockIndex };
};

const gifFile = (name = 'cat.gif'): File =>
  new File([new Uint8Array(8)], name, { type: 'image/gif' });

const webmBlob = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' });

describe('ImageTool — GIF conversion hand-off', () => {
  it('does not also upload the GIF once the video block took over', async () => {
    mockConvert.mockResolvedValue(webmBlob());
    const uploadByFile = vi.fn(async () => ({ url: 'https://cdn/cat.gif' }));
    const videoUpload = vi.fn<UploadFn>(async () => ({ url: 'https://cdn/cat.webm' }));
    const { api, insert } = createConvertApi({ index: 2, videoUpload });
    const tool = new ImageTool({ ...createOptions({}, { uploader: { uploadByFile } }), api });

    tool.render();
    pasteFile(tool, gifFile());
    await tick();

    expect(insert).toHaveBeenCalledTimes(1);
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('names the converted file after the GIF, replacing only the trailing extension', async () => {
    mockConvert.mockResolvedValue(webmBlob());
    const videoUpload = vi.fn<UploadFn>(async () => ({ url: 'https://cdn/clip.webm' }));
    const { api, insert } = createConvertApi({ index: 0, videoUpload });
    const tool = new ImageTool({ ...createOptions(), api });

    tool.render();
    pasteFile(tool, gifFile('clip.gif.gif'));
    await tick();

    const uploaded = videoUpload.mock.calls[0][0];

    expect(uploaded.name).toBe('clip.gif.webm');
    expect(uploaded.type).toBe('video/webm');
    expect(uploaded.size).toBeGreaterThan(0);
    expect(insert).toHaveBeenCalledWith(
      'video',
      { url: 'https://cdn/clip.webm', autoplay: true, loop: true, mimeType: 'video/webm', fileName: 'clip.gif.webm' },
      {}, 0, false, true
    );
  });

  it('pipes conversion and converted-upload progress into the uploading bar', async () => {
    mockConvert.mockImplementation(async (_bytes, options) => {
      options?.onProgress?.(20);

      return webmBlob();
    });
    const videoUpload = vi.fn<UploadFn>(async (_f, ctx) => {
      ctx?.onProgress?.(70);

      return new Promise<{ url: string }>(() => { /* in flight */ });
    });
    const { api } = createConvertApi({ index: 0, videoUpload });
    const tool = new ImageTool({ ...createOptions(), api });
    const root = tool.render();

    pasteFile(tool, gifFile());
    await tick();

    expect(el<HTMLElement>(root, '[data-role="fill"]').style.width).toBe('70%');
  });

  it('stops calling it a conversion once the GIF falls back to a plain upload', async () => {
    mockConvert.mockResolvedValue(null);
    const { api } = createConvertApi({
      index: 0,
      messages: { 'tools.image.converting': 'Converting', 'tools.image.uploadingLabel': 'Uploading file' },
    });
    const tool = new ImageTool({
      ...createOptions({}, {
        uploader: { uploadByFile: () => new Promise<{ url: string }>(() => { /* in flight */ }) },
      }),
      api,
    });
    const root = tool.render();

    pasteFile(tool, gifFile());
    await tick();

    expect(el(root, '.blok-image-uploading__label').textContent).toBe('Uploading file');
    expect(el(root, '[data-role="filename"]').textContent).toBe('cat.gif');
  });

  it('keeps the GIF as an image when the converted upload yields no url', async () => {
    mockConvert.mockResolvedValue(webmBlob());
    const videoUpload = vi.fn<UploadFn>(async () => ({ url: null as unknown as string }));
    const { api, insert } = createConvertApi({ index: 0, videoUpload });
    const uploadByFile = vi.fn(async () => ({ url: 'https://cdn/cat.gif' }));
    const tool = new ImageTool({ ...createOptions({}, { uploader: { uploadByFile } }), api });
    const root = tool.render();

    pasteFile(tool, gifFile());
    await tick();
    await tick();

    expect(insert).not.toHaveBeenCalled();
    expect(uploadByFile).toHaveBeenCalledOnce();
    expect(el<HTMLImageElement>(root, 'img').getAttribute('src')).toBe('https://cdn/cat.gif');
  });

  it('keeps the GIF as an image when the block has no position to insert at', async () => {
    mockConvert.mockResolvedValue(webmBlob());
    const uploadByFile = vi.fn(async () => ({ url: 'https://cdn/cat.gif' }));
    const { api, insert } = createConvertApi({ index: undefined });
    const tool = new ImageTool({ ...createOptions({}, { uploader: { uploadByFile } }), api });
    const root = tool.render();

    pasteFile(tool, gifFile());
    await tick();
    await tick();

    expect(insert).not.toHaveBeenCalled();
    expect(el<HTMLImageElement>(root, 'img').getAttribute('src')).toBe('https://cdn/cat.gif');
  });

  it('converts an explicit convertGifToVideo:true configuration', async () => {
    mockConvert.mockResolvedValue(webmBlob());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const { api, insert } = createConvertApi({ index: 1 });
    const tool = new ImageTool({ ...createOptions({}, { convertGifToVideo: true }), api });

    tool.render();
    pastePattern(tool, 'https://x/cat.gif');
    await tick();
    await tick();

    expect(insert).toHaveBeenCalledOnce();
  });
});

describe('ImageTool — GIF URL conversion falls back to the image', () => {
  const stubFetch = (ok: boolean): void => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, arrayBuffer: async () => new ArrayBuffer(8) })));
  };

  const pasteGifUrl = async (tool: ImageTool): Promise<void> => {
    pastePattern(tool, 'https://x/cat.gif');
    await tick();
    await tick();
  };

  const labelledApi = (parts: ConvertHarness): API => parts.api;

  const messages = {
    'tools.image.converting': 'Converting',
    'tools.image.uploading': 'Fetching the link',
    'tools.image.uploadingLabel': 'Uploading file',
  };

  it('shows the converting label only while the conversion runs', async () => {
    stubFetch(true);
    mockConvert.mockImplementation(() => new Promise<Blob | null>(() => { /* in flight */ }));
    const parts = createConvertApi({ index: 0, messages });
    const tool = new ImageTool({ ...createOptions(), api: labelledApi(parts) });
    const root = tool.render();

    await pasteGifUrl(tool);

    expect(el(root, '.blok-image-uploading__label').textContent).toBe('Converting');
  });

  it('drops back to the link label when the converter produces nothing', async () => {
    stubFetch(true);
    mockConvert.mockResolvedValue(null);
    const parts = createConvertApi({ index: 0, messages });
    const tool = new ImageTool({
      ...createOptions({}, { uploader: { uploadByUrl: () => new Promise<{ url: string }>(() => { /* in flight */ }) } }),
      api: labelledApi(parts),
    });
    const root = tool.render();

    await pasteGifUrl(tool);

    expect(el(root, '.blok-image-uploading__label').textContent).toBe('Fetching the link');
  });

  it('drops back to the link label when the converted upload yields no url', async () => {
    stubFetch(true);
    mockConvert.mockResolvedValue(webmBlob());
    const parts = createConvertApi({
      index: 0,
      messages,
      videoUpload: async () => ({ url: null as unknown as string }),
    });
    const tool = new ImageTool({
      ...createOptions({}, { uploader: { uploadByUrl: () => new Promise<{ url: string }>(() => { /* in flight */ }) } }),
      api: labelledApi(parts),
    });
    const root = tool.render();

    await pasteGifUrl(tool);

    expect(el(root, '.blok-image-uploading__label').textContent).toBe('Fetching the link');
    expect(parts.insert).not.toHaveBeenCalled();
  });

  it('drops back to the link label and keeps the GIF when the converter throws', async () => {
    stubFetch(true);
    mockConvert.mockRejectedValue(new Error('decode failed'));
    const parts = createConvertApi({ index: 0, messages });
    const tool = new ImageTool({
      ...createOptions({}, { uploader: { uploadByUrl: () => new Promise<{ url: string }>(() => { /* in flight */ }) } }),
      api: labelledApi(parts),
    });
    const root = tool.render();

    await pasteGifUrl(tool);

    expect(el(root, '.blok-image-uploading__label').textContent).toBe('Fetching the link');
    expect(parts.insert).not.toHaveBeenCalled();
  });

  it('names the converted remote GIF animation.webm', async () => {
    stubFetch(true);
    mockConvert.mockResolvedValue(webmBlob());
    const videoUpload = vi.fn<UploadFn>(async () => ({ url: 'https://cdn/a.webm' }));
    const parts = createConvertApi({ index: 3, videoUpload });
    const tool = new ImageTool({ ...createOptions(), api: parts.api });

    tool.render();
    await pasteGifUrl(tool);

    const uploaded = videoUpload.mock.calls[0][0];

    expect(uploaded.name).toBe('animation.webm');
    expect(uploaded.type).toBe('video/webm');
    expect(uploaded.size).toBeGreaterThan(0);
    expect(parts.insert).toHaveBeenCalledWith(
      'video',
      { url: 'https://cdn/a.webm', autoplay: true, loop: true, mimeType: 'video/webm', fileName: 'animation.webm' },
      {}, 3, false, true
    );
  });

  it('does not convert when the GIF cannot be fetched', async () => {
    stubFetch(false);
    mockConvert.mockResolvedValue(webmBlob());
    const parts = createConvertApi({ index: 0 });
    const tool = new ImageTool({ ...createOptions(), api: parts.api });
    const root = tool.render();

    await pasteGifUrl(tool);

    expect(mockConvert).not.toHaveBeenCalled();
    expect(parts.insert).not.toHaveBeenCalled();
    expect(el<HTMLImageElement>(root, 'img').getAttribute('src')).toBe('https://x/cat.gif');
  });

  it('does not also load the GIF url once the video block took over', async () => {
    stubFetch(true);
    mockConvert.mockResolvedValue(webmBlob());
    const uploadByUrl = vi.fn(async () => ({ url: 'https://cdn/cat.gif' }));
    const parts = createConvertApi({ index: 0 });
    const tool = new ImageTool({ ...createOptions({}, { uploader: { uploadByUrl } }), api: parts.api });

    tool.render();
    await pasteGifUrl(tool);

    expect(parts.insert).toHaveBeenCalledOnce();
    expect(uploadByUrl).not.toHaveBeenCalled();
  });

  it('hands the conversion a progress callback', async () => {
    stubFetch(true);
    mockConvert.mockResolvedValue(webmBlob());
    const parts = createConvertApi({ index: 0 });
    const tool = new ImageTool({ ...createOptions(), api: parts.api });

    tool.render();
    await pasteGifUrl(tool);

    expect(mockConvert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
  });
});

const setNatural = (img: HTMLImageElement, w: number, h: number): void => {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
};

/** jsdom never decodes images, so the "already loaded" flags have to be forced. */
const stubImageDecoding = (complete: boolean, w: number, h: number): void => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(complete);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(w);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(h);
};

describe('ImageTool — caching the intrinsic size', () => {
  it('stores the decoded size on load so the next render can pre-size the figure', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const img = el<HTMLImageElement>(root, 'img');

    setNatural(img, 300, 200);
    img.dispatchEvent(new Event('load'));

    expect(tool.save()).toStrictEqual({ url: 'u', naturalWidth: 300, naturalHeight: 200 });
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('does not re-dispatch a change when the same size loads again', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const img = el<HTMLImageElement>(root, 'img');

    setNatural(img, 300, 200);
    img.dispatchEvent(new Event('load'));
    img.dispatchEvent(new Event('load'));

    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('re-caches when only the height changes', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const img = el<HTMLImageElement>(root, 'img');

    setNatural(img, 300, 200);
    img.dispatchEvent(new Event('load'));
    setNatural(img, 300, 400);
    img.dispatchEvent(new Event('load'));

    expect(tool.save().naturalHeight).toBe(400);
    expect(block.dispatchChange).toHaveBeenCalledTimes(2);
  });

  it.each<[string, number, number]>([
    ['zero width', 0, 200],
    ['zero height', 200, 0],
    ['no size at all', 0, 0],
  ])('ignores a load that reports %s', (_label, w, h) => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const img = el<HTMLImageElement>(root, 'img');

    setNatural(img, w, h);
    img.dispatchEvent(new Event('load'));

    expect(tool.save()).toStrictEqual({ url: 'u' });
    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('pre-sizes the figure from the cached size and clears it once the image loads', () => {
    const tool = new ImageTool(createOptions({ url: 'u', naturalWidth: 300, naturalHeight: 200 }));
    const root = tool.render();
    const figure = el<HTMLElement>(root, '.blok-image-inner');
    const img = el<HTMLImageElement>(root, 'img');

    expect(figure.style.getPropertyValue('aspect-ratio')).toBe('300 / 200');

    setNatural(img, 300, 200);
    img.dispatchEvent(new Event('load'));

    expect(figure.style.getPropertyValue('aspect-ratio')).toBe('');
    expect(figure.style.getPropertyValue('min-height')).toBe('');
    expect(img.style.getPropertyValue('min-height')).toBe('');
  });

  it('does not pre-size the figure from a half-known cached size', () => {
    const tool = new ImageTool(createOptions({ url: 'u', naturalWidth: 300 }));
    const root = tool.render();

    expect(el<HTMLElement>(root, '.blok-image-inner').style.getPropertyValue('aspect-ratio')).toBe('');
  });

  it('does not pre-size the figure when no size was ever cached', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    expect(el<HTMLElement>(root, '.blok-image-inner').style.getPropertyValue('aspect-ratio')).toBe('');
  });

  it('gives the image a zoom cursor so it reads as clickable', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(el<HTMLImageElement>(tool.render(), 'img').style.cursor).toBe('zoom-in');
  });
});

describe('ImageTool — an image that fails to decode', () => {
  it('shows the broken card straight away for a source that is already known bad', () => {
    stubImageDecoding(true, 0, 0);
    const tool = new ImageTool(createOptions({ url: 'https://x/gone.png' }));
    const root = tool.render();

    expect(root.getAttribute('data-state')).toBe('error');
    expect(el(root, '[data-role="error-state"]').getAttribute('data-variant')).toBe('broken');
  });

  it('renders normally for a source that is already decoded', () => {
    stubImageDecoding(true, 640, 480);
    const tool = new ImageTool(createOptions({ url: 'https://x/ok.png' }));
    const root = tool.render();

    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(root.querySelector('[data-role="error-state"]')).toBeNull();
  });

  it('says the image failed to load rather than blaming the upload', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }, { reloadAttempts: 0 }));
    const root = tool.render();

    el<HTMLImageElement>(root, 'img').dispatchEvent(new Event('error'));

    expect(el(root, '[data-role="error-state"]').textContent)
      .toContain('tools.image.errorSourceOffline');
  });

  it('keeps the same broken card when the stale image fails again', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }, { reloadAttempts: 0 }));
    const root = tool.render();
    const img = el<HTMLImageElement>(root, 'img');

    img.dispatchEvent(new Event('error'));
    const card = el(root, '[data-role="error-state"]');

    img.dispatchEvent(new Event('error'));

    expect(root.querySelector('[data-role="error-state"]')).toBe(card);
  });

  it('switches an upload-failure card to the broken card when the old image fails', async () => {
    const tool = new ImageTool(createOptions(
      { url: 'https://x/y.png' },
      { reloadAttempts: 0, uploader: { uploadByUrl: async () => { throw new ImageError('UPLOAD_FAILED', 'server rejected'); } } }
    ));
    const root = tool.render();
    const stale = el<HTMLImageElement>(root, 'img');
    const replacement = document.createElement('img');

    replacement.setAttribute('src', 'https://x/z.png');
    pasteTag(tool, replacement);
    await tick();
    expect(el(root, '[data-role="error-state"]').getAttribute('data-variant')).toBe('upload');

    stale.dispatchEvent(new Event('error'));

    expect(el(root, '[data-role="error-state"]').getAttribute('data-variant')).toBe('broken');
  });

  it('try again on a broken image puts the picture back', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }, { reloadAttempts: 0 }));
    const root = tool.render();

    el<HTMLImageElement>(root, 'img').dispatchEvent(new Event('error'));
    el<HTMLButtonElement>(root, '[data-role="error-state"] [data-action="retry"]').click();

    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(root.querySelector('[data-role="error-state"]')).toBeNull();
    expect(root.querySelector('img')).not.toBeNull();
  });

  it('clears and re-sets the src so the browser actually refetches it', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();
    const img = el<HTMLImageElement>(root, 'img');
    const setAttribute = vi.spyOn(img, 'setAttribute');

    img.dispatchEvent(new Event('error'));

    expect(setAttribute.mock.calls).toContainEqual(['src', '']);
    expect(setAttribute.mock.calls.at(-1)).toStrictEqual(['src', 'https://x/y.png']);
  });

  it('sizes the retry placeholder from the cached intrinsic size instead of probing', () => {
    const tool = new ImageTool(createOptions({ url: 'u', naturalWidth: 400, naturalHeight: 100 }));
    const root = tool.render();
    const figure = el<HTMLElement>(root, '.blok-image-inner');
    const img = el<HTMLImageElement>(root, 'img');

    img.dispatchEvent(new Event('error'));

    expect(mockProbe).not.toHaveBeenCalled();
    expect(figure.getAttribute('data-loading')).toBe('true');
    expect(figure.style.getPropertyValue('aspect-ratio')).toBe('400 / 100');
    expect(figure.style.getPropertyValue('min-height')).toBe('0px');
    expect(img.style.getPropertyValue('min-height')).toBe('0px');
  });

  it('probes the source when only one cached dimension is known', async () => {
    mockProbe.mockResolvedValue({ width: 800, height: 400 });
    const tool = new ImageTool(createOptions({ url: 'u', naturalWidth: 400 }));
    const root = tool.render();
    const figure = el<HTMLElement>(root, '.blok-image-inner');

    el<HTMLImageElement>(root, 'img').dispatchEvent(new Event('error'));
    await tick();

    expect(mockProbe).toHaveBeenCalledWith('u');
    expect(figure.style.getPropertyValue('aspect-ratio')).toBe('800 / 400');
  });

  it('drops a late probe result once the image has loaded', async () => {
    let resolveProbe: (dims: { width: number; height: number } | null) => void = () => { /* set below */ };

    mockProbe.mockImplementation(() => new Promise((resolve) => { resolveProbe = resolve; }));
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const figure = el<HTMLElement>(root, '.blok-image-inner');
    const img = el<HTMLImageElement>(root, 'img');

    img.dispatchEvent(new Event('error'));
    img.dispatchEvent(new Event('load'));
    resolveProbe({ width: 800, height: 400 });
    await tick();

    expect(figure.style.getPropertyValue('aspect-ratio')).toBe('');
  });

  it.each<[string, number | null]>([
    ['a negative count', -1],
    ['a non-numeric count', null],
  ])('falls back to the default retry budget for %s', (_label, configured) => {
    const tool = new ImageTool(createOptions(
      { url: 'u' },
      { reloadAttempts: configured as unknown as number }
    ));
    const root = tool.render();

    el<HTMLImageElement>(root, 'img').dispatchEvent(new Event('error'));

    expect(root.getAttribute('data-state')).toBe('rendered');
    expect(el<HTMLElement>(root, '.blok-image-inner').getAttribute('data-loading')).toBe('true');
  });
});

interface StubBlockSpec {
  id: string;
  name?: string;
  src?: string;
  alt?: string;
  state?: string;
  cropped?: boolean;
  preservedData?: Partial<ImageData>;
  brokenImg?: boolean;
  noImg?: boolean;
}

const stubBlock = (spec: StubBlockSpec): BlockAPI => {
  const holder = document.createElement('div');
  const toolRoot = document.createElement('div');

  toolRoot.setAttribute('data-blok-tool', 'image');
  if (spec.state) toolRoot.setAttribute('data-state', spec.state);
  const figure = document.createElement('figure');

  figure.className = 'blok-image-inner';
  if (!spec.noImg) {
    const img = document.createElement('img');

    img.setAttribute('src', spec.src ?? `https://x/${spec.id}.png`);
    if (spec.alt !== undefined) img.setAttribute('alt', spec.alt);
    if (spec.brokenImg) {
      Object.defineProperty(img, 'complete', { value: true, configurable: true });
      setNatural(img, 0, 0);
    }
    if (spec.cropped) {
      const wrapper = document.createElement('div');

      wrapper.className = 'blok-image-crop';
      wrapper.appendChild(img);
      figure.appendChild(wrapper);
    } else {
      figure.appendChild(img);
    }
  }
  toolRoot.appendChild(figure);
  holder.appendChild(toolRoot);

  return {
    id: spec.id,
    name: spec.name ?? 'image',
    holder,
    preservedData: spec.preservedData,
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI;
};

type NavigationArg = {
  items: Array<{ url: string; alt?: string; fileName?: string; crop?: ImageCrop; origin?: HTMLElement }>;
  startIndex: number;
} | undefined;

const lastNavigation = (): NavigationArg => {
  const call = mockLightbox.mock.calls.at(-1);

  if (!call) throw new Error('lightbox was never opened');

  return (call[0] as { navigation?: NavigationArg }).navigation;
};

const withBlocks = (blocks: BlockAPI[], messages?: Record<string, string>): API => {
  const api = createMockApi(messages);

  (api as unknown as { blocks: unknown }).blocks = {
    getBlocksCount: () => blocks.length,
    getBlockByIndex: (i: number) => blocks[i],
  };

  return api;
};

describe('ImageTool — lightbox navigation across the page', () => {
  const openFullscreen = (tool: ImageTool): void => {
    settingsItem(tool, 'image-fullscreen').onActivate?.();
  };

  it('collects every healthy image block, in page order, starting on this one', () => {
    const self = createMockBlock('b2');
    const api = withBlocks([
      stubBlock({ id: 'b1', src: 'https://x/1.png', alt: 'One' }),
      self,
      stubBlock({ id: 'b3', src: 'https://x/3.png' }),
    ]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/2.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    const nav = lastNavigation();

    expect(nav?.items.map((i) => i.url)).toStrictEqual([
      'https://x/1.png',
      'https://x/2.png',
      'https://x/3.png',
    ]);
    expect(nav?.items[0].alt).toBe('One');
    expect(nav?.startIndex).toBe(1);
  });

  it('offers no navigation for a lone image block', () => {
    const self = createMockBlock('b1');
    const api = withBlocks([self]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()).toBeUndefined();
  });

  it('skips blocks that are not images, even when they show a picture', () => {
    const self = createMockBlock('b1');
    const api = withBlocks([
      self,
      stubBlock({ id: 'b2', name: 'video', src: 'https://x/poster.png' }),
      stubBlock({ id: 'b3', src: 'https://x/3.png' }),
    ]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()?.items.map((i) => i.url))
      .toStrictEqual(['https://x/1.png', 'https://x/3.png']);
  });

  it('survives a block index the editor cannot resolve', () => {
    const self = createMockBlock('b1');
    const api = createMockApi();

    (api as unknown as { blocks: unknown }).blocks = {
      getBlocksCount: () => 3,
      getBlockByIndex: (i: number) => (i === 1 ? undefined : [self, undefined, stubBlock({ id: 'b3' })][i]),
    };
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());

    expect(() => { openFullscreen(tool); }).not.toThrow();
    expect(lastNavigation()?.items.map((i) => i.url))
      .toStrictEqual(['https://x/1.png', 'https://x/b3.png']);
  });

  it('skips a block whose card is showing an error', () => {
    const self = createMockBlock('b1');
    const api = withBlocks([
      self,
      stubBlock({ id: 'b2', state: 'error' }),
      stubBlock({ id: 'b3' }),
    ]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()?.items.map((i) => i.url))
      .toStrictEqual(['https://x/1.png', 'https://x/b3.png']);
  });

  it('skips a block whose picture failed to decode', () => {
    const self = createMockBlock('b1');
    const api = withBlocks([
      self,
      stubBlock({ id: 'b2', brokenImg: true }),
      stubBlock({ id: 'b3' }),
    ]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()?.items.map((i) => i.url))
      .toStrictEqual(['https://x/1.png', 'https://x/b3.png']);
  });

  it('skips a block with nothing rendered in it', () => {
    const self = createMockBlock('b1');
    const api = withBlocks([
      self,
      stubBlock({ id: 'b2', noImg: true }),
      stubBlock({ id: 'b3' }),
    ]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()?.items.map((i) => i.url))
      .toStrictEqual(['https://x/1.png', 'https://x/b3.png']);
  });

  it('prefers the block data over the rendered src, and carries its alt, name and crop', () => {
    const self = createMockBlock('b1');
    const crop: ImageCrop = { x: 5, y: 5, w: 40, h: 40 };
    const api = withBlocks([
      self,
      stubBlock({
        id: 'b2',
        src: 'blob:preview',
        preservedData: { url: 'https://cdn/final.png', alt: 'Final', fileName: 'final.png', crop },
      }),
    ]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()?.items[1]).toStrictEqual({
      url: 'https://cdn/final.png',
      alt: 'Final',
      fileName: 'final.png',
      crop,
      origin: expect.any(HTMLElement),
    });
  });

  it('falls back to the rendered src when the block data carries no url', () => {
    const self = createMockBlock('b1');
    const api = withBlocks([
      self,
      stubBlock({ id: 'b2', src: 'https://x/2.png', alt: 'Two', preservedData: { alt: 'ignored' } }),
    ]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    const item = lastNavigation()?.items[1];

    expect(item?.url).toBe('https://x/2.png');
    expect(item?.alt).toBe('Two');
  });

  it('uses the crop frame as the zoom origin for a cropped thumbnail', () => {
    const self = createMockBlock('b1');
    const sibling = stubBlock({ id: 'b2', cropped: true });
    const api = withBlocks([self, sibling]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()?.items[1].origin)
      .toBe(sibling.holder.querySelector('.blok-image-crop'));
  });

  it('starts at the first slide when this block is missing from the page list', () => {
    const self = createMockBlock('b-self');
    const api = withBlocks([stubBlock({ id: 'b1' }), stubBlock({ id: 'b2' })]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    openFullscreen(tool);

    expect(lastNavigation()?.startIndex).toBe(0);
  });
});

describe('ImageTool — opening the lightbox', () => {
  it('hands the lightbox the stored image and the crop frame as its origin', () => {
    const crop: ImageCrop = { x: 10, y: 10, w: 50, h: 50 };
    const tool = new ImageTool(createOptions({
      url: 'https://x/y.png', alt: 'Alt', fileName: 'y.png', crop,
    }));
    const root = tool.render();

    settingsItem(tool, 'image-fullscreen').onActivate?.();

    expect(mockLightbox).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://x/y.png',
      alt: 'Alt',
      fileName: 'y.png',
      crop,
      origin: el<HTMLElement>(root, '.blok-image-crop'),
    }));
  });

  it('uses the picture itself as the origin when nothing is cropped', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    settingsItem(tool, 'image-fullscreen').onActivate?.();

    expect(mockLightbox.mock.calls[0][0].origin).toBe(el<HTMLImageElement>(root, 'img'));
  });

  it('still opens fullscreen before the block has been rendered', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));

    expect(() => { settingsItem(tool, 'image-fullscreen').onActivate?.(); }).not.toThrow();
    expect(mockLightbox.mock.calls[0][0].origin).toBeUndefined();
  });

  it('opens the lightbox from the overlay button with the same origin', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="fullscreen"]').click();

    expect(mockLightbox).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://x/y.png',
      origin: el<HTMLImageElement>(root, 'img'),
    }));
  });
});

type CropModalOptions = Parameters<typeof openCropModal>[0];

const cropModalOptions = (): CropModalOptions => {
  const call = mockCropModal.mock.calls.at(-1);

  if (!call) throw new Error('crop modal was never opened');

  return call[0];
};

describe('ImageTool — cropping', () => {
  const openCrop = (tool: ImageTool): void => {
    settingsItem(tool, 'image-crop').onActivate?.();
  };

  it('opens the modal on the current image, alt and crop', () => {
    const crop: ImageCrop = { x: 5, y: 5, w: 40, h: 40 };
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', alt: 'Alt', crop }));

    tool.render();
    openCrop(tool);

    expect(mockCropModal).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://x/y.png',
      alt: 'Alt',
      initial: crop,
    }));
  });

  it('does not stack a second modal while one is open', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();
    openCrop(tool);
    openCrop(tool);

    expect(mockCropModal).toHaveBeenCalledTimes(1);
  });

  it('lets the user re-open the modal after cancelling', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();
    openCrop(tool);
    cropModalOptions().onCancel();
    openCrop(tool);

    expect(mockCropModal).toHaveBeenCalledTimes(2);
  });

  it('stores the applied rectangle, renders it and dispatches a change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();

    openCrop(tool);
    cropModalOptions().onApply({ x: 10, y: 20, w: 50, h: 60 });

    expect(tool.save().crop).toStrictEqual({ x: 10, y: 20, w: 50, h: 60 });
    expect(block.dispatchChange).toHaveBeenCalled();
    expect(root.querySelector('.blok-image-crop')).not.toBeNull();
  });

  it('removes the crop when the modal applies nothing', () => {
    const tool = new ImageTool(createOptions({ url: 'u', crop: { x: 5, y: 5, w: 40, h: 40 } }));
    const root = tool.render();

    openCrop(tool);
    cropModalOptions().onApply(null);

    expect(tool.save()).toStrictEqual({ url: 'u' });
    expect(root.querySelector('.blok-image-crop')).toBeNull();
  });

  it('rescales an explicit width so a taller crop does not become a tower', () => {
    const tool = new ImageTool(createOptions({ url: 'u', width: 80 }));

    tool.render();
    openCrop(tool);
    cropModalOptions().onApply({ x: 0, y: 0, w: 50, h: 100 });

    expect(tool.save().width).toBe(40);
  });

  it('leaves a width-less image width-less after a crop', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();
    openCrop(tool);
    cropModalOptions().onApply({ x: 0, y: 0, w: 50, h: 100 });

    expect(tool.save()).toStrictEqual({ url: 'u', crop: { x: 0, y: 0, w: 50, h: 100 } });
  });

  it('closes the alignment popover before the modal covers it', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const trigger = el<HTMLButtonElement>(root, '[data-action="align-trigger"]');
    const popover = el<HTMLElement>(root, '[data-role="align-popover"]');

    trigger.click();
    expect(root.getAttribute('data-align-open')).toBe('true');

    el<HTMLButtonElement>(root, '[data-action="crop"]').click();

    expect(popover.hidden).toBe(true);
    expect(popover.hasAttribute('data-blok-popover-opened')).toBe(false);
    expect(root.hasAttribute('data-align-open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the crop modal from the overlay button', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="crop"]').click();

    expect(mockCropModal).toHaveBeenCalledOnce();
  });

  it('opening crop before the block is rendered does not throw', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(() => { openCrop(tool); }).not.toThrow();
  });

  it('tears the modal down when the block is removed', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();
    openCrop(tool);
    tool.removed();

    expect(cropDetach).toHaveBeenCalledOnce();
  });
});

/** Feeds the FLIP measurement: first call is the outgoing figure, then the new one. */
const stubFigureLefts = (before: number, after: number): void => {
  let call = 0;

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
    call += 1;

    return new DOMRect(call === 1 ? before : after, 0, 100, 100);
  });
};

/** Records the style the FLIP has staged at the moment it forces a reflow. */
const recordReflowState = (): { transform: string; transition: string }[] => {
  const seen: { transform: string; transition: string }[] = [];

  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function reflow(this: HTMLElement) {
    seen.push({ transform: this.style.transform, transition: this.style.transition });

    return 0;
  });

  return seen;
};

describe('ImageTool — changing alignment', () => {
  const align = (tool: ImageTool, value: ImageAlignment): void => {
    settingsItem(tool, 'image-alignment').children?.items
      ?.find((c) => c.name === `image-alignment-${value}`)?.onActivate?.();
  };

  it('stores the new alignment, re-renders and dispatches a change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();

    align(tool, 'left');

    expect(tool.save().alignment).toBe('left');
    expect(root.getAttribute('data-align')).toBe('left');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a re-pick of the alignment already in force', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', alignment: 'left' }, {}, block));

    tool.render();
    align(tool, 'left');

    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('changes alignment before the block is rendered without throwing', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(() => { align(tool, 'right'); }).not.toThrow();
    expect(tool.save().alignment).toBe('right');
  });

  it('slides the figure from its old position to its new one', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const staged = recordReflowState();

    stubFigureLefts(100, 40);
    align(tool, 'left');
    const figure = el<HTMLElement>(root, '.blok-image-inner');

    // The offset is staged with transitions off and the reflow read commits it,
    // or the browser would coalesce both writes and paint no movement at all.
    expect(staged).toStrictEqual([{ transform: 'translateX(60px)', transition: 'none' }]);
    expect(figure.style.transform).toBe('translateX(0)');
    expect(figure.style.transition).toBe('transform 320ms cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('clears the inline animation styles once the slide ends', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    stubFigureLefts(100, 40);
    align(tool, 'left');
    const figure = el<HTMLElement>(root, '.blok-image-inner');

    figure.dispatchEvent(new Event('transitionend'));

    expect(figure.style.transform).toBe('');
    expect(figure.style.transition).toBe('');
  });

  it('does not animate a figure that did not move', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    stubFigureLefts(40, 40);
    align(tool, 'left');

    expect(el<HTMLElement>(root, '.blok-image-inner').style.transition).toBe('');
  });

  it('animates a half-pixel shift — the threshold is exclusive', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    stubFigureLefts(40.5, 40);
    align(tool, 'left');

    expect(el<HTMLElement>(root, '.blok-image-inner').style.transform).toBe('translateX(0)');
  });

  it('ignores a sub-pixel shift too small to see', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    stubFigureLefts(40.1, 40);
    align(tool, 'left');

    expect(el<HTMLElement>(root, '.blok-image-inner').style.transform).toBe('');
  });

  it('applies alignment picked from the overlay popover', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="align-trigger"]').click();
    el<HTMLButtonElement>(root, '[data-action="align-right"]').click();

    expect(root.getAttribute('data-align')).toBe('right');
  });

  it('shows the stored alignment on the overlay trigger, centre by default', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(el(tool.render(), '[data-action="align-trigger"]').getAttribute('data-current'))
      .toBe('center');
  });

  it('drops a stale open-popover flag when the block re-renders', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="align-trigger"]').click();
    expect(root.getAttribute('data-align-open')).toBe('true');

    el<HTMLButtonElement>(root, '[data-action="caption-toggle"]').click();

    expect(root.hasAttribute('data-align-open')).toBe(false);
  });
});

interface StubbedAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
}

const stubWebAnimations = (): StubbedAnimation[] => {
  const played: StubbedAnimation[] = [];
  const animate = (keyframes: Keyframe[], options: KeyframeAnimationOptions): StubbedAnimation => {
    const animation: StubbedAnimation = { keyframes, options, onfinish: null, oncancel: null };

    played.push(animation);

    return animation;
  };

  Object.defineProperty(Element.prototype, 'animate', {
    value: animate, configurable: true, writable: true,
  });

  return played;
};

const stubReducedMotion = (reduce: boolean): ReturnType<typeof vi.fn> => {
  const matchMedia = vi.fn((query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' }));

  vi.stubGlobal('matchMedia', matchMedia);

  return matchMedia;
};

describe('ImageTool — replacing the image', () => {
  const replace = (tool: ImageTool): void => {
    settingsItem(tool, 'image-replace').onActivate?.();
  };

  it('clears the url but keeps everything else the user configured', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({
      url: 'https://x/y.png', caption: 'Kept', alignment: 'left', size: 'lg', alt: 'Alt',
    }, {}, block));
    const root = tool.render();

    replace(tool);

    expect(tool.save()).toStrictEqual({
      url: '', caption: 'Kept', alignment: 'left', size: 'lg', alt: 'Alt',
    });
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('swaps straight to the uploader when the browser cannot animate', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    replace(tool);

    expect(root.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('swaps straight to the uploader when the reader asked for less motion', () => {
    const matchMedia = stubReducedMotion(true);
    const played = stubWebAnimations();
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    replace(tool);

    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    // Only the entry fade survives reduced motion; the content is swapped at once
    // rather than waiting on a fade-out that would never finish.
    expect(played.map((a) => a.options.duration)).toStrictEqual([200]);
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('still swaps when the environment has no media-query support', () => {
    vi.stubGlobal('matchMedia', undefined);
    const played = stubWebAnimations();
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    expect(() => { replace(tool); }).not.toThrow();
    played[0].onfinish?.();
    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('still swaps when matchMedia answers with nothing', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => undefined));
    stubWebAnimations();
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    expect(() => { replace(tool); }).not.toThrow();
    expect(root.getAttribute('data-state')).toBe('rendered');
  });

  it('fades the old content out, then fades the uploader in', () => {
    stubReducedMotion(false);
    const played = stubWebAnimations();
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    replace(tool);

    expect(played).toHaveLength(1);
    expect(played[0].keyframes).toStrictEqual([
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.98)' },
    ]);
    expect(played[0].options).toStrictEqual({ duration: 140, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
    expect(root.querySelector('input[type="file"]')).toBeNull();

    played[0].onfinish?.();

    expect(root.querySelector('input[type="file"]')).not.toBeNull();
    expect(played).toHaveLength(2);
    expect(played[1].keyframes).toStrictEqual([
      { opacity: 0, transform: 'scale(0.97)' },
      { opacity: 1, transform: 'scale(1)' },
    ]);
    expect(played[1].options).toStrictEqual({ duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  });

  it('still swaps if the fade-out is cancelled part way', () => {
    stubReducedMotion(false);
    const played = stubWebAnimations();
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    replace(tool);
    played[0].oncancel?.();

    expect(root.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('replaces from the overlay button too', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="replace"]').click();

    expect(root.getAttribute('data-state')).toBe('empty');
  });

  it('uploads a picture dropped onto the empty card', async () => {
    const uploadByFile = vi.fn(async () => ({ url: 'https://cdn/dropped.png' }));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();
    const drop = new Event('drop', { bubbles: true, cancelable: true });

    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [new File([new Uint8Array(4)], 'dropped.png', { type: 'image/png' })] },
    });
    el(root, '.blok-media-empty__card').dispatchEvent(drop);
    await tick();

    expect(uploadByFile).toHaveBeenCalledOnce();
    expect(el<HTMLImageElement>(root, 'img').getAttribute('src')).toBe('https://cdn/dropped.png');
  });
});

describe('ImageTool — caption', () => {
  it('shows the stored caption and an empty box when there is none', () => {
    const withText = new ImageTool(createOptions({ url: 'u', caption: 'Sunset' }));
    const without = new ImageTool(createOptions({ url: 'u' }));

    expect(el(withText.render(), '.blok-image-caption').textContent).toBe('Sunset');
    expect(el(without.render(), '.blok-image-caption').textContent).toBe('');
  });

  it('persists an edited caption on blur', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const caption = el<HTMLElement>(root, '.blok-image-caption');

    caption.textContent = 'A new caption';
    caption.dispatchEvent(new Event('blur'));

    expect(tool.save().caption).toBe('A new caption');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch a change when the caption is untouched', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', caption: 'Sunset' }, {}, block));
    const root = tool.render();

    el<HTMLElement>(root, '.blok-image-caption').dispatchEvent(new Event('blur'));

    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('toggling the caption off flips the flag, the attribute and dispatches a change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="caption-toggle"]').click();

    expect(tool.save().captionVisible).toBe(false);
    expect(root.getAttribute('data-caption')).toBe('off');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it.each<[string, boolean | undefined, string]>([
    ['on by default', undefined, 'true'],
    ['off when hidden', false, 'false'],
  ])('marks the overlay caption button %s', (_label, captionVisible, pressed) => {
    const tool = new ImageTool(createOptions({
      url: 'u', ...(captionVisible === undefined ? {} : { captionVisible }),
    }));

    expect(el(tool.render(), '[data-action="caption-toggle"]').getAttribute('aria-pressed'))
      .toBe(pressed);
  });

  it('renders a caption row even for a block created with a hidden caption', () => {
    const tool = new ImageTool(createOptions({ url: 'u', captionVisible: false }));

    expect(() => tool.render()).not.toThrow();
    expect(tool.render().querySelector('.blok-image-caption')).not.toBeNull();
  });
});

describe('ImageTool — alt text', () => {
  const openAlt = (root: HTMLElement): HTMLButtonElement => {
    const anchor = el<HTMLButtonElement>(root, '[data-action="alt-edit"]');

    anchor.click();

    return anchor;
  };

  const altInput = (): HTMLInputElement | HTMLTextAreaElement =>
    el<HTMLInputElement>(document.body, '[data-role="image-alt-popover"] input, [data-role="image-alt-popover"] textarea');

  const commitAlt = (value: string): void => {
    const input = altInput();

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  it('seeds the field with the stored alt text and flags the button as open', () => {
    const tool = new ImageTool(createOptions({ url: 'u', alt: 'A cat' }));
    const root = tool.render();
    const anchor = openAlt(root);

    expect(altInput().value).toBe('A cat');
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    expect(root.getAttribute('data-alt-open')).toBe('true');
  });

  it('starts empty when no alt was ever written', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    openAlt(tool.render());

    expect(altInput().value).toBe('');
  });

  it('does not stack a second popover', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    openAlt(root);
    openAlt(root);

    expect(document.querySelectorAll('[data-role="image-alt-popover"]')).toHaveLength(1);
  });

  it('trims the saved alt text and marks the image as described', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const anchor = openAlt(root);

    commitAlt('   A cat   ');

    expect(tool.save().alt).toBe('A cat');
    expect(root.getAttribute('data-alt')).toBe('set');
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
    expect(root.hasAttribute('data-alt-open')).toBe(false);
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('drops the alt text entirely when it is cleared', () => {
    const tool = new ImageTool(createOptions({ url: 'u', alt: 'A cat' }));
    const root = tool.render();

    openAlt(root);
    commitAlt('   ');

    expect(tool.save()).toStrictEqual({ url: 'u' });
    expect(root.getAttribute('data-alt')).toBe('none');
  });

  it('does not dispatch a change when the alt text is re-saved unchanged', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', alt: 'A cat' }, {}, block));

    openAlt(tool.render());
    commitAlt('A cat');

    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('does not dispatch a change when an empty alt is saved on an image that had none', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));

    openAlt(tool.render());
    commitAlt('');

    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('closes the button state when the popover is dismissed', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const anchor = openAlt(root);

    altInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(anchor.getAttribute('aria-expanded')).toBe('false');
    expect(root.hasAttribute('data-alt-open')).toBe(false);
  });

  it('closes the alignment popover before the alt popover covers it', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="align-trigger"]').click();
    openAlt(root);

    expect(root.hasAttribute('data-align-open')).toBe(false);
  });
});

describe('ImageTool — overlay actions that leave the tool', () => {
  it('downloads the original with its stored file name', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', fileName: 'holiday.png' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="download"]').click();

    expect(mockDownload).toHaveBeenCalledWith('https://x/y.png', 'holiday.png');
  });

  it('deletes the block through the editor API', () => {
    const del = vi.fn();
    const api = createMockApi();
    const block = createMockBlock('b7');

    (api as unknown as { blocks: unknown }).blocks = { delete: del };
    const tool = new ImageTool({ ...createOptions({ url: 'u' }, {}, block), api });
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="delete"]').click();

    expect(del).toHaveBeenCalledWith('b7');
  });

  it('does nothing when the editor exposes no delete', () => {
    const api = createMockApi();

    (api as unknown as { blocks: unknown }).blocks = {};
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), api });
    const root = tool.render();

    expect(() => { el<HTMLButtonElement>(root, '[data-action="delete"]').click(); }).not.toThrow();
  });

  it('does nothing when the editor exposes no blocks API at all', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    expect(() => { el<HTMLButtonElement>(root, '[data-action="delete"]').click(); }).not.toThrow();
  });

  it('copies the image url to the clipboard', () => {
    const writeText = vi.fn();

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));

    tool.render();
    settingsItem(tool, 'image-copy-url').onActivate?.();

    expect(writeText).toHaveBeenCalledWith('https://x/y.png');
  });

  it('does not throw when the browser exposes no clipboard', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));

    tool.render();

    expect(() => { settingsItem(tool, 'image-copy-url').onActivate?.(); }).not.toThrow();
  });

  it('does not throw when the clipboard cannot write text', () => {
    Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));

    tool.render();

    expect(() => { settingsItem(tool, 'image-copy-url').onActivate?.(); }).not.toThrow();
  });
});

interface SettingsHarness {
  api: API;
  toggleBlockSettings: ReturnType<typeof vi.fn>;
  emit: (name: string) => void;
  handlerCount: (name: string) => number;
}

const createSettingsApi = (withToolbar = true): SettingsHarness => {
  const handlers = new Map<string, Array<() => void>>();
  const toggleBlockSettings = vi.fn();
  const api = createMockApi();

  (api as unknown as { events: unknown }).events = {
    on: (name: string, cb: () => void): void => {
      handlers.set(name, [...(handlers.get(name) ?? []), cb]);
    },
    off: (name: string, cb: () => void): void => {
      handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== cb));
    },
    emit: vi.fn(),
  };
  if (withToolbar) (api as unknown as { toolbar: unknown }).toolbar = { toggleBlockSettings };

  return {
    api,
    toggleBlockSettings,
    emit: (name) => { (handlers.get(name) ?? []).forEach((h) => { h(); }); },
    handlerCount: (name) => (handlers.get(name) ?? []).length,
  };
};

describe('ImageTool — the three-dots button', () => {
  it('opens block settings anchored on itself and marks both as expanded', () => {
    const harness = createSettingsApi();
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), api: harness.api });
    const root = tool.render();
    const more = el<HTMLButtonElement>(root, '[data-action="more"]');

    more.click();

    expect(harness.toggleBlockSettings).toHaveBeenCalledWith(true, more, { placeLeftOfAnchor: false });
    expect(root.getAttribute('data-settings-open')).toBe('true');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('clears both flags and unsubscribes when the settings close', () => {
    const harness = createSettingsApi();
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), api: harness.api });
    const root = tool.render();
    const more = el<HTMLButtonElement>(root, '[data-action="more"]');

    more.click();
    harness.emit('block-settings-closed');

    expect(root.hasAttribute('data-settings-open')).toBe(false);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(harness.handlerCount('block-settings-closed')).toBe(0);
  });

  it('keeps the click off the image, so the lightbox stays shut', () => {
    const harness = createSettingsApi();
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), api: harness.api });
    const root = tool.render();
    const bubbled = vi.fn();

    root.addEventListener('click', bubbled);
    el<HTMLButtonElement>(root, '[data-action="more"]').click();

    expect(bubbled).not.toHaveBeenCalled();
  });

  it('does nothing when the editor has no block-settings toolbar', () => {
    const harness = createSettingsApi(false);
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), api: harness.api });
    const root = tool.render();

    expect(() => { el<HTMLButtonElement>(root, '[data-action="more"]').click(); }).not.toThrow();
    expect(root.hasAttribute('data-settings-open')).toBe(false);
  });
});

type ResizeOptions = Parameters<typeof attachResizeHandle>[0];

const resizeCalls = (): ResizeOptions[] => mockAttachResize.mock.calls.map((c) => c[0]);

// minWidthPx is declared as a number OR a thunk; the tool always passes the thunk.
const minWidthOf = (opts: ResizeOptions): number | undefined =>
  (typeof opts.minWidthPx === 'function' ? opts.minWidthPx() : opts.minWidthPx);

describe('ImageTool — resize handles', () => {
  it('hangs one handle on each side of the figure', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const handles = [...root.querySelectorAll('[data-role="resize-handle"]')];

    expect(handles.map((h) => h.getAttribute('data-edge'))).toStrictEqual(['left', 'right']);
    expect(handles.every((h) => h.parentElement === root.querySelector('.blok-image-inner'))).toBe(true);
  });

  it('measures against the figure container and the current alignment', () => {
    const tool = new ImageTool(createOptions({ url: 'u', alignment: 'left' }));
    const root = tool.render();
    const figure = el<HTMLElement>(root, '.blok-image-inner');

    expect(resizeCalls()[0].figure).toBe(figure);
    expect(resizeCalls()[0].container).toBe(figure.parentElement);
    expect(resizeCalls().map((c) => c.alignment)).toStrictEqual(['left', 'left']);
  });

  it('defaults the resize alignment to centre', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();

    expect(resizeCalls().map((c) => c.alignment)).toStrictEqual(['center', 'center']);
  });

  it('floors an image inside a table cell at a legible width', () => {
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell', '');
    document.body.appendChild(cell);
    const tool = new ImageTool(createOptions({ url: 'u' }));

    cell.appendChild(tool.render());

    expect(minWidthOf(resizeCalls()[0])).toBe(120);
  });

  it('applies no pixel floor outside a table cell', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    document.body.appendChild(tool.render());

    expect(minWidthOf(resizeCalls()[0])).toBeUndefined();
  });

  it('previews the drag width live, then stores it on commit', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const figure = el<HTMLElement>(root, '.blok-image-inner');

    resizeCalls()[0].onPreview(55);
    expect(figure.style.getPropertyValue('width')).toBe('55%');

    resizeCalls()[0].onCommit(55);
    expect(tool.save().width).toBe(55);
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('unhooks the old handles before the figure is thrown away', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    el<HTMLButtonElement>(root, '[data-action="caption-toggle"]').click();

    expect(resizeDetach).toHaveBeenCalledTimes(2);
  });

  it('unhooks the handles when the block is removed', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    tool.render();
    tool.removed();

    expect(resizeDetach).toHaveBeenCalledTimes(2);
  });
});

describe('ImageTool — keeping the layout in step with the image', () => {
  const stubDecoded = (): { complete: boolean; w: number; h: number } => {
    const state = { complete: true, w: 0, h: 0 };

    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(() => state.complete);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => state.w);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(() => state.h);

    return state;
  };

  const hostWithWidth = (width: number): HTMLElement => {
    const host = document.createElement('div');

    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    document.body.appendChild(host);

    return host;
  };

  it('flags a short image for the full-width layout using the container width', () => {
    const state = stubDecoded();

    state.w = 1000;
    state.h = 50;
    const host = hostWithWidth(800);
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    host.appendChild(root);
    // Re-render now that the root has a measurable parent.
    tool.setReadOnly(false);

    expect(root.getAttribute('data-auto-full')).toBe('true');
  });

  it('leaves a normally-proportioned image alone', () => {
    const state = stubDecoded();

    state.w = 1000;
    state.h = 800;
    const host = hostWithWidth(800);
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    host.appendChild(root);
    tool.setReadOnly(false);

    expect(root.hasAttribute('data-auto-full')).toBe(false);
  });

  it('measures again once a not-yet-decoded image finishes loading', () => {
    const state = stubDecoded();

    state.complete = false;
    const host = hostWithWidth(800);
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    host.appendChild(root);
    tool.setReadOnly(false);
    expect(root.hasAttribute('data-auto-full')).toBe(false);

    state.w = 1000;
    state.h = 50;
    el<HTMLImageElement>(root, 'img').dispatchEvent(new Event('load'));

    expect(root.getAttribute('data-auto-full')).toBe('true');
  });

  it('measures without a parent element to fall back on', () => {
    const state = stubDecoded();

    state.w = 1000;
    state.h = 50;
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(() => tool.render()).not.toThrow();
  });

  it('watches the figure for size changes and stops watching on removal', () => {
    const observed: Element[] = [];
    const disconnect = vi.fn();

    class TrackingResizeObserver {
      public observe(target: Element): void { observed.push(target); }
      public unobserve(): void { /* unused */ }
      public disconnect(): void { disconnect(); }
    }

    vi.stubGlobal('ResizeObserver', TrackingResizeObserver);
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    expect(observed).toStrictEqual([el<HTMLElement>(root, '.blok-image-inner')]);

    tool.removed();

    expect(disconnect).toHaveBeenCalled();
  });

  it('renders where the browser has no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(() => tool.render()).not.toThrow();
  });
});

describe('ImageTool — read-only documents', () => {
  it('hides the overlay, the resize handles and the alt button', () => {
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), readOnly: true });
    const root = tool.render();

    expect(root.querySelector('[data-role="image-overlay"]')).toBeNull();
    expect(root.querySelector('[data-role="resize-handle"]')).toBeNull();
    expect(root.querySelector('[data-action="alt-edit"]')).toBeNull();
    expect(mockAttachResize).not.toHaveBeenCalled();
    expect(el(root, '.blok-image-caption').getAttribute('contenteditable')).toBe('false');
  });

  it('re-renders the moment the document is locked', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    expect(root.querySelector('[data-role="image-overlay"]')).not.toBeNull();

    tool.setReadOnly(true);

    expect(root.querySelector('[data-role="image-overlay"]')).toBeNull();
  });

  it('hides the replace button on a broken image', () => {
    const tool = new ImageTool({
      ...createOptions({ url: 'u' }, { reloadAttempts: 0 }),
      readOnly: true,
    });
    const root = tool.render();

    el<HTMLImageElement>(root, 'img').dispatchEvent(new Event('error'));

    expect(root.querySelector('[data-role="error-state"] [data-action="replace"]')).toBeNull();
  });
});

describe('ImageTool — before the block is rendered', () => {
  it.each<[string, (tool: ImageTool) => void]>([
    ['locking the document', (tool) => { tool.setReadOnly(true); }],
    ['removing the block', (tool) => { tool.removed(); }],
    ['setting a frame', (tool) => { tool.setFrame('border'); }],
    ['setting rounded corners', (tool) => { tool.setRounded(false); }],
    ['replacing the image', (tool) => { settingsItem(tool, 'image-replace').onActivate?.(); }],
    ['toggling the caption', (tool) => { settingsItem(tool, 'image-caption').onActivate?.(); }],
  ])('survives %s', (_label, act) => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));

    expect(() => { act(tool); }).not.toThrow();
  });

  it('has no toolbar anchor to offer', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(tool.getToolbarAnchorElement()).toBeUndefined();
  });

  it('has no content offset to report', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));

    expect(tool.getContentOffset(document.createElement('div'))).toBeUndefined();
  });
});

describe('ImageTool — frame and rounding', () => {
  it.each<['border' | 'shadow' | 'none', string]>([
    ['border', 'border'],
    ['shadow', 'shadow'],
  ])('stores the %s frame and dispatches a change', (frame, attr) => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();

    tool.setFrame(frame);

    expect(tool.save().frame).toBe(frame);
    expect(root.getAttribute('data-frame')).toBe(attr);
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a re-pick of the frame already in force', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', frame: 'border' }, {}, block));

    tool.render();
    tool.setFrame('border');

    expect(block.dispatchChange).not.toHaveBeenCalled();
  });

  it('turns rounded corners off and dispatches a change', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();

    tool.setRounded(false);

    expect(tool.save().rounded).toBe(false);
    expect(root.getAttribute('data-rounded')).toBe('off');
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a re-pick of the rounding already in force', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u', rounded: false }, {}, block));

    tool.render();
    tool.setRounded(false);

    expect(block.dispatchChange).not.toHaveBeenCalled();
  });
});

/**
 * jsdom routes a throw inside an event listener to window's error event instead
 * of failing the test, so a listener that throws is invisible to `not.toThrow`.
 */
const watchWindowErrors = (): { errors: Error[]; stop: () => void } => {
  const errors: Error[] = [];
  const onError = (event: ErrorEvent): void => { errors.push(event.error as Error); };

  window.addEventListener('error', onError);

  return { errors, stop: () => { window.removeEventListener('error', onError); } };
};

const activateSetting = (tool: ImageTool, name: string): void => {
  settingsItem(tool, name).onActivate?.();
};

const activateAlignment = (tool: ImageTool, value: ImageAlignment): void => {
  settingsItem(tool, 'image-alignment').children?.items
    ?.find((item) => item.name === `image-alignment-${value}`)?.onActivate?.();
};

describe('ImageTool — paste types the tool has no case for', () => {
  it('does not route an unrecognised paste into the file-upload path', () => {
    const uploadByFile = vi.fn(async () => ({ url: 'https://cdn/a.png' }));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();
    const event = new CustomEvent('paste', { detail: {} }) as unknown as PasteEvent;

    Object.defineProperty(event, 'type', { value: 'clipboard' });

    expect(() => { tool.onPaste(event); }).not.toThrow();
    expect(uploadByFile).not.toHaveBeenCalled();
    expect(root.getAttribute('data-state')).toBe('empty');
  });
});

describe('ImageTool — the progress reporter each upload route receives', () => {
  it('hands the converter a progress callback that reaches the uploading bar', async () => {
    mockConvert.mockImplementation(async (_bytes, options) => {
      options?.onProgress?.(20);

      return new Promise<Blob | null>(() => { /* still converting */ });
    });
    const { api } = createConvertApi({ index: 0 });
    const tool = new ImageTool({ ...createOptions(), api });
    const root = tool.render();

    pasteFile(tool, gifFile());
    await tick();

    expect(el<HTMLElement>(root, '[data-role="fill"]').style.width).toBe('20%');
  });

  it('hands the retrying file upload the tool progress callback', async () => {
    const uploadByFile = vi.fn<UploadFn>()
      .mockRejectedValueOnce(new ImageError('UPLOAD_FAILED', 'server rejected'))
      .mockImplementation(() => new Promise<{ url: string }>(() => { /* in flight */ }));
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();
    el<HTMLButtonElement>(root, '[data-role="error-state"] [data-action="retry"]').click();
    await tick();

    expect(uploadByFile.mock.calls.at(-1)?.[1]).toStrictEqual({ onProgress: expect.any(Function) });
  });

  it('hands the retrying url upload the tool progress callback', async () => {
    // The URL-upload seam, not UploadFn (which is the file-upload signature).
    const uploadByUrl = vi.fn<(url: string, ctx?: { onProgress?: (p: number) => void }) => Promise<{ url: string }>>()
      .mockRejectedValueOnce(new ImageError('UPLOAD_FAILED', 'server rejected'))
      .mockImplementation(() => new Promise<{ url: string }>(() => { /* in flight */ }));
    const img = document.createElement('img');

    img.setAttribute('src', 'https://x/y.png');
    const tool = new ImageTool(createOptions({}, { uploader: { uploadByUrl } }));
    const root = tool.render();

    pasteTag(tool, img);
    await tick();
    el<HTMLButtonElement>(root, '[data-role="error-state"] [data-action="retry"]').click();
    await tick();

    expect(uploadByUrl.mock.calls.at(-1)?.[1]).toStrictEqual({ onProgress: expect.any(Function) });
  });
});

describe('ImageTool — the copy an upload failure shows', () => {
  const failingApi = (): API => createMockApi({
    'tools.image.errorUploadFailed': 'Upload failed',
    'tools.image.errorUploadFailedTitle': 'Upload failed title',
  });

  it('writes the generic copy into the message slot for an unexpected failure', async () => {
    const tool = new ImageTool({
      ...createOptions({}, { uploader: { uploadByFile: async () => { throw new Error('socket closed'); } } }),
      api: failingApi(),
    });
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();

    expect(el(root, '.blok-image-error__msg').textContent).toBe('Upload failed');
  });

  it('writes the generic copy into the message slot for a coded failure', async () => {
    const tool = new ImageTool({
      ...createOptions({}, {
        uploader: { uploadByFile: async () => { throw new ImageError('UPLOAD_FAILED', 'server rejected'); } },
      }),
      api: failingApi(),
    });
    const root = tool.render();

    pasteFile(tool, new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
    await tick();

    expect(el(root, '.blok-image-error__msg').textContent).toBe('Upload failed');
  });
});

describe('ImageTool — GIF conversion the configuration switches off', () => {
  it('keeps a remote GIF as an image when convertGifToVideo is false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    mockConvert.mockResolvedValue(webmBlob());
    const parts = createConvertApi({ index: 0 });
    const tool = new ImageTool({ ...createOptions({}, { convertGifToVideo: false }), api: parts.api });
    const root = tool.render();

    pastePattern(tool, 'https://x/cat.gif');
    await tick();
    await tick();

    expect(mockConvert).not.toHaveBeenCalled();
    expect(parts.insert).not.toHaveBeenCalled();
    expect(el<HTMLImageElement>(root, 'img').getAttribute('src')).toBe('https://x/cat.gif');
  });
});

describe('ImageTool — re-caching the intrinsic size', () => {
  it('re-caches when only the width changes', () => {
    const block = createMockBlock();
    const tool = new ImageTool(createOptions({ url: 'u' }, {}, block));
    const root = tool.render();
    const img = el<HTMLImageElement>(root, 'img');

    setNatural(img, 300, 200);
    img.dispatchEvent(new Event('load'));
    setNatural(img, 400, 200);
    img.dispatchEvent(new Event('load'));

    expect(tool.save().naturalWidth).toBe(400);
    expect(block.dispatchChange).toHaveBeenCalledTimes(2);
  });

  it('clears the retry placeholder sizing once the image finally loads', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', naturalWidth: 400, naturalHeight: 100 }));
    const root = tool.render();
    const figure = el<HTMLElement>(root, '.blok-image-inner');
    const img = el<HTMLImageElement>(root, 'img');

    img.dispatchEvent(new Event('error'));
    expect(figure.style.getPropertyValue('min-height')).toBe('0px');
    expect(img.style.getPropertyValue('min-height')).toBe('0px');

    img.dispatchEvent(new Event('load'));

    expect(figure.style.getPropertyValue('min-height')).toBe('');
    expect(img.style.getPropertyValue('min-height')).toBe('');
  });
});

describe('ImageTool — the pre-size a half-known intrinsic size must not produce', () => {
  it('does not pre-size the figure from a zero height', () => {
    const tool = new ImageTool(createOptions({ url: 'u', naturalWidth: 300, naturalHeight: 0 }));
    const root = tool.render();

    expect(el<HTMLElement>(root, '.blok-image-inner').style.getPropertyValue('aspect-ratio')).toBe('');
  });
});

describe('ImageTool — lightbox slides that are decoded', () => {
  it('keeps a thumbnail whose picture decoded to a real size', () => {
    const self = createMockBlock('b1');
    const api = withBlocks([self, stubBlock({ id: 'b2', src: 'https://x/2.png' })]);
    const tool = new ImageTool({ ...createOptions({ url: 'https://x/1.png' }, {}, self), api });

    self.holder.appendChild(tool.render());
    stubImageDecoding(true, 640, 480);
    activateSetting(tool, 'image-fullscreen');

    expect(lastNavigation()?.items.map((item) => item.url))
      .toStrictEqual(['https://x/1.png', 'https://x/2.png']);
  });
});

describe('ImageTool — clicking controls a re-render has already replaced', () => {
  it('opens the crop modal even after the alignment trigger is gone', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const trigger = el<HTMLButtonElement>(root, '[data-action="align-trigger"]');

    trigger.click();
    trigger.remove();
    el<HTMLButtonElement>(root, '[data-action="crop"]').click();

    expect(mockCropModal).toHaveBeenCalledOnce();
  });

  it('opens no alt popover from a button the caption row no longer holds', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const staleAlt = el<HTMLButtonElement>(root, '[data-action="alt-edit"]');
    const watched = watchWindowErrors();

    tool.setReadOnly(true);
    expect(root.querySelector('[data-action="alt-edit"]')).toBeNull();

    staleAlt.click();
    watched.stop();

    expect(watched.errors).toStrictEqual([]);
    expect(document.querySelector('[data-role="image-alt-popover"]')).toBeNull();
  });

  it('raises nothing when the editor has no block-settings toolbar', () => {
    const harness = createSettingsApi(false);
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), api: harness.api });
    const root = tool.render();
    const watched = watchWindowErrors();

    el<HTMLButtonElement>(root, '[data-action="more"]').click();
    watched.stop();

    expect(watched.errors).toStrictEqual([]);
    expect(root.hasAttribute('data-settings-open')).toBe(false);
  });

  it('raises nothing when the editor exposes no delete', () => {
    const api = createMockApi();

    (api as unknown as { blocks: unknown }).blocks = {};
    const tool = new ImageTool({ ...createOptions({ url: 'u' }), api });
    const root = tool.render();
    const watched = watchWindowErrors();

    el<HTMLButtonElement>(root, '[data-action="delete"]').click();
    watched.stop();

    expect(watched.errors).toStrictEqual([]);
  });

  it('raises nothing when the editor exposes no blocks API at all', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();
    const watched = watchWindowErrors();

    el<HTMLButtonElement>(root, '[data-action="delete"]').click();
    watched.stop();

    expect(watched.errors).toStrictEqual([]);
  });
});

describe('ImageTool — swapping to the uploader', () => {
  it('swaps at once when there is no window to ask about motion', () => {
    const played = stubWebAnimations();
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));

    tool.render();
    vi.stubGlobal('window', undefined);
    activateSetting(tool, 'image-replace');

    // The exit fade is the only animation: there is no reduced-motion query to
    // consult outside a browser, so the swap still has to wait for it.
    expect(played.map((animation) => animation.options.duration)).toStrictEqual([140]);
  });
});

describe('ImageTool — the auto-full verdict', () => {
  const stubNaturalSize = (): { complete: boolean; w: number; h: number } => {
    const state = { complete: true, w: 0, h: 0 };

    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(() => state.complete);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => state.w);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(() => state.h);

    return state;
  };

  const hostWide = (width: number): HTMLElement => {
    const host = document.createElement('div');

    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    document.body.appendChild(host);

    return host;
  };

  it('leaves the verdict alone while the source has no measured width', () => {
    const syncs: (() => void)[] = [];

    class TrackingResizeObserver {
      public constructor(callback: () => void) { syncs.push(callback); }
      public observe(): void { /* unused */ }
      public unobserve(): void { /* unused */ }
      public disconnect(): void { /* unused */ }
    }

    vi.stubGlobal('ResizeObserver', TrackingResizeObserver);
    const state = stubNaturalSize();

    state.complete = true;
    state.w = 1000;
    state.h = 50;
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    hostWide(800).appendChild(root);
    // A ResizeObserver tick, not a re-render: a re-render of an image whose
    // stubbed natural size is zero flips the card to the broken variant first.
    for (const sync of syncs) sync();
    expect(root.getAttribute('data-auto-full')).toBe('true');

    state.w = 0;
    state.h = 0;
    for (const sync of syncs) sync();

    expect(root.getAttribute('data-auto-full')).toBe('true');
  });

  it('does not re-measure for an image that was already decoded', () => {
    const state = stubNaturalSize();

    state.complete = true;
    state.w = 1000;
    state.h = 50;
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    expect(root.hasAttribute('data-auto-full')).toBe(false);

    hostWide(800).appendChild(root);
    el<HTMLImageElement>(root, 'img').dispatchEvent(new Event('load'));

    expect(root.hasAttribute('data-auto-full')).toBe(false);
  });

  it('re-measures a not-yet-decoded image only once', () => {
    const state = stubNaturalSize();

    state.complete = false;
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    hostWide(800).appendChild(root);
    tool.setReadOnly(false);
    expect(root.hasAttribute('data-auto-full')).toBe(false);

    const img = el<HTMLImageElement>(root, 'img');

    img.dispatchEvent(new Event('load'));
    state.w = 1000;
    state.h = 50;
    img.dispatchEvent(new Event('load'));

    expect(root.hasAttribute('data-auto-full')).toBe(false);
  });
});

describe('ImageTool — a picture that goes bad mid-render', () => {
  it('survives an alignment change when the re-render produces no figure', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    expect(root.querySelector('.blok-image-inner')).not.toBeNull();

    stubImageDecoding(true, 0, 0);
    activateAlignment(tool, 'left');

    expect(root.querySelector('.blok-image-inner')).toBeNull();
  });
});

describe('ImageTool — the slide cleanup', () => {
  it('runs once, so a later transition cannot wipe a fresh slide', () => {
    const tool = new ImageTool(createOptions({ url: 'u' }));
    const root = tool.render();

    stubFigureLefts(100, 40);
    activateAlignment(tool, 'left');
    const figure = el<HTMLElement>(root, '.blok-image-inner');

    figure.dispatchEvent(new Event('transitionend'));
    figure.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
    figure.dispatchEvent(new Event('transitionend'));

    expect(figure.style.transition).toBe('transform 320ms cubic-bezier(0.22, 1, 0.36, 1)');
  });
});
