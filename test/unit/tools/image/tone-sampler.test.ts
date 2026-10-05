import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTones, cssColor, isReadableInPlace, loadSampleSource, pageBackdrop, readToneGrid,
} from '../../../../src/tools/image/tone-sampler';
import { luminanceGrid } from '../../../../src/tools/image/tone';

const WHITE = { r: 255, g: 255, b: 255 };

const fakeImg = (w: number, h: number): HTMLImageElement => {
  const img = document.createElement('img');

  Object.defineProperty(img, 'naturalWidth', { value: w });
  Object.defineProperty(img, 'naturalHeight', { value: h });

  return img;
};

const rect = (left: number, top: number, width: number, height: number): DOMRect => DOMRect.fromRect({ x: left, y: top, width, height });

interface FakeCtx {
  scale: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  filter: string;
}

const stubContext = (ctx: FakeCtx): void => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
};

describe('tone-sampler', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('reads same-origin, data: and blob: images in place, and nothing else', () => {
    const base = 'http://localhost:4444/page.html';

    expect(isReadableInPlace('/a.png', base)).toBe(true);
    expect(isReadableInPlace('data:image/png;base64,AAAA', base)).toBe(true);
    expect(isReadableInPlace('blob:http://localhost:4444/1', base)).toBe(true);
    expect(isReadableInPlace('http://127.0.0.1:4444/a.png', base)).toBe(false);
    expect(isReadableInPlace('https://cdn.example/a.png', base)).toBe(false);
  });

  it('a cross-origin image is read through a CORS copy; the visible img is untouched', async () => {
    const img = document.createElement('img');

    img.src = 'https://cdn.example/a.png';
    const created: HTMLImageElement[] = [];
    const RealImage = window.Image;

    // A function, not an arrow: the code under test calls it with `new`.
    vi.spyOn(window, 'Image').mockImplementation(function () {
      const copy = new RealImage();

      created.push(copy);

      return copy;
    });
    const pending = loadSampleSource(img);

    expect(created).toHaveLength(1);
    expect(created[0].crossOrigin).toBe('anonymous');
    expect(created[0].src).toBe('https://cdn.example/a.png');
    expect(img.hasAttribute('crossorigin')).toBe(false);
    created[0].dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe(created[0]);
  });

  it('a copy that fails to load (no CORS on the host) gives no source', async () => {
    const img = document.createElement('img');

    img.src = 'https://cdn.example/a.png';
    const created: HTMLImageElement[] = [];
    const RealImage = window.Image;

    vi.spyOn(window, 'Image').mockImplementation(function () {
      const copy = new RealImage();

      created.push(copy);

      return copy;
    });
    const pending = loadSampleSource(img);

    created[0].dispatchEvent(new Event('error'));
    await expect(pending).resolves.toBeNull();
  });

  it('a same-origin image is read in place, with no second request', async () => {
    const img = document.createElement('img');

    img.src = `${location.origin}/a.png`;
    const spy = vi.spyOn(window, 'Image');

    await expect(loadSampleSource(img)).resolves.toBe(img);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a tainted canvas read gives no grid', () => {
    stubContext({
      scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(), filter: 'none',
      getImageData: vi.fn(() => {
        throw new DOMException('tainted', 'SecurityError');
      }),
    });

    expect(readToneGrid(fakeImg(800, 600), {}, undefined, WHITE)).toBeNull();
  });

  it('draws only the crop, filtered like the picture', () => {
    const data = new Uint8ClampedArray(24 * 9 * 4).fill(255);
    const ctx: FakeCtx = {
      scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(), filter: 'none',
      getImageData: vi.fn(() => ({ data })),
    };

    stubContext(ctx);
    const grid = readToneGrid(
      fakeImg(800, 600),
      { crop: { x: 0, y: 0, w: 100, h: 50 }, adjust: { brightness: -40, contrast: 0, saturation: 0 } },
      undefined,
      WHITE
    );

    // Crop 800x300 of an 800x600 picture, long side 24: 24 x 9.
    expect(grid?.width).toBe(24);
    expect(grid?.height).toBe(9);
    expect(ctx.filter).toContain('brightness(');
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -400, -300, 800, 600);
  });

  it('turns and mirrors the picture like the frame does', () => {
    const data = new Uint8ClampedArray(24 * 24 * 4).fill(255);
    const ctx: FakeCtx = {
      scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(), filter: 'none',
      getImageData: vi.fn(() => ({ data })),
    };

    stubContext(ctx);
    const grid = readToneGrid(fakeImg(800, 600), { rotation: 90, flipX: true }, undefined, WHITE);

    // A quarter turn swaps the sides: the oriented picture is 600 x 800.
    expect(grid?.width).toBe(18);
    expect(grid?.height).toBe(24);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.scale).toHaveBeenLastCalledWith(-1, 1);
  });

  // Real colour parsing (oklch, translucent layers, color-scheme) is covered in image-chrome.spec.ts:
  // it paints a canvas pixel, and jsdom has no canvas.
  it('without a canvas to read colours, the page counts as white', () => {
    const page = document.createElement('div');

    page.style.backgroundColor = 'rgb(25, 25, 25)';
    document.body.appendChild(page);

    expect(cssColor('rgb(25, 25, 25)')).toBeNull();
    expect(pageBackdrop(page)).toEqual(WHITE);
    expect(document.documentElement.querySelector(':scope > span')).toBeNull();
  });

  it('stamps each control with the tone under it, and clears tones without a grid', () => {
    const figure = document.createElement('figure');
    const img = document.createElement('img');
    const overlay = document.createElement('div');
    const alt = document.createElement('button');

    overlay.setAttribute('data-role', 'image-overlay');
    alt.setAttribute('data-action', 'alt-edit');
    figure.append(img, overlay, alt);
    document.body.appendChild(figure);
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 400));
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(rect(150, 8, 100, 34));
    vi.spyOn(alt, 'getBoundingClientRect').mockReturnValue(rect(8, 360, 120, 24));
    const W = [255, 255, 255, 255];
    const K = [10, 10, 10, 255];
    const grid = luminanceGrid(new Uint8ClampedArray([...W, ...W, ...K, ...K]), 2, 2, WHITE);

    applyTones(figure, grid);
    expect(overlay.getAttribute('data-tone')).toBe('paper');
    expect(alt.getAttribute('data-tone')).toBe('graphite');

    applyTones(figure, null);
    expect(overlay.hasAttribute('data-tone')).toBe(false);
    expect(alt.hasAttribute('data-tone')).toBe(false);
  });
});
