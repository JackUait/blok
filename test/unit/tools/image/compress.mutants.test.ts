import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { avifEncoder } = vi.hoisted(() => ({
  avifEncoder: vi.fn<() => Promise<Blob | null>>(async () => null),
}));

vi.mock('../../../../src/tools/image/avif-webcodecs', () => ({
  encodeAvifWithVideoEncoder: avifEncoder,
}));

import { compressImage } from '../../../../src/tools/image/compress';

interface FakeBitmap {
  width: number;
  height: number;
  close: () => void;
}

interface DrawCall {
  width: number;
  height: number;
}

const state = {
  bitmaps: [] as FakeBitmap[],
  decodeOptions: [] as unknown[],
  contextRequests: [] as string[],
  draws: [] as DrawCall[],
  encodeCalls: [] as string[],
  encodable: new Set<string>(),
  encodedSize: 1024,
  contextAvailable: true,
  convertThrows: false,
};

const file = ({ size = 500 * 1024, type = 'image/jpeg', name = 'photo.jpg' } = {}): File => {
  const built = new File([new Uint8Array(8)], name, { type });

  Object.defineProperty(built, 'size', { value: size });

  return built;
};

const installBitmapDecoder = (width = 4000, height = 3000): void => {
  (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(async (_blob: Blob, options?: unknown) => {
    state.decodeOptions.push(options);

    const bitmap: FakeBitmap = { width, height, close: vi.fn() };

    state.bitmaps.push(bitmap);

    return bitmap;
  });
};

const installCanvas = (): void => {
  class FakeOffscreenCanvas {
    public constructor(public width: number, public height: number) {}

    // A real canvas returns null for any context id it does not implement.
    public getContext(id: string): { drawImage: (bitmap: unknown, x: number, y: number, w: number, h: number) => void } | null {
      state.contextRequests.push(id);

      if (id !== '2d' || !state.contextAvailable) {
        return null;
      }

      return {
        drawImage: (_bitmap, _x, _y, w, h) => {
          state.draws.push({ width: w, height: h });
        },
      };
    }

    public async convertToBlob({ type }: { type: string; quality?: number }): Promise<Blob> {
      if (state.convertThrows) {
        throw new Error('encoder exploded');
      }
      state.encodeCalls.push(type);

      // A real browser silently hands back a PNG when it cannot encode the type.
      const actual = state.encodable.has(type) ? type : 'image/png';

      return new Blob([new Uint8Array(state.encodedSize)], { type: actual });
    }
  }

  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
};

/**
 * Four survivors are equivalent, all because the mutated path lands somewhere
 * that produces the same answer:
 *
 * - `transform?.(file)` losing its optional call — runTransform is only reached
 *   after `if (cfg.transform)`.
 * - `if (!result) return null` in runTransform — falling through hands null to
 *   toFile, which throws on `.type` into the enclosing catch, which returns null.
 * - the empty catch in `decode` — it then returns undefined, and the caller's
 *   `if (!bitmap)` treats that exactly like the null it replaced.
 * - the createImageBitmap half of the decode-capability check forced true:
 *   without that global, `decode` throws on the very call the check was
 *   guarding, and its own catch returns the same null.
 */
describe('compressImage mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.bitmaps.length = 0;
    state.decodeOptions.length = 0;
    state.contextRequests.length = 0;
    state.draws.length = 0;
    state.encodeCalls.length = 0;
    state.encodable = new Set(['image/jpeg', 'image/png', 'image/webp']);
    state.encodedSize = 1024;
    state.contextAvailable = true;
    state.convertThrows = false;
    installBitmapDecoder();
    installCanvas();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    vi.restoreAllMocks();
  });

  describe('configuration', () => {
    it('treats an absent config as the defaults rather than dereferencing it', async () => {
      await expect(compressImage(file(), undefined)).resolves.not.toBeUndefined();
    });

    it('decodes with the orientation baked in', async () => {
      await compressImage(file(), true);

      expect(state.decodeOptions).toStrictEqual([{ imageOrientation: 'from-image' }]);
    });
  });

  describe('skip rules', () => {
    it('never touches a file that is not an image', async () => {
      expect(await compressImage(file({ type: 'text/plain', name: 'notes.txt' }), true)).toBeNull();
      expect(state.bitmaps).toHaveLength(0);
    });

    it('never touches a GIF', async () => {
      expect(await compressImage(file({ type: 'image/gif', name: 'loop.gif' }), true)).toBeNull();
      expect(state.bitmaps).toHaveLength(0);
    });

    it('compresses a file sitting exactly on the size floor', async () => {
      expect(await compressImage(file({ size: 100 * 1024 }), true)).not.toBeNull();
    });

    it('decodes nothing when the browser has no canvas', async () => {
      delete (globalThis as Record<string, unknown>).OffscreenCanvas;

      expect(await compressImage(file(), true)).toBeNull();
      expect(state.bitmaps).toHaveLength(0);
    });

    it('decodes nothing when the browser cannot make a bitmap', async () => {
      delete (globalThis as Record<string, unknown>).createImageBitmap;

      expect(await compressImage(file(), true)).toBeNull();
    });
  });

  describe('encoding', () => {
    it('tries each target once, with the source type last', async () => {
      state.encodable = new Set(['image/png']);

      expect(await compressImage(file({ type: 'image/webp', name: 'p.webp' }), { format: 'auto' })).toBeNull();
      expect(state.encodeCalls).toStrictEqual(['image/avif', 'image/webp']);
    });

    it('asks the canvas for a 2d context and draws the resized bitmap into it', async () => {
      await compressImage(file(), { maxWidth: 2000 });

      expect(state.contextRequests).toStrictEqual(['2d']);
      expect(state.draws).toStrictEqual([{ width: 2000, height: 1500 }]);
    });

    it('moves on to the next target when the canvas has no context', async () => {
      state.contextAvailable = false;

      expect(await compressImage(file(), { format: 'auto' })).toBeNull();
      expect(state.contextRequests).toStrictEqual(['2d', '2d', '2d']);
      expect(state.encodeCalls).toStrictEqual([]);
    });

    it('reaches for the video encoder only for AVIF', async () => {
      state.encodable = new Set(['image/png']);

      await compressImage(file(), { format: 'webp' });

      expect(avifEncoder).not.toHaveBeenCalled();
    });

    it('returns null when the encoder throws', async () => {
      state.convertThrows = true;

      expect(await compressImage(file(), true)).toBeNull();
    });
  });

  describe('worth-it rules', () => {
    // 100x1 scaled by half rounds the height back to 1, so exactly one axis
    // moves — the only shape that separates the two halves of `resized`.
    it('keeps a downscale where only the width changed', async () => {
      state.bitmaps.length = 0;
      installBitmapDecoder(100, 1);
      state.encodedSize = 499 * 1024;

      expect(await compressImage(file({ size: 500 * 1024 }), { maxWidth: 50 })).not.toBeNull();
    });

    it('keeps a downscale where only the height changed', async () => {
      state.bitmaps.length = 0;
      installBitmapDecoder(1, 100);
      state.encodedSize = 499 * 1024;

      expect(await compressImage(file({ size: 500 * 1024 }), { maxHeight: 50 })).not.toBeNull();
    });

    it('rejects a result that is exactly the size of the original', async () => {
      state.bitmaps.length = 0;
      installBitmapDecoder(100, 1);
      state.encodedSize = 500 * 1024;

      expect(await compressImage(file({ size: 500 * 1024 }), { maxWidth: 50 })).toBeNull();
    });

    it('rejects a result that is larger than the original', async () => {
      state.bitmaps.length = 0;
      installBitmapDecoder(100, 1);
      state.encodedSize = 600 * 1024;

      expect(await compressImage(file({ size: 500 * 1024 }), { maxWidth: 50 })).toBeNull();
    });

    it('rejects an un-resized result sitting exactly on the savings threshold', async () => {
      state.encodedSize = 450 * 1024;

      expect(await compressImage(file({ size: 500 * 1024 }), { minSavings: 0.1 })).toBeNull();
    });
  });

  describe('renaming', () => {
    const viaTransform = async (name: string, type: string): Promise<string | null> => {
      const result = await compressImage(file({ name }), {
        transform: async () => new Blob([new Uint8Array(4)], { type }),
      });

      return result === null ? null : result.name;
    };

    it('leaves the name alone for a type it has no extension for', async () => {
      expect(await viaTransform('photo.jpg', 'image/tiff')).toBe('photo.jpg');
    });

    it('keeps a name that has no extension whole', async () => {
      expect(await viaTransform('photo', 'image/webp')).toBe('photo.webp');
    });

    it('treats a leading dot as part of the name, not as an extension', async () => {
      expect(await viaTransform('.env', 'image/webp')).toBe('.env.webp');
    });
  });
});
