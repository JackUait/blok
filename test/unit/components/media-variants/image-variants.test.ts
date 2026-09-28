import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { avifMock } = vi.hoisted(() => ({ avifMock: vi.fn<() => Promise<Blob | null>>(async () => null) }));

vi.mock('../../../../src/tools/image/avif-webcodecs', () => ({ encodeAvifWithVideoEncoder: avifMock }));

import { produceImageVariants } from '../../../../src/components/media-variants/image-variants';

/** MIME types the fake canvas can encode. Anything else comes back as PNG. */
const encodable = new Set<string>();
/** Alpha the fake canvas reports for every pixel, and the decoded size. */
const state = { alpha: 255, width: 40, height: 30 };
const encodes: Array<{ type: string; width: number; height: number }> = [];

const install = (): void => {
  (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(async () => ({
    width: state.width,
    height: state.height,
    close: vi.fn(),
  }));

  class FakeOffscreenCanvas {
    constructor(public width: number, public height: number) {}

    getContext(): unknown {
      return {
        drawImage: vi.fn(),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4).fill(255);

          for (let i = 3; i < data.length; i += 4) {
            data[i] = state.alpha;
          }

          return { data };
        },
      };
    }

    async convertToBlob({ type }: { type: string }): Promise<Blob> {
      encodes.push({ type, width: this.width, height: this.height });

      return new Blob([new Uint8Array(4)], { type: encodable.has(type) ? type : 'image/png' });
    }
  }
  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
};

const photo = (type = 'image/jpeg'): File => new File([new Uint8Array(8)], 'photo.jpg', { type });

describe('produceImageVariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encodable.clear();
    encodes.length = 0;
    state.alpha = 255;
    install();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    delete (globalThis as Record<string, unknown>).createImageBitmap;
  });

  it('returns every encodable listed format, best first, whatever the listed order', async () => {
    encodable.add('image/webp').add('image/jpeg');

    const out = await produceImageVariants(photo(), ['jpeg', 'webp'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/webp', 'image/jpeg']);
    expect(out.every((v) => v.file.type === v.mimeType)).toBe(true);
  });

  it('skips a format the browser silently turns into PNG', async () => {
    encodable.add('image/jpeg');

    const out = await produceImageVariants(photo(), ['webp', 'jpeg'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/jpeg']);
  });

  it('uses the WebCodecs AVIF encoder when the canvas cannot make AVIF', async () => {
    encodable.add('image/jpeg');
    avifMock.mockResolvedValueOnce(new Blob([new Uint8Array(2)], { type: 'image/avif' }));

    const out = await produceImageVariants(photo(), ['avif', 'jpeg'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/avif', 'image/jpeg']);
  });

  it('never makes a JPEG of a transparent image', async () => {
    encodable.add('image/jpeg').add('image/png').add('image/webp');
    state.alpha = 0;

    const out = await produceImageVariants(photo('image/png'), ['webp', 'jpeg', 'png'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/webp', 'image/png']);
  });

  it('makes a JPEG of an opaque PNG', async () => {
    encodable.add('image/jpeg');

    const out = await produceImageVariants(photo('image/png'), ['jpeg'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/jpeg']);
  });

  it('keeps the original pixel size unless a cap is set', async () => {
    encodable.add('image/jpeg');

    await produceImageVariants(photo(), ['jpeg'], { quality: 0.92 });
    await produceImageVariants(photo(), ['jpeg'], { quality: 0.92, maxWidth: 20 });

    expect(encodes.filter((e) => e.type === 'image/jpeg').map((e) => [e.width, e.height]))
      .toEqual([[40, 30], [20, 15]]);
  });

  it('returns nothing for SVG, GIF, or when the browser cannot decode', async () => {
    encodable.add('image/jpeg');

    expect(await produceImageVariants(photo('image/svg+xml'), ['jpeg'], { quality: 0.92 })).toEqual([]);
    expect(await produceImageVariants(photo('image/gif'), ['jpeg'], { quality: 0.92 })).toEqual([]);

    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    expect(await produceImageVariants(photo(), ['jpeg'], { quality: 0.92 })).toEqual([]);
  });
});
