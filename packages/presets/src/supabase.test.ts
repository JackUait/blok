import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokUploader } from '../../../types/configs/uploader';
import { supabaseStorage } from './supabase';

function requireUploadByFile(uploader: BlokUploader): NonNullable<BlokUploader['uploadByFile']> {
  const { uploadByFile } = uploader;

  if (!uploadByFile) {
    throw new Error('expected uploadByFile to be defined');
  }

  return uploadByFile;
}

function fakeClient(overrides: { uploadError?: { message: string } } = {}) {
  const upload = vi.fn().mockResolvedValue({
    data: overrides.uploadError ? null : { path: 'stored/path.png' },
    error: overrides.uploadError ?? null,
  });
  const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://sb.example.com/stored/path.png' } });
  const from = vi.fn().mockReturnValue({ upload, getPublicUrl });

  return { client: { storage: { from } }, from, upload, getPublicUrl };
}

describe('supabaseStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads into the configured bucket and returns the public url', async () => {
    const { client, from, upload } = fakeClient();

    const result = await requireUploadByFile(supabaseStorage(client, { bucket: 'media' }))(
      new File(['x'], 'a.png', { type: 'image/png' }),
      { kind: 'image' }
    );

    expect(from).toHaveBeenCalledWith('media');
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/png' });
    expect(result.url).toBe('https://sb.example.com/stored/path.png');
    expect(result.fileName).toBe('a.png');
  });

  // Routing on kind is the whole reason UploadContext carries it: an audio block
  // uploading cover art passes kind 'image' and must not land in the audio bucket.
  it('routes by asset kind when bucket is a function', async () => {
    const { client, from } = fakeClient();

    await requireUploadByFile(supabaseStorage(client, { bucket: (kind) => `blok-${kind}` }))(
      new File(['x'], 'cover.png', { type: 'image/png' }),
      { kind: 'image', tool: 'audio' }
    );

    expect(from).toHaveBeenCalledWith('blok-image');
  });

  it('generates a collision-free path that keeps the extension', async () => {
    const { client, upload } = fakeClient();

    await requireUploadByFile(supabaseStorage(client))(new File(['x'], 'my photo.png'), { kind: 'image' });

    const path = upload.mock.calls[0][0] as string;

    expect(path).toMatch(/\.png$/);
    expect(path).not.toContain(' ');
    expect(path).not.toContain('my photo');
  });

  it('surfaces the Supabase error message', async () => {
    const { client } = fakeClient({ uploadError: { message: 'bucket not found' } });

    await expect(
      requireUploadByFile(supabaseStorage(client))(new File(['x'], 'a.png'), { kind: 'image' })
    ).rejects.toThrow(/bucket not found/);
  });

  it('declares no uploadByUrl, so Blok keeps a third-party URL verbatim', () => {
    const { client } = fakeClient();

    expect(supabaseStorage(client).uploadByUrl).toBeUndefined();
  });
});
