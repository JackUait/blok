import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Uploader, VideoUploadError } from '../../../../src/tools/video/uploader';
import type { AssetKind } from '../../../../types/tools/block-tool';

const makeFile = (name: string, type: string, size: number): File =>
  new File([new Uint8Array(size)], name, { type });

/** Run a call that must reject and hand back whatever it threw. */
const rejectionOf = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to reject');
};

const asVideoError = (value: unknown): VideoUploadError => {
  if (!(value instanceof VideoUploadError)) {
    throw new Error(`expected a VideoUploadError, got ${String(value)}`);
  }

  return value;
};

/**
 * A strict editor-uploader double: `isConfigured` answers from the exact
 * `(kind, method)` pair it was asked about, so a mutant that rewrites either
 * argument makes it answer `false` instead of being swept along by a blanket
 * `() => true`.
 */
const assetsDouble = (configured: (kind: AssetKind, method?: 'uploadByFile' | 'uploadByUrl') => boolean) => ({
  uploadByFile: vi.fn(async (_file: File, _ctx: { kind: string }) => ({ url: 'https://cdn/editor-file' })),
  uploadByUrl: vi.fn(async (_url: string, _ctx: { kind: string }) => ({ url: 'https://cdn/editor-url' })),
  isConfigured: vi.fn((kind: AssetKind, method?: 'uploadByFile' | 'uploadByUrl') => configured(kind, method)),
});

describe('VideoUploadError surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('composes `${code}: ${detail}` in the message when a detail is given', async () => {
    const error = asVideoError(await rejectionOf(() => new Uploader({}).handleUrl('not a url')));

    expect(error.message).toBe('INVALID_URL: not a url');
  });

  it('names the error class and exposes its code and detail', async () => {
    const error = asVideoError(await rejectionOf(() => new Uploader({}).handleUrl('not a url')));

    expect(error.name).toBe('VideoUploadError');
    expect(error.code).toBe('INVALID_URL');
    expect(error.detail).toBe('not a url');
    expect(error).toBeInstanceOf(VideoUploadError);
  });
});

describe('video Uploader.handleUrl routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects a non-http(s) protocol as INVALID_URL carrying the protocol as detail', async () => {
    const error = asVideoError(await rejectionOf(() => new Uploader({}).handleUrl('ftp://example.com/clip.mp4')));

    expect(error.code).toBe('INVALID_URL');
    expect(error.detail).toBe('ftp:');
  });

  it('accepts a plain http:// media URL and rehosts it through the editor uploader', async () => {
    const assets = assetsDouble((kind, method) => kind === 'video' && method === 'uploadByUrl');

    await expect(new Uploader({}, assets).handleUrl('http://cdn.example/clip.mp4'))
      .resolves.toStrictEqual({ url: 'https://cdn/editor-url' });
  });

  it('prefers the editor uploader and forwards the exact upload context', async () => {
    const assets = assetsDouble((kind, method) => kind === 'video' && method === 'uploadByUrl');
    const onProgress = vi.fn();

    const result = await new Uploader({}, assets).handleUrl('https://cdn.example/clip.mp4', { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/editor-url' });
    expect(assets.uploadByUrl).toHaveBeenCalledTimes(1);
    expect(assets.uploadByUrl).toHaveBeenCalledWith('https://cdn.example/clip.mp4', {
      kind: 'video',
      tool: 'video',
      onProgress,
    });
  });

  it('lets a tool-level uploadByUrl rehost a non-media watch page', async () => {
    const uploadByUrl = vi.fn(async (_url: string) => ({ url: 'https://cdn/tool-url' }));

    const result = await new Uploader({ uploader: { uploadByUrl } }).handleUrl('https://videos.example/watch?v=42');

    expect(result).toStrictEqual({ url: 'https://cdn/tool-url' });
    expect(uploadByUrl).toHaveBeenCalledTimes(1);
  });

  it('treats an editor uploader configured for video URLs as a rehost capability', async () => {
    const assets = assetsDouble((kind, method) => kind === 'video' && method === 'uploadByUrl');

    await expect(new Uploader({}, assets).handleUrl('https://videos.example/watch?v=42'))
      .resolves.toStrictEqual({ url: 'https://cdn/editor-url' });
  });

  it('still rejects a non-media watch page when nothing can rehost it', async () => {
    const error = asVideoError(await rejectionOf(() => new Uploader({}).handleUrl('https://videos.example/watch?v=42')));

    expect(error.code).toBe('NOT_MEDIA_URL');
    expect(error.detail).toBe('https://videos.example/watch?v=42');
  });
});

describe('video Uploader.handleFile routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video');
  });
  afterEach(() => vi.restoreAllMocks());

  it('uploads through the editor uploader and forwards the exact upload context', async () => {
    const assets = assetsDouble((kind, method) => kind === 'video' && method === 'uploadByFile');
    const onProgress = vi.fn();
    const file = makeFile('a.mp4', 'video/mp4', 10);

    const result = await new Uploader({}, assets).handleFile(file, { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/editor-file' });
    expect(assets.uploadByFile).toHaveBeenCalledTimes(1);
    expect(assets.uploadByFile).toHaveBeenCalledWith(file, { kind: 'video', tool: 'video', onProgress });
  });

  it('accepts a file exactly at the size ceiling', async () => {
    await expect(new Uploader({ maxSize: 100 }).handleFile(makeFile('x.mp4', 'video/mp4', 100)))
      .resolves.toStrictEqual({ url: 'blob:video', fileName: 'x.mp4' });
  });

  it('falls back to a blob URL carrying the original filename when nothing is configured', async () => {
    await expect(new Uploader({}).handleFile(makeFile('clip.mkv', 'video/x-matroska', 10)))
      .resolves.toStrictEqual({ url: 'blob:video', fileName: 'clip.mkv' });
  });
});
