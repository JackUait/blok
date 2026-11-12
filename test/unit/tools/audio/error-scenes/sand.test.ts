import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSand } from '../../../../../src/tools/audio/error-scenes/sand';
import type { SandScene } from '../../../../../src/tools/audio/error-scenes/sand';
import type { SceneColors, SceneLayout, ScenePointer } from '../../../../../src/tools/audio/error-scenes/types';

const WIDE: SceneLayout = { width: 768, height: 216, zone: { x: 361, y: 0, width: 407, floor: 216 }, scale: 2 };
const NARROW: SceneLayout = { width: 380, height: 420, zone: { x: 0, y: 0, width: 380, floor: 172 }, scale: 2 };
const LAYOUTS: Array<[string, SceneLayout]> = [['wide', WIDE], ['narrow', NARROW]];
const COLORS: SceneColors = { ink: '#111111', card: '#ffffff', muted: '#888888' };
const AWAY: ScenePointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, down: false };
const DT = 1 / 60;
const GRAIN = 2;
const BAR_STEP = 7;
const SEEDS = [1, 2, 3, 4, 5, 6];

const seeded = (seed: number): (() => number) => {
  const state = { a: seed };

  return () => {
    state.a = (state.a + 0x6D2B79F5) | 0;
    const mixed = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
    const again = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((again ^ (again >>> 14)) >>> 0) / 4294967296;
  };
};

const make = (layout: SceneLayout, seed = 1): SandScene => {
  const scene = createSand(seeded(seed));

  scene.layout(layout);
  scene.reset();

  return scene;
};

const pointerAt = (x: number, y: number, vx = 0, vy = 0): ScenePointer => ({ x, y, vx, vy, inside: true, down: false });

const barCount = (layout: SceneLayout): number => Math.floor((layout.zone.width - 44) / BAR_STEP);
const firstBarX = (layout: SceneLayout): number => layout.zone.x + (layout.zone.width - barCount(layout) * BAR_STEP) / 2;

/** Grains per bar, from x, y pairs. */
const perBar = (pairs: Float64Array, layout: SceneLayout): number[] => {
  const counts = new Array<number>(barCount(layout)).fill(0);

  pairs.forEach((value, index) => {
    if (index % 2 === 0) counts[Math.floor((value - firstBarX(layout)) / BAR_STEP)] += 1;
  });

  return counts;
};

const sum = (values: ArrayLike<number>): number => Array.from(values).reduce((total, value) => total + value, 0);
const total = (scene: SandScene): number => scene.standing().length / 2 + scene.falling().length / 2 + sum(scene.pile());

/** Steps with the pointer away until the scene rests. Returns the step count. */
const settle = (scene: SandScene, limit = 600): number => {
  const steps = Array.from({ length: limit }).findIndex(() => !scene.step(DT, AWAY));

  return steps < 0 ? limit : steps + 1;
};

const steepest = (heights: Int16Array): number => Array.from(heights).reduce(
  (worst, height, column) => column === 0 ? worst : Math.max(worst, Math.abs(height - heights[column - 1])),
  0
);

const tallestColumn = (heights: Int16Array): number => heights.indexOf(Math.max(...Array.from(heights)));

const recorder = (): { ctx: CanvasRenderingContext2D; rects: number[][]; calls: string[]; style: () => unknown } => {
  const rects: number[][] = [];
  const calls: string[] = [];
  const ctx = {
    fillStyle: '',
    beginPath: () => calls.push('beginPath'),
    rect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    fill: () => calls.push('fill'),
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, calls, style: () => ctx.fillStyle };
};

describe('createSand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('before the break', () => {
    it.each(LAYOUTS)('stands whole with an empty pile after reset (%s)', (_name, layout) => {
      const scene = make(layout);

      expect(sum(scene.pile())).toBe(0);
      expect(scene.falling()).toHaveLength(0);
      expect(perBar(scene.standing(), layout).every((count) => count >= 4)).toBe(true);
    });

    it.each(LAYOUTS)('lays the bars out 7px apart, two grains wide, centred in the zone (%s)', (_name, layout) => {
      const scene = make(layout);
      const xs = Array.from(new Set(Array.from(scene.standing()).filter((_, index) => index % 2 === 0))).sort((a, b) => a - b);
      const first = firstBarX(layout);
      const expected = Array.from({ length: barCount(layout) }).flatMap((_, bar) => [first + bar * BAR_STEP, first + bar * BAR_STEP + GRAIN]);

      expect(xs).toEqual(expected);
      expect(xs[0] - layout.zone.x).toBeCloseTo(layout.zone.x + layout.zone.width - (xs[xs.length - 1] + BAR_STEP - GRAIN), 5);
    });

    it.each(LAYOUTS)('mirrors every bar around a line 40% down the zone and keeps it inside (%s)', (_name, layout) => {
      const scene = make(layout);
      const ys = Array.from(scene.standing()).filter((_, index) => index % 2 === 1);
      const mid = layout.zone.y + (layout.zone.floor - layout.zone.y) * 0.4;
      const top = Math.min(...ys);
      const bottom = Math.max(...ys) + GRAIN;

      expect(mid - top).toBeCloseTo(bottom - mid, 5);
      expect(top).toBeGreaterThanOrEqual(layout.zone.y);
      expect(bottom).toBeLessThan(layout.zone.floor);
    });

    it('gives the bars different heights', () => {
      const counts = perBar(make(WIDE).standing(), WIDE);

      expect(new Set(counts).size).toBeGreaterThan(8);
    });

    it('paints the whole waveform before any step', () => {
      const scene = make(WIDE);
      const fake = recorder();

      scene.paint(fake.ctx, COLORS);

      expect(fake.rects).toHaveLength(scene.standing().length / 2);
    });

    it('starts to crumble from the first steps, with no hold of its own', () => {
      const scene = make(WIDE);
      const before = scene.standing().length;

      Array.from({ length: 18 }).forEach(() => scene.step(DT, AWAY));

      expect(scene.standing().length).toBeLessThan(before);
    });
  });

  describe('after it settles', () => {
    it.each(LAYOUTS)('keeps the first third, erodes a short stretch, drops the rest (%s)', (_name, layout) => {
      const scene = make(layout);
      const before = perBar(scene.standing(), layout);

      settle(scene);
      const after = perBar(scene.standing(), layout);
      const bars = barCount(layout);
      const share = (bar: number): number => bar / bars;
      const kept = after.filter((_, bar) => share(bar) < 0.32);
      const gone = after.filter((_, bar) => share(bar) >= 0.46);
      const erodedBefore = sum(before.filter((_, bar) => share(bar) >= 0.32 && share(bar) < 0.46));
      const erodedAfter = sum(after.filter((_, bar) => share(bar) >= 0.32 && share(bar) < 0.46));

      expect(kept).toEqual(before.filter((_, bar) => share(bar) < 0.32));
      expect(gone.every((count) => count === 0)).toBe(true);
      expect(gone.length).toBeGreaterThan(bars / 2);
      expect(erodedAfter).toBeGreaterThan(0);
      expect(erodedAfter).toBeLessThan(erodedBefore);
    });

    it('erodes more towards the break point', () => {
      const scene = make(WIDE);
      const before = perBar(scene.standing(), WIDE);

      settle(scene);
      const after = perBar(scene.standing(), WIDE);
      const bars = barCount(WIDE);
      const stretch = after.map((count, bar) => count / before[bar]).filter((_, bar) => bar / bars >= 0.32 && bar / bars < 0.46);

      expect(stretch[0]).toBeGreaterThan(stretch[stretch.length - 1]);
    });

    it.each(LAYOUTS)('piles every fallen grain on the floor (%s)', (_name, layout) => {
      const scene = make(layout);
      const start = scene.standing().length / 2;

      settle(scene);

      expect(sum(scene.pile())).toBe(start - scene.standing().length / 2);
      expect(sum(scene.pile())).toBeGreaterThan(start / 3);
      expect(scene.falling()).toHaveLength(0);
    });

    it.each(LAYOUTS)('comes to rest within a few seconds and stays at rest (%s)', (_name, layout) => {
      const scene = make(layout);
      const steps = settle(scene);

      expect(steps).toBeLessThan(4 / DT);
      expect(steps).toBeGreaterThanOrEqual(Math.floor(1.6 / DT));
      expect(scene.step(DT, AWAY)).toBe(false);
    });

    it.each(LAYOUTS)('never leaves a neighbour step steeper than two grains (%s)', (_name, layout) => {
      const worst = SEEDS.map((seed) => {
        const scene = make(layout, seed);

        settle(scene);

        return steepest(scene.pile());
      });

      expect(Math.max(...worst)).toBeLessThanOrEqual(2);
    });

    it.each(LAYOUTS)('rests every grain inside the zone and above the floor (%s)', (_name, layout) => {
      const scene = make(layout);
      const fake = recorder();
      const { zone } = layout;

      settle(scene);
      scene.paint(fake.ctx, COLORS);
      const outside = fake.rects.filter(([x, y, w, h]) => x < zone.x || x + w > zone.x + zone.width || y < zone.y || y + h > zone.floor);

      expect(outside).toEqual([]);
      expect(scene.pile()).toHaveLength(Math.floor(zone.width / GRAIN));
    });
  });

  describe('while it falls', () => {
    it.each(LAYOUTS)('conserves grains at every step (%s)', (_name, layout) => {
      const scene = make(layout);
      const start = total(scene);
      const sweep = (step: number): ScenePointer => pointerAt(layout.zone.x + (step * 9) % layout.zone.width, layout.zone.floor - 6 - (step % 5) * 20, 500, -40);
      const counts = Array.from({ length: 300 }).map((_, step) => {
        scene.step(DT, step % 3 === 0 ? sweep(step) : AWAY);

        return total(scene);
      });

      expect(counts.every((count) => count === start)).toBe(true);
      expect(start).toBeGreaterThan(500);
    });

    it.each(LAYOUTS)('keeps flying grains between the zone walls (%s)', (_name, layout) => {
      const scene = make(layout);
      const { zone } = layout;
      const stray = Array.from({ length: 240 }).flatMap((_, step) => {
        scene.step(DT, step % 2 === 0 ? pointerAt(zone.x + 4, zone.floor - 4, -3000, 0) : pointerAt(zone.x + zone.width - 4, zone.floor - 4, 3000, 0));

        return Array.from(scene.falling()).filter((value, index) => index % 2 === 0 && (value < zone.x || value > zone.x + zone.width - GRAIN));
      });

      expect(stray).toEqual([]);
    });

    it('stays awake while grains are in the air', () => {
      const scene = make(WIDE);
      const awake = Array.from({ length: 30 }).map(() => scene.step(DT, AWAY));

      expect(scene.falling().length).toBeGreaterThan(0);
      expect(awake.every(Boolean)).toBe(true);
    });
  });

  describe('pointer', () => {
    it('knocks the grains of a standing bar loose', () => {
      const scene = make(WIDE);
      const before = perBar(scene.standing(), WIDE);
      const mid = WIDE.zone.floor * 0.4;

      scene.step(DT, pointerAt(firstBarX(WIDE) + 2 * BAR_STEP, mid, 120, 0));
      const after = perBar(scene.standing(), WIDE);

      expect(after[2]).toBeLessThan(before[2]);
      expect(scene.falling().length / 2).toBe(sum(before) - sum(after));
      expect(after[6]).toBe(before[6]);
    });

    it('only reaches grains within 11px', () => {
      const scene = make(WIDE);
      const x = firstBarX(WIDE) + 2 * BAR_STEP;
      const mid = WIDE.zone.floor * 0.4;

      scene.step(DT, pointerAt(x, mid));
      const left = Array.from(scene.standing());
      const near = left.filter((value, index) => index % 2 === 0 && Math.abs(value - x) < 11 && Math.abs(left[index + 1] - mid) < 11);

      expect(near).toEqual([]);
      expect(perBar(scene.standing(), WIDE)[5]).toBe(perBar(make(WIDE).standing(), WIDE)[5]);
    });

    it('leaves the bars alone when it is not over the canvas', () => {
      const scene = make(WIDE);
      const before = scene.standing().length;

      scene.step(DT, { ...pointerAt(firstBarX(WIDE) + 2 * BAR_STEP, WIDE.zone.floor * 0.4, 120, 0), inside: false });

      expect(scene.standing()).toHaveLength(before);
    });

    it('throws grains up when it moves fast through the pile', () => {
      const scene = make(WIDE);

      settle(scene);
      const heights = scene.pile();
      const column = tallestColumn(heights);

      scene.step(DT, pointerAt(WIDE.zone.x + column * GRAIN, WIDE.zone.floor - 1, 400, 0));
      const thrown = scene.falling();

      expect(thrown.length).toBeGreaterThan(0);
      expect(sum(scene.pile())).toBe(sum(heights) - thrown.length / 2);
      expect(Array.from(scene.pile()).every((height, at) => Math.abs(at - column) <= 6 || height === heights[at])).toBe(true);
      scene.step(DT, AWAY);
      const next = scene.falling();

      expect(next).toHaveLength(thrown.length);
      expect(Array.from(next).every((value, index) => index % 2 === 0 || value < thrown[index])).toBe(true);
    });

    it('leaves the pile alone when it is still or slow', () => {
      const scene = make(WIDE);

      settle(scene);
      const heights = scene.pile();
      const column = tallestColumn(heights);

      scene.step(DT, pointerAt(WIDE.zone.x + column * GRAIN, WIDE.zone.floor - 1, 0, 0));
      scene.step(DT, pointerAt(WIDE.zone.x + column * GRAIN, WIDE.zone.floor - 1, 15, 15));

      expect(scene.falling()).toHaveLength(0);
      expect(scene.pile()).toEqual(heights);
    });

    it('leaves the pile alone when it moves fast well above it', () => {
      const scene = make(WIDE);

      settle(scene);
      const heights = scene.pile();
      const column = tallestColumn(heights);

      scene.step(DT, pointerAt(WIDE.zone.x + column * GRAIN, WIDE.zone.floor - heights[column] * GRAIN - 30, 400, 0));

      expect(scene.pile()).toEqual(heights);
    });

    it('keeps the scene awake while it is over the canvas', () => {
      const scene = make(WIDE);

      settle(scene);

      expect(scene.step(DT, pointerAt(WIDE.zone.x + 5, 5))).toBe(true);
      expect(scene.step(DT, AWAY)).toBe(false);
    });
  });

  describe('reset', () => {
    it('restores the waveform and empties the pile', () => {
      const scene = make(WIDE);
      const whole = scene.standing();

      settle(scene);
      scene.reset();

      expect(scene.standing()).toEqual(whole);
      expect(sum(scene.pile())).toBe(0);
      expect(scene.falling()).toHaveLength(0);
    });

    it('plays the break again', () => {
      const scene = make(WIDE);

      settle(scene);
      const first = scene.standing().length;

      scene.reset();

      expect(scene.step(DT, AWAY)).toBe(true);
      settle(scene);
      expect(scene.standing()).toHaveLength(first);
    });

    it('follows a new layout', () => {
      const scene = make(WIDE);

      settle(scene);
      scene.layout(NARROW);
      scene.reset();

      expect(scene.standing()).toEqual(make(NARROW).standing());
      expect(scene.pile()).toHaveLength(Math.floor(NARROW.zone.width / GRAIN));
    });
  });

  describe('random', () => {
    it('gives the same result for the same random source', () => {
      const one = make(WIDE, 7);
      const two = make(WIDE, 7);

      Array.from({ length: 70 }).forEach(() => {
        one.step(DT, AWAY);
        two.step(DT, AWAY);
      });

      expect(one.falling()).toEqual(two.falling());
      expect(one.falling().length).toBeGreaterThan(0);
      settle(one);
      settle(two);
      expect(one.pile()).toEqual(two.pile());
      expect(one.standing()).toEqual(two.standing());
    });

    it('builds the same waveform whatever the random source', () => {
      expect(make(WIDE, 1).standing()).toEqual(make(WIDE, 99).standing());
    });

    it('never touches Math.random when a source is passed', () => {
      const spy = vi.spyOn(Math, 'random');
      const scene = make(WIDE);

      settle(scene);

      expect(spy).not.toHaveBeenCalled();
    });

    it('falls back to Math.random', () => {
      const spy = vi.spyOn(Math, 'random');
      const scene = createSand();

      scene.layout(WIDE);
      scene.reset();
      Array.from({ length: 40 }).forEach(() => scene.step(DT, AWAY));

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('paint', () => {
    it('draws every grain as one ink path of small squares', () => {
      const scene = make(WIDE);
      const fake = recorder();

      Array.from({ length: 60 }).forEach(() => scene.step(DT, AWAY));
      scene.paint(fake.ctx, COLORS);

      expect(fake.rects).toHaveLength(total(scene));
      expect(fake.rects.every(([, , w, h]) => w === 1.65 && h === 1.65)).toBe(true);
      expect(fake.calls).toEqual(['beginPath', 'fill']);
      expect(fake.style()).toBe(COLORS.ink);
    });

    it('draws the pile as stacked grains on the floor', () => {
      const scene = make(WIDE);
      const fake = recorder();

      settle(scene);
      scene.paint(fake.ctx, COLORS);
      const heights = scene.pile();
      const column = tallestColumn(heights);
      const x = WIDE.zone.x + column * GRAIN;
      const stack = fake.rects.filter(([rx, ry]) => rx === x && ry >= WIDE.zone.floor - heights[column] * GRAIN).map(([, ry]) => ry).sort((a, b) => a - b);

      expect(stack).toEqual(Array.from({ length: heights[column] }).map((_, row) => WIDE.zone.floor - (heights[column] - row) * GRAIN));
    });

    it('does not throw before the first layout', () => {
      const scene = createSand(seeded(1));
      const fake = recorder();

      expect(() => {
        scene.reset();
        scene.step(DT, pointerAt(3, 3, 90, 0));
        scene.paint(fake.ctx, COLORS);
      }).not.toThrow();
      expect(fake.rects).toEqual([]);
    });
  });

  it('asks the stage for neither drag nor goo', () => {
    const scene = make(WIDE);

    expect(scene.drag).toBeUndefined();
    expect(scene.goo).toBeUndefined();
  });
});
