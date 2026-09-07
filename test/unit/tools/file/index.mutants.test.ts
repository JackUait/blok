import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const uploader = vi.hoisted(() => ({
  handleFile: vi.fn(),
  handleUrl: vi.fn(),
}));
const preview = vi.hoisted(() => ({ open: vi.fn(() => vi.fn()) }));

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

interface ActivatableItem {
  name?: string;
  isActive?: boolean;
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

describe('FileTool mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    getBlockIndex.mockReturnValue(0);
    uploader.handleFile.mockResolvedValue({ url: 'https://cdn.test/a.pdf' });
    uploader.handleUrl.mockResolvedValue({ url: 'https://cdn.test/a.pdf' });
  });

  afterEach(() => {
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
      uploader.handleFile.mockRejectedValue(new FileToolError('too big', 'FILE_TOO_LARGE'));
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
});
