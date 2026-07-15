import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { encodeAvifWithVideoEncoderMock } = vi.hoisted(() => ({
  encodeAvifWithVideoEncoderMock: vi.fn<() => Promise<Blob | null>>(async () => null),
}));

vi.mock('../../../../src/tools/image/avif-webcodecs', () => ({
  encodeAvifWithVideoEncoder: encodeAvifWithVideoEncoderMock,
}));

import { compressImage } from '../../../../src/tools/image/compress';

interface FakeBitmap { width: number; height: number; close: () => void; }

const bitmaps: FakeBitmap[] = [];

/** Sizes returned by the fake encoder, keyed by requested MIME type. */
const encodedSizes = new Map<string, number>();
/** MIME types the fake browser can actually encode. Anything else yields a PNG. */
const encodable = new Set<string>();
/** Every (type, quality, width, height) the fake canvas was asked to encode. */
const encodeCalls: Array<{ type: string; quality?: number; width: number; height: number }> = [];

const makeFile = (
  { size = 500 * 1024, type = 'image/jpeg', name = 'photo.jpg' } = {},
): File => {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const installCanvas = (width = 4000, height = 3000): void => {
  (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(async () => {
    const bitmap: FakeBitmap = { width, height, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  });

  class FakeOffscreenCanvas {
    constructor(public width: number, public height: number) {}
    getContext(): { drawImage: () => void } {
      return { drawImage: vi.fn() };
    }
    async convertToBlob({ type, quality }: { type: string; quality?: number }): Promise<Blob> {
      encodeCalls.push({ type, quality, width: this.width, height: this.height });
      // A real browser silently hands back a PNG when it can't encode the type.
      const actual = encodable.has(type) ? type : 'image/png';
      const size = encodedSizes.get(actual) ?? 1024;
      return new Blob([new Uint8Array(size)], { type: actual });
    }
  }
  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
};

describe('compressImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bitmaps.length = 0;
    encodeCalls.length = 0;
    encodedSizes.clear();
    encodable.clear();
    encodable.add('image/jpeg');
    encodable.add('image/png');
    encodable.add('image/webp');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    vi.restoreAllMocks();
  });

  describe('skip rules — null means "upload the original"', () => {
    it('returns null when compression is disabled', async () => {
      installCanvas();
      expect(await compressImage(makeFile(), false)).toBeNull();
    });

    it('returns null for an SVG — rasterising a vector would destroy it', async () => {
      installCanvas();
      const svg = makeFile({ type: 'image/svg+xml', name: 'logo.svg' });
      expect(await compressImage(svg, true)).toBeNull();
    });

    it('returns null for a GIF — the GIF branch owns those, canvas would flatten it', async () => {
      installCanvas();
      expect(await compressImage(makeFile({ type: 'image/gif', name: 'a.gif' }), true)).toBeNull();
    });

    it('returns null for a non-image file', async () => {
      installCanvas();
      expect(await compressImage(makeFile({ type: 'application/pdf', name: 'a.pdf' }), true)).toBeNull();
    });

    it('returns null for a file below minSize', async () => {
      installCanvas();
      const small = makeFile({ size: 40 * 1024 });
      expect(await compressImage(small, true)).toBeNull();
      expect(encodeCalls).toHaveLength(0);
    });

    it('honours a custom minSize', async () => {
      installCanvas();
      encodedSizes.set('image/jpeg', 10 * 1024);
      const file = makeFile({ size: 40 * 1024 });
      expect(await compressImage(file, { minSize: 20 * 1024 })).not.toBeNull();
    });

    it('returns null when the browser cannot decode images at all', async () => {
      expect(await compressImage(makeFile(), true)).toBeNull();
    });

    it('returns null when decoding throws', async () => {
      installCanvas();
      (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(async () => {
        throw new Error('corrupt');
      });
      expect(await compressImage(makeFile(), true)).toBeNull();
    });
  });

  describe('safe default', () => {
    it('re-encodes a JPEG as JPEG at quality 0.92, keeping dimensions and name', async () => {
      installCanvas(4000, 3000);
      encodedSizes.set('image/jpeg', 100 * 1024);

      const result = await compressImage(makeFile({ size: 500 * 1024 }), true);

      expect(result).toBeInstanceOf(File);
      expect(result?.type).toBe('image/jpeg');
      expect(result?.name).toBe('photo.jpg');
      expect(result?.size).toBe(100 * 1024);
      expect(encodeCalls).toEqual([
        { type: 'image/jpeg', quality: 0.92, width: 4000, height: 3000 },
      ]);
    });

    it('closes the decoded bitmap', async () => {
      installCanvas();
      encodedSizes.set('image/jpeg', 100 * 1024);
      await compressImage(makeFile(), true);
      expect(bitmaps).toHaveLength(1);
      expect(bitmaps[0].close).toHaveBeenCalled();
    });

    it('keeps the original when the result does not save at least 10%', async () => {
      installCanvas();
      encodedSizes.set('image/jpeg', 460 * 1024); // only 8% smaller

      expect(await compressImage(makeFile({ size: 500 * 1024 }), true)).toBeNull();
    });

    it('keeps the original when the re-encode comes out bigger (typical PNG screenshot)', async () => {
      installCanvas();
      encodedSizes.set('image/png', 900 * 1024);
      const png = makeFile({ size: 500 * 1024, type: 'image/png', name: 'shot.png' });

      expect(await compressImage(png, true)).toBeNull();
    });

    it('respects a custom minSavings', async () => {
      installCanvas();
      encodedSizes.set('image/jpeg', 460 * 1024); // 8% smaller

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { minSavings: 0.05 });

      expect(result?.size).toBe(460 * 1024);
    });
  });

  describe('opt-in format', () => {
    it('re-encodes to WebP and rewrites the extension', async () => {
      installCanvas();
      encodedSizes.set('image/webp', 80 * 1024);

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'webp' });

      expect(result?.type).toBe('image/webp');
      expect(result?.name).toBe('photo.webp');
    });

    it('falls back to the source format when the browser silently returns a PNG', async () => {
      installCanvas();
      encodable.delete('image/webp'); // browser cannot encode webp
      encodedSizes.set('image/jpeg', 100 * 1024);

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'webp' });

      expect(encodeCalls.map((c) => c.type)).toEqual(['image/webp', 'image/jpeg']);
      expect(result?.type).toBe('image/jpeg');
      expect(result?.name).toBe('photo.jpg');
    });

    it("format 'auto' prefers AVIF when the browser can encode it", async () => {
      installCanvas();
      encodable.add('image/avif');
      encodedSizes.set('image/avif', 60 * 1024);

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'auto' });

      expect(result?.type).toBe('image/avif');
      expect(result?.name).toBe('photo.avif');
    });

    it("format 'auto' degrades AVIF → WebP → original", async () => {
      installCanvas();
      encodedSizes.set('image/webp', 70 * 1024);

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'auto' });

      expect(encodeCalls.map((c) => c.type)).toEqual(['image/avif', 'image/webp']);
      expect(result?.type).toBe('image/webp');
    });

    it('passes a custom quality through', async () => {
      installCanvas();
      encodedSizes.set('image/jpeg', 50 * 1024);

      await compressImage(makeFile({ size: 500 * 1024 }), { quality: 0.6 });

      expect(encodeCalls[0].quality).toBe(0.6);
    });
  });

  describe('WebCodecs AVIF fallback — canvas cannot encode AVIF anywhere', () => {
    const avifBlob = (size: number): Blob =>
      new Blob([new Uint8Array(size)], { type: 'image/avif' });

    beforeEach(() => {
      encodeAvifWithVideoEncoderMock.mockResolvedValue(null);
    });

    it('encodes real AVIF through the AV1 video encoder when canvas hands back a PNG', async () => {
      installCanvas();
      encodeAvifWithVideoEncoderMock.mockResolvedValue(avifBlob(60 * 1024));

      const png = makeFile({ size: 500 * 1024, type: 'image/png', name: 'shot.png' });
      const result = await compressImage(png, { format: 'avif', maxWidth: 1920, maxHeight: 1080 });

      expect(result?.type).toBe('image/avif');
      expect(result?.name).toBe('shot.avif');
      expect(encodeAvifWithVideoEncoderMock).toHaveBeenCalledWith(
        expect.anything(),
        { width: 1440, height: 1080 }, // 4000×3000 capped to the 1080 side
        0.92,
      );
    });

    it('is not consulted when the canvas can already encode AVIF', async () => {
      installCanvas();
      encodable.add('image/avif');
      encodedSizes.set('image/avif', 60 * 1024);

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'avif' });

      expect(result?.type).toBe('image/avif');
      expect(encodeAvifWithVideoEncoderMock).not.toHaveBeenCalled();
    });

    it('falls back to the source format when WebCodecs cannot help either', async () => {
      installCanvas();
      encodeAvifWithVideoEncoderMock.mockResolvedValue(null);
      encodedSizes.set('image/jpeg', 100 * 1024);

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'avif' });

      expect(encodeCalls.map((c) => c.type)).toEqual(['image/avif', 'image/jpeg']);
      expect(result?.type).toBe('image/jpeg');
    });

    it("serves the format 'auto' AVIF preference before WebP", async () => {
      installCanvas();
      encodeAvifWithVideoEncoderMock.mockResolvedValue(avifBlob(60 * 1024));

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'auto' });

      expect(result?.type).toBe('image/avif');
    });

    it('still applies the worth-it check to WebCodecs output', async () => {
      installCanvas(1000, 800); // below any cap → not resized
      encodeAvifWithVideoEncoderMock.mockResolvedValue(avifBlob(480 * 1024));

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { format: 'avif' });

      expect(result).toBeNull();
    });
  });

  describe('dimension cap', () => {
    it('downscales to maxWidth, preserving aspect ratio', async () => {
      installCanvas(4000, 2000);
      encodedSizes.set('image/jpeg', 100 * 1024);

      await compressImage(makeFile({ size: 500 * 1024 }), { maxWidth: 1000 });

      expect(encodeCalls[0]).toMatchObject({ width: 1000, height: 500 });
    });

    it('downscales to maxHeight, preserving aspect ratio', async () => {
      installCanvas(4000, 2000);
      encodedSizes.set('image/jpeg', 100 * 1024);

      await compressImage(makeFile({ size: 500 * 1024 }), { maxHeight: 500 });

      expect(encodeCalls[0]).toMatchObject({ width: 1000, height: 500 });
    });

    it('never upscales an image smaller than the cap', async () => {
      installCanvas(400, 200);
      encodedSizes.set('image/jpeg', 100 * 1024);

      await compressImage(makeFile({ size: 500 * 1024 }), { maxWidth: 1000 });

      expect(encodeCalls[0]).toMatchObject({ width: 400, height: 200 });
    });

    it('accepts a downscaled result that saves less than minSavings but is still smaller', async () => {
      installCanvas(4000, 2000);
      encodedSizes.set('image/jpeg', 480 * 1024); // 4% smaller — under the default gate

      const result = await compressImage(makeFile({ size: 500 * 1024 }), { maxWidth: 1000 });

      expect(result?.size).toBe(480 * 1024);
    });
  });

  describe('transform escape hatch', () => {
    it('replaces the built-in pipeline', async () => {
      installCanvas();
      const custom = new File([new Uint8Array(4)], 'custom.webp', { type: 'image/webp' });
      const transform = vi.fn(async () => custom);

      const result = await compressImage(makeFile(), { transform });

      expect(result).toBe(custom);
      expect(encodeCalls).toHaveLength(0);
    });

    it('wraps a returned Blob into a File, rewriting the extension', async () => {
      installCanvas();
      const blob = new Blob([new Uint8Array(4)], { type: 'image/webp' });

      const result = await compressImage(makeFile(), { transform: async () => blob });

      expect(result).toBeInstanceOf(File);
      expect(result?.name).toBe('photo.webp');
      expect(result?.type).toBe('image/webp');
    });

    it('keeps the original when the transform returns null or throws', async () => {
      installCanvas();
      expect(await compressImage(makeFile(), { transform: async () => null })).toBeNull();
      expect(await compressImage(makeFile(), {
        transform: async () => { throw new Error('nope'); },
      })).toBeNull();
    });
  });
});
