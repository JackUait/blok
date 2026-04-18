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
});
