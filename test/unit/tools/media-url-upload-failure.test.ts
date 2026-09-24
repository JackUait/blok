import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, BlockToolData } from '../../../types';
import { ImageTool } from '../../../src/tools/image';
import { AudioTool } from '../../../src/tools/audio';
import { VideoTool } from '../../../src/tools/video';
import { FileTool } from '../../../src/tools/file';

type MediaTool = BlockTool & { save(): BlockToolData; removed(): void };
type Make = (options: BlockToolConstructorOptions) => MediaTool;

const TOOLS: Array<{ name: string; make: Make; error: string }> = [
  { name: 'image', make: (o) => new ImageTool(o as never), error: '[data-role="error-state"]' },
  { name: 'audio', make: (o) => new AudioTool(o as never), error: '[data-role="audio-error"]' },
  { name: 'video', make: (o) => new VideoTool(o as never), error: '[data-role="video-error"]' },
  { name: 'file', make: (o) => new FileTool(o as never), error: '[data-role="file-error"]' },
];

const LINK = 'https://example.com/missing.bin';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const createApi = (blocks: Record<string, unknown> = {}): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
  uploader: { isConfigured: () => false },
  blocks: { getBlockIndex: () => 0, insert: vi.fn(), ...blocks },
} as unknown as API);

const createBlock = (name: string): BlockAPI => ({
  id: 'm1',
  name,
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const enterLink = (root: HTMLElement, url: string): void => {
  root.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
  const input = root.querySelector<HTMLInputElement>('input[type="url"]');

  if (input === null) {
    throw new Error('url input missing');
  }
  input.value = url;
  input.dispatchEvent(new Event('input'));
  root.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
};

describe('media tools: a failed upload by URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(TOOLS)('$name', ({ name, make, error }) => {
    const uploadByUrl = (): Promise<never> => Promise.reject(new Error('404'));

    it('saves no link and shows the error', async () => {
      const block = createBlock(name);
      const tool = make({ data: { url: '' }, config: { uploader: { uploadByUrl } }, api: createApi(), block, readOnly: false });
      const root = tool.render() as HTMLElement;

      enterLink(root, LINK);
      await flush();

      expect(tool.save().url).toBe('');
      expect(root.querySelector(error)).not.toBeNull();
      // The link was the edit; putting it back is derived from it, so it cancels that edit's undo step.
      expect(vi.mocked(block.dispatchChange).mock.calls).toEqual([[], [{ derived: true, from: ['url'] }]]);
    });

    it('puts the link back on the block rebuilt under the upload', async () => {
      const block = createBlock(name);
      const live = { id: 'm1', name, save: async () => ({ data: { url: LINK } }) };
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
      const tool = make({ data: { url: '' }, config: { uploader: { uploadByUrl } }, api, block, readOnly: false });
      const root = tool.render() as HTMLElement;

      enterLink(root, LINK);
      tool.removed();
      await flush();
      await flush();

      expect(updates).toEqual([{ data: { url: '' }, inScope: true }]);
      expect(scope.options).toEqual({ derivedFrom: 'm1', from: ['url'] });
    });
  });

  it('audio: a Google Drive link with no uploader saves no link', async () => {
    const block = createBlock('audio');
    const tool = new AudioTool({ data: { url: '' }, config: {}, api: createApi(), block, readOnly: false });
    const root = tool.render();

    enterLink(root, 'https://drive.google.com/file/d/1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM/view');
    await flush();

    expect(tool.save().url).toBe('');
    expect(root.querySelector('[data-role="audio-error"]')).not.toBeNull();
  });

  it('image: retry after a failed link lands the upload', async () => {
    const block = createBlock('image');
    const upload = vi.fn()
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ url: 'https://cdn/ok.png' });
    const tool = new ImageTool({ data: { url: '' }, config: { uploader: { uploadByUrl: upload } }, api: createApi(), block, readOnly: false });
    const root = tool.render();

    enterLink(root, 'https://x/ok.png');
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    await flush();

    expect(tool.save().url).toBe('https://cdn/ok.png');
  });
});
