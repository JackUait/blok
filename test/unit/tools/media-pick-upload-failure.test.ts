import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, BlockToolData } from '../../../types';
import { ImageTool } from '../../../src/tools/image';
import { AudioTool } from '../../../src/tools/audio';
import { VideoTool } from '../../../src/tools/video';
import { FileTool } from '../../../src/tools/file';

type MediaTool = BlockTool & { save(): BlockToolData; removed(): void };
type Make = (options: BlockToolConstructorOptions) => MediaTool;

const TOOLS: Array<{ name: string; make: Make; error: string; file: File }> = [
  { name: 'image', make: (o) => new ImageTool(o as never), error: '[data-role="error-state"]', file: new File(['x'], 'shot.png', { type: 'image/png' }) },
  { name: 'audio', make: (o) => new AudioTool(o as never), error: '[data-role="audio-error"]', file: new File(['x'], 'song.mp3', { type: 'audio/mpeg' }) },
  { name: 'video', make: (o) => new VideoTool(o as never), error: '[data-role="video-error"]', file: new File(['x'], 'clip.mp4', { type: 'video/mp4' }) },
  { name: 'file', make: (o) => new FileTool(o as never), error: '[data-role="file-error"]', file: new File(['x'], 'notes.txt', { type: 'text/plain' }) },
];

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const createApi = (blocks: Record<string, unknown> = {}): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
  uploader: { isConfigured: () => false },
  tools: { getBlockTools: () => [] },
  blocks: { getBlockIndex: () => 0, insert: vi.fn(), ...blocks },
} as unknown as API);

const createBlock = (name: string): BlockAPI => ({
  id: 'm1',
  name,
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const pick = (root: HTMLElement, file: File): void => {
  const input = root.querySelector<HTMLInputElement>('[data-blok-testid="file-input"]');

  if (input === null) {
    throw new Error('file input missing');
  }
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
};

describe('media tools: a failed upload of a picked file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(TOOLS)('$name', ({ name, make, error, file }) => {
    const uploadByFile = (): Promise<never> => Promise.reject(new Error('500'));

    it('saves no file name and shows the error', async () => {
      const block = createBlock(name);
      const tool = make({ data: { url: '' }, config: { uploader: { uploadByFile } }, api: createApi(), block, readOnly: false });
      const root = tool.render() as HTMLElement;

      pick(root, file);
      await flush();

      expect(tool.save()).not.toHaveProperty('fileName');
      expect(root.querySelector(error)).not.toBeNull();
      // The pick was the edit; putting its name back is derived from it, so it cancels that edit's undo step.
      expect(vi.mocked(block.dispatchChange).mock.calls).toEqual([[], [{ derived: true, from: ['fileName'] }]]);
    });

    it('puts the old file name back on a block that had one', async () => {
      const block = createBlock(name);
      const tool = make({ data: { url: '', fileName: 'old.bin' }, config: { uploader: { uploadByFile } }, api: createApi(), block, readOnly: false });
      const root = tool.render() as HTMLElement;

      pick(root, file);
      await flush();

      expect(tool.save().fileName).toBe('old.bin');
    });

    it('puts the file name back on the block rebuilt under the upload', async () => {
      const block = createBlock(name);
      const live = { id: 'm1', name, save: async () => ({ data: { url: '', fileName: file.name } }) };
      const scope = { open: false, options: undefined as unknown };
      const updates: Array<{ data: unknown; inScope: boolean }> = [];
      const api = createApi({
        getBlocksCount: () => 1,
        getBlockByIndex: () => live,
        update: vi.fn((_id: string, data: unknown) => {
          updates.push({ data, inScope: scope.open });

          return Promise.resolve();
        }),
        transactWithoutCapture: (fn: () => void, options?: unknown) => {
          scope.open = true;
          scope.options = options;
          fn();
          scope.open = false;
        },
      });
      const tool = make({ data: { url: '' }, config: { uploader: { uploadByFile } }, api, block, readOnly: false });
      const root = tool.render() as HTMLElement;

      pick(root, file);
      tool.removed();
      await flush();
      await flush();

      expect(updates).toStrictEqual([{ data: { fileName: undefined }, inScope: true }]);
      expect(scope.options).toEqual({ derivedFrom: 'm1', from: ['fileName'] });
    });
  });

  it('image: retry after a failed pick picks the file again, so the upload joins that edit', async () => {
    const block = createBlock('image');
    const upload = vi.fn()
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce({ url: 'https://cdn/ok.png' });
    const tool = new ImageTool({ data: { url: '' }, config: { uploader: { uploadByFile: upload } }, api: createApi(), block, readOnly: false });
    const root = tool.render();

    pick(root, new File(['x'], 'ok.png', { type: 'image/png' }));
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    await flush();

    expect(tool.save()).toMatchObject({ url: 'https://cdn/ok.png', fileName: 'ok.png' });
    expect(vi.mocked(block.dispatchChange).mock.calls).toEqual([
      [],
      [{ derived: true, from: ['fileName'] }],
      [],
      [{ derived: true, from: ['fileName'] }],
    ]);
  });
});
