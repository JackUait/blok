import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Uploader } from '../../../../src/tools/file/uploader';
import { FileToolError } from '../../../../src/tools/file/errors';
import type { Uploader as AssetUploaderApi } from '../../../../types/api/uploader';
import type { UploadedAsset, UploadContext } from '../../../../types/configs/uploader';
import type { AssetKind } from '../../../../types/tools/block-tool';

type IsConfigured = (kind: AssetKind, method?: 'uploadByFile' | 'uploadByUrl') => boolean;
type FileUploadFn = (file: File, ctx: UploadContext) => Promise<UploadedAsset>;
type UrlUploadFn = (url: string, ctx: UploadContext) => Promise<UploadedAsset>;

const makeFile = (name: string, type: string, size: number): File =>
  new File([new Uint8Array(size)], name, { type });

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body } as unknown as Response);

/**
 * Editor-level uploader stub whose `isConfigured` is a real predicate, so a
 * mutant that swaps an argument literal ('file' -> '') makes it answer false.
 */
const makeAssets = (configured: IsConfigured = () => true) => {
  const uploadByFile = vi.fn<FileUploadFn>(async () => ({ url: 'https://cdn/editor-file' }));
  const uploadByUrl = vi.fn<UrlUploadFn>(async () => ({ url: 'https://cdn/editor-url' }));
  const isConfigured = vi.fn<IsConfigured>(configured);
  const api: AssetUploaderApi = { uploadByFile, uploadByUrl, isConfigured };
  return { api, uploadByFile, uploadByUrl, isConfigured };
};

const onlyFile: IsConfigured = (kind, method) => kind === 'file' && method === 'uploadByFile';
const onlyUrl: IsConfigured = (kind, method) => kind === 'file' && method === 'uploadByUrl';

describe('uploader.mutants — handleFile validation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('accepts a file whose size equals maxSize exactly (ceiling is inclusive)', async () => {
    // Kills `file.size > maxSize` -> `>=`: at the exact ceiling the original
    // still uploads, the mutant rejects.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:at-limit');

    const result = await new Uploader({ maxSize: 1024 })
      .handleFile(makeFile('exact.bin', 'application/octet-stream', 1024));

    expect(result).toStrictEqual({
      url: 'blob:at-limit',
      fileName: 'exact.bin',
      size: 1024,
      mimeType: 'application/octet-stream',
    });
  });

  it('reports the offending MIME type as the UNSUPPORTED_TYPE detail', async () => {
    // Kills `file.type || 'unknown'` -> `true` / `false` / `&&`: all three lose
    // the real MIME type in the detail.
    await expect(
      new Uploader({ types: ['application/pdf'] }).handleFile(makeFile('z.zip', 'application/zip', 10)),
    ).rejects.toThrowError(new FileToolError('UNSUPPORTED_TYPE', 'application/zip'));
  });

  it('reports "unknown" as the detail when the rejected file carries no MIME type', async () => {
    // Kills `'unknown'` -> `''`: with an empty file.type the detail becomes ''.
    await expect(
      new Uploader({ types: ['application/pdf'] }).handleFile(makeFile('blob', '', 10)),
    ).rejects.toThrowError(new FileToolError('UNSUPPORTED_TYPE', 'unknown'));
  });

  it('reports size and ceiling in the FILE_TOO_LARGE detail', async () => {
    await expect(new Uploader({ maxSize: 64 }).handleFile(makeFile('big.bin', 'application/octet-stream', 65)))
      .rejects.toThrowError(new FileToolError('FILE_TOO_LARGE', '65 > 64'));
  });

  it('caps at the 30 MiB default and honours a per-MIME object ceiling', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:zip');
    const perType = { 'application/zip': 4096, '*': 1024 };

    await expect(new Uploader({ maxSize: perType }).handleFile(makeFile('a.zip', 'application/zip', 4096)))
      .resolves.toStrictEqual({
        url: 'blob:zip',
        fileName: 'a.zip',
        size: 4096,
        mimeType: 'application/zip',
      });

    await expect(new Uploader({}).handleFile(makeFile('huge.bin', 'application/octet-stream', 30 * 1024 * 1024 + 1)))
      .rejects.toThrowError(new FileToolError('FILE_TOO_LARGE', `${30 * 1024 * 1024 + 1} > ${30 * 1024 * 1024}`));
  });
});

describe('uploader.mutants — handleFile routing', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes to the editor uploader with the exact context when both uploaders exist', async () => {
    // Kills `isConfigured('file', 'uploadByFile')` -> `isConfigured('', ...)`:
    // the predicate only answers true for the literal kind 'file'.
    const { api, uploadByFile } = makeAssets(onlyFile);
    const toolUpload = vi.fn<FileUploadFn>(async () => ({ url: 'https://cdn/tool' }));
    const onProgress = vi.fn();

    const result = await new Uploader({ uploader: { uploadByFile: toolUpload } }, api)
      .handleFile(makeFile('a.pdf', 'application/pdf', 2048), { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/editor-file' });
    expect(uploadByFile).toHaveBeenCalledWith(expect.any(File), {
      kind: 'file',
      tool: 'file',
      onProgress,
    });
    expect(toolUpload).not.toHaveBeenCalled();
  });

  it('falls back to the tool uploader when the editor uploader is not configured for files', async () => {
    const { api, uploadByFile } = makeAssets(() => false);
    const onProgress = vi.fn();
    const toolUpload = vi.fn<FileUploadFn>(async () => ({ url: 'https://cdn/tool', fileName: 'tool.pdf' }));

    const result = await new Uploader({ uploader: { uploadByFile: toolUpload } }, api)
      .handleFile(makeFile('a.pdf', 'application/pdf', 2048), { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/tool', fileName: 'tool.pdf' });
    expect(toolUpload).toHaveBeenCalledWith(expect.any(File), { onProgress });
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('uses the editor uploader when the tool declares no uploader of its own', async () => {
    // Kills the two literals in the second `isConfigured('file','uploadByFile')`
    // and the object literal handed to the editor uploader.
    const { api, uploadByFile } = makeAssets(onlyFile);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:none');
    const onProgress = vi.fn();

    const result = await new Uploader({}, api).handleFile(makeFile('a.pdf', 'application/pdf', 2048), { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/editor-file' });
    expect(uploadByFile).toHaveBeenCalledWith(expect.any(File), {
      kind: 'file',
      tool: 'file',
      onProgress,
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('prefers the endpoint over the editor uploader and posts multipart with tool defaults', async () => {
    const { api, uploadByFile } = makeAssets(onlyFile);
    const fetchMock = vi.fn(async () => okJson({ url: 'https://cdn/endpoint' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new Uploader({ endpoints: { byFile: '/up/file', byUrl: '/up/url' } }, api)
      .handleFile(makeFile('a.pdf', 'application/pdf', 7));

    expect(uploadByFile).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/up/file');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(result).toStrictEqual({
      url: 'https://cdn/endpoint',
      fileName: 'a.pdf',
      size: 7,
      mimeType: 'application/pdf',
    });
  });

  it('honours a custom form field name and additional request headers', async () => {
    // Kills the whole-object `{}` literal replacing the headers object.
    const fetchMock = vi.fn(async () => okJson({ url: 'https://cdn/endpoint' }));
    vi.stubGlobal('fetch', fetchMock);

    await new Uploader({
      endpoints: '/up',
      field: 'document',
      additionalRequestHeaders: { Authorization: 'Bearer x' },
    }).handleFile(makeFile('a.pdf', 'application/pdf', 7));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toStrictEqual({ Authorization: 'Bearer x' });
    expect((init.body as FormData).get('document')).toBeInstanceOf(File);
    expect((init.body as FormData).get('file')).toBeNull();
  });
});

describe('uploader.mutants — handleUrl routing', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns only the raw url when nothing is configured', async () => {
    const result = await new Uploader({}).handleUrl('https://site.com/doc.pdf');
    expect(result).toStrictEqual({ url: 'https://site.com/doc.pdf' });
  });

  it('rejects a non-http(s) scheme with the scheme as the detail', async () => {
    await expect(new Uploader({}).handleUrl('ftp://site.com/doc.pdf'))
      .rejects.toThrowError(new FileToolError('INVALID_URL', 'ftp:'));
  });

  it('accepts a plain http url', async () => {
    // Kills the two `'http:'` literals: either deletion makes the scheme guard
    // reject http, which the original accepts.
    const result = await new Uploader({}).handleUrl('http://site.com/doc.pdf');
    expect(result).toStrictEqual({ url: 'http://site.com/doc.pdf' });
  });

  it('rejects an unparseable string with the raw string as the detail', async () => {
    await expect(new Uploader({}).handleUrl('not a url'))
      .rejects.toThrowError(new FileToolError('INVALID_URL', 'not a url'));
  });

  it('accepts https and routes to the editor uploader with the exact context', async () => {
    // Kills `parsed.protocol !== 'http:'` -> true, the `'http:'` literal, and
    // the whole `isConfigured(...)` guard -> false.
    const { api, uploadByUrl } = makeAssets(onlyUrl);
    const onProgress = vi.fn();

    const result = await new Uploader({}, api).handleUrl('https://site.com/doc.pdf', { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/editor-url' });
    expect(uploadByUrl).toHaveBeenCalledWith('https://site.com/doc.pdf', {
      kind: 'file',
      tool: 'file',
      onProgress,
    });
  });

  it('prefers the editor uploader over the tool uploader and forwards onProgress', async () => {
    // Kills the `'uploadByUrl'` literal in isConfigured and the `{}` replacement
    // of the tool uploader's options object.
    const { api, uploadByUrl } = makeAssets(onlyUrl);
    const onProgress = vi.fn();
    const toolUpload = vi.fn<UrlUploadFn>(async () => ({ url: 'https://cdn/tool' }));

    const result = await new Uploader({ uploader: { uploadByUrl: toolUpload } }, api)
      .handleUrl('https://site.com/doc.pdf', { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/editor-url' });
    expect(uploadByUrl).toHaveBeenCalledWith('https://site.com/doc.pdf', {
      kind: 'file',
      tool: 'file',
      onProgress,
    });
    expect(toolUpload).not.toHaveBeenCalled();
  });

  it('falls back to the tool uploader when the editor uploader is not configured for urls', async () => {
    const { api, uploadByUrl } = makeAssets(() => false);
    const onProgress = vi.fn();
    const toolUpload = vi.fn<UrlUploadFn>(async () => ({ url: 'https://cdn/tool' }));

    const result = await new Uploader({ uploader: { uploadByUrl: toolUpload } }, api)
      .handleUrl('https://site.com/doc.pdf', { onProgress });

    expect(result).toStrictEqual({ url: 'https://cdn/tool' });
    expect(toolUpload).toHaveBeenCalledWith('https://site.com/doc.pdf', { onProgress });
    expect(uploadByUrl).not.toHaveBeenCalled();
  });

  it('posts the url as JSON with merged headers when only an endpoint is set', async () => {
    // Kills the JSON headers literal and the 'application/json' literal, and
    // the undefined-key guards in parseResponse (no fallbacks on this route).
    const fetchMock = vi.fn(async () => okJson({ url: 'https://cdn/stored' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new Uploader({
      endpoints: { byFile: '/up/file', byUrl: '/up/url' },
      additionalRequestHeaders: { 'X-Trace': 'abc' },
    }).handleUrl('https://site.com/doc.pdf');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/up/url');
    expect(init.method).toBe('POST');
    expect(init.headers).toStrictEqual({ 'Content-Type': 'application/json', 'X-Trace': 'abc' });
    expect(JSON.parse(init.body as string)).toStrictEqual({ url: 'https://site.com/doc.pdf' });
    expect(result).toStrictEqual({ url: 'https://cdn/stored' });
  });

  it('uses the string endpoint for urls and does not call it when only byFile is set', async () => {
    const fetchMock = vi.fn(async () => okJson({ url: 'https://cdn/stored' }));
    vi.stubGlobal('fetch', fetchMock);

    await new Uploader({ endpoints: 'https://api/upload' }).handleUrl('https://site.com/doc.pdf');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api/upload');

    fetchMock.mockClear();
    const raw = await new Uploader({ endpoints: { byFile: '/up/file' } }).handleUrl('https://site.com/doc.pdf');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(raw).toStrictEqual({ url: 'https://site.com/doc.pdf' });
  });
});

describe('uploader.mutants — parseResponse', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const upload = (body: unknown): Promise<unknown> => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson(body)));
    return new Uploader({ endpoints: '/up' }).handleFile(makeFile('a.pdf', 'application/pdf', 5));
  };

  it('rejects a non-ok response with the numeric status as the detail', async () => {
    // Kills `!response.ok` -> false (nothing thrown) and the emptied throw block.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));

    await expect(new Uploader({ endpoints: '/up' }).handleFile(makeFile('a.pdf', 'application/pdf', 5)))
      .rejects.toThrowError(new FileToolError('UPLOAD_FAILED', '503'));
  });

  it('rejects a JSON null body as malformed', async () => {
    // Kills `body === null` -> false: the null body then escapes the guard.
    await expect(upload(null)).rejects.toThrowError(new FileToolError('UPLOAD_FAILED', 'malformed response'));
  });

  it('rejects a non-object JSON body as malformed', async () => {
    // Kills `typeof body !== 'object'` -> false and the `||` -> `&&` swap.
    await expect(upload('nope')).rejects.toThrowError(new FileToolError('UPLOAD_FAILED', 'malformed response'));
  });

  it('rejects a body whose url is not a string', async () => {
    await expect(upload({ url: 42 })).rejects.toThrowError(new FileToolError('UPLOAD_FAILED', 'malformed response'));
  });

  it('rejects a body that is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } })));

    await expect(new Uploader({ endpoints: '/up' }).handleFile(makeFile('a.pdf', 'application/pdf', 5)))
      .rejects.toThrowError(new FileToolError('UPLOAD_FAILED', 'malformed response'));
  });

  it('prefers JSON metadata over the file fallbacks and omits absent fields', async () => {
    // Kills `typeof json.mimeType === 'string'` -> false and the `'string'` literal.
    const result = await upload({ url: 'https://cdn/a.pdf', fileName: 'server.pdf', size: 900, mimeType: 'application/x-custom' });

    expect(result).toStrictEqual({
      url: 'https://cdn/a.pdf',
      fileName: 'server.pdf',
      size: 900,
      mimeType: 'application/x-custom',
    });
  });

  it('surfaces only the url when the JSON body carries no optional metadata on the url route', async () => {
    // Kills the `fileName !== undefined` / `size !== undefined` /
    // `mimeType !== undefined` guards turned into always-true: those would add
    // keys holding undefined, which toStrictEqual distinguishes from absent.
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ url: 'https://cdn/stored' })));

    const result = await new Uploader({ endpoints: '/up' }).handleUrl('https://site.com/doc.pdf');

    expect(result).toStrictEqual({ url: 'https://cdn/stored' });
  });

  it('falls back to the file name, size and MIME type when the JSON omits them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ url: 'https://cdn/stored' })));

    const result = await new Uploader({ endpoints: '/up' })
      .handleFile(makeFile('local.pdf', 'application/pdf', 1234));

    expect(result).toStrictEqual({
      url: 'https://cdn/stored',
      fileName: 'local.pdf',
      size: 1234,
      mimeType: 'application/pdf',
    });
  });
});
