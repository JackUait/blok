import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokUploader } from '../../../types/configs/uploader';
import { fetchStorage } from './fetch-endpoint';
import * as xhr from '../../../src/components/utils/upload-xhr';

/**
 * The upload behaviour itself is covered where it lives, in
 * `test/unit/components/utils/fetch-uploader.test.ts`. What is left to prove
 * here is the published surface: that `fetchStorage` still returns a working
 * uploader and hands every option through.
 * @param uploader - the uploader under test
 */
function requireUploadByFile(uploader: BlokUploader): NonNullable<BlokUploader['uploadByFile']> {
  const { uploadByFile } = uploader;

  if (!uploadByFile) {
    throw new Error('expected uploadByFile to be defined');
  }

  return uploadByFile;
}

describe('fetchStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads to <baseUrl>/upload and returns the parsed url', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"url":"https://cdn.example.com/a.png","fileName":"a.png"}',
    });

    const uploader = fetchStorage({ baseUrl: 'https://blok.example.com' });
    const result = await requireUploadByFile(uploader)(new File(['x'], 'a.png'), { kind: 'image' });

    expect(result).toEqual({ url: 'https://cdn.example.com/a.png', fileName: 'a.png' });
    expect(spy.mock.calls[0][0].url).toBe('https://blok.example.com/upload');
  });

  it('passes the field and headers options through', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"url":"u"}' });
    const file = new File(['x'], 'a.png');

    const uploader = fetchStorage({
      baseUrl: 'https://blok.example.com',
      field: 'upload',
      headers: { Authorization: 'Bearer pass-1' },
    });

    await requireUploadByFile(uploader)(file, { kind: 'image' });

    const body = spy.mock.calls[0][0].body as FormData;

    expect(body.get('upload')).toBe(file);
    expect(spy.mock.calls[0][0].headers).toEqual({ Authorization: 'Bearer pass-1' });
  });

  it('declares uploadByUrl, which a browser-only preset cannot offer', () => {
    expect(fetchStorage({ baseUrl: 'https://blok.example.com' }).uploadByUrl).toBeTypeOf('function');
  });
});
