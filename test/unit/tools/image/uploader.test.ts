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
});
