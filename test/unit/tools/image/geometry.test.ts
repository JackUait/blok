import { describe, it, expect } from 'vitest';
import type { ImageCrop, ImageData, ImageRotation } from '../../../../types/tools/image';
import type { Point, Size } from '../../../../src/tools/image/darkroom/camera';
import {
  IDENTITY,
  readGeometry,
  geometryFields,
  isIdentity,
  orientedSize,
  rotateLeft,
  flipHorizontal,
  coverScale,
  clampCentre,
  coverCrop,
  planeImageStyle,
  type Geometry,
} from '../../../../src/tools/image/geometry';

/** Lets a test feed values the saved-data type forbids. */
const raw = (v: Record<string, unknown>): Partial<ImageData> => ({ ...v });
const ROTATIONS: ImageRotation[] = [0, 90, 180, 270];
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Natural px -> O px: mirror, then clockwise quarter turns, then straighten about O's centre (y down). */
const toO = (p: Point, n: Size, g: Geometry): Point => {
  let x = g.flipX ? n.w - p.x : p.x;
  let y = p.y;
  let box: Size = { w: n.w, h: n.h };

  for (let i = 0; i < g.rotation / 90; i++) {
    [x, y] = [box.h - y, x];
    box = { w: box.h, h: box.w };
  }

  const t = rad(g.straighten);
  const dx = x - box.w / 2;
  const dy = y - box.h / 2;

  return {
    x: box.w / 2 + dx * Math.cos(t) - dy * Math.sin(t),
    y: box.h / 2 + dx * Math.sin(t) + dy * Math.cos(t),
  };
};

/** Where a point sits inside the crop, 0..1 on each axis. */
const inCrop = (p: Point, o: Size, crop: ImageCrop): Point => ({
  x: ((p.x / o.w) * 100 - crop.x) / crop.w,
  y: ((p.y / o.h) * 100 - crop.y) / crop.h,
});

const SAMPLES: Point[] = [
  { x: 10, y: 20 },
  { x: 250, y: 90 },
  { x: 399, y: 1 },
  { x: 123.5, y: 299 },
];

const N: Size = { w: 400, h: 300 };
const CROP: ImageCrop = { x: 12, y: 8, w: 40, h: 55 };

const allGeometries = (): Geometry[] =>
  ROTATIONS.flatMap((rotation) =>
    [false, true].flatMap((flipX) => [0, 7.5, -30].map((straighten) => ({ rotation, flipX, straighten })))
  );

/** Does the frame (O px, centre c), turned back by -theta about O's centre, lie inside O? */
const frameInsideTurnedContent = (c: Point, frame: Size, o: Size, theta: number): boolean => {
  const t = rad(theta);
  const signs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const corners = signs.map(([sx, sy]) => {
    const dx = c.x - o.w / 2 + (sx * frame.w) / 2;
    const dy = c.y - o.h / 2 + (sy * frame.h) / 2;

    // Undo the clockwise turn: rotate by -theta.
    return { x: dx * Math.cos(t) + dy * Math.sin(t), y: -dx * Math.sin(t) + dy * Math.cos(t) };
  });
  const eps = 1e-6;

  return corners.every((p) => Math.abs(p.x) <= o.w / 2 + eps && Math.abs(p.y) <= o.h / 2 + eps);
};

describe('readGeometry', () => {
  it('returns identity for missing fields', () => {
    expect(readGeometry({})).toEqual(IDENTITY);
    expect(IDENTITY).toEqual({ rotation: 0, flipX: false, straighten: 0 });
  });

  it('keeps only exact quarter turns', () => {
    for (const r of ROTATIONS) {
      expect(readGeometry({ rotation: r }).rotation).toBe(r);
    }
    expect(readGeometry(raw({ rotation: 45 })).rotation).toBe(0);
    expect(readGeometry(raw({ rotation: '90' })).rotation).toBe(0);
    expect(readGeometry(raw({ rotation: 360 })).rotation).toBe(0);
  });

  it('treats only true as a mirror', () => {
    expect(readGeometry({ flipX: true }).flipX).toBe(true);
    expect(readGeometry(raw({ flipX: 'true' })).flipX).toBe(false);
    expect(readGeometry(raw({ flipX: 1 })).flipX).toBe(false);
  });

  it('clamps straighten to +-45, rounds to 0.1 and drops -0', () => {
    expect(readGeometry({ straighten: 60 }).straighten).toBe(45);
    expect(readGeometry({ straighten: -90 }).straighten).toBe(-45);
    expect(readGeometry({ straighten: 12.345 }).straighten).toBe(12.3);
    expect(readGeometry({ straighten: -12.36 }).straighten).toBe(-12.4);
    expect(Object.is(readGeometry({ straighten: -0.04 }).straighten, 0)).toBe(true);
    expect(Object.is(readGeometry({ straighten: -0 }).straighten, 0)).toBe(true);
    expect(readGeometry({ straighten: Number.NaN }).straighten).toBe(0);
    expect(readGeometry({ straighten: Number.POSITIVE_INFINITY }).straighten).toBe(0);
    expect(readGeometry(raw({ straighten: '5' })).straighten).toBe(0);
  });
});

describe('geometryFields / isIdentity', () => {
  it('omits every default', () => {
    expect(geometryFields(IDENTITY)).toEqual({});
    expect(isIdentity(IDENTITY)).toBe(true);
  });

  it('keeps only the non-default fields', () => {
    expect(geometryFields({ rotation: 90, flipX: false, straighten: 0 })).toEqual({ rotation: 90 });
    expect(geometryFields({ rotation: 0, flipX: true, straighten: 0 })).toEqual({ flipX: true });
    expect(geometryFields({ rotation: 0, flipX: false, straighten: -3.5 })).toEqual({ straighten: -3.5 });
    expect(isIdentity({ rotation: 0, flipX: false, straighten: 0.1 })).toBe(false);
    expect(isIdentity({ rotation: 180, flipX: false, straighten: 0 })).toBe(false);
    expect(isIdentity({ rotation: 0, flipX: true, straighten: 0 })).toBe(false);
  });
});

describe('orientedSize', () => {
  it('swaps on quarter turns only', () => {
    expect(orientedSize(N, { ...IDENTITY, rotation: 0 })).toEqual({ w: 400, h: 300 });
    expect(orientedSize(N, { ...IDENTITY, rotation: 90 })).toEqual({ w: 300, h: 400 });
    expect(orientedSize(N, { ...IDENTITY, rotation: 180 })).toEqual({ w: 400, h: 300 });
    expect(orientedSize(N, { ...IDENTITY, rotation: 270, flipX: true })).toEqual({ w: 300, h: 400 });
  });
});

describe('rotateLeft', () => {
  it('maps every pixel to the place a 90 degree counter-clockwise view turn puts it', () => {
    for (const g of allGeometries()) {
      const next = rotateLeft(g, CROP);
      const o = orientedSize(N, g);
      const o2 = orientedSize(N, next.g);

      for (const p of SAMPLES) {
        const before = inCrop(toO(p, N, g), o, CROP);
        const after = inCrop(toO(p, N, next.g), o2, next.crop);

        expect(after.x).toBeCloseTo(before.y, 9);
        expect(after.y).toBeCloseTo(1 - before.x, 9);
      }
    }
  });

  it('applies the documented formulas and keeps shape', () => {
    const r = rotateLeft({ rotation: 0, flipX: true, straighten: 4 }, { ...CROP, shape: 'circle' });

    expect(r.g).toEqual({ rotation: 270, flipX: true, straighten: 4 });
    expect(r.crop).toEqual({ x: 8, y: 48, w: 55, h: 40, shape: 'circle' });
  });

  it('comes back to the start after four turns', () => {
    let state = { g: { rotation: 90, flipX: true, straighten: -6 } as Geometry, crop: CROP };

    for (let i = 0; i < 4; i++) state = rotateLeft(state.g, state.crop);

    expect(state.g).toEqual({ rotation: 90, flipX: true, straighten: -6 });
    expect(state.crop.x).toBeCloseTo(CROP.x, 9);
    expect(state.crop.y).toBeCloseTo(CROP.y, 9);
    expect(state.crop.w).toBeCloseTo(CROP.w, 9);
    expect(state.crop.h).toBeCloseTo(CROP.h, 9);
    expect(state.crop).not.toHaveProperty('shape');
  });
});

describe('flipHorizontal', () => {
  it('maps every pixel to its left-right mirror inside the crop', () => {
    for (const g of allGeometries()) {
      const next = flipHorizontal(g, CROP);
      const o = orientedSize(N, g);
      const o2 = orientedSize(N, next.g);

      for (const p of SAMPLES) {
        const before = inCrop(toO(p, N, g), o, CROP);
        const after = inCrop(toO(p, N, next.g), o2, next.crop);

        expect(after.x).toBeCloseTo(1 - before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      }
    }
  });

  it('applies the documented formulas, keeps shape and never returns -0', () => {
    const r = flipHorizontal({ rotation: 90, flipX: false, straighten: 3 }, { ...CROP, shape: 'ellipse' });

    expect(r.g).toEqual({ rotation: 270, flipX: true, straighten: -3 });
    expect(r.crop).toEqual({ x: 48, y: 8, w: 40, h: 55, shape: 'ellipse' });
    expect(Object.is(flipHorizontal(IDENTITY, CROP).g.straighten, 0)).toBe(true);
    expect(flipHorizontal(IDENTITY, CROP).g.rotation).toBe(0);
  });

  it('is undone by a second flip', () => {
    const g: Geometry = { rotation: 270, flipX: false, straighten: 11 };
    const twice = flipHorizontal(flipHorizontal(g, CROP).g, flipHorizontal(g, CROP).crop);

    expect(twice.g).toEqual(g);
    expect(twice.crop).toEqual(CROP);
  });
});

describe('coverScale', () => {
  it('is the plain cover scale at zero', () => {
    expect(coverScale({ w: 200, h: 100 }, { w: 400, h: 400 }, 0)).toBeCloseTo(0.5, 12);
    expect(coverScale({ w: 200, h: 300 }, { w: 400, h: 400 }, 0)).toBeCloseTo(0.75, 12);
  });

  it('is exact: the frame at that scale just fits the turned image, at +-45 too', () => {
    const frame: Size = { w: 300, h: 200 };
    const o: Size = { w: 800, h: 500 };

    for (const theta of [-45, -20, 5, 33, 45]) {
      const s = coverScale(frame, o, theta);
      const inO: Size = { w: frame.w / s, h: frame.h / s };
      const centre: Point = { x: o.w / 2, y: o.h / 2 };

      expect(frameInsideTurnedContent(centre, inO, o, theta)).toBe(true);
      expect(frameInsideTurnedContent(centre, { w: inO.w * 1.001, h: inO.h * 1.001 }, o, theta)).toBe(false);
    }
  });

  it('is symmetric in the sign of theta', () => {
    expect(coverScale({ w: 300, h: 200 }, { w: 800, h: 500 }, 17)).toBeCloseTo(
      coverScale({ w: 300, h: 200 }, { w: 800, h: 500 }, -17),
      12
    );
  });
});

describe('clampCentre', () => {
  const o: Size = { w: 800, h: 500 };
  const frame: Size = { w: 200, h: 120 };

  it('leaves a centre that already fits untouched', () => {
    expect(clampCentre({ x: 400, y: 250 }, frame, o, 20)).toEqual({ x: 400, y: 250 });
    expect(clampCentre({ x: 410, y: 240 }, frame, o, 0)).toEqual({ x: 410, y: 240 });
  });

  it('matches the plain axis clamp at zero', () => {
    expect(clampCentre({ x: -50, y: 900 }, frame, o, 0)).toEqual({ x: 100, y: 440 });
  });

  it('pulls a far centre back so the frame stays inside the turned image, on the edge', () => {
    for (const theta of [-45, -12, 12, 45]) {
      for (const c of [
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 500 },
        { x: -300, y: 250 },
      ]) {
        const out = clampCentre(c, frame, o, theta);

        expect(frameInsideTurnedContent(out, frame, o, theta)).toBe(true);
        // On the boundary: nudging further toward the requested centre leaves the image.
        const nudge = { x: out.x + (c.x - out.x) * 0.01, y: out.y + (c.y - out.y) * 0.01 };
        expect(frameInsideTurnedContent(nudge, frame, o, theta)).toBe(false);
      }
    }
  });

  it('pins to the centre when the frame is too big on an axis', () => {
    const out = clampCentre({ x: 0, y: 0 }, { w: 900, h: 600 }, o, 0);

    expect(out).toEqual({ x: 400, y: 250 });
  });
});

describe('coverCrop', () => {
  const o: Size = { w: 800, h: 500 };
  const asFrame = (c: ImageCrop): { centre: Point; frame: Size } => ({
    centre: { x: ((c.x + c.w / 2) / 100) * o.w, y: ((c.y + c.h / 2) / 100) * o.h },
    frame: { w: (c.w / 100) * o.w, h: (c.h / 100) * o.h },
  });

  it('returns a covered crop unchanged', () => {
    const crop: ImageCrop = { x: 40, y: 40, w: 20, h: 20, shape: 'circle' };

    expect(coverCrop(crop, o, 10)).toEqual(crop);
    expect(coverCrop({ x: 0, y: 0, w: 100, h: 100 }, o, 0)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('shrinks the full rect about its centre, keeps aspect, and is covered', () => {
    for (const theta of [-45, -8, 8, 45]) {
      const out = coverCrop({ x: 0, y: 0, w: 100, h: 100 }, o, theta);
      const { centre, frame } = asFrame(out);

      expect(out.w / out.h).toBeCloseTo(1, 9);
      expect(out.x + out.w / 2).toBeCloseTo(50, 9);
      expect(out.y + out.h / 2).toBeCloseTo(50, 9);
      expect(frameInsideTurnedContent(centre, frame, o, theta)).toBe(true);
      // Exact: any bigger frame would not fit.
      expect(frameInsideTurnedContent(centre, { w: frame.w * 1.001, h: frame.h * 1.001 }, o, theta)).toBe(false);
    }
  });

  it('moves a corner crop inward so it is covered and still inside 0..100, keeping shape', () => {
    for (const theta of [-30, 30, 45]) {
      const out = coverCrop({ x: 0, y: 0, w: 30, h: 30, shape: 'ellipse' }, o, theta);
      const { centre, frame } = asFrame(out);

      expect(out.shape).toBe('ellipse');
      expect(out.w / out.h).toBeCloseTo(1, 9);
      expect(frameInsideTurnedContent(centre, frame, o, theta)).toBe(true);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.x + out.w).toBeLessThanOrEqual(100 + 1e-9);
      expect(out.y + out.h).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it('keeps a wide thin crop inside O box even where the turned content pokes past it', () => {
    // A tall narrow O tilted slightly is wider than O.w along a horizontal line.
    const tall: Size = { w: 100, h: 1000 };
    const out = coverCrop({ x: 0, y: 0, w: 100, h: 0.5 }, tall, 3);
    const centre = { x: ((out.x + out.w / 2) / 100) * tall.w, y: ((out.y + out.h / 2) / 100) * tall.h };
    const frame = { w: (out.w / 100) * tall.w, h: (out.h / 100) * tall.h };

    expect(frameInsideTurnedContent(centre, frame, tall, 3)).toBe(true);
    expect(out.x).toBeGreaterThanOrEqual(-1e-9);
    expect(out.y).toBeGreaterThanOrEqual(-1e-9);
    expect(out.x + out.w).toBeLessThanOrEqual(100 + 1e-9);
    expect(out.y + out.h).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe('planeImageStyle', () => {
  it('fills the plane exactly with no transform noise at identity', () => {
    expect(planeImageStyle(N, IDENTITY)).toEqual({
      width: '100%',
      height: '100%',
      left: '0%',
      top: '0%',
      transform: 'rotate(0deg)',
    });
  });

  it('centres the unturned img in a quarter-turned plane, compactly formatted', () => {
    expect(planeImageStyle(N, { rotation: 90, flipX: true, straighten: -2.5 })).toEqual({
      width: '133.3333%',
      height: '75%',
      left: '-16.6667%',
      top: '12.5%',
      transform: 'rotate(87.5deg) scaleX(-1)',
    });
  });

  it('puts every natural pixel where the coordinate model says, for every rotation and flip', () => {
    for (const g of allGeometries()) {
      const st = planeImageStyle(N, g);
      const o = orientedSize(N, g);
      const pct = (s: string): number => Number.parseFloat(s) / 100;
      const box = { x: pct(st.left) * o.w, y: pct(st.top) * o.h, w: pct(st.width) * o.w, h: pct(st.height) * o.h };
      const deg = Number.parseFloat(st.transform.slice('rotate('.length));
      const mirrored = st.transform.includes('scaleX(-1)');

      expect(box.w).toBeCloseTo(N.w, 2);
      expect(box.h).toBeCloseTo(N.h, 2);

      for (const p of SAMPLES) {
        // CSS: scaleX(-1) first, then rotate, both about the img centre.
        const dx0 = p.x - N.w / 2;
        const dx = mirrored ? -dx0 : dx0;
        const dy = p.y - N.h / 2;
        const t = rad(deg);
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const css = { x: cx + dx * Math.cos(t) - dy * Math.sin(t), y: cy + dx * Math.sin(t) + dy * Math.cos(t) };
        const model = toO(p, N, g);

        expect(css.x).toBeCloseTo(model.x, 1);
        expect(css.y).toBeCloseTo(model.y, 1);
      }
    }
  });
});
