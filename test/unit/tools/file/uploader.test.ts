import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  it('accepts any type but caps size at the 30 MiB default when maxSize is omitted', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ok');
    const result = await new Uploader({}).handleFile(makeFile('ok.bin', 'application/octet-stream', 20 * 1024 * 1024));
    expect(result.url).toBe('blob:ok');

    await expect(new Uploader({}).handleFile(makeFile('huge.bin', 'application/octet-stream', 31 * 1024 * 1024)))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' } as Partial<FileToolError>);
  });

  it('allows unlimited size when maxSize is Infinity', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:big');
    const result = await new Uploader({ maxSize: Number.POSITIVE_INFINITY })
      .handleFile(makeFile('huge.bin', 'application/octet-stream', 500_000_000));
    expect(result.url).toBe('blob:big');
  });

  it('supports per-MIME-type ceilings via an object maxSize', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:zip');
    const config = { 'application/zip': 100 * 1024 * 1024, '*': 1024 };
    const zip = await new Uploader({ maxSize: config }).handleFile(makeFile('a.zip', 'application/zip', 10 * 1024 * 1024));
    expect(zip.url).toBe('blob:zip');

    await expect(new Uploader({ maxSize: config }).handleFile(makeFile('b.txt', 'text/plain', 4096)))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' } as Partial<FileToolError>);
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

describe('Uploader — endpoint upload (handleFile)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const okJson = (body: unknown): Response =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response);

  it('POSTs the file as multipart to a string endpoint and returns the parsed result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ url: 'https://cdn/a.pdf', size: 9 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new Uploader({ endpoints: 'https://api/upload' }).handleFile(makeFile('a.pdf', 'application/pdf', 5));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(result).toEqual({ url: 'https://cdn/a.pdf', fileName: 'a.pdf', size: 9, mimeType: 'application/pdf' });
  });

  it('uses endpoints.byFile when an object is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ url: 'https://cdn/a.pdf' }));
    vi.stubGlobal('fetch', fetchMock);

    await new Uploader({ endpoints: { byFile: '/up/file', byUrl: '/up/url' } }).handleFile(makeFile());

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/up/file');
  });

  it('uses a configurable form field name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ url: 'https://cdn/a.pdf' }));
    vi.stubGlobal('fetch', fetchMock);

    await new Uploader({ endpoints: '/up', field: 'document' }).handleFile(makeFile());

    const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(body.get('document')).toBeInstanceOf(File);
  });

  it('merges additionalRequestHeaders into the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ url: 'https://cdn/a.pdf' }));
    vi.stubGlobal('fetch', fetchMock);

    await new Uploader({ endpoints: '/up', additionalRequestHeaders: { Authorization: 'Bearer x' } }).handleFile(makeFile());

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer x' });
  });

  it('throws UPLOAD_FAILED when the endpoint responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response));
    await expect(new Uploader({ endpoints: '/up' }).handleFile(makeFile()))
      .rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
  });

  it('throws UPLOAD_FAILED when the response lacks a url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ fileName: 'a.pdf' })));
    await expect(new Uploader({ endpoints: '/up' }).handleFile(makeFile()))
      .rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
  });

  it('prefers an explicit uploader.uploadByFile over the endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/custom' });

    const result = await new Uploader({ endpoints: '/up', uploader: { uploadByFile } }).handleFile(makeFile());

    expect(uploadByFile).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.url).toBe('https://cdn/custom');
  });

  it('falls back to a blob URL when no uploader and no endpoint are configured', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:none');
    const result = await new Uploader({}).handleFile(makeFile());
    expect(result.url).toBe('blob:none');
  });
});

describe('Uploader — endpoint upload (handleUrl)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const okJson = (body: unknown): Response =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response);

  it('POSTs the url as JSON to a string endpoint and returns the parsed result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new Uploader({ endpoints: 'https://api/upload' }).handleUrl('https://site.com/doc.pdf');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api/upload');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://site.com/doc.pdf' });
    expect(result).toEqual({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf' });
  });

  it('uses endpoints.byUrl when an object is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ url: 'https://cdn/doc.pdf' }));
    vi.stubGlobal('fetch', fetchMock);

    await new Uploader({ endpoints: { byFile: '/up/file', byUrl: '/up/url' } }).handleUrl('https://site.com/doc.pdf');

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/up/url');
  });

  it('does not call the file endpoint for a URL when only byFile is set (falls back to raw url)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new Uploader({ endpoints: { byFile: '/up/file' } }).handleUrl('https://site.com/doc.pdf');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ url: 'https://site.com/doc.pdf' });
  });

  it('prefers an explicit uploader.uploadByUrl over the endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/custom' });

    const result = await new Uploader({ endpoints: '/up', uploader: { uploadByUrl } }).handleUrl('https://site.com/doc.pdf');

    expect(uploadByUrl).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.url).toBe('https://cdn/custom');
  });

  it('still validates the URL scheme before hitting the endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new Uploader({ endpoints: '/up' }).handleUrl('ftp://x/y')).rejects.toMatchObject({ code: 'INVALID_URL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
