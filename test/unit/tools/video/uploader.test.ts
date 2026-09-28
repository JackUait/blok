import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Uploader } from '../../../../src/tools/video/uploader';

const makeFile = (name: string, type: string, size: number): File =>
  new File([new Uint8Array(size)], name, { type });

describe('video Uploader.handleFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video');
  });
  afterEach(() => vi.restoreAllMocks());

  it('throws UNSUPPORTED_TYPE for non-video MIME', async () => {
    await expect(new Uploader({}).handleFile(makeFile('x.png', 'image/png', 10)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('accepts any video/* type by default (e.g. video/x-matroska)', async () => {
    await expect(new Uploader({}).handleFile(makeFile('x.mkv', 'video/x-matroska', 10)))
      .resolves.toMatchObject({ url: 'blob:video' });
  });

  it('honors a restrictive types config', async () => {
    await expect(new Uploader({ types: ['video/mp4'] }).handleFile(makeFile('x.webm', 'video/webm', 10)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('keeps a 100 MiB default ceiling (larger than the shared 30 MiB media default)', async () => {
    const under = makeFile('ok.mp4', 'video/mp4', 90 * 1024 * 1024);
    const over = makeFile('big.mp4', 'video/mp4', 110 * 1024 * 1024);

    await expect(new Uploader({}).handleFile(under)).resolves.toMatchObject({ url: 'blob:video' });
    await expect(new Uploader({}).handleFile(over)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('reports the offending and limit bytes in the FILE_TOO_LARGE detail', async () => {
    await expect(new Uploader({ maxSize: 100 }).handleFile(makeFile('x.mp4', 'video/mp4', 250)))
      .rejects.toMatchObject({ detail: '250 > 100' });
  });

  it('supports per-MIME-type ceilings via an object maxSize', async () => {
    const config = { 'video/mp4': 200 * 1024 * 1024, '*': 1024 };
    await expect(new Uploader({ maxSize: config }).handleFile(makeFile('a.mp4', 'video/mp4', 150 * 1024 * 1024)))
      .resolves.toMatchObject({ url: 'blob:video' });
    await expect(new Uploader({ maxSize: config }).handleFile(makeFile('b.webm', 'video/webm', 4096)))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
});

describe('editor-level uploader fallback', () => {
  const assetsApi = (over = {}) => ({
    uploadByFile: vi.fn(async () => ({ url: 'https://cdn/editor-file' })),
    uploadByUrl: vi.fn(async () => ({ url: 'https://cdn/editor-url' })),
    isConfigured: vi.fn(() => true),
    ...over,
  });

  it('uploads through the editor-level uploader when the tool declares none', async () => {
    const assets = assetsApi();
    const u = new Uploader({}, assets);

    await expect(u.handleFile(makeFile('a.mp4', 'video/mp4', 10)))
      .resolves.toMatchObject({ url: 'https://cdn/editor-file' });
    expect(assets.uploadByFile).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ kind: 'video', tool: 'video' })
    );
  });

  it('still falls back to a blob URL when nothing is configured', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video');
    const assets = assetsApi({ isConfigured: vi.fn(() => false) });

    await expect(new Uploader({}, assets).handleFile(makeFile('a.mp4', 'video/mp4', 10)))
      .resolves.toMatchObject({ url: 'blob:video' });
  });
});

describe('video Uploader.uploadVariant', () => {
  const file = (): File => new File([new Uint8Array(4)], 'clip.webm', { type: 'video/webm' });
  const variant = { mimeType: 'video/webm; codecs="vp9, opus"', role: 'variant' as const };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('sends the rendition through the editor uploader with its kind and variant', async () => {
    const uploadByFile = vi.fn(async () => ({ url: 'https://cdn/clip.webm' }));
    const assets = { isConfigured: () => true, uploadByFile, uploadByUrl: vi.fn() };

    await new Uploader({}, assets).uploadVariant(file(), variant);

    expect(uploadByFile).toHaveBeenCalledWith(expect.any(File), { kind: 'video', tool: 'video', variant });
  });

  it('falls back to the tool uploader, then to a blob URL', async () => {
    const uploadByFile = vi.fn(async () => ({ url: 'https://cdn/tool.webm' }));

    await expect(new Uploader({ uploader: { uploadByFile } }).uploadVariant(file(), variant))
      .resolves.toEqual({ url: 'https://cdn/tool.webm' });

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:variant');
    await expect(new Uploader({}).uploadVariant(file(), variant)).resolves.toEqual({ url: 'blob:variant' });
  });
});
