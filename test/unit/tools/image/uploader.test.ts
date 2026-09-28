import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../../src/tools/image/compress', () => ({
  compressImage: vi.fn(async () => null),
}));

vi.mock('../../../../src/components/media-variants/image-variants', () => ({
  produceImageVariants: vi.fn(async () => []),
}));

import type { AssetKind } from '../../../../types/tools/block-tool';
import type { UploadContext } from '../../../../types/configs/uploader';
import {
  collectAssetUploaderSources,
  hasAssetUploader,
  uploadAssetFile,
  uploadAssetUrl,
} from '../../../../src/components/utils/asset-uploader';
import { Uploader } from '../../../../src/tools/image/uploader';
import { compressImage } from '../../../../src/tools/image/compress';
import { produceImageVariants } from '../../../../src/components/media-variants/image-variants';

const compressImageMock = vi.mocked(compressImage);
const produceMock = vi.mocked(produceImageVariants);

describe('Uploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  });
  afterEach(() => vi.restoreAllMocks());

  describe('handleFile type validation', () => {
    const makeFile = (name: string, type: string): File =>
      new File([new Uint8Array(10)], name, { type });

    it('accepts any image/* type by default (e.g. image/avif)', async () => {
      await expect(new Uploader({}).handleFile(makeFile('x.avif', 'image/avif')))
        .resolves.toMatchObject({ url: 'blob:test' });
    });

    it('still rejects out-of-family types by default', async () => {
      await expect(new Uploader({}).handleFile(makeFile('x.pdf', 'application/pdf')))
        .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    });

    it('honors a restrictive types config', async () => {
      await expect(new Uploader({ types: ['image/png'] }).handleFile(makeFile('x.jpg', 'image/jpeg')))
        .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    });
  });

  describe('handleUrl validation', () => {
    it('throws INVALID_URL on garbage input', async () => {
      const u = new Uploader({});
      await expect(u.handleUrl('not a url')).rejects.toMatchObject({
        name: 'ImageError',
        code: 'INVALID_URL',
      });
    });

    it('throws INVALID_URL on non-http(s) protocol', async () => {
      const u = new Uploader({});
      await expect(u.handleUrl('ftp://example.com/x.png')).rejects.toMatchObject({
        code: 'INVALID_URL',
      });
    });

    it('returns the URL unchanged when no uploadByUrl is configured', async () => {
      const u = new Uploader({});
      await expect(u.handleUrl('https://example.com/x.png')).resolves.toEqual({
        url: 'https://example.com/x.png',
      });
    });
  });

  describe('handleUrl data: URL support', () => {
    /**
     * Google Docs sometimes embeds images in clipboard HTML as
     * `<img src="data:image/png;base64,…">` inline data URLs rather than
     * hosted URLs.  These must be accepted.
     */
    const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZmUkA0AAAAASUVORK5CYII=';

    it('accepts data:image/*;base64 URL when no uploader configured', async () => {
      const u = new Uploader({});
      await expect(u.handleUrl(DATA_URL)).resolves.toEqual({ url: DATA_URL });
    });

    it('passes data: URL to uploadByUrl when configured', async () => {
      const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/rehosted.png' });
      const u = new Uploader({ uploader: { uploadByUrl } });

      await expect(u.handleUrl(DATA_URL)).resolves.toEqual({ url: 'https://cdn/rehosted.png' });
      expect(uploadByUrl).toHaveBeenCalledWith(DATA_URL, expect.any(Object));
    });

    it('converts data: URL to File and routes to uploadByFile when only uploadByFile is configured', async () => {
      const uploadByFile = vi.fn().mockImplementation(async (file: File) => ({
        url: `https://cdn/${file.name}`,
        fileName: file.name,
      }));
      const u = new Uploader({ uploader: { uploadByFile } });

      const result = await u.handleUrl(DATA_URL);
      expect(uploadByFile).toHaveBeenCalledOnce();
      const [file] = uploadByFile.mock.calls[0] as [File];
      expect(file).toBeInstanceOf(File);
      expect(file.type).toBe('image/png');
      expect(result.url).toMatch(/^https:\/\/cdn\//);
    });

    it('still rejects non-image data: URLs (e.g. data:text/plain)', async () => {
      const u = new Uploader({});
      await expect(u.handleUrl('data:text/plain;base64,aGVsbG8=')).rejects.toMatchObject({
        code: 'INVALID_URL',
      });
    });
  });

  describe('handleFile validation', () => {
    const makeFile = (name: string, type: string, size: number): File => {
      const blob = new Blob([new Uint8Array(size)], { type });

      return new File([blob], name, { type });
    };

    it('throws UNSUPPORTED_TYPE for non-image MIME', async () => {
      const u = new Uploader({});
      const file = makeFile('x.pdf', 'application/pdf', 10);

      await expect(u.handleFile(file)).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    });

    it('throws FILE_TOO_LARGE when size exceeds maxSize', async () => {
      const u = new Uploader({ maxSize: 100 });
      const file = makeFile('x.png', 'image/png', 200);

      await expect(u.handleFile(file)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('defaults to a 30 MiB ceiling when maxSize is omitted', async () => {
      const u = new Uploader({});
      const under = makeFile('ok.png', 'image/png', 20 * 1024 * 1024);
      const over = makeFile('big.png', 'image/png', 31 * 1024 * 1024);

      await expect(u.handleFile(under)).resolves.toMatchObject({ url: expect.stringMatching(/^blob:/) });
      await expect(u.handleFile(over)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('reports the offending and limit bytes in the FILE_TOO_LARGE detail', async () => {
      const u = new Uploader({ maxSize: 100 });
      const file = makeFile('x.png', 'image/png', 250);

      await expect(u.handleFile(file)).rejects.toMatchObject({ detail: '250 > 100' });
    });

    it('supports per-MIME-type ceilings via an object maxSize', async () => {
      const u = new Uploader({ maxSize: { 'image/gif': 50 * 1024 * 1024, '*': 1024 } });
      const gif = makeFile('a.gif', 'image/gif', 10 * 1024 * 1024);
      const png = makeFile('b.png', 'image/png', 4096);

      await expect(u.handleFile(gif)).resolves.toMatchObject({ url: expect.stringMatching(/^blob:/) });
      await expect(u.handleFile(png)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('accepts custom types config and falls back to blob URL', async () => {
      const u = new Uploader({ types: ['image/avif'] });
      const png = makeFile('x.png', 'image/png', 10);

      await expect(u.handleFile(png)).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
      const avif = makeFile('y.avif', 'image/avif', 10);

      await expect(u.handleFile(avif)).resolves.toMatchObject({
        url: expect.stringMatching(/^blob:/),
        fileName: 'y.avif',
      });
    });
  });

  describe('progress reporting', () => {
    /**
     * Progress events from the consumer's upload implementation must reach
     * the UI so the upload bar moves.  Without forwarding, the bar stays
     * at 0% until the upload completes — observed when pasting images
     * from Google Docs through a real (non-blob) uploader.
     */
    it('forwards onProgress callback into uploadByFile so consumer can report bytes uploaded', async () => {
      const uploadByFile = vi.fn().mockImplementation(
        async (_file: File, ctx?: { onProgress?: (percent: number) => void }) => {
          ctx?.onProgress?.(25);
          ctx?.onProgress?.(75);
          return { url: 'https://cdn/x.png' };
        }
      );
      const onProgress = vi.fn();
      const u = new Uploader({ uploader: { uploadByFile } });
      const file = new File([new Uint8Array(10)], 'x.png', { type: 'image/png' });

      await u.handleFile(file, { onProgress });
      expect(uploadByFile).toHaveBeenCalledWith(file, expect.objectContaining({
        onProgress: expect.any(Function),
      }));
      expect(onProgress).toHaveBeenCalledWith(25);
      expect(onProgress).toHaveBeenCalledWith(75);
    });

    it('forwards onProgress callback into uploadByUrl so consumer can report progress', async () => {
      const uploadByUrl = vi.fn().mockImplementation(
        async (_url: string, ctx?: { onProgress?: (percent: number) => void }) => {
          ctx?.onProgress?.(50);
          return { url: 'https://cdn/x.png' };
        }
      );
      const onProgress = vi.fn();
      const u = new Uploader({ uploader: { uploadByUrl } });

      await u.handleUrl('https://orig/x.png', { onProgress });
      expect(uploadByUrl).toHaveBeenCalledWith('https://orig/x.png', expect.objectContaining({
        onProgress: expect.any(Function),
      }));
      expect(onProgress).toHaveBeenCalledWith(50);
    });

    it('forwards onProgress when data: URL is rerouted to uploadByFile', async () => {
      const uploadByFile = vi.fn().mockImplementation(
        async (_file: File, ctx?: { onProgress?: (percent: number) => void }) => {
          ctx?.onProgress?.(40);
          return { url: 'https://cdn/x.png', fileName: 'pasted-image.png' };
        }
      );
      const onProgress = vi.fn();
      const u = new Uploader({ uploader: { uploadByFile } });
      const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZmUkA0AAAAASUVORK5CYII=';

      await u.handleUrl(DATA_URL, { onProgress });
      expect(uploadByFile).toHaveBeenCalledOnce();
      expect(onProgress).toHaveBeenCalledWith(40);
    });
  });

  describe('compression', () => {
    const makeFile = (size = 500 * 1024): File => {
      const file = new File([new Uint8Array(8)], 'photo.jpg', { type: 'image/jpeg' });

      Object.defineProperty(file, 'size', { value: size });

      return file;
    };

    beforeEach(() => compressImageMock.mockResolvedValue(null));

    it('uploads the compressed file instead of the original', async () => {
      const smaller = new File([new Uint8Array(4)], 'photo.jpg', { type: 'image/jpeg' });

      compressImageMock.mockResolvedValue(smaller);
      const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/x.jpg' });

      await new Uploader({ uploader: { uploadByFile } }).handleFile(makeFile());

      expect(uploadByFile).toHaveBeenCalledWith(smaller, expect.any(Object));
    });

    it('uploads the original bytes untouched when compression declines', async () => {
      const original = makeFile();
      const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/x.jpg' });

      await new Uploader({ uploader: { uploadByFile } }).handleFile(original);

      expect(uploadByFile).toHaveBeenCalledWith(original, expect.any(Object));
    });

    it('passes the tool config through, so compress: false disables it', async () => {
      await new Uploader({ compress: false }).handleFile(makeFile());

      expect(compressImageMock).toHaveBeenCalledWith(expect.any(File), false);
    });

    it('passes an opt-in compression config through', async () => {
      const compress = { format: 'webp' as const, quality: 0.7 };

      await new Uploader({ compress }).handleFile(makeFile());

      expect(compressImageMock).toHaveBeenCalledWith(expect.any(File), compress);
    });

    it('validates the original file, not the compressed one — maxSize stays predictable', async () => {
      const uploadByFile = vi.fn();

      await expect(new Uploader({ maxSize: 100, uploader: { uploadByFile } }).handleFile(makeFile()))
        .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
      expect(compressImageMock).not.toHaveBeenCalled();
      expect(uploadByFile).not.toHaveBeenCalled();
    });

    it('reports the compressed size on the blob-URL fallback path too', async () => {
      const smaller = new File([new Uint8Array(4)], 'photo.webp', { type: 'image/webp' });

      compressImageMock.mockResolvedValue(smaller);

      await expect(new Uploader({}).handleFile(makeFile()))
        .resolves.toEqual({ url: 'blob:test', fileName: 'photo.webp' });
      expect(URL.createObjectURL).toHaveBeenCalledWith(smaller);
    });

    it('compresses a pasted data: URL image that is routed to uploadByFile', async () => {
      const smaller = new File([new Uint8Array(4)], 'pasted-image.webp', { type: 'image/webp' });

      compressImageMock.mockResolvedValue(smaller);
      const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/x.webp' });
      const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZmUkA0AAAAASUVORK5CYII=';

      await new Uploader({ uploader: { uploadByFile } }).handleUrl(DATA_URL);

      expect(uploadByFile).toHaveBeenCalledWith(smaller, expect.any(Object));
    });
  });

  describe('custom uploader integration', () => {
    it('routes handleFile through config.uploader.uploadByFile when present', async () => {
      const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/x.png', fileName: 'x.png' });
      const u = new Uploader({ uploader: { uploadByFile } });
      const file = new File([new Uint8Array(10)], 'x.png', { type: 'image/png' });

      await expect(u.handleFile(file)).resolves.toEqual({ url: 'https://cdn/x.png', fileName: 'x.png' });
      expect(uploadByFile).toHaveBeenCalledWith(file, expect.any(Object));
    });

    it('routes handleUrl through config.uploader.uploadByUrl when present', async () => {
      const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/proxied.png' });
      const u = new Uploader({ uploader: { uploadByUrl } });

      await expect(u.handleUrl('https://orig/x.png')).resolves.toEqual({ url: 'https://cdn/proxied.png' });
      expect(uploadByUrl).toHaveBeenCalledWith('https://orig/x.png', expect.any(Object));
    });

    it('propagates rejection from custom uploader', async () => {
      const uploadByFile = vi.fn().mockRejectedValue(new Error('S3 down'));
      const u = new Uploader({ uploader: { uploadByFile } });
      const file = new File([new Uint8Array(10)], 'x.png', { type: 'image/png' });

      await expect(u.handleFile(file)).rejects.toThrow('S3 down');
    });
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

    await expect(u.handleFile(new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })))
      .resolves.toMatchObject({ url: 'https://cdn/editor-file' });
    expect(assets.uploadByFile).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ kind: 'image', tool: 'image' })
    );
  });

  // Driven through the real resolver, not a stub: the tool's uploader wins
  // because `api.uploader` files it under the kind this tool owns and prefers
  // it there. A stubbed `assets` could not tell that apart from the tool
  // skipping the API, which is how every tool-level upload used to escape the
  // orphan sweep.
  it("keeps the tool's own uploader authoritative over the editor-level one", async () => {
    const tool = { uploadByFile: vi.fn().mockResolvedValue({ url: 'https://cdn/tool' }) };
    const editor = { uploadByFile: vi.fn().mockResolvedValue({ url: 'https://cdn/editor-file' }) };
    const sources = collectAssetUploaderSources([ { assetKind: 'image',
      settings: { uploader: tool } } ], editor);
    const assets = {
      uploadByFile: (file: File, ctx: UploadContext) => uploadAssetFile(file, ctx, sources),
      uploadByUrl: (url: string, ctx: UploadContext) => uploadAssetUrl(url, ctx, sources),
      isConfigured: (kind: AssetKind, method?: 'uploadByFile' | 'uploadByUrl') =>
        hasAssetUploader(kind, sources, method),
    };
    const u = new Uploader({ uploader: tool }, assets);

    await expect(u.handleFile(new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })))
      .resolves.toMatchObject({ url: 'https://cdn/tool' });
    expect(editor.uploadByFile).not.toHaveBeenCalled();
  });

  it('still falls back to a blob URL when nothing is configured', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const assets = assetsApi({ isConfigured: vi.fn(() => false) });
    const u = new Uploader({}, assets);

    await expect(u.handleFile(new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })))
      .resolves.toMatchObject({ url: 'blob:test' });
    expect(assets.uploadByFile).not.toHaveBeenCalled();
  });

  describe('handleFile with media formats', () => {
    const photo = (): File => new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });

    beforeEach(() => {
      vi.clearAllMocks();
      compressImageMock.mockResolvedValue(null);
      produceMock.mockResolvedValue([]);
    });

    it('uploads every rendition and returns them as variants', async () => {
      produceMock.mockResolvedValueOnce([
        { file: new Blob(['a'], { type: 'image/avif' }), mimeType: 'image/avif' },
        { file: new Blob(['j'], { type: 'image/jpeg' }), mimeType: 'image/jpeg' },
      ]);
      const uploadByFile = vi.fn(async (file: File) => ({ url: `https://cdn/${file.name}` }));
      const uploader = new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { image: ['avif', 'jpeg'] } }));

      const result = await uploader.handleFile(photo());

      expect(result.url).toBe('https://cdn/photo.jpg');
      expect(result.variants?.map((v) => v.mimeType)).toEqual(['image/avif', 'image/jpeg']);
      expect(compressImageMock).not.toHaveBeenCalled();
    });

    it('passes the variant to the editor-level uploader context', async () => {
      produceMock.mockResolvedValueOnce([{ file: new Blob(['j'], { type: 'image/jpeg' }), mimeType: 'image/jpeg' }]);
      const seen: UploadContext[] = [];
      const assets = {
        isConfigured: (kind: AssetKind) => kind === 'image',
        uploadByFile: vi.fn(async (_f: File, ctx: UploadContext) => {
          seen.push(ctx);

          return { url: 'u' };
        }),
        uploadByUrl: vi.fn(),
      };
      const uploader = new Uploader({}, assets, () => ({ formats: { image: ['jpeg'] } }));

      await uploader.handleFile(photo());

      expect(seen[0]).toMatchObject({ kind: 'image', tool: 'image', variant: { mimeType: 'image/jpeg', role: 'variant' } });
    });

    it('uses the host convert hook, and the built-in converter when it returns null', async () => {
      const convert = vi.fn(async (): Promise<Array<{ file: Blob; mimeType: string }> | null> =>
        [{ file: new Blob(['w'], { type: 'image/webp' }), mimeType: 'image/webp' }]);
      const uploadByFile = vi.fn(async (file: File) => ({ url: file.name }));
      const uploader = new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { image: ['webp'] }, convert }));

      const result = await uploader.handleFile(photo());

      expect(convert).toHaveBeenCalledWith(expect.any(File), ['webp'], expect.objectContaining({ kind: 'image' }));
      expect(produceMock).not.toHaveBeenCalled();
      expect(result.variants?.map((v) => v.mimeType)).toEqual(['image/webp', 'image/jpeg']);

      convert.mockResolvedValueOnce(null);
      await uploader.handleFile(photo());
      expect(produceMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to the built-in converter when the hook throws', async () => {
      const convert = vi.fn(async () => {
        throw new Error('boom');
      });
      const uploader = new Uploader({ uploader: { uploadByFile: vi.fn(async () => ({ url: 'u' })) } }, undefined, () => ({ formats: { image: ['jpeg'] }, convert }));

      await expect(uploader.handleFile(photo())).resolves.toMatchObject({ url: 'u' });
      expect(produceMock).toHaveBeenCalledTimes(1);
    });

    it('uploads the compressed original alone, as today, when no format could be made', async () => {
      const compressed = new File([new Uint8Array(3)], 'photo.jpg', { type: 'image/jpeg' });
      const uploadByFile = vi.fn(async (_file: File) => ({ url: 'u' }));

      compressImageMock.mockResolvedValueOnce(compressed);
      const result = await new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { image: ['avif'] } })).handleFile(photo());

      expect(uploadByFile).toHaveBeenCalledTimes(1);
      expect(uploadByFile.mock.calls[0][0]).toBe(compressed);
      expect(result.variants).toBeUndefined();
    });

    it('compresses the original when it is kept as the fallback', async () => {
      const compressed = new File([new Uint8Array(3)], 'photo.jpg', { type: 'image/jpeg' });
      const uploaded: File[] = [];
      const uploadByFile = vi.fn(async (file: File) => {
        uploaded.push(file);

        return { url: file.name };
      });

      produceMock.mockResolvedValueOnce([{ file: new Blob(['w'], { type: 'image/webp' }), mimeType: 'image/webp' }]);
      compressImageMock.mockResolvedValueOnce(compressed);
      await new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { image: ['webp'] } })).handleFile(photo());

      expect(uploaded).toContain(compressed);
    });

    it('uses the built-in converter when a JavaScript hook returns nothing', async () => {
      const convert = vi.fn(async () => undefined as unknown as null);
      const uploader = new Uploader({ uploader: { uploadByFile: vi.fn(async () => ({ url: 'u' })) } }, undefined, () => ({ formats: { image: ['jpeg'] }, convert }));

      await expect(uploader.handleFile(photo())).resolves.toMatchObject({ url: 'u' });
      expect(produceMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the old single-file path when no image formats are set', async () => {
      const uploadByFile = vi.fn(async () => ({ url: 'u' }));
      const result = await new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { video: ['mp4'] } })).handleFile(photo());

      expect(result.variants).toBeUndefined();
      expect(compressImageMock).toHaveBeenCalledTimes(1);
      expect(produceMock).not.toHaveBeenCalled();
    });
  });
});
