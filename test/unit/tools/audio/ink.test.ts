import { describe, it, expect } from 'vitest';
import { createInkDrop, INK_POINTS, INK_TILE } from '../../../../src/tools/audio/ink';
import type { InkDrop, InkShape } from '../../../../src/tools/audio/ink';

type Signals = Parameters<InkDrop['step']>[0];

const SILENCE: Signals = { level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 };
const FRAME = 1 / 60;
const REST = 11.5;

/** mulberry32 */
const seeded = (seed: number): (() => number) => {
  const state = { a: seed >>> 0 };

  return () => {
    state.a = (state.a + 0x6d2b79f5) >>> 0;
    const t1 = Math.imul(state.a ^ (state.a >>> 15), state.a | 1);
    const t2 = t1 ^ (t1 + Math.imul(t1 ^ (t1 >>> 7), t1 | 61));

    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
};

const frames = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

const run = (drop: InkDrop, seconds: number, signals: Signals = SILENCE): void => {
  frames(Math.round(seconds * 60)).forEach(() => drop.step(signals, FRAME));
};

const radiiOf = (drop: InkDrop): number[] => Array.from(drop.shape().radii);
const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

const bodyRadiusAt = (shape: InkShape, x: number, y: number): number => {
  const turn = ((Math.atan2(y, x) / (Math.PI * 2)) % 1 + 1) % 1;
  const at = turn * INK_POINTS;
  const i0 = Math.floor(at) % INK_POINTS;
  const frac = at - Math.floor(at);

  return shape.radii[i0] * (1 - frac) + shape.radii[(i0 + 1) % INK_POINTS] * frac;
};

/** Largest gap between a ball's inner edge and the body edge under it. */
const widestGap = (shape: InkShape): number => shape.balls.reduce(
  (best, ball) => Math.max(best, Math.hypot(ball.x, ball.y) - ball.r - bodyRadiusAt(shape, ball.x, ball.y)),
  -Infinity
);

describe('createInkDrop', () => {
  it('exposes the tile and point count', () => {
    expect(INK_TILE).toBe(44);
    expect(INK_POINTS).toBe(96);
  });

  it('starts as a centred circle at rest and stays there in silence', () => {
    const drop = createInkDrop(seeded(1));
    const check = (): void => {
      const shape = drop.shape();

      expect(shape.radii).toHaveLength(INK_POINTS);
      expect(Array.from(shape.radii).every((r) => r === REST)).toBe(true);
      expect(shape.cx).toBe(22);
      expect(shape.cy).toBe(22);
      expect(shape.balls).toEqual([]);
      expect(drop.atRest()).toBe(true);
    };

    check();
    run(drop, 2);
    check();
  });

  it('a kick dents the edge and wakes the drop', () => {
    const drop = createInkDrop(seeded(2));

    drop.step({ ...SILENCE, kick: 0.2 }, FRAME);
    run(drop, 0.15);
    const radii = radiiOf(drop);

    expect(Math.min(...radii)).toBeLessThan(REST - 0.2);
    expect(Math.max(...radii)).toBeGreaterThan(REST);
    expect(drop.atRest()).toBe(false);
  });

  it('a kick pushes the centre off home, within 2 units', () => {
    const drop = createInkDrop(seeded(2));

    drop.step({ ...SILENCE, kick: 1 }, FRAME);
    const offsets = frames(60).map(() => {
      drop.step(SILENCE, FRAME);
      const { cx, cy } = drop.shape();

      return Math.max(Math.abs(cx - 22), Math.abs(cy - 22));
    });

    expect(Math.max(...offsets)).toBeGreaterThan(0.5);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(2);
  });

  it('settles back to a round drop at rest after a kick and 6 s of silence', () => {
    const drop = createInkDrop(seeded(3));

    drop.step({ ...SILENCE, kick: 1 }, FRAME);
    run(drop, 6);
    const shape = drop.shape();

    expect(drop.atRest()).toBe(true);
    expect(shape.balls).toEqual([]);
    expect(Math.max(...Array.from(shape.radii).map((r) => Math.abs(r - REST)))).toBeLessThan(0.05);
    expect(Math.abs(shape.cx - 22)).toBeLessThan(0.05);
    expect(Math.abs(shape.cy - 22)).toBeLessThan(0.05);
  });

  it('a strong kick throws a droplet that leaves the body and later melts back', () => {
    const drop = createInkDrop(seeded(4));

    drop.step({ ...SILENCE, kick: 1 }, FRAME);
    const gaps = frames(120).map(() => {
      drop.step(SILENCE, FRAME);

      return widestGap(drop.shape());
    });

    expect(Math.max(...gaps)).toBeGreaterThan(0);
    run(drop, 4);
    expect(drop.shape().balls).toEqual([]);
  });

  it('a weak kick throws no droplet', () => {
    const drop = createInkDrop(seeded(5));

    drop.step({ ...SILENCE, kick: 0.2 }, FRAME);
    const counts = frames(180).map(() => {
      drop.step(SILENCE, FRAME);

      return drop.shape().balls.length;
    });

    expect(Math.max(...counts)).toBe(0);
  });

  it('a kick just over the threshold throws a droplet', () => {
    const drop = createInkDrop(seeded(5));

    drop.step({ ...SILENCE, kick: 0.27 }, FRAME);

    expect(drop.shape().balls.length).toBeGreaterThan(0);
  });

  it('a snare always throws a droplet', () => {
    [0.05, 0.5, 1].forEach((snare, i) => {
      const drop = createInkDrop(seeded(10 + i));

      drop.step({ ...SILENCE, snare }, FRAME);

      expect(drop.shape().balls.length).toBeGreaterThan(0);
      expect(drop.atRest()).toBe(false);
    });
  });

  it('a hat ripples the edge without a droplet', () => {
    const drop = createInkDrop(seeded(6));

    drop.step({ ...SILENCE, hat: 1 }, FRAME);
    run(drop, 0.05);
    const radii = radiiOf(drop);

    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05);
    expect(drop.shape().balls).toEqual([]);
  });

  it('mid energy keeps the edge restless', () => {
    const drop = createInkDrop(seeded(7));

    run(drop, 0.5, { ...SILENCE, mid: 0.5 });
    const radii = radiiOf(drop);

    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05);
  });

  it('keeps every ball centre inside the tile under a busy beat', () => {
    const drop = createInkDrop(seeded(8));
    const reach = frames(1200).map((i) => {
      drop.step({
        level: 0.8,
        bass: 0.7,
        mid: 0.4,
        kick: i % 24 === 0 ? 1 : 0,
        snare: i % 48 === 24 ? 1 : 0,
        hat: i % 12 === 6 ? 0.8 : 0,
      }, FRAME);

      return drop.shape().balls.reduce((far, ball) => Math.max(far, Math.hypot(ball.x, ball.y)), 0);
    });

    expect(Math.max(...reach)).toBeLessThanOrEqual(20.2 + 1e-3);
    expect(Math.max(...reach)).toBeGreaterThan(12);
  });

  it('is deterministic for a given random source', () => {
    const play = (seed: number): number[] => {
      const drop = createInkDrop(seeded(seed));

      frames(90).forEach((i) => drop.step({ ...SILENCE, level: 0.5, mid: 0.3, kick: i % 30 === 0 ? 0.9 : 0, snare: i === 45 ? 1 : 0 }, FRAME));

      return radiiOf(drop);
    };

    expect(play(42)).toEqual(play(42));
    expect(play(42)).not.toEqual(play(43));
  });

  it('held bass and level swell the drop', () => {
    const quiet = createInkDrop(seeded(9));
    const loud = createInkDrop(seeded(9));
    const bassy = createInkDrop(seeded(9));

    run(quiet, 0.5);
    run(loud, 0.5, { ...SILENCE, level: 1 });
    run(bassy, 0.5, { ...SILENCE, bass: 0.5 });

    expect(mean(radiiOf(loud)) - mean(radiiOf(quiet))).toBeCloseTo(1.9, 3);
    expect(mean(radiiOf(bassy)) - mean(radiiOf(quiet))).toBeCloseTo(1.6, 3);
  });

  it('survives a giant dt and bad dt values', () => {
    const drop = createInkDrop(seeded(11));
    const loud: Signals = { level: 1, bass: 1, mid: 1, kick: 1, snare: 1, hat: 1 };

    [1000, 1e9, 0, -5, Number.NaN, 1000, 0.016].forEach((dt) => drop.step(loud, dt));
    frames(30).forEach(() => drop.step(loud, 1000));
    const shape = drop.shape();
    const radii = Array.from(shape.radii);

    expect(radii.every((r) => Number.isFinite(r) && r >= 0 && r <= 21)).toBe(true);
    expect(Number.isFinite(shape.cx) && Number.isFinite(shape.cy)).toBe(true);
    expect(shape.balls.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.r))).toBe(true);
  });

  it('a giant dt moves the drop no further than a 0.05 s step', () => {
    const giant = createInkDrop(seeded(12));
    const capped = createInkDrop(seeded(12));

    giant.step({ ...SILENCE, kick: 0.2 }, 30);
    capped.step({ ...SILENCE, kick: 0.2 }, 0.05);

    expect(radiiOf(giant)).toEqual(radiiOf(capped));
  });
});
