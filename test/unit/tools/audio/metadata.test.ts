import { describe, it, expect, vi } from 'vitest';
import { mapMetadata, resolveCover } from '../../../../src/tools/audio/metadata';

describe('mapMetadata', () => {
  it('extracts title and artist from common tags', () => {
    const meta = mapMetadata({ common: { title: 'Midnight City', artist: 'M83', picture: [] } });
    expect(meta).toEqual({ title: 'Midnight City', artist: 'M83' });
  });

  it('extracts the first embedded picture as a cover', () => {
    const data = new Uint8Array([1, 2, 3]);
    const meta = mapMetadata({ common: { picture: [{ data, format: 'image/jpeg' }] } });
    expect(meta.cover).toEqual({ data, mimeType: 'image/jpeg' });
  });

  it('returns an empty object when nothing is present', () => {
    expect(mapMetadata({ common: {} })).toEqual({});
    expect(mapMetadata({})).toEqual({});
  });
});

describe('resolveCover', () => {
  const cover = { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };

  it('re-uploads via the host uploader when present', async () => {
    const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/cover.jpg' });
    await expect(resolveCover(cover, { uploadByFile })).resolves.toBe('https://cdn/cover.jpg');
    expect(uploadByFile).toHaveBeenCalled();
  });

  it('falls back to a data URL when no uploader and under the cap', async () => {
    const url = await resolveCover(cover, undefined);
    expect(url?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('returns undefined when over the cap and no uploader', async () => {
    const big = { data: new Uint8Array(200 * 1024), mimeType: 'image/jpeg' };
    await expect(resolveCover(big, undefined)).resolves.toBeUndefined();
  });
});
