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

  it('delegates a Google Drive share link to uploadByUrl with the direct-download URL', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/rehosted.wav' });
    const u = new Uploader({ uploader: { uploadByUrl } });
    await expect(u.handleUrl('https://drive.google.com/file/d/1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM/view?usp=drive_link'))
      .resolves.toEqual({ url: 'https://cdn/rehosted.wav' });
    expect(uploadByUrl).toHaveBeenCalledWith(
      'https://drive.usercontent.google.com/download?id=1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM&export=download&confirm=t',
      expect.anything(),
    );
  });

  it('rejects a Google Drive share link when no uploadByUrl is configured', async () => {
    const u = new Uploader({});
    await expect(u.handleUrl('https://drive.google.com/file/d/1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM/view'))
      .rejects.toMatchObject({ code: 'GOOGLE_DRIVE_NEEDS_UPLOADER' });
  });

  it('rewrites a Dropbox share link to the direct-content host without an uploader', async () => {
    const u = new Uploader({});
    await expect(u.handleUrl('https://www.dropbox.com/scl/fi/abc/song.mp3?rlkey=k&dl=0'))
      .resolves.toEqual({ url: 'https://dl.dropboxusercontent.com/scl/fi/abc/song.mp3?rlkey=k' });
  });

  it('rewrites a GitHub blob link to the raw host without an uploader', async () => {
    const u = new Uploader({});
    await expect(u.handleUrl('https://github.com/user/repo/blob/main/song.mp3'))
      .resolves.toEqual({ url: 'https://raw.githubusercontent.com/user/repo/main/song.mp3' });
  });

  it('passes the normalized direct link to uploadByUrl when configured', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/rehosted.mp3' });
    const u = new Uploader({ uploader: { uploadByUrl } });
    await expect(u.handleUrl('https://www.dropbox.com/s/abc/song.mp3?dl=0'))
      .resolves.toEqual({ url: 'https://cdn/rehosted.mp3' });
    expect(uploadByUrl).toHaveBeenCalledWith(
      'https://dl.dropboxusercontent.com/s/abc/song.mp3',
      expect.anything(),
    );
  });
});
