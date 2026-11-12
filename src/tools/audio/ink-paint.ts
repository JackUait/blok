import { INK_POINTS, INK_TILE } from './ink';
import type { InkShape } from './ink';

/** `sheen` is a light colour with alpha: it is laid over the ink, so it works on dark and light ink alike. */
export interface InkPaintOptions { pixels: number; ink: string; sheen: string; glint: string }

const TAU = Math.PI * 2;
const HOME = INK_TILE / 2;
/** How far apart two surfaces start to pull into one neck, in tile units. */
const BLEND = 1.5;
const SHINE_TILT = -0.7;

/** Smooth union of two signed distances: the lower one, pulled down where they are close. */
const blend = (d: number, other: number): number => {
  const near = BLEND - Math.abs(d - other);

  return Math.min(d, other) - (near > 0 ? near * near / BLEND * 0.25 : 0);
};

/** Signed distance (tile units, negative = inside the ink) at tile point (x, y): body and balls joined by a smooth union. */
export function inkDistance(shape: InkShape, x: number, y: number): number {
  const ux = x - shape.cx;
  const uy = y - shape.cy;
  const turn = ((Math.atan2(uy, ux) % TAU) + TAU) % TAU / TAU * INK_POINTS;
  const whole = Math.floor(turn);
  const frac = turn - whole;
  const i0 = whole % INK_POINTS;
  const edge = shape.radii[i0] * (1 - frac) + shape.radii[(i0 + 1) % INK_POINTS] * frac;

  return shape.balls.reduce(
    (d, ball) => blend(d, Math.hypot(ux - ball.x, uy - ball.y) - ball.r),
    Math.hypot(ux, uy) - edge
  );
}

/** Per-size lookups, relative to the drop centre: they do not change between frames. */
interface Field {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  x: Float32Array;
  y: Float32Array;
  rho: Float32Array;
  i0: Uint8Array;
  i1: Uint8Array;
  frac: Float32Array;
  dist: Float32Array;
}

const fields = new Map<number, Field>();

const fieldOf = (pixels: number): Field | null => {
  const cached = fields.get(pixels);

  if (cached) return cached;
  const canvas = document.createElement('canvas');

  canvas.width = pixels;
  canvas.height = pixels;
  const ctx = canvas.getContext('2d');

  if (!ctx) return null;
  const count = pixels * pixels;
  const perUnit = pixels / INK_TILE;
  const field: Field = {
    canvas,
    ctx,
    image: ctx.createImageData(pixels, pixels),
    x: new Float32Array(count),
    y: new Float32Array(count),
    rho: new Float32Array(count),
    i0: new Uint8Array(count),
    i1: new Uint8Array(count),
    frac: new Float32Array(count),
    dist: new Float32Array(count),
  };

  field.rho.forEach((_, p) => {
    const ux = ((p % pixels) + 0.5) / perUnit - HOME;
    const uy = (Math.floor(p / pixels) + 0.5) / perUnit - HOME;
    const turn = ((Math.atan2(uy, ux) % TAU) + TAU) % TAU / TAU * INK_POINTS;
    const whole = Math.floor(turn);

    field.x[p] = ux;
    field.y[p] = uy;
    field.rho[p] = Math.hypot(ux, uy);
    field.i0[p] = whole % INK_POINTS;
    field.i1[p] = (whole + 1) % INK_POINTS;
    field.frac[p] = turn - whole;
  });
  fields.set(pixels, field);

  return field;
};

const writeMask = (field: Field, shape: InkShape, perUnit: number): void => {
  const { x, y, rho, i0, i1, frac, dist } = field;
  const { radii } = shape;
  const alpha = field.image.data;
  const count = dist.length;
  // Plain counted loops: typed-array forEach is many times slower here.
  const at = { p: 0 };

  while (at.p < count) {
    const p = at.p;
    const f = frac[p];

    dist[p] = rho[p] - (radii[i0[p]] * (1 - f) + radii[i1[p]] * f);
    at.p = p + 1;
  }
  // One pass per ball, in ball order: the union is not symmetric.
  shape.balls.forEach((ball) => {
    at.p = 0;
    while (at.p < count) {
      const p = at.p;
      const dx = x[p] - ball.x;
      const dy = y[p] - ball.y;

      dist[p] = blend(dist[p], Math.sqrt(dx * dx + dy * dy) - ball.r);
      at.p = p + 1;
    }
  });
  at.p = 0;
  while (at.p < count) {
    // The clamped array clamps and rounds for us.
    alpha[at.p * 4 + 3] = (0.5 - dist[at.p] * perUnit) * 255;
    at.p += 1;
  }
};

const shine = (ctx: CanvasRenderingContext2D, x: number, y: number, long: number, short: number): void => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(SHINE_TILT);
  ctx.beginPath();
  ctx.ellipse(0, 0, long, short, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
};

/** Clears and paints the whole canvas (ctx.canvas is pixels x pixels). */
export function paintInk(ctx: CanvasRenderingContext2D, shape: InkShape, opts: InkPaintOptions): void {
  const { pixels } = opts;
  const field = fieldOf(pixels);

  if (!field) return;
  const perUnit = pixels / INK_TILE;
  const off = field.ctx;
  const half = pixels / 2;

  writeMask(field, shape, perUnit);
  // putImageData ignores compositing, but the mask must land before the source-in fill.
  off.globalCompositeOperation = 'source-over';
  off.putImageData(field.image, 0, 0);
  const gradient = off.createRadialGradient(half - 5 * perUnit, half - 7 * perUnit, perUnit, half, half, 17 * perUnit);

  gradient.addColorStop(0, opts.sheen);
  gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
  off.globalCompositeOperation = 'source-in';
  off.fillStyle = opts.ink;
  off.fillRect(0, 0, pixels, pixels);
  off.globalCompositeOperation = 'source-atop';
  off.fillStyle = gradient;
  off.fillRect(0, 0, pixels, pixels);

  const target = ctx;

  target.setTransform(perUnit, 0, 0, perUnit, 0, 0);
  target.clearRect(0, 0, INK_TILE, INK_TILE);
  target.drawImage(field.canvas, shape.cx - HOME, shape.cy - HOME, INK_TILE, INK_TILE);
  target.fillStyle = opts.glint;
  shine(target, shape.cx - 4.5, shape.cy - 6.5, 3.6, 1.3);
  shape.balls.filter((ball) => ball.glint).forEach((ball) => {
    shine(target, shape.cx + ball.x - ball.r * 0.32, shape.cy + ball.y - ball.r * 0.38, ball.r * 0.34, ball.r * 0.15);
  });
}
