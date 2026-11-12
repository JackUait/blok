import type { ErrorScene, SceneColors, SceneFactory, SceneLayout, ScenePointer } from './types';

/** The sand scene, plus read-only views of its grains. */
export interface SandScene extends ErrorScene {
  /** Grains still in the waveform, as x, y pairs. */
  standing(): Float64Array;
  /** Grains in the air, as x, y pairs. */
  falling(): Float64Array;
  /** Grains at rest in each 2px column of the zone, left to right. */
  pile(): Int16Array;
}

/** Grain pitch. A grain is drawn a little smaller, so the gaps show. */
const GRAIN = 2;
const GRAIN_SIZE = GRAIN - 0.35;
const BAR_STEP = 7;
const BAR_GRAINS = 2;
const SIDE_MARGIN = 44;
/** Bars past this share of the waveform fall whole. */
const BREAK_AT = 0.46;
/** Bars from this share up to the break lose a growing part of their grains. */
const ERODE_AT = 0.32;
const GRAVITY = 1150;
const WALL_BOUNCE = 0.4;
const REACH = 11;
const SWEEP_SPEED = 25;
const SWEEP_COLUMNS = 6;
const SWEEP_CHANCE = 0.55;
const MAX_SLIDES = 8;
/** Reads as a wall: a grain never slides past the zone's edge. */
const WALL = 999;
/** The last grain lets go at about 1.06s. */
const AWAKE_FOR = 1.6;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const hash = (a: number, b = 0): number => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;

  return x - Math.floor(x);
};

/** Grain rows above the middle line for bar i. The bar mirrors them below. */
const barRows = (i: number, amp: number): number => {
  const wave = Math.abs(Math.sin(i * 0.37) * 0.62 + Math.sin(i * 0.93 + 1) * 0.38);

  return Math.max(1, Math.round((0.2 + 0.8 * wave) * (0.62 + 0.38 * hash(i, 5)) * amp / GRAIN));
};

/** Seconds after the break starts when a grain lets go. Infinity: it stays. */
const letGoAt = (i: number, c: number, r: number, f: number): number => {
  if (f >= BREAK_AT) return (f - 0.34) * 1.3 + hash(i * 7 + c, r) * 0.2;
  if (f >= ERODE_AT && hash(i * 31 + r, c + 2) < (f - ERODE_AT) / (BREAK_AT - ERODE_AT)) {
    return (f - ERODE_AT) * 1.3 + hash(r, i) * 0.2;
  }

  return Infinity;
};

/**
 * A waveform made of grains. The first part stands, a short stretch erodes,
 * the rest falls into a pile. The pointer brushes bars loose and sweeps the pile.
 */
export const createSand = ((random: () => number = Math.random): SandScene => {
  const zone = { x: 0, y: 0, width: 0, floor: 0 };
  const s = {
    cols: 0,
    heights: new Int16Array(0),
    t: 0,
    flip: false,
    fixed: 0,
    fixedX: new Float64Array(0),
    fixedY: new Float64Array(0),
    fixedAt: new Float64Array(0),
    loose: 0,
    x: new Float64Array(0),
    y: new Float64Array(0),
    vx: new Float64Array(0),
    vy: new Float64Array(0),
  };

  const rnd = (low: number, high: number): number => low + random() * (high - low);

  const release = (x: number, y: number, vx: number, vy: number): void => {
    const g = s.loose;

    s.x[g] = x;
    s.y[g] = y;
    s.vx[g] = vx;
    s.vy[g] = vy;
    s.loose = g + 1;
  };

  /** Room for every grain in each list: a grain is in exactly one at a time. */
  const allocate = (count: number): void => {
    if (s.fixedX.length === count) return;
    s.fixedX = new Float64Array(count);
    s.fixedY = new Float64Array(count);
    s.fixedAt = new Float64Array(count);
    s.x = new Float64Array(count);
    s.y = new Float64Array(count);
    s.vx = new Float64Array(count);
    s.vy = new Float64Array(count);
  };

  const addBar = (i: number, rows: number, bars: number, x0: number, mid: number): void => {
    const at = { c: 0, r: 0 };

    while (at.c < BAR_GRAINS) {
      at.r = -rows;
      while (at.r < rows) {
        const g = s.fixed;

        s.fixedX[g] = x0 + i * BAR_STEP + at.c * GRAIN;
        s.fixedY[g] = mid + at.r * GRAIN;
        s.fixedAt[g] = letGoAt(i, at.c, at.r, i / bars);
        s.fixed = g + 1;
        at.r += 1;
      }
      at.c += 1;
    }
  };

  /** @returns true when the grain left the waveform */
  const shed = (g: number, p: ScenePointer): boolean => {
    const x = s.fixedX[g];
    const y = s.fixedY[g];

    if (s.t > s.fixedAt[g]) {
      release(x, y, rnd(-28, 28), rnd(-30, 20));

      return true;
    }
    if (p.inside && Math.abs(x - p.x) < REACH && Math.abs(y - p.y) < REACH) {
      release(x, y, p.vx * 0.35 + rnd(-40, 40), p.vy * 0.35 - rnd(0, 70));

      return true;
    }

    return false;
  };

  const shedAll = (p: ScenePointer): void => {
    const count = s.fixed;
    const at = { g: 0, kept: 0 };

    while (at.g < count) {
      const g = at.g;

      if (!shed(g, p)) {
        s.fixedX[at.kept] = s.fixedX[g];
        s.fixedY[at.kept] = s.fixedY[g];
        s.fixedAt[at.kept] = s.fixedAt[g];
        at.kept += 1;
      }
      at.g = g + 1;
    }
    s.fixed = at.kept;
  };

  const slide = (c: number): number => {
    const here = s.heights[c] - 1;
    const left = c > 0 ? s.heights[c - 1] : WALL;
    const right = c < s.cols - 1 ? s.heights[c + 1] : WALL;

    if (left < here && (left <= right || random() < 0.3)) return c - 1;
    if (right < here) return c + 1;

    return c;
  };

  /** A landing grain rolls downhill a few columns before it rests. */
  const land = (start: number): void => {
    const at = { c: start, slides: 0 };

    while (at.slides < MAX_SLIDES) {
      const next = slide(at.c);

      if (next === at.c) break;
      at.c = next;
      at.slides += 1;
    }
    s.heights[at.c] += 1;
  };

  /** @returns true while the grain is still in the air */
  const fly = (g: number, dt: number): boolean => {
    const right = zone.x + zone.width - GRAIN;

    s.vy[g] += GRAVITY * dt;
    s.x[g] += s.vx[g] * dt;
    s.y[g] += s.vy[g] * dt;
    if (s.x[g] < zone.x) {
      s.x[g] = zone.x;
      s.vx[g] = Math.abs(s.vx[g]) * WALL_BOUNCE;
    }
    if (s.x[g] > right) {
      s.x[g] = right;
      s.vx[g] = -Math.abs(s.vx[g]) * WALL_BOUNCE;
    }
    const c = clamp(Math.floor((s.x[g] - zone.x) / GRAIN), 0, s.cols - 1);

    if (s.vy[g] < 0 || s.y[g] + GRAIN < zone.floor - s.heights[c] * GRAIN) return true;
    land(c);

    return false;
  };

  const flyAll = (dt: number): void => {
    const count = s.loose;
    const at = { g: 0, kept: 0 };

    while (at.g < count) {
      const g = at.g;

      if (fly(g, dt)) {
        s.x[at.kept] = s.x[g];
        s.y[at.kept] = s.y[g];
        s.vx[at.kept] = s.vx[g];
        s.vy[at.kept] = s.vy[g];
        at.kept += 1;
      }
      at.g = g + 1;
    }
    s.loose = at.kept;
  };

  /** One pass, in a direction that flips each frame so the pile does not lean. */
  const relax = (): void => {
    const gaps = s.cols - 1;
    const at = { i: 0 };

    s.flip = !s.flip;
    while (at.i < gaps) {
      const c = s.flip ? at.i : gaps - 1 - at.i;
      const drop = s.heights[c] - s.heights[c + 1];

      if (drop > 2) {
        s.heights[c] -= 1;
        s.heights[c + 1] += 1;
      } else if (drop < -2) {
        s.heights[c] += 1;
        s.heights[c + 1] -= 1;
      }
      at.i += 1;
    }
  };

  const sweep = (p: ScenePointer): void => {
    if (!p.inside || Math.hypot(p.vx, p.vy) <= SWEEP_SPEED) return;
    const under = Math.floor((p.x - zone.x) / GRAIN);
    const last = Math.min(s.cols - 1, under + SWEEP_COLUMNS);
    const at = { c: Math.max(0, under - SWEEP_COLUMNS) };

    while (at.c <= last) {
      const c = at.c;
      const top = zone.floor - s.heights[c] * GRAIN;

      if (s.heights[c] > 0 && p.y > top - 10 && random() < SWEEP_CHANCE) {
        s.heights[c] -= 1;
        release(zone.x + c * GRAIN, top - 2, p.vx * 0.35 + rnd(-50, 50), -rnd(140, 300));
      }
      at.c = c + 1;
    }
  };

  const pairs = (xs: Float64Array, ys: Float64Array, count: number): Float64Array => {
    const out = new Float64Array(count * 2);

    out.forEach((_, index) => {
      out[index] = index % 2 === 0 ? xs[index >> 1] : ys[index >> 1];
    });

    return out;
  };

  const rects = (ctx: CanvasRenderingContext2D, xs: Float64Array, ys: Float64Array, count: number): void => {
    const at = { g: 0 };

    while (at.g < count) {
      ctx.rect(xs[at.g], ys[at.g], GRAIN_SIZE, GRAIN_SIZE);
      at.g += 1;
    }
  };

  const pileRects = (ctx: CanvasRenderingContext2D): void => {
    const at = { c: 0, r: 1 };

    while (at.c < s.cols) {
      at.r = 1;
      while (at.r <= s.heights[at.c]) {
        ctx.rect(zone.x + at.c * GRAIN, zone.floor - at.r * GRAIN, GRAIN_SIZE, GRAIN_SIZE);
        at.r += 1;
      }
      at.c += 1;
    }
  };

  return {
    layout(layout: SceneLayout): void {
      zone.x = layout.zone.x;
      zone.y = layout.zone.y;
      zone.width = layout.zone.width;
      zone.floor = layout.zone.floor;
      s.cols = Math.floor(zone.width / GRAIN);
      s.heights = new Int16Array(s.cols);
    },

    reset(): void {
      const bars = Math.max(0, Math.floor((zone.width - SIDE_MARGIN) / BAR_STEP));
      const x0 = zone.x + (zone.width - bars * BAR_STEP) / 2;
      const depth = zone.floor - zone.y;
      const mid = zone.y + depth * 0.4;
      const rows = Array.from({ length: bars }, (_, i) => barRows(i, depth * 0.3));

      allocate(rows.reduce((sum, count) => sum + count * 2 * BAR_GRAINS, 0));
      s.heights.fill(0);
      s.fixed = 0;
      s.loose = 0;
      s.t = 0;
      rows.forEach((count, i) => addBar(i, count, bars, x0, mid));
    },

    step(dt: number, pointer: ScenePointer): boolean {
      s.t += dt;
      shedAll(pointer);
      flyAll(dt);
      relax();
      sweep(pointer);

      return pointer.inside || s.loose > 0 || s.t < AWAKE_FOR;
    },

    paint(ctx: CanvasRenderingContext2D, colors: SceneColors): void {
      const context = ctx;

      context.fillStyle = colors.ink;
      context.beginPath();
      rects(context, s.fixedX, s.fixedY, s.fixed);
      rects(context, s.x, s.y, s.loose);
      pileRects(context);
      context.fill();
    },

    standing: () => pairs(s.fixedX, s.fixedY, s.fixed),
    falling: () => pairs(s.x, s.y, s.loose),
    pile: () => s.heights.slice(),
  };
}) satisfies SceneFactory;
