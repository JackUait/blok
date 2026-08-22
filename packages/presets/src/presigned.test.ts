import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokUploader } from '../../../types/configs/uploader';
import { presignedStorage } from './presigned';
import * as xhr from './upload-xhr';

function requireUploadByFile(uploader: BlokUploader): NonNullable<BlokUploader['uploadByFile']> {
  const { uploadByFile } = uploader;

  if (!uploadByFile) {
    throw new Error('expected uploadByFile to be defined');
  }

  return uploadByFile;
}

describe('presignedStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PUTs the file to the signed url and returns the public url', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '' });
    const sign = vi.fn().mockResolvedValue({
      uploadUrl: 'https://bucket.s3.example.com/key?sig=abc',
      publicUrl: 'https://cdn.example.com/key',
      headers: { 'x-amz-acl': 'private' },
    });

    const result = await requireUploadByFile(presignedStorage({ sign }))(
      new File(['xyz'], 'a.png', { type: 'image/png' }),
      { kind: 'image' }
    );

    expect(sign).toHaveBeenCalledWith({ fileName: 'a.png', mimeType: 'image/png', size: 3, kind: 'image' });
    expect(spy.mock.calls[0][0].method).toBe('PUT');
    expect(spy.mock.calls[0][0].url).toBe('https://bucket.s3.example.com/key?sig=abc');
    expect(spy.mock.calls[0][0].headers).toMatchObject({ 'x-amz-acl': 'private', 'Content-Type': 'image/png' });
    expect(result).toEqual({ url: 'https://cdn.example.com/key', fileName: 'a.png' });
  });

  it('throws when the storage rejects the PUT', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 403, text: 'AccessDenied' });
    const sign = vi.fn().mockResolvedValue({ uploadUrl: 'https://u', publicUrl: 'https://p' });

    await expect(
      requireUploadByFile(presignedStorage({ sign }))(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/403/);
  });

  it('propagates a failure from the signer without attempting an upload', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress');
    const sign = vi.fn().mockRejectedValue(new Error('not authorised'));

    await expect(
      requireUploadByFile(presignedStorage({ sign }))(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/not authorised/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('declares no uploadByUrl, so Blok keeps a third-party URL verbatim', () => {
    const sign = vi.fn();

    expect(presignedStorage({ sign }).uploadByUrl).toBeUndefined();
  });
});
