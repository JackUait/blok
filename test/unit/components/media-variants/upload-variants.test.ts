import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { uploadImageVariants } from '../../../../src/components/media-variants/upload-variants';

const blob = (type: string): Blob => new Blob([new Uint8Array(3)], { type });
const original = new File([new Uint8Array(9)], 'photo.PNG', { type: 'image/png' });

const recorder = (): {
  calls: Array<{ name: string; type: string; role: string }>;
  upload: (file: File, variant: { mimeType: string; role: 'original' | 'variant' }) => Promise<{ url: string; fileName: string }>;
} => {
  const calls: Array<{ name: string; type: string; role: string }> = [];
  const upload = vi.fn(async (file: File, variant: { mimeType: string; role: 'original' | 'variant' }) => {
    calls.push({ name: file.name, type: file.type, role: variant.role });

    return { url: `https://cdn/${file.name}`, fileName: file.name };
  });

  return { calls, upload };
};

describe('uploadImageVariants', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('uploads each variant and makes the most compatible one the url', async () => {
    const { calls, upload } = recorder();

    const out = await uploadImageVariants(original, [
      { file: blob('image/png'), mimeType: 'image/png' },
      { file: blob('image/avif'), mimeType: 'image/avif' },
    ], upload);

    expect(out.url).toBe('https://cdn/photo.png');
    expect(out.variants).toEqual([
      { url: 'https://cdn/photo.avif', mimeType: 'image/avif' },
      { url: 'https://cdn/photo.png', mimeType: 'image/png' },
    ]);
    expect(calls.map((c) => [c.type, c.role])).toEqual([['image/avif', 'variant'], ['image/png', 'variant']]);
  });

  it('adds the original last when no universal format was produced', async () => {
    const { calls, upload } = recorder();

    const out = await uploadImageVariants(original, [
      { file: blob('image/webp'), mimeType: 'image/webp' },
    ], upload);

    expect(out.url).toBe('https://cdn/photo.PNG');
    expect(out.variants?.map((v) => v.mimeType)).toEqual(['image/webp', 'image/png']);
    expect(calls.at(-1)).toMatchObject({ name: 'photo.PNG', role: 'original' });
  });

  it('uploads only the original, with no variants, when nothing was produced', async () => {
    const { calls, upload } = recorder();

    const out = await uploadImageVariants(original, [], upload);

    expect(out.url).toBe('https://cdn/photo.PNG');
    expect(out.variants).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('reports overall progress across all uploads', async () => {
    const seen: number[] = [];
    const upload = vi.fn(async (_f: File, _v: unknown, onProgress: (p: number) => void) => {
      onProgress(100);

      return { url: 'u' };
    });

    await uploadImageVariants(original, [
      { file: blob('image/avif'), mimeType: 'image/avif' },
      { file: blob('image/jpeg'), mimeType: 'image/jpeg' },
    ], upload, (p) => seen.push(p));

    expect(seen).toEqual([50, 100]);
  });
});
