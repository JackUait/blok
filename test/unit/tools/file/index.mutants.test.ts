import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const uploader = vi.hoisted(() => ({
  handleFile: vi.fn(),
  handleUrl: vi.fn(),
}));
const preview = vi.hoisted(() => ({ open: vi.fn((_options: unknown) => vi.fn()) }));

vi.mock('../../../../src/tools/file/uploader', () => ({
  Uploader: class FakeUploader {
    public handleFile = uploader.handleFile;

    public handleUrl = uploader.handleUrl;
  },
}));

vi.mock('../../../../src/tools/file/preview-modal', () => ({
  openFilePreview: (options: unknown) => preview.open(options),
}));

import { FileTool } from '../../../../src/tools/file';
import { FileToolError } from '../../../../src/tools/file/errors';
import { PASTE_EXTENSIONS } from '../../../../src/tools/file/constants';
import type { FileData, FileConfig } from '../../../../types/tools/file';
import type { API, BlockAPI, BlockToolConstructorOptions, FilePasteEvent } from '../../../../types';
import type { MenuConfigItem } from '../../../../types/tools/menu-config';

const insert = vi.fn();
const getBlockIndex = vi.fn<() => number | undefined>(() => 0);
const dispatchChange = vi.fn();

const createApi = (): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (key: string) => key, has: () => false },
  blocks: { getBlockIndex, insert },
} as unknown as API);

const createBlock = (): BlockAPI => ({
  id: 'b1',
  name: 'file',
  holder: document.createElement('div'),
  dispatchChange,
} as unknown as BlockAPI);

const createTool = (data: Partial<FileData> = {}, config: FileConfig = {}): FileTool => {
  const options: BlockToolConstructorOptions<FileData, FileConfig> = {
    data: { url: '', ...data },
    config,
    api: createApi(),
    block: createBlock(),
    readOnly: false,
  };

  return new FileTool(options);
};

const pasteFile = (file: File): FilePasteEvent => {
  const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;

  Object.defineProperty(event, 'type', { value: 'file' });

  return event;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// jsdom reports a throw inside a DOM listener on window's `error` event rather
// than to the test, so a broken listener would otherwise pass silently.
const windowErrors: string[] = [];

const recordWindowError = (event: ErrorEvent): void => {
  windowErrors.push(event.message);
};

interface ActivatableItem {
  name?: string;
  title?: string;
  icon?: string;
  isActive?: boolean;
  closeOnActivate?: boolean;
  onActivate?: (item: MenuConfigItem) => void;
}

const settingsItem = (tool: FileTool, name: string): ActivatableItem => {
  const items = tool.renderSettings() as unknown as ActivatableItem[];
  const hit = items.find((item) => item.name === name);

  if (hit === undefined) {
    throw new Error(`no settings item named ${name}`);
  }

  return hit;
};

/** Builds a tool whose stored data may be malformed or absent. */
const constructRaw = (data: unknown, config: FileConfig = {}): FileTool => {
  const options = {
    data,
    config,
    api: createApi(),
    block: createBlock(),
    readOnly: false,
  } as unknown as BlockToolConstructorOptions<FileData, FileConfig>;

  return new FileTool(options);
};

/** Renders the block and mounts it so click handlers reach the document. */
const mount = (data: Partial<FileData> = {}): { tool: FileTool; root: HTMLElement } => {
  const tool = createTool(data);
  const root = tool.render();

  document.body.appendChild(root);

  return { tool, root };
};

/** Fills the empty state's link form and submits it. */
const submitUrl = (root: HTMLElement, url: string): void => {
  root.querySelector<HTMLButtonElement>('[data-src="embed"]')?.click();
  const input = root.querySelector<HTMLInputElement>('input[type="url"]');

  if (input === null) {
    throw new Error('no url input');
  }

  input.value = url;
  root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
};

/** Replaces anchor clicks so a download navigation never leaves the test. */
const recordAnchorClicks = (): HTMLAnchorElement[] => {
  const clicked: HTMLAnchorElement[] = [];

  vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
    clicked.push(this as HTMLAnchorElement);
  });

  return clicked;
};

/** Commits the card's editable filename field. */
const commitName = (root: HTMLElement, next: string): void => {
  const name = root.querySelector<HTMLElement>('[data-role="file-name"]');

  if (name === null) {
    throw new Error('no name field');
  }

  name.textContent = next;
  name.dispatchEvent(new Event('blur'));
};

/** Commits the caption row with the given text. */
const commitCaption = (root: HTMLElement, next: string): void => {
  const caption = root.querySelector<HTMLElement>('[data-role="file-caption"]');

  if (caption === null) {
    throw new Error('no caption row');
  }

  caption.textContent = next;
  caption.dispatchEvent(new Event('blur'));
};

describe('FileTool mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    getBlockIndex.mockReturnValue(0);
    uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/a.pdf' });
    uploader.handleUrl.mockResolvedValue({ url: 'https://cdn.test/a.pdf' });
    preview.open.mockImplementation(() => vi.fn());
    windowErrors.length = 0;
    window.addEventListener('error', recordWindowError);
  });

  afterEach(() => {
    window.removeEventListener('error', recordWindowError);
    vi.restoreAllMocks();
  });

  describe('uploading a pasted file', () => {
    it('shows the uploading state with the pasted file name while the upload runs', () => {
      const tool = createTool();
      const root = tool.render();

      document.body.appendChild(root);
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));

      expect(uploader.handleFile).toHaveBeenCalledTimes(1);
      expect(root.textContent).toContain('report.pdf');
      expect(root.querySelector('[data-role="file-card"]')).toBeNull();
    });

    it('forwards upload progress to the uploading state', () => {
      const tool = createTool();
      const root = tool.render();

      document.body.appendChild(root);

      let report: ((value: number) => void) | undefined;

      uploader.handleFile.mockImplementation((_file: File, options: { onProgress: (value: number) => void }) => {
        report = options.onProgress;

        return new Promise(() => undefined);
      });

      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));

      expect(report).toBeDefined();
      expect(() => report?.(42)).not.toThrow();
    });

    it('refuses a pasted file when the block only accepts urls', () => {
      const tool = createTool({}, { sources: 'url' });

      tool.render();
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));

      expect(uploader.handleFile).not.toHaveBeenCalled();
    });

    it('renders the uploaded file and announces the change', async () => {
      const tool = createTool();
      const root = tool.render();

      document.body.appendChild(root);
      uploader.handleFile.mockResolvedValue({
        url: 'https://cdn.test/report.pdf',
        size: 1234,
        mimeType: 'application/pdf',
      });
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));
      await flush();

      expect(root.querySelector('[data-role="file-card"]')).not.toBeNull();
      expect(dispatchChange).toHaveBeenCalledTimes(1);
      expect(tool.save()).toStrictEqual({
        url: 'https://cdn.test/report.pdf',
        fileName: 'report.pdf',
        size: 1234,
        mimeType: 'application/pdf',
      });
    });

    it('keeps the pasted file name when the upload result carries none', async () => {
      const tool = createTool();

      tool.render();
      uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/x' });
      tool.onPaste(pasteFile(new File(['x'], 'invoice.pdf', { type: 'application/pdf' })));
      await flush();

      expect(tool.save().fileName).toBe('invoice.pdf');
    });

    it('prefers the name the upload result reports', async () => {
      const tool = createTool();

      tool.render();
      uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/x', fileName: 'server-name.pdf' });
      tool.onPaste(pasteFile(new File(['x'], 'local-name.pdf', { type: 'application/pdf' })));
      await flush();

      expect(tool.save().fileName).toBe('server-name.pdf');
    });

    it('shows the failure message and a retry when the upload fails', async () => {
      const tool = createTool();
      const root = tool.render();

      document.body.appendChild(root);
      uploader.handleFile.mockRejectedValue(new FileToolError('FILE_TOO_LARGE', 'too big'));
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));
      await flush();

      const error = root.querySelector('[data-role="file-error"]');

      expect(error).not.toBeNull();
      expect(root.querySelector('[data-role="file-card"]')).toBeNull();
    });

    it('returns to the empty state from the retry button', async () => {
      const tool = createTool();
      const root = tool.render();

      document.body.appendChild(root);
      uploader.handleFile.mockRejectedValue(new Error('boom'));
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));
      await flush();
      dispatchChange.mockClear();

      root.querySelector<HTMLButtonElement>('[data-action="replace"]')?.click();

      expect(root.querySelector('[data-role="file-error"]')).toBeNull();
      expect(dispatchChange).toHaveBeenCalledTimes(1);
      expect(tool.save().url).toBe('');
    });
  });

  describe('converting to a media block', () => {
    const uploadNamed = async (tool: FileTool, name: string, type: string, url: string): Promise<void> => {
      tool.render();
      uploader.handleFile.mockResolvedValue({ url });
      tool.onPaste(pasteFile(new File(['x'], name, { type })));
      await flush();
    };

    it('replaces itself with an image block for an uploaded image', async () => {
      const tool = createTool();

      await uploadNamed(tool, 'photo.png', 'image/png', 'https://cdn.test/photo.png');

      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledWith(
        'image',
        { url: 'https://cdn.test/photo.png', fileName: 'photo.png' },
        {},
        0,
        false,
        true,
      );
      expect(dispatchChange).not.toHaveBeenCalled();
    });

    it('replaces itself with a video block for an uploaded video', async () => {
      const tool = createTool();

      await uploadNamed(tool, 'clip.mp4', 'video/mp4', 'https://cdn.test/clip.mp4');

      expect(insert).toHaveBeenCalledWith(
        'video',
        { url: 'https://cdn.test/clip.mp4', fileName: 'clip.mp4' },
        {},
        0,
        false,
        true,
      );
    });

    it('reads the image extension when the mime type says nothing', async () => {
      const tool = createTool();

      await uploadNamed(tool, 'photo.JPEG', '', 'https://cdn.test/photo.JPEG');

      expect(insert).toHaveBeenCalledWith('image', expect.anything(), {}, 0, false, true);
    });

    it('reads the video extension when the mime type says nothing', async () => {
      const tool = createTool();

      await uploadNamed(tool, 'clip.MOV', '', 'https://cdn.test/clip.MOV');

      expect(insert).toHaveBeenCalledWith('video', expect.anything(), {}, 0, false, true);
    });

    it('leaves a plain document alone', async () => {
      const tool = createTool();

      await uploadNamed(tool, 'report.pdf', 'application/pdf', 'https://cdn.test/report.pdf');

      expect(insert).not.toHaveBeenCalled();
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });

    it('keeps the file card when the block can no longer be found', async () => {
      const tool = createTool();

      getBlockIndex.mockReturnValue(undefined);

      const root = tool.render();

      document.body.appendChild(root);
      uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/photo.png' });
      tool.onPaste(pasteFile(new File(['x'], 'photo.png', { type: 'image/png' })));
      await flush();

      expect(insert).not.toHaveBeenCalled();
      expect(root.querySelector('[data-role="file-card"]')).not.toBeNull();
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });

    it('carries the caption across to the image block', async () => {
      const tool = createTool({ caption: 'a caption', captionVisible: true });

      await uploadNamed(tool, 'photo.png', 'image/png', 'https://cdn.test/photo.png');

      expect(insert).toHaveBeenCalledWith(
        'image',
        { url: 'https://cdn.test/photo.png', fileName: 'photo.png', caption: 'a caption', captionVisible: true },
        {},
        0,
        false,
        true,
      );
    });

    it('carries the mime type across to the video block', async () => {
      const tool = createTool();

      tool.render();
      uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/clip.mp4', mimeType: 'video/mp4' });
      tool.onPaste(pasteFile(new File(['x'], 'clip.mp4', { type: 'video/mp4' })));
      await flush();

      expect(insert).toHaveBeenCalledWith(
        'video',
        { url: 'https://cdn.test/clip.mp4', fileName: 'clip.mp4', mimeType: 'video/mp4' },
        {},
        0,
        false,
        true,
      );
    });
  });

  describe('settings', () => {
    it('toggles the caption row on and announces the change', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });
      const root = tool.render();

      document.body.appendChild(root);

      const item = settingsItem(tool, 'file-caption');

      expect(item.isActive).toBe(false);

      item.onActivate?.({} as MenuConfigItem);

      expect(tool.save().captionVisible).toBe(true);
      expect(dispatchChange).toHaveBeenCalledTimes(1);
      expect(settingsItem(tool, 'file-caption').isActive).toBe(true);
    });

    it('toggles the caption row back off', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', caption: 'hello' });

      tool.render();

      expect(settingsItem(tool, 'file-caption').isActive).toBe(true);

      settingsItem(tool, 'file-caption').onActivate?.({} as MenuConfigItem);

      expect(tool.save().captionVisible).toBe(false);
    });


    it('lists the four settings actions with their own icons and labels', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      tool.render();

      const items = tool.renderSettings() as unknown as ActivatableItem[];

      expect(items.map((item) => item.name)).toStrictEqual([
        'file-caption',
        'file-replace',
        'file-download',
        'file-copy-url',
      ]);
      expect(items.map((item) => item.title)).toStrictEqual([
        'tools.file.toggleCaption',
        'tools.file.replace',
        'tools.file.download',
        'tools.file.copyUrl',
      ]);
      expect(new Set(items.map((item) => item.icon)).size).toBe(4);
      expect(items.every((item) => item.closeOnActivate === true)).toBe(true);
    });

    it('empties the block from the replace action', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });
      const root = tool.render();

      document.body.appendChild(root);
      settingsItem(tool, 'file-replace').onActivate?.({} as MenuConfigItem);

      expect(tool.save().url).toBe('');
      expect(root.querySelector('[data-role="file-card"]')).toBeNull();
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });

    it('clicks the card\'s own download link from the download action', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });
      const root = tool.render();

      document.body.appendChild(root);

      const link = root.querySelector<HTMLAnchorElement>('a[data-action="download"]');

      expect(link).not.toBeNull();

      const click = vi.fn((event: Event) => event.preventDefault());

      link?.addEventListener('click', click);
      settingsItem(tool, 'file-download').onActivate?.({} as MenuConfigItem);

      expect(click).toHaveBeenCalledTimes(1);
    });

    it('copies the file url from the copy action', () => {
      const writeText = vi.fn(async () => undefined);

      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      tool.render();
      settingsItem(tool, 'file-copy-url').onActivate?.({} as MenuConfigItem);

      expect(writeText).toHaveBeenCalledWith('https://cdn.test/a.pdf');
    });
  });

  describe('lifecycle', () => {
    it('validates only a non-empty url', () => {
      const tool = createTool();

      expect(tool.validate({ url: 'https://cdn.test/a.pdf' })).toBe(true);
      expect(tool.validate({ url: '' })).toBe(false);
    });

    it('anchors the toolbar to the file card', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });
      const root = tool.render();

      document.body.appendChild(root);

      expect(tool.getToolbarAnchorElement()).toBe(root.querySelector('[data-role="file-card"]'));
    });

    it('has no toolbar anchor while the block is empty', () => {
      const tool = createTool();

      tool.render();

      expect(tool.getToolbarAnchorElement()).toBeUndefined();
    });

    it('re-renders when read-only is switched on', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });
      const root = tool.render();

      document.body.appendChild(root);
      tool.setReadOnly(true);

      expect(root.querySelector('[data-role="file-card"]')).not.toBeNull();
    });
  });

  describe('statics and toolbox entry', () => {
    it('advertises the file toolbox entry', () => {
      const toolbox = FileTool.toolbox;

      if (Array.isArray(toolbox)) {
        throw new Error('file declares a single toolbox entry');
      }

      expect(toolbox.titleKey).toBe('file');
      expect(toolbox.searchTerms).toStrictEqual([
        'file',
        'attachment',
        'upload',
        'download',
        'pdf',
        'document',
      ]);
      expect(toolbox.section).toBe('media');
    });

    it('declares the file asset kind and read-only support', () => {
      expect(FileTool.assetKind).toBe('file');
      expect(FileTool.isReadOnlySupported).toBe(true);
    });

    it('claims the paste extensions', () => {
      const paste = FileTool.pasteConfig;

      if (paste === false) {
        throw new Error('file declares a paste config');
      }

      expect(paste.files?.extensions).toStrictEqual([...PASTE_EXTENSIONS]);
    });

    it('tags the rendered root with the file tool name', () => {
      expect(createTool().render().getAttribute('data-blok-tool')).toBe('file');
    });
  });

  describe('constructor data handling', () => {
    it('defaults the url to empty when the stored data carries none', () => {
      const tool = constructRaw({ fileName: 'a.pdf' });

      expect(tool.save()).toStrictEqual({ url: '', fileName: 'a.pdf' });
    });

    it('survives a block with no data at all', () => {
      expect(constructRaw(undefined).save().url).toBe('');
    });
  });

  describe('save', () => {
    it('omits every field the block does not carry', () => {
      const tool = constructRaw({ url: 'https://cdn.test/a.pdf' });

      expect(tool.save()).toStrictEqual({ url: 'https://cdn.test/a.pdf' });
    });

    it('omits an empty caption but keeps a real one', () => {
      expect(constructRaw({ url: 'https://cdn.test/a.pdf', caption: '' }).save()).toStrictEqual({
        url: 'https://cdn.test/a.pdf',
      });
      expect(constructRaw({ url: 'https://cdn.test/a.pdf', caption: 'hello' }).save()).toStrictEqual({
        url: 'https://cdn.test/a.pdf',
        caption: 'hello',
      });
    });
  });

  describe('validate and toolbar anchor', () => {
    it('rejects a url that is not a non-empty string', () => {
      const tool = createTool();

      expect(tool.validate({ url: '' })).toBe(false);
      expect(tool.validate({ url: 42 as unknown as string })).toBe(false);
    });

    it('rejects stored data whose url is not a string at all', () => {
      const tool = createTool();

      expect(tool.validate({ url: null as unknown as string })).toBe(false);
      expect(tool.validate({ url: undefined as unknown as string })).toBe(false);
    });

    it('has no toolbar anchor before the block is rendered', () => {
      expect(createTool().getToolbarAnchorElement()).toBeUndefined();
    });
  });

  describe('paste routing', () => {
    it('ignores a paste event that is not a file', () => {
      const tool = createTool();

      tool.render();

      const event = new CustomEvent('paste', {
        detail: { file: new File(['x'], 'report.pdf', { type: 'application/pdf' }) },
      }) as FilePasteEvent;

      Object.defineProperty(event, 'type', { value: 'html' });
      tool.onPaste(event);

      expect(uploader.handleFile).not.toHaveBeenCalled();
    });
  });

  describe('uploading state', () => {
    it('paints the reported progress into the uploading bar', () => {
      const { tool, root } = mount();

      let report: ((value: number) => void) | undefined;

      uploader.handleFile.mockImplementation((_file: File, options: { onProgress: (value: number) => void }) => {
        report = options.onProgress;

        return new Promise(() => undefined);
      });

      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));
      report?.(42);

      expect(root.querySelector<HTMLElement>('[data-role="fill"]')?.style.width).toBe('42%');
      expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    });

    it('labels the uploading state with the i18n copy and the file name', () => {
      const { tool, root } = mount();

      uploader.handleFile.mockImplementation(() => new Promise(() => undefined));
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));

      expect(root.textContent).toContain('tools.file.uploading report.pdf');
      expect(root.querySelector('[data-action="cancel"]')?.getAttribute('aria-label')).toBe(
        'tools.file.cancelUpload',
      );
      expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe(
        'tools.file.uploadProgress',
      );
    });

    it('drops progress that arrives after the upload was cancelled', () => {
      const { tool, root } = mount();

      let report: ((value: number) => void) | undefined;

      uploader.handleFile.mockImplementation((_file: File, options: { onProgress: (value: number) => void }) => {
        report = options.onProgress;

        return new Promise(() => undefined);
      });

      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));
      root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();

      expect(windowErrors).toStrictEqual([]);
      expect(root.querySelector('[data-action="cancel"]')).toBeNull();
      expect(() => report?.(50)).not.toThrow();
    });
  });

  describe('url uploads', () => {
    it('starts a url upload from the empty state link form', async () => {
      const { root } = mount();

      uploader.handleUrl.mockResolvedValue({ url: 'https://cdn.test/a.pdf' });
      submitUrl(root, 'https://cdn.test/a.pdf');

      expect(uploader.handleUrl).toHaveBeenCalledTimes(1);
      expect(uploader.handleUrl.mock.calls[0]?.[0]).toBe('https://cdn.test/a.pdf');
      await flush();
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });

    it('forwards url upload progress to the uploading bar', () => {
      const { root } = mount();

      uploader.handleUrl.mockImplementation(() => new Promise(() => undefined));
      submitUrl(root, 'https://cdn.test/a.pdf');

      const options = uploader.handleUrl.mock.calls[0]?.[1] as { onProgress: (value: number) => void };

      options.onProgress(37);
      expect(root.querySelector<HTMLElement>('[data-role="fill"]')?.style.width).toBe('37%');

      root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
      expect(root.querySelector('[data-action="cancel"]')).toBeNull();
      expect(() => options.onProgress(50)).not.toThrow();
    });

    it('renders the error state when a url upload fails', async () => {
      const { root } = mount();

      uploader.handleUrl.mockRejectedValue(new Error('boom'));
      submitUrl(root, 'https://cdn.test/a.pdf');
      await flush();

      expect(root.querySelector('[data-role="file-error"]')).not.toBeNull();
    });

    it('leaves the file picker open when no type list is configured', () => {
      const { root } = mount();

      expect(root.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('*');
    });

    it('starts the upload when a file is picked in the empty state', () => {
      const { root } = mount();
      const input = root.querySelector<HTMLInputElement>('input[type="file"]');
      const file = new File(['x'], 'picked.pdf', { type: 'application/pdf' });

      if (input === null) {
        throw new Error('no file input');
      }

      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));

      expect(uploader.handleFile).toHaveBeenCalledTimes(1);
      expect(uploader.handleFile.mock.calls[0]?.[0]).toBe(file);
    });
  });

  describe('error state copy', () => {
    it('falls back to the generic copy for a non upload error', async () => {
      const { tool, root } = mount();

      uploader.handleFile.mockRejectedValue(new Error('boom'));
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));
      await flush();

      const wrap = root.querySelector('[data-role="file-error"]');

      expect(wrap?.textContent).toContain('tools.file.errorUploadFailed');
      expect(wrap?.className).toBe('blok-file-error-state');

      const retry = wrap?.querySelector('button');

      expect(retry?.getAttribute('type')).toBe('button');
      expect(retry?.className).toBe('blok-file-retry');
      expect(retry?.textContent).toBe('tools.file.errorReplace');
    });

    it('uses the generic i18n key for an upload error it cannot parse', async () => {
      const { tool, root } = mount();

      uploader.handleFile.mockRejectedValue(new FileToolError('UPLOAD_FAILED', 'nope'));
      tool.onPaste(pasteFile(new File(['x'], 'report.pdf', { type: 'application/pdf' })));
      await flush();

      expect(root.querySelector('[data-role="file-error"]')?.textContent).toContain(
        'tools.file.errorUploadFailed',
      );
    });
  });

  describe('renaming the file', () => {
    it('renames the file when the name field is committed', () => {
      const { root } = mount({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      commitName(root, 'b.pdf');

      expect(root.querySelector('a[data-action="download"]')?.getAttribute('download')).toBe('b.pdf');
    });

    it('leaves the file alone when the name is committed unchanged', () => {
      const { root } = mount({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      dispatchChange.mockClear();
      commitName(root, 'a.pdf');

      expect(dispatchChange).not.toHaveBeenCalled();
    });
  });

  describe('download fallback without a mounted card', () => {
    it('builds and follows a download anchor', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });
      const clicked = recordAnchorClicks();

      settingsItem(tool, 'file-download').onActivate?.({} as MenuConfigItem);

      expect(clicked).toHaveLength(1);

      const anchor = clicked[0];

      expect(anchor.getAttribute('href')).toBe('https://cdn.test/a.pdf');
      expect(anchor.getAttribute('download')).toBe('a.pdf');
      expect(anchor.getAttribute('target')).toBe('_blank');
      expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('downloads without a name when the block has none', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf' });
      const clicked = recordAnchorClicks();

      settingsItem(tool, 'file-download').onActivate?.({} as MenuConfigItem);

      expect(clicked[0]?.getAttribute('download')).toBe('');
    });

    it('refuses to download a url that is not http(s)', () => {
      const tool = createTool({ url: 'javascript:alert(1)', fileName: 'x' });
      const clicked = recordAnchorClicks();

      settingsItem(tool, 'file-download').onActivate?.({} as MenuConfigItem);

      expect(clicked).toHaveLength(0);
    });
  });

  describe('copy url without a clipboard', () => {
    it('does nothing when the clipboard api is missing', () => {
      Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });

      const tool = createTool({ url: 'https://cdn.test/a.pdf' });

      tool.render();

      expect(() => settingsItem(tool, 'file-copy-url').onActivate?.({} as MenuConfigItem)).not.toThrow();
    });
  });

  describe('preview', () => {
    it('opens the preview with the localized label set', () => {
      const { root } = mount({
        url: 'https://cdn.test/a.pdf',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
      });

      root.querySelector<HTMLButtonElement>('[data-action="preview"]')?.click();

      expect(preview.open).toHaveBeenCalledTimes(1);
      expect(preview.open).toHaveBeenCalledWith({
        url: 'https://cdn.test/a.pdf',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        labels: {
          close: 'tools.file.previewClose',
          raw: 'tools.file.previewRaw',
          render: 'tools.file.previewRender',
          loading: 'tools.file.previewLoading',
          error: 'tools.file.previewError',
          download: 'tools.file.previewDownload',
          openInNewTab: 'tools.file.previewOpenInNewTab',
          backToContent: 'tools.file.previewBackToContent',
        },
      });
      expect(root.firstElementChild?.className).toBe('blok-file-rendered');
    });

    it('closes a preview only when one is open', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      tool.render();

      expect(() => tool.removed()).not.toThrow();
    });
  });

  describe('render state', () => {
    it('ignores a state render before the block is mounted', () => {
      const tool = createTool({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      expect(() => tool.setReadOnly(true)).not.toThrow();

      const root = tool.render();

      expect(root.querySelector('[data-role="file-card"]')).not.toBeNull();
    });

    it('wipes the previous render before rebuilding it', () => {
      const { tool, root } = mount({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      tool.setReadOnly(true);

      expect(root.childNodes).toHaveLength(1);
    });
  });

  describe('caption row', () => {
    it('renders an empty caption value when the block carries no caption', () => {
      const { root } = mount({
        url: 'https://cdn.test/a.pdf',
        fileName: 'a.pdf',
        captionVisible: true,
      });

      expect(root.querySelector('[data-role="file-caption"]')?.textContent).toBe('');
    });

    it('ignores a caption edit that changes nothing', () => {
      const { root } = mount({
        url: 'https://cdn.test/a.pdf',
        fileName: 'a.pdf',
        caption: 'hello',
        captionVisible: true,
      });

      dispatchChange.mockClear();
      commitCaption(root, 'hello');

      expect(dispatchChange).not.toHaveBeenCalled();
    });

    it('shows the caption row as soon as the caption is toggled on', () => {
      const { tool, root } = mount({ url: 'https://cdn.test/a.pdf', fileName: 'a.pdf' });

      expect(root.querySelector('[data-role="file-caption"]')).toBeNull();

      settingsItem(tool, 'file-caption').onActivate?.({} as MenuConfigItem);

      expect(root.querySelector('[data-role="file-caption"]')).not.toBeNull();
    });
  });

  describe('media conversion from a url upload', () => {
    it('carries only the fields the block holds into the image block', async () => {
      const { root } = mount();

      uploader.handleUrl.mockResolvedValue({ url: 'https://cdn.test/photo.png' });
      submitUrl(root, 'https://cdn.test/photo.png');
      await flush();

      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert.mock.calls[0]?.[0]).toBe('image');
      expect(insert.mock.calls[0]?.[1]).toStrictEqual({ url: 'https://cdn.test/photo.png' });
    });

    it('carries only the fields the block holds into the video block', async () => {
      const { root } = mount();

      uploader.handleUrl.mockResolvedValue({ url: 'https://cdn.test/clip.mp4' });
      submitUrl(root, 'https://cdn.test/clip.mp4');
      await flush();

      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert.mock.calls[0]?.[0]).toBe('video');
      expect(insert.mock.calls[0]?.[1]).toStrictEqual({ url: 'https://cdn.test/clip.mp4' });
    });
  });

  describe('media conversion details', () => {
    const uploadNamed = async (tool: FileTool, name: string, type: string, url: string): Promise<void> => {
      tool.render();
      uploader.handleFile.mockResolvedValue({ url });
      tool.onPaste(pasteFile(new File(['x'], name, { type })));
      await flush();
    };

    it('converts on an image mime prefix with no image extension in the name', async () => {
      const tool = createTool();

      await uploadNamed(tool, 'download', 'image/png', 'https://cdn.test/photo.png');

      expect(insert.mock.calls[0]?.[0]).toBe('image');
    });

    it('converts on a video mime prefix with no video extension in the name', async () => {
      const tool = createTool();

      await uploadNamed(tool, 'download', 'video/mp4', 'https://cdn.test/clip.mp4');

      expect(insert.mock.calls[0]?.[0]).toBe('video');
    });

    it('carries the caption and its visibility into the video block', async () => {
      const tool = createTool({ caption: 'a caption', captionVisible: true });

      tool.render();
      uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/clip.mp4' });
      tool.onPaste(pasteFile(new File(['x'], 'clip.mp4', { type: 'video/mp4' })));
      await flush();

      expect(insert.mock.calls[0]?.[1]).toStrictEqual({
        url: 'https://cdn.test/clip.mp4',
        fileName: 'clip.mp4',
        caption: 'a caption',
        captionVisible: true,
      });
    });

    it('keeps the file card when the block cannot be found for a video', async () => {
      const { tool, root } = mount();

      getBlockIndex.mockReturnValue(undefined);
      uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/clip.mp4' });
      tool.onPaste(pasteFile(new File(['x'], 'clip.mp4', { type: 'video/mp4' })));
      await flush();

      expect(insert).not.toHaveBeenCalled();
      expect(root.querySelector('[data-role="file-card"]')).not.toBeNull();
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });
  });
});
