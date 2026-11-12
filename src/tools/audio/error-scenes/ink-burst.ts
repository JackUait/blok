/**
 * Ink burst: a round ink drop bursts into a splat with fast streaks and loose
 * droplets, then a few drips run down. The ink stays wet, so a pointer dragged
 * through it smears it until the finger runs dry.
 */
import type { ErrorScene, SceneColors, SceneFactory, SceneLayout, ScenePointer, SceneZone } from './types';

/** One droplet in flight. Speeds are CSS pixels per second. */
export interface InkDroplet { x: number; y: number; vx: number; vy: number; r: number; streak: boolean }

/** One drip. `wait` is the seconds left before it runs, `gone` how far it ran out of `len`. */
export interface InkDrip { x: number; y: number; r: number; len: number; gone: number; v: number; wait: number }

/** The scene plus read-only views of its state. */
export interface InkBurstScene extends ErrorScene {
  readonly goo: true;
  paintOverlay(ctx: CanvasRenderingContext2D, colors: SceneColors): void;
  /** Copies of the droplets still flying. */
  droplets(): InkDroplet[];
  /** Copies of the drips still waiting or running. */
  drips(): InkDrip[];
  /** Whether the stain holds ink at this canvas point, in CSS pixels. */
  isWet(x: number, y: number): boolean;
}

const TAU = Math.PI * 2;

/** Radius of the drop, and of the splat's core. */
const CORE = 27;
/** Where the drop sits between the zone's top and its floor. */
const CENTRE_Y = 0.4;

const LOBES = 11;
const LOBE_TURN = 0.25;
const LOBE_NEAR = 17;
const LOBE_FAR = 29;
const LOBE_MIN = 8;
const LOBE_MAX = 15;

const DROPLETS = 56;
/** Droplets start on this ring, inside the core. */
const DROPLET_RING = 20;
const DROPLET_MIN = 1.6;
const DROPLET_GROW = 5.5;
const SPEED_MIN = 260;
const SPEED_MAX = 1500;
/** Big droplets fly slower: speed is scaled by SPEED_BASE - size * SPEED_DRAG. */
const SPEED_BASE = 1.15;
const SPEED_DRAG = 0.7;
const STREAK_SHARE = 0.45;
/** A streak droplet draws its trail only above this speed. */
const STREAK_SPEED = 160;
const STREAK_STEP = 2;
const STREAK_WIDTH = 0.42;
const STREAK_MIN = 1.2;
/** Speed lost per second, as an exponent. */
const FRICTION = 7.5;
/** Below this speed a droplet lands. */
const LAND_SPEED = 12;

const DRIPS = 5;
const DRIP_GAP = 11;
const DRIP_SHIFT = 4;
const DRIP_TOP_MIN = 18;
const DRIP_TOP_MAX = 26;
const DRIP_MIN = 3.6;
const DRIP_MAX = 6;
/** Kept free between the longest drip and the floor. */
const DRIP_ROOM = 30;
const DRIP_SHORT = 0.3;
const DRIP_SLOW = 70;
const DRIP_FAST = 130;
const DRIP_WAIT_MIN = 0.15;
const DRIP_WAIT_MAX = 1.3;
const DRIP_FRICTION = 0.9;
/** A drip never crawls slower than this. */
const DRIP_CRAWL = 9;
const DRIP_STEP = 1.2;
const DRIP_TRAIL = 0.56;
const DRIP_FLOOR_GAP = 3;

/** Pixels of smear one touch of ink gives the finger. */
const DRY_AFTER = 150;
const SMEAR_STEP = 2;
const SMEAR_MIN = 1.4;
const SMEAR_GROW = 6.5;
/** Pointer moves shorter than this leave no mark. */
const SMEAR_SLACK = 0.5;

/** Side of one wetness cell, in CSS pixels. */
const CELL = 2;
/** Any opaque colour: paint() recolours the stain with the theme's ink. */
const STAMP_INK = '#000';
const GLINT = 'rgba(255, 255, 255, 0.5)';

interface State {
  width: number;
  height: number;
  scale: number;
  zone: SceneZone;
  cx: number;
  cy: number;
  stain: HTMLCanvasElement | null;
  sctx: CanvasRenderingContext2D | null;
  /** 1 where the stain holds ink. Cells start at the zone's corner, so none lies outside it. */
  grid: Uint8Array;
  cols: number;
  rows: number;
  live: InkDroplet[];
  drips: InkDrip[];
  burst: boolean;
  /** Ink left on the finger, 0..1. */
  wet: number;
  touching: boolean;
  lastX: number;
  lastY: number;
}

const times = (count: number, each: (i: number) => void): void => {
  const at = { i: 0 };

  while (at.i < count) {
    each(at.i);
    at.i += 1;
  }
};

const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
};

/**
 * Builds the ink burst scene.
 * @param random - 0..1 source; tests pass a fixed one
 */
export const createInkBurst = ((random: () => number = Math.random): InkBurstScene => {
  const state: State = {
    width: 0,
    height: 0,
    scale: 1,
    zone: { x: 0, y: 0, width: 0, floor: 0 },
    cx: 0,
    cy: 0,
    stain: null,
    sctx: null,
    grid: new Uint8Array(0),
    cols: 0,
    rows: 0,
    live: [],
    drips: [],
    burst: false,
    wet: 0,
    touching: false,
    lastX: 0,
    lastY: 0,
  };

  const between = (from: number, to: number): number => from + random() * (to - from);

  /** Index of the cell under a canvas point, or -1 outside the zone. */
  const cellAt = (x: number, y: number): number => {
    const { zone, cols } = state;

    if (x < zone.x || x >= zone.x + zone.width || y < zone.y || y >= zone.floor) return -1;

    return Math.floor((y - zone.y) / CELL) * cols + Math.floor((x - zone.x) / CELL);
  };

  const mark = (x: number, y: number, r: number): void => {
    const { grid, cols, rows, zone } = state;
    const gx = x - zone.x;
    const gy = y - zone.y;
    const col0 = Math.max(0, Math.floor((gx - r) / CELL));
    const col1 = Math.min(cols - 1, Math.floor((gx + r) / CELL));
    const row0 = Math.max(0, Math.floor((gy - r) / CELL));
    const row1 = Math.min(rows - 1, Math.floor((gy + r) / CELL));

    if (col1 < col0 || row1 < row0) return;
    const span = col1 - col0 + 1;

    times(span * (row1 - row0 + 1), (i) => {
      const col = col0 + i % span;
      const row = row0 + Math.floor(i / span);
      const dx = (col + 0.5) * CELL - gx;
      const dy = (row + 0.5) * CELL - gy;

      if (dx * dx + dy * dy <= r * r) grid[row * cols + col] = 1;
    });
    // A stamp thinner than a cell can miss every cell centre.
    const own = cellAt(x, y);

    if (own >= 0) grid[own] = 1;
  };

  const stamp = (x: number, y: number, r: number): void => {
    mark(x, y, r);
    if (state.sctx) dot(state.sctx, x, y, r);
  };

  const pop = (): void => {
    const { cx, cy, zone } = state;

    state.burst = true;
    stamp(cx, cy, CORE);
    times(LOBES, (i) => {
      const angle = i * TAU / LOBES + between(-LOBE_TURN, LOBE_TURN);
      const reach = between(LOBE_NEAR, LOBE_FAR);

      stamp(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach, between(LOBE_MIN, LOBE_MAX));
    });
    state.live = Array.from({ length: DROPLETS }, () => {
      const angle = between(0, TAU);
      const big = random();
      const r = DROPLET_MIN + big * big * DROPLET_GROW;
      const speed = between(SPEED_MIN, SPEED_MAX) * (SPEED_BASE - big * SPEED_DRAG);

      return {
        x: cx + Math.cos(angle) * DROPLET_RING,
        y: cy + Math.sin(angle) * DROPLET_RING,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r,
        streak: random() < STREAK_SHARE,
      };
    });
    const room = zone.floor - cy - DRIP_ROOM;

    state.drips = Array.from({ length: DRIPS }, (_, i) => ({
      x: cx + (i - (DRIPS - 1) / 2) * DRIP_GAP + between(-DRIP_SHIFT, DRIP_SHIFT),
      y: cy + between(DRIP_TOP_MIN, DRIP_TOP_MAX),
      r: between(DRIP_MIN, DRIP_MAX),
      len: between(DRIP_SHORT, 1) * room,
      gone: 0,
      v: between(DRIP_SLOW, DRIP_FAST),
      wait: between(DRIP_WAIT_MIN, DRIP_WAIT_MAX),
    }));
  };

  /** @returns false once the droplet has landed */
  const fly = (index: number, dt: number, friction: number): boolean => {
    const drop = state.live[index];
    const speed = Math.hypot(drop.vx, drop.vy);

    if (drop.streak && speed > STREAK_SPEED) {
      const count = Math.ceil(speed * dt / STREAK_STEP);
      const r = Math.max(STREAK_MIN, drop.r * STREAK_WIDTH);

      times(count, (i) => stamp(drop.x + drop.vx * dt * i / count, drop.y + drop.vy * dt * i / count, r));
    }
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    drop.vx *= friction;
    drop.vy *= friction;
    if (speed >= LAND_SPEED) return true;
    stamp(drop.x, drop.y, drop.r);

    return false;
  };

  /** @returns false once the drip has stopped */
  const run = (index: number, dt: number): boolean => {
    const drip = state.drips[index];

    if (drip.wait > 0) {
      drip.wait -= dt;

      return true;
    }
    const move = drip.v * dt;
    const count = Math.ceil(move / DRIP_STEP);
    const from = drip.y;

    drip.v = Math.max(DRIP_CRAWL, drip.v * Math.exp(-DRIP_FRICTION * dt));
    times(count, (i) => stamp(drip.x, from + move * i / count, drip.r * DRIP_TRAIL));
    drip.y += move;
    drip.gone += move;
    if (drip.gone < drip.len && drip.y <= state.zone.floor - drip.r - DRIP_FLOOR_GAP) return true;
    stamp(drip.x, drip.y, drip.r);

    return false;
  };

  const smear = (pointer: ScenePointer): void => {
    if (!pointer.inside) {
      state.touching = false;
      state.wet = 0;

      return;
    }
    const { lastX, lastY, touching } = state;

    state.touching = true;
    state.lastX = pointer.x;
    state.lastY = pointer.y;
    if (!touching) return;
    const dist = Math.hypot(pointer.x - lastX, pointer.y - lastY);
    const cell = cellAt(pointer.x, pointer.y);

    if (cell >= 0 && state.grid[cell] === 1) state.wet = 1;
    const { wet } = state;

    if (wet <= 0 || dist <= SMEAR_SLACK) return;
    const count = Math.ceil(dist / SMEAR_STEP);

    times(count, (i) => {
      const along = (i + 1) / count;
      const left = Math.max(0, wet - dist * along / DRY_AFTER);

      stamp(lastX + (pointer.x - lastX) * along, lastY + (pointer.y - lastY) * along, SMEAR_MIN + SMEAR_GROW * left);
    });
    state.wet = Math.max(0, wet - dist / DRY_AFTER);
  };

  return {
    goo: true,

    layout({ width, height, zone, scale }: SceneLayout): void {
      const stain = document.createElement('canvas');

      stain.width = Math.max(1, Math.round(width * scale));
      stain.height = Math.max(1, Math.round(height * scale));
      state.width = width;
      state.height = height;
      state.scale = scale;
      state.zone = { ...zone };
      state.cx = zone.x + zone.width * 0.5;
      state.cy = zone.y + (zone.floor - zone.y) * CENTRE_Y;
      state.stain = stain;
      // Null where the browser gives no 2D canvas: the scene still runs, without a stain.
      state.sctx = stain.getContext('2d') ?? null;
      state.cols = Math.max(0, Math.ceil(zone.width / CELL));
      state.rows = Math.max(0, Math.ceil((zone.floor - zone.y) / CELL));
      state.grid = new Uint8Array(state.cols * state.rows);
    },

    reset(): void {
      const { sctx, stain, scale, zone } = state;

      if (sctx && stain) {
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, stain.width, stain.height);
        sctx.setTransform(scale, 0, 0, scale, 0, 0);
        sctx.beginPath();
        sctx.rect(zone.x, zone.y, zone.width, zone.floor - zone.y);
        sctx.clip();
        sctx.fillStyle = STAMP_INK;
      }
      state.grid.fill(0);
      state.live = [];
      state.drips = [];
      state.burst = false;
      state.wet = 0;
      state.touching = false;
    },

    step(dt: number, pointer: ScenePointer): boolean {
      if (!state.burst) {
        pop();

        return true;
      }
      const friction = Math.exp(-FRICTION * dt);

      state.live = state.live.filter((_, i) => fly(i, dt, friction));
      state.drips = state.drips.filter((_, i) => run(i, dt));
      smear(pointer);

      return pointer.inside || state.live.length > 0 || state.drips.length > 0;
    },

    paint(ctx: CanvasRenderingContext2D, colors: SceneColors): void {
      const context = ctx;
      const { width, height, stain } = state;

      context.fillStyle = colors.ink;
      if (!state.burst) {
        dot(context, state.cx, state.cy, CORE);

        return;
      }
      if (stain) context.drawImage(stain, 0, 0, width, height);
      // The stain is stamped in one fixed colour: this turns it into the theme's ink.
      context.globalCompositeOperation = 'source-in';
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';
      state.live.forEach((drop) => dot(context, drop.x, drop.y, drop.r));
      state.drips.filter((drip) => drip.wait <= 0).forEach((drip) => dot(context, drip.x, drip.y, drip.r));
    },

    paintOverlay(ctx: CanvasRenderingContext2D): void {
      const context = ctx;

      context.fillStyle = GLINT;
      context.save();
      context.translate(state.cx - 9, state.cy - 13);
      context.rotate(-0.7);
      context.beginPath();
      context.ellipse(0, 0, 7.5, 2.6, 0, 0, TAU);
      context.fill();
      context.restore();
    },

    droplets: (): InkDroplet[] => state.live.map((drop) => ({ ...drop })),

    drips: (): InkDrip[] => state.drips.map((drip) => ({ ...drip })),

    isWet(x: number, y: number): boolean {
      const cell = cellAt(x, y);

      return cell >= 0 && state.grid[cell] === 1;
    },
  };
}) satisfies SceneFactory;
