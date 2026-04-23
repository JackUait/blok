import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Uploader } from '../../../../src/tools/image/uploader';

describe('Uploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  });
  afterEach(() => vi.restoreAllMocks());

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
