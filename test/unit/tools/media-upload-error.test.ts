import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI, BlockTool, PasteEvent } from '../../../types';
import type { MediaUploadError, UploadErrorHandler } from '../../../types/tools/upload-error';
import { ImageTool } from '../../../src/tools/image';
import { VideoTool } from '../../../src/tools/video';
import { AudioTool } from '../../../src/tools/audio';
import { FileTool } from '../../../src/tools/file';

// jsdom cannot decode audio; the audio tool reads tags and peaks after an upload.
vi.mock('../../../src/tools/audio/metadata', () => ({
  readTrackMetadata: vi.fn().mockResolvedValue({}),
  resolveCover: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/tools/audio/waveform', () => ({
  decodePeaks: vi.fn().mockResolvedValue(null),
  attachWaveform: vi.fn().mockReturnValue({ destroy: vi.fn() }),
}));

interface ToolConfig {
  maxSize?: number;
  uploader?: {
    uploadByFile?: (file: File) => Promise<{ url: string }>;
    uploadByUrl?: (url: string) => Promise<{ url: string }>;
  };
  onUploadError?: UploadErrorHandler;
}

interface Case {
  tool: 'image' | 'video' | 'audio' | 'file';
  create: (config: ToolConfig) => BlockTool;
  file: File;
  errorSelector: string;
}

const api = {
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
  blocks: { getBlockIndex: vi.fn(() => 0), insert: vi.fn() },
} as unknown as API;

const block = (name: string): BlockAPI => ({
  id: 'b1',
  name,
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const options = <C>(name: string, config: C) => ({
  data: { url: '' },
  config,
  api,
  block: block(name),
  readOnly: false,
});

const cases: Case[] = [
  {
    tool: 'image',
    create: (config) => new ImageTool(options('image', config)),
    file: new File([new Uint8Array(50)], 'big.png', { type: 'image/png' }),
    errorSelector: '[data-role="error-state"]',
  },
  {
    tool: 'video',
    create: (config) => new VideoTool(options('video', config)),
    file: new File([new Uint8Array(50)], 'big.mp4', { type: 'video/mp4' }),
    errorSelector: '[data-role="video-error"]',
  },
  {
    tool: 'audio',
    create: (config) => new AudioTool(options('audio', config)),
    file: new File([new Uint8Array(50)], 'big.mp3', { type: 'audio/mpeg' }),
    errorSelector: '[data-role="audio-error"]',
  },
  {
    tool: 'file',
    create: (config) => new FileTool(options('file', config)),
    file: new File([new Uint8Array(50)], 'big.pdf', { type: 'application/pdf' }),
    errorSelector: '[data-role="file-error"]',
  },
];

const filePaste = (file: File): PasteEvent =>
  ({ type: 'file', detail: { file } }) as unknown as PasteEvent;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const pasteInto = async (tool: BlockTool, file: File): Promise<HTMLElement> => {
  const root = tool.render() as HTMLElement;

  tool.onPaste?.(filePaste(file));
  await flush();

  return root;
};

describe.each(cases)('$tool tool — onUploadError', ({ tool: name, create, file, errorSelector }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reports a too-large file with its sizes and keeps the default message', async () => {
    const onUploadError = vi.fn<UploadErrorHandler>();
    const root = await pasteInto(create({ maxSize: 5, onUploadError }), file);

    expect(onUploadError).toHaveBeenCalledTimes(1);

    const reported: MediaUploadError = onUploadError.mock.calls[0][0];

    expect(reported).toMatchObject({
      code: 'FILE_TOO_LARGE',
      tool: name,
      message: `tools.${name}.errorFileTooLarge`,
      file,
      size: 50,
      maxSize: 5,
    });
    expect(root.querySelector(errorSelector)?.textContent).toContain(`tools.${name}.errorFileTooLarge`);
  });

  it('shows the string the handler returns instead of the default message', async () => {
    const root = await pasteInto(create({ maxSize: 5, onUploadError: () => 'Файл слишком большой' }), file);
    const error = root.querySelector(errorSelector);

    expect(error?.textContent).toContain('Файл слишком большой');
    expect(error?.textContent).not.toContain(`tools.${name}.errorFileTooLarge`);
  });

  it('goes back to the empty state with no error when the handler returns false', async () => {
    const root = await pasteInto(create({ maxSize: 5, onUploadError: () => false }), file);

    expect(root.querySelector(errorSelector)).toBeNull();
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('keeps the default message when the handler throws', async () => {
    const root = await pasteInto(create({
      maxSize: 5,
      onUploadError: () => {
        throw new Error('handler bug');
      },
    }), file);

    expect(root.querySelector(errorSelector)?.textContent).toContain(`tools.${name}.errorFileTooLarge`);
  });

  it('reports the link for a failed link upload, and false leaves no link saved', async () => {
    const serverError = new Error('404');
    const onUploadError = vi.fn<UploadErrorHandler>(() => false);
    const tool = create({ uploader: { uploadByUrl: () => Promise.reject(serverError) }, onUploadError });
    const root = tool.render() as HTMLElement;

    root.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]');
    const submit = root.querySelector<HTMLButtonElement>('[data-action="submit-url"]');

    if (!input || !submit) throw new Error('link field missing');
    input.value = 'https://x/clip';
    submit.click();
    await flush();

    expect(onUploadError).toHaveBeenCalledTimes(1);
    expect(onUploadError.mock.calls[0][0]).toMatchObject({
      code: 'UPLOAD_FAILED',
      tool: name,
      url: 'https://x/clip',
      cause: serverError,
    });
    expect(onUploadError.mock.calls[0][0].file).toBeUndefined();
    expect(root.querySelector(errorSelector)).toBeNull();
    expect((tool.save(root) as { url: string }).url).toBe('');
  });

  it('reports a rejection from the consumer uploader as UPLOAD_FAILED with the original error', async () => {
    const serverError = new Error('403');
    const onUploadError = vi.fn<UploadErrorHandler>();

    await pasteInto(create({
      uploader: { uploadByFile: () => Promise.reject(serverError) },
      onUploadError,
    }), file);

    expect(onUploadError).toHaveBeenCalledTimes(1);
    expect(onUploadError.mock.calls[0][0]).toMatchObject({
      code: 'UPLOAD_FAILED',
      tool: name,
      file,
      cause: serverError,
    });
  });
});
