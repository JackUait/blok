import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokUploader } from '../../../../types/configs/uploader';
import { createFetchUploader } from '../../../../src/components/utils/fetch-uploader';
import * as xhr from '../../../../src/components/utils/upload-xhr';

function requireUploadByFile(uploader: BlokUploader): NonNullable<BlokUploader['uploadByFile']> {
  const { uploadByFile } = uploader;

  if (!uploadByFile) {
    throw new Error('expected uploadByFile to be defined');
  }

  return uploadByFile;
}

function requireUploadByUrl(uploader: BlokUploader): NonNullable<BlokUploader['uploadByUrl']> {
  const { uploadByUrl } = uploader;

  if (!uploadByUrl) {
    throw new Error('expected uploadByUrl to be defined');
  }

  return uploadByUrl;
}

function requireDelete(uploader: BlokUploader): NonNullable<BlokUploader['delete']> {
  const remove = uploader.delete;

  if (!remove) {
    throw new Error('expected delete to be defined');
  }

  return remove;
}

describe('createFetchUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts multipart to <baseUrl>/upload and returns the parsed url', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"url":"https://cdn.example.com/a.png","fileName":"a.png"}',
    });

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com' });
    const result = await requireUploadByFile(uploader)(new File(['x'], 'a.png', { type: 'image/png' }), {
      kind: 'image',
    });

    expect(result).toEqual({ url: 'https://cdn.example.com/a.png', fileName: 'a.png' });
    expect(spy.mock.calls[0][0].url).toBe('https://blok.example.com/upload');
    expect(spy.mock.calls[0][0].method).toBe('POST');
  });

  it('sends the file under the default "file" multipart field', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"url":"u"}' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com' });
    await requireUploadByFile(uploader)(file, { kind: 'image' });

    const body = spy.mock.calls[0][0].body as FormData;
    expect(body.get('file')).toBe(file);
  });

  it('sends the file under a custom field name from the field option', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"url":"u"}' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com', field: 'upload' });
    await requireUploadByFile(uploader)(file, { kind: 'image' });

    const body = spy.mock.calls[0][0].body as FormData;
    expect(body.get('upload')).toBe(file);
    expect(body.get('file')).toBeNull();
  });

  it('strips a trailing slash from baseUrl instead of producing a double slash', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"url":"u"}' });

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com/' });

    await requireUploadByFile(uploader)(new File(['x'], 'a.png'), { kind: 'image' });

    expect(spy.mock.calls[0][0].url).toBe('https://blok.example.com/upload');
  });

  it('resolves headers from a function on every call', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"url":"u"}' });
    const headers = vi.fn().mockResolvedValue({ Authorization: 'Bearer pass-1' });

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com', headers });
    const uploadByFile = requireUploadByFile(uploader);

    await uploadByFile(new File(['x'], 'a.png'), { kind: 'image' });
    await uploadByFile(new File(['y'], 'b.png'), { kind: 'image' });

    expect(headers).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0].headers).toEqual({ Authorization: 'Bearer pass-1' });
  });

  it('posts JSON to <baseUrl>/upload-by-url for uploadByUrl', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({ url: 'https://cdn.example.com/rehosted.png' }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com' });
    const result = await requireUploadByUrl(uploader)('https://elsewhere.example.net/i.png', { kind: 'image' });

    expect(result.url).toBe('https://cdn.example.com/rehosted.png');
    expect(fetchMock.mock.calls[0][0]).toBe('https://blok.example.com/upload-by-url');

    const body = fetchMock.mock.calls[0][1]?.body;

    if (typeof body !== 'string') {
      throw new Error('expected a string body');
    }

    expect(JSON.parse(body)).toEqual({ url: 'https://elsewhere.example.net/i.png' });

    vi.unstubAllGlobals();
  });

  it('does not let caller headers override the JSON Content-Type on upload-by-url', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({ url: 'https://cdn.example.com/rehosted.png' }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const uploader = createFetchUploader({
      baseUrl: 'https://blok.example.com',
      headers: { 'Content-Type': 'text/plain' },
    });

    await requireUploadByUrl(uploader)('https://elsewhere.example.net/i.png', { kind: 'image' });

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');

    vi.unstubAllGlobals();
  });

  it('wraps a malformed upload-by-url response in the same friendly error as the file path', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, text: async () => 'not json' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com' });

    await expect(
      requireUploadByUrl(uploader)('https://elsewhere.example.net/i.png', { kind: 'image' })
    ).rejects.toThrow(/malformed response/);

    vi.unstubAllGlobals();
  });

  it('throws with the status when the endpoint rejects the upload', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 413, text: 'file too large' });

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com' });

    await expect(requireUploadByFile(uploader)(new File(['x'], 'a.png'), { kind: 'image' })).rejects.toThrow(
      'Fetch endpoint upload failed with status 413'
    );
  });

  it('throws when the endpoint answers 200 with a body carrying no url', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"ok":true}' });

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com' });

    await expect(requireUploadByFile(uploader)(new File(['x'], 'a.png'), { kind: 'image' })).rejects.toThrow(/url/i);
  });

  it('posts JSON to <baseUrl>/delete with the url and the resolved headers', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const uploader = createFetchUploader({
      baseUrl: 'https://blok.example.com',
      headers: { Authorization: 'Bearer pass-1' },
    });

    await requireDelete(uploader)('https://cdn.example.com/a.png', { kind: 'image', tool: 'image' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://blok.example.com/delete');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;

    expect(headers.Authorization).toBe('Bearer pass-1');
    expect(headers['Content-Type']).toBe('application/json');

    const body = fetchMock.mock.calls[0][1]?.body;

    if (typeof body !== 'string') {
      throw new Error('expected a string body');
    }

    expect(JSON.parse(body)).toEqual({ url: 'https://cdn.example.com/a.png' });
  });

  it('resolves the headers function on every delete, so each request carries a live pass', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const headers = vi.fn().mockResolvedValue({ Authorization: 'Bearer pass-1' });
    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com', headers });
    const remove = requireDelete(uploader);

    await remove('https://cdn.example.com/a.png', { kind: 'image' });
    await remove('https://cdn.example.com/b.png', { kind: 'image' });

    expect(headers).toHaveBeenCalledTimes(2);
  });

  it('throws with the status when the endpoint rejects the delete', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const uploader = createFetchUploader({ baseUrl: 'https://blok.example.com' });

    await expect(requireDelete(uploader)('https://cdn.example.com/gone.png', { kind: 'image' })).rejects.toThrow(
      'Fetch endpoint delete failed with status 404'
    );
  });
});
