import { describe, it, expect, vi } from 'vitest';
import { Uploader } from '../../../../src/tools/audio/uploader';

const mp3 = (size: number) =>
  new File([new Uint8Array(size)], 'song.mp3', { type: 'audio/mpeg' });

describe('Audio Uploader', () => {
  it('rejects a non-audio MIME type', async () => {
    const u = new Uploader({});
    await expect(u.handleFile(new File([new Uint8Array(1)], 'x.txt', { type: 'text/plain' })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('accepts any audio/* type by default (e.g. audio/x-aiff)', async () => {
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
    const u = new Uploader({});
    await expect(u.handleFile(new File([new Uint8Array(10)], 'x.aiff', { type: 'audio/x-aiff' })))
      .resolves.toMatchObject({ url: 'blob:audio' });
    spy.mockRestore();
  });

  it('honors a restrictive types config', async () => {
    const u = new Uploader({ types: ['audio/mpeg'] });
    await expect(u.handleFile(new File([new Uint8Array(10)], 'x.flac', { type: 'audio/flac' })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('rejects a file over the max size', async () => {
    const u = new Uploader({ maxSize: 10 });
    await expect(u.handleFile(mp3(50))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('falls back to an object URL when no uploader is configured', async () => {
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
    const u = new Uploader({});
    await expect(u.handleFile(mp3(10))).resolves.toEqual({ url: 'blob:audio', fileName: 'song.mp3' });
    spy.mockRestore();
  });

  it('delegates to a custom uploadByFile', async () => {
    const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/song.mp3' });
    const u = new Uploader({ uploader: { uploadByFile } });
    await expect(u.handleFile(mp3(10))).resolves.toEqual({ url: 'https://cdn/song.mp3' });
    expect(uploadByFile).toHaveBeenCalled();
  });

  it('rejects a non-http(s) URL', async () => {
    const u = new Uploader({});
    await expect(u.handleUrl('ftp://x/y.mp3')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('passes a valid URL straight through when no uploader', async () => {
    const u = new Uploader({});
    await expect(u.handleUrl('https://x/y.mp3')).resolves.toEqual({ url: 'https://x/y.mp3' });
  });
});
