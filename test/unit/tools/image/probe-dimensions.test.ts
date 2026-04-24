import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { probeImageDimensions } from '../../../../src/tools/image/probe-dimensions';

class MockImage {
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public naturalWidth = 0;
  public naturalHeight = 0;
  private _src = '';
  public static lastInstance: MockImage | null = null;
  constructor() {
    MockImage.lastInstance = this;
  }
  public set src(value: string) {
    this._src = value;
  }
  public get src(): string {
    return this._src;
  }
}

describe('probeImageDimensions', () => {
  afterEach(() => {
    MockImage.lastInstance = null;
    vi.unstubAllGlobals();
  });

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('resolves with naturalWidth/naturalHeight when the probe image loads', async () => {
    vi.stubGlobal('Image', MockImage);
    const promise = probeImageDimensions('https://example.com/cat.png');
    await flush();
    const inst = MockImage.lastInstance;
    if (!inst) throw new Error('Image was not constructed');
    inst.naturalWidth = 400;
    inst.naturalHeight = 250;
    inst.onload?.();
    await expect(promise).resolves.toEqual({ width: 400, height: 250 });
  });

  it('resolves with null when the probe image errors', async () => {
    vi.stubGlobal('Image', MockImage);
    const promise = probeImageDimensions('https://example.com/broken.png');
    await flush();
    const inst = MockImage.lastInstance;
    if (!inst) throw new Error('Image was not constructed');
    inst.onerror?.();
    await expect(promise).resolves.toBeNull();
  });

  it('resolves with null when the probe image loads but has no intrinsic size', async () => {
    vi.stubGlobal('Image', MockImage);
    const promise = probeImageDimensions('https://example.com/empty.png');
    await flush();
    const inst = MockImage.lastInstance;
    if (!inst) throw new Error('Image was not constructed');
    inst.naturalWidth = 0;
    inst.naturalHeight = 0;
    inst.onload?.();
    await expect(promise).resolves.toBeNull();
  });

  describe('fast paths before network probe', () => {
    beforeEach(() => {
      vi.stubGlobal('Image', MockImage);
    });

    it('returns dimensions parsed from the URL without constructing an Image', async () => {
      const dims = await probeImageDimensions('https://cdn.example.com/pic.jpg?w=400&h=300');
      expect(dims).toEqual({ width: 400, height: 300 });
      expect(MockImage.lastInstance).toBeNull();
    });

    it('returns dimensions parsed from SVG text without constructing an Image', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: (): Promise<string> => Promise.resolve('<svg width="640" height="480"></svg>'),
      }));
      const dims = await probeImageDimensions('https://cdn.example.com/logo.svg');
      expect(dims).toEqual({ width: 640, height: 480 });
      expect(MockImage.lastInstance).toBeNull();
    });

    it('falls back to Image probe when URL and SVG strategies miss', async () => {
      const promise = probeImageDimensions('https://cdn.example.com/pic.png');
      await flush();
      const inst = MockImage.lastInstance;
      if (!inst) throw new Error('Image was not constructed');
      inst.naturalWidth = 321;
      inst.naturalHeight = 123;
      inst.onload?.();
      await expect(promise).resolves.toEqual({ width: 321, height: 123 });
    });
  });
});
