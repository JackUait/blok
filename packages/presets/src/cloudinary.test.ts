import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokUploader } from '../../../types/configs/uploader';
import { cloudinaryStorage } from './cloudinary';
import * as xhr from './upload-xhr';

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const preset = { cloudName: 'demo', uploadPreset: 'blok-unsigned' };

describe('cloudinaryStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to the image endpoint for image assets', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"secure_url":"https://res.cloudinary.com/demo/image/upload/v1/a.png"}',
    });

    const result = await requireUploadByFile(cloudinaryStorage(preset))(
      new File(['x'], 'a.png', { type: 'image/png' }),
      { kind: 'image' }
    );

    expect(spy.mock.calls[0][0].url).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(result.url).toBe('https://res.cloudinary.com/demo/image/upload/v1/a.png');
  });

  it('sends the upload_preset and folder in the multipart body', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"secure_url":"https://res.cloudinary.com/demo/image/upload/v1/a.png"}',
    });

    await requireUploadByFile(cloudinaryStorage({ ...preset, folder: 'uploads' }))(
      new File(['x'], 'a.png', { type: 'image/png' }),
      { kind: 'image' }
    );

    const body = spy.mock.calls[0][0].body as FormData;
    expect(body.get('upload_preset')).toBe('blok-unsigned');
    expect(body.get('folder')).toBe('uploads');
  });

  // Cloudinary routes by resource type in the URL, so the kind must pick it.
  it('uses the video endpoint for video and audio, and raw for files', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"secure_url":"u"}' });
    const uploadByFile = requireUploadByFile(cloudinaryStorage(preset));

    await uploadByFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }), { kind: 'video' });
    await uploadByFile(new File(['x'], 'a.mp3', { type: 'audio/mpeg' }), { kind: 'audio' });
    await uploadByFile(new File(['x'], 'a.zip'), { kind: 'file' });

    expect(spy.mock.calls[0][0].url).toContain('/video/upload');
    expect(spy.mock.calls[1][0].url).toContain('/video/upload');
    expect(spy.mock.calls[2][0].url).toContain('/raw/upload');
  });

  it('re-hosts a remote URL by handing it to Cloudinary as the file field', async () => {
    const spy = vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({
      status: 200,
      text: '{"secure_url":"https://res.cloudinary.com/demo/image/upload/v1/rehosted.png"}',
    });

    const result = await requireUploadByUrl(cloudinaryStorage(preset))('https://elsewhere.example.net/i.png', {
      kind: 'image',
    });

    expect((spy.mock.calls[0][0].body as FormData).get('file')).toBe('https://elsewhere.example.net/i.png');
    expect(result.url).toBe('https://res.cloudinary.com/demo/image/upload/v1/rehosted.png');
  });

  it('throws when Cloudinary answers without a secure_url', async () => {
    vi.spyOn(xhr, 'uploadWithProgress').mockResolvedValue({ status: 200, text: '{"error":{"message":"bad preset"}}' });

    await expect(
      requireUploadByFile(cloudinaryStorage(preset))(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/bad preset/);
  });
});
