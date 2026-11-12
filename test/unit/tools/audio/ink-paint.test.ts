import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { inkDistance, paintInk } from '../../../../src/tools/audio/ink-paint';
import { INK_POINTS } from '../../../../src/tools/audio/ink';
import type { InkBall, InkShape } from '../../../../src/tools/audio/ink';

const round = (balls: InkBall[] = [], cx = 22, cy = 22): InkShape => ({
  radii: new Float32Array(INK_POINTS).fill(11.5),
  cx,
  cy,
  balls,
});

describe('inkDistance', () => {
  it('is negative at the centre and positive in the tile corner', () => {
    const shape = round();

    expect(inkDistance(shape, 22, 22)).toBeCloseTo(-11.5, 5);
    expect(inkDistance(shape, 0.5, 0.5)).toBeGreaterThan(10);
  });

  it('is zero on the rest circle, all the way round', () => {
    const shape = round();
    const worst = Array.from({ length: 50 }, (_, i) => i * 0.1257).reduce(
      (far, a) => Math.max(far, Math.abs(inkDistance(shape, 22 + Math.cos(a) * 11.5, 22 + Math.sin(a) * 11.5))),
      0
    );

    expect(worst).toBeLessThan(1e-4);
  });

  it('follows a bump in the edge between two points', () => {
    const shape = round();

    shape.radii[0] = 13.5;
    shape.radii[1] = 12.5;
    const halfStep = Math.PI / INK_POINTS;

    expect(inkDistance(shape, 22 + 13.5, 22)).toBeCloseTo(0, 4);
    expect(inkDistance(shape, 22 + Math.cos(halfStep) * 13, 22 + Math.sin(halfStep) * 13)).toBeCloseTo(0, 4);
    expect(inkDistance(shape, 22 + Math.cos(-halfStep) * 12.5, 22 + Math.sin(-halfStep) * 12.5)).toBeCloseTo(0, 4);
  });

  it('a ball far outside is its own island', () => {
    const shape = round([{ x: 19, y: 0, r: 1, glint: false }]);

    expect(inkDistance(shape, 22 + 19, 22)).toBeCloseTo(-1, 5);
    expect(inkDistance(shape, 22 + 14.75, 22)).toBeGreaterThan(1);
    expect(inkDistance(shape, 22, 22)).toBeCloseTo(-11.5, 5);
  });

  it('a ball just off the surface is joined to the body by a neck', () => {
    const near = { x: 13, y: 0, r: 1, glint: false };

    expect(inkDistance(round([near]), 22 + 11.75, 22)).toBeLessThan(0);
    expect(inkDistance(round(), 22 + 11.75, 22)).toBeGreaterThan(0);
    expect(inkDistance(round([near]), 22 + 11.75, 22)).toBeCloseTo(0.25 - 0.375, 5);
  });

  it('balls sit relative to the drop centre and the field moves with it', () => {
    const shape = round([{ x: 0, y: -19, r: 1, glint: false }], 24, 21);

    expect(inkDistance(shape, 24, 21)).toBeCloseTo(-11.5, 5);
    expect(inkDistance(shape, 24 + 11.5, 21)).toBeCloseTo(0, 4);
    expect(inkDistance(shape, 24, 21 - 19)).toBeCloseTo(-1, 5);
    expect(inkDistance(shape, 22, 22 - 19)).toBeGreaterThan(0);
  });
});

interface FakeOffscreen {
  ctx: CanvasRenderingContext2D;
  image: { data: Uint8ClampedArray; width: number; height: number } | null;
  calls: string[];
  stops: Array<[number, string]>;
  gradientArgs: number[];
}

const fakeOffscreen = (): FakeOffscreen => {
  const fake: FakeOffscreen = { ctx: {} as CanvasRenderingContext2D, image: null, calls: [], stops: [], gradientArgs: [] };
  const gradient = { addColorStop: (at: number, color: string): void => { fake.stops.push([at, color]); } };
  const ctx = {
    globalCompositeOperation: 'source-over',
    fillStyle: '' as unknown,
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    putImageData: (image: FakeOffscreen['image']): void => {
      fake.image = image;
      fake.calls.push(`put:${ctx.globalCompositeOperation}`);
    },
    createRadialGradient: (...args: number[]) => {
      fake.gradientArgs = args;

      return gradient;
    },
    fillRect: (x: number, y: number, w: number, h: number): void => {
      fake.calls.push(`fillRect:${ctx.globalCompositeOperation}:${ctx.fillStyle === gradient ? 'gradient' : 'other'}:${x},${y},${w},${h}`);
    },
  };

  fake.ctx = ctx as unknown as CanvasRenderingContext2D;

  return fake;
};

interface FakeTarget {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  images: unknown[];
}

const fakeTarget = (): FakeTarget => {
  const calls: string[] = [];
  const images: unknown[] = [];
  const log = (name: string) => (...args: number[]): void => {
    calls.push(`${name}:${args.map((n) => Number(n.toFixed(3))).join(',')}`);
  };
  const ctx = {
    fillStyle: '',
    setTransform: log('setTransform'),
    clearRect: log('clearRect'),
    save: log('save'),
    restore: log('restore'),
    translate: log('translate'),
    rotate: log('rotate'),
    beginPath: log('beginPath'),
    ellipse: log('ellipse'),
    fill: (): void => { calls.push(`fill:${ctx.fillStyle}`); },
    drawImage: (image: unknown, ...args: number[]): void => {
      images.push(image);
      log('drawImage')(...args);
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, images };
};

describe('paintInk', () => {
  const OPTS = { ink: '#111', sheen: 'rgba(255, 255, 255, 0.2)', glint: '#fff' };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  // paintInk caches its offscreen canvas per size, so each test that reads the offscreen uses its own size.
  const setup = (): { off: FakeOffscreen; target: FakeTarget } => {
    const off = fakeOffscreen();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(off.ctx);

    return { off, target: fakeTarget() };
  };

  const alphaAt = (off: FakeOffscreen, x: number, y: number): number => {
    if (!off.image) throw new Error('no mask was written');

    return off.image.data[(y * off.image.width + x) * 4 + 3];
  };

  it('writes an alpha mask: opaque in the middle, clear in the corner, soft on the edge', () => {
    const { off, target } = setup();

    paintInk(target.ctx, round(), { ...OPTS, pixels: 44 });

    expect(alphaAt(off, 22, 22)).toBe(255);
    expect(alphaAt(off, 0, 0)).toBe(0);
    expect(alphaAt(off, 43, 43)).toBe(0);
    // Pixel centre 33.5 is exactly on the 11.5 circle: half covered.
    expect(alphaAt(off, 33, 22)).toBeGreaterThan(100);
    expect(alphaAt(off, 33, 22)).toBeLessThan(155);
    expect(alphaAt(off, 34, 22)).toBe(0);
    expect(alphaAt(off, 32, 22)).toBe(255);
  });

  it('scales the mask with the backing size', () => {
    const { off, target } = setup();

    paintInk(target.ctx, round(), { ...OPTS, pixels: 88 });

    expect(off.image?.width).toBe(88);
    expect(alphaAt(off, 44, 44)).toBe(255);
    expect(alphaAt(off, 65, 44)).toBe(255);
    expect(alphaAt(off, 68, 44)).toBe(0);
  });

  it('puts droplets and their necks in the mask', () => {
    const { off, target } = setup();

    paintInk(target.ctx, round([{ x: 13, y: 0, r: 1, glint: false }, { x: 0, y: 18, r: 1.2, glint: false }]), { ...OPTS, pixels: 132 });

    // 3 px per unit: tile x = 22 + 11.75 is the neck, tile y = 22 + 18 the island.
    expect(alphaAt(off, Math.floor(33.75 * 3), 66)).toBeGreaterThan(200);
    expect(alphaAt(off, 66, 120)).toBe(255);
    expect(alphaAt(off, 66, 108)).toBe(0);
  });

  it('fills the mask with ink, then lays the sheen over it', () => {
    const { off, target } = setup();

    paintInk(target.ctx, round(), { ...OPTS, pixels: 66 });

    expect(off.calls).toEqual(['put:source-over', 'fillRect:source-in:other:0,0,66,66', 'fillRect:source-atop:gradient:0,0,66,66']);
    expect(off.stops).toEqual([[0, 'rgba(255, 255, 255, 0.2)'], [0.55, 'rgba(255, 255, 255, 0)']]);
    expect(off.gradientArgs).toEqual([25.5, 22.5, 1.5, 33, 33, 25.5]);
  });

  it('clears the canvas and draws the body shifted with the drop centre', () => {
    const { target } = setup();

    paintInk(target.ctx, round([], 23.5, 21), { ...OPTS, pixels: 110 });

    expect(target.calls.slice(0, 3)).toEqual(['setTransform:2.5,0,0,2.5,0,0', 'clearRect:0,0,44,44', 'drawImage:1.5,-1,44,44']);
    expect(target.images[0]).toBeInstanceOf(HTMLCanvasElement);
  });

  it('draws the highlight on the body and a glint only on glinting droplets', () => {
    const { target } = setup();
    const balls = [{ x: 15, y: 0, r: 2, glint: true }, { x: -15, y: 0, r: 2, glint: false }];

    paintInk(target.ctx, round(balls, 23, 22), { ...OPTS, pixels: 44 });

    expect(target.calls.filter((c) => c.startsWith('translate'))).toEqual(['translate:18.5,15.5', 'translate:37.36,21.24']);
    expect(target.calls.filter((c) => c.startsWith('ellipse'))).toEqual([
      `ellipse:0,0,3.6,1.3,0,0,${Number((Math.PI * 2).toFixed(3))}`,
      `ellipse:0,0,0.68,0.3,0,0,${Number((Math.PI * 2).toFixed(3))}`,
    ]);
    expect(target.calls.filter((c) => c.startsWith('fill'))).toEqual(['fill:#fff', 'fill:#fff']);
    expect(target.calls.filter((c) => c.startsWith('rotate'))).toEqual(['rotate:-0.7', 'rotate:-0.7']);
  });

  it('does nothing when the offscreen canvas has no 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const target = fakeTarget();

    paintInk(target.ctx, round(), { ...OPTS, pixels: 50 });

    expect(target.calls.filter((c) => c.startsWith('drawImage'))).toEqual([]);
  });
});
