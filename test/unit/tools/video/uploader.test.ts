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
