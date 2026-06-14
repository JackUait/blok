import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Uploader } from '../../../../src/tools/file/uploader';
import type { FileToolError } from '../../../../src/tools/file/errors';

const makeFile = (name = 'doc.pdf', type = 'application/pdf', size = 1024): File => {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
};

describe('Uploader.handleFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a blob URL and file metadata when no uploader is configured', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:abc');
    const result = await new Uploader({}).handleFile(makeFile('a.pdf', 'application/pdf', 2048));
    expect(result).toEqual({ url: 'blob:abc', fileName: 'a.pdf', size: 2048, mimeType: 'application/pdf' });
  });

  it('delegates to config.uploader.uploadByFile when present', async () => {
    const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/a.pdf' });
    const result = await new Uploader({ uploader: { uploadByFile } }).handleFile(makeFile());
    expect(uploadByFile).toHaveBeenCalledOnce();
    expect(result.url).toBe('https://cdn/a.pdf');
  });

  it('forwards onProgress to the consumer uploader', async () => {
    const uploadByFile = vi.fn().mockImplementation(async (_f: File, ctx?: { onProgress?: (p: number) => void }) => {
      ctx?.onProgress?.(42);
      return { url: 'https://cdn/a.pdf' };
    });
    const onProgress = vi.fn();
    await new Uploader({ uploader: { uploadByFile } }).handleFile(makeFile(), { onProgress });
    expect(onProgress).toHaveBeenCalledWith(42);
  });

  it('throws UNSUPPORTED_TYPE when the type is not in the allowlist', async () => {
    await expect(new Uploader({ types: ['application/pdf'] }).handleFile(makeFile('x.zip', 'application/zip')))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' } as Partial<FileToolError>);
  });

  it('throws FILE_TOO_LARGE when the file exceeds maxSize', async () => {
    await expect(new Uploader({ maxSize: 10 }).handleFile(makeFile('x.pdf', 'application/pdf', 100)))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' } as Partial<FileToolError>);
  });

  it('accepts any type and any size when types/maxSize are omitted (no paywall)', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:big');
    const result = await new Uploader({}).handleFile(makeFile('huge.bin', 'application/octet-stream', 50_000_000));
    expect(result.url).toBe('blob:big');
  });
});

describe('Uploader.handleUrl', () => {
  it('returns the URL directly when no uploader is configured', async () => {
    const result = await new Uploader({}).handleUrl('https://site.com/doc.pdf');
    expect(result).toEqual({ url: 'https://site.com/doc.pdf' });
  });

  it('delegates to config.uploader.uploadByUrl when present', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf' });
    const result = await new Uploader({ uploader: { uploadByUrl } }).handleUrl('https://site.com/doc.pdf');
    expect(uploadByUrl).toHaveBeenCalledOnce();
    expect(result.fileName).toBe('doc.pdf');
  });

  it('throws INVALID_URL for a non-http(s) URL', async () => {
    await expect(new Uploader({}).handleUrl('ftp://x/y')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('throws INVALID_URL for an unparseable string', async () => {
    await expect(new Uploader({}).handleUrl('not a url')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });
});
