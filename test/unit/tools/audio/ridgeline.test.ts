import { describe, it, expect } from 'vitest';
import { RIDGE_POINTS, RIDGE_ROWS, paintRidges, ridgeProfile, ridgeRows } from '../../../../src/tools/audio/ridgeline';

describe('ridgeProfile', () => {
  it('pins both ends of a ridge to the ground', () => {
    const profile = ridgeProfile(1, 7);

    expect(profile).toHaveLength(RIDGE_POINTS);
    expect(profile[0]).toBe(0);
    expect(profile[RIDGE_POINTS - 1]).toBeCloseTo(0, 6);
  });

  it('keeps a silent bucket flat', () => {
    expect(ridgeProfile(0, 3).every((v) => v === 0)).toBe(true);
  });

  it('grows with the loudness of its bucket', () => {
    const quiet = Math.max(...ridgeProfile(0.2, 11));
    const loud = Math.max(...ridgeProfile(0.9, 11));

    expect(loud).toBeGreaterThan(quiet * 3);
  });

  it('stays inside 0..1', () => {
    const all = Array.from({ length: 300 }, (_, bucket) => ridgeProfile(1, bucket, 1)).flat();

    expect(Math.min(...all)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...all)).toBeLessThanOrEqual(1);
  });

  it('draws the same ridge for the same bucket, and a different one for the next', () => {
    expect(ridgeProfile(0.6, 42)).toEqual(ridgeProfile(0.6, 42));
    expect(ridgeProfile(0.6, 43)).not.toEqual(ridgeProfile(0.6, 42));
  });

  it('a beat lifts the middle of the ridge', () => {
    const mid = Math.floor(RIDGE_POINTS / 2);

    expect(ridgeProfile(0.5, 9, 1)[mid]).toBeGreaterThan(ridgeProfile(0.5, 9, 0)[mid]);
  });
});

describe('ridgeRows', () => {
  it('puts the bucket under the playhead in front and the rest behind it, back row first', () => {
    const rows = ridgeRows(0);

    expect(rows).toHaveLength(RIDGE_ROWS + 1);
    expect(rows[rows.length - 1]).toEqual({ bucket: 0, depth: 0, alpha: 1 });
    expect(rows[rows.length - 2].bucket).toBe(1);
    expect(rows[rows.length - 2].depth).toBeCloseTo(1 / RIDGE_ROWS, 6);
    expect(rows[0].bucket).toBe(RIDGE_ROWS);
    expect(rows[0].depth).toBe(1);
  });

  it('fades the back row in and the front row out as the playhead moves between buckets', () => {
    const rows = ridgeRows(10.25);
    const front = rows[rows.length - 1];
    const back = rows[0];

    expect(front.bucket).toBe(10);
    expect(front.depth).toBeCloseTo(-0.25 / RIDGE_ROWS, 6);
    expect(front.alpha).toBeCloseTo(0.75, 6);
    expect(back.bucket).toBe(10 + RIDGE_ROWS);
    expect(back.alpha).toBeCloseTo(0.25, 6);
    expect(rows[1].alpha).toBe(1);
  });
});

interface Stroke { alpha: number; style: string; points: Array<[number, number]> }

const recorder = (): { ctx: CanvasRenderingContext2D; strokes: Stroke[]; fills: string[] } => {
  const strokes: Stroke[] = [];
  const fills: string[] = [];
  const state = { alpha: 1, stroke: '', fill: '', points: [] as Array<[number, number]> };
  const ctx = {
    lineWidth: 1,
    lineJoin: 'miter',
    get globalAlpha(): number { return state.alpha; },
    set globalAlpha(v: number) { state.alpha = v; },
    get strokeStyle(): string { return state.stroke; },
    set strokeStyle(v: string) { state.stroke = v; },
    get fillStyle(): string { return state.fill; },
    set fillStyle(v: string) { state.fill = v; },
    beginPath: (): void => { state.points = []; },
    moveTo: (x: number, y: number): void => { state.points.push([x, y]); },
    lineTo: (x: number, y: number): void => { state.points.push([x, y]); },
    fill: (): void => { fills.push(state.fill); },
    stroke: (): void => { strokes.push({ alpha: state.alpha, style: state.stroke, points: [...state.points] }); },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, fills };
};

const paint = (over: Partial<Parameters<typeof paintRidges>[1]> = {}): ReturnType<typeof recorder> => {
  const rec = recorder();

  paintRidges(rec.ctx, {
    width: 400,
    height: 120,
    peaks: Array.from({ length: 300 }, (_, i) => 0.3 + 0.6 * ((i * 7) % 10) / 10),
    beats: [],
    playhead: 0,
    ink: '#111',
    fill: '#fff',
    energy: 0,
    kick: 0,
    timeSeconds: 0,
    ...over,
  });

  return rec;
};

const lowest = (stroke: Stroke): number => Math.max(...stroke.points.map(([, y]) => y));
const highest = (stroke: Stroke): number => Math.min(...stroke.points.map(([, y]) => y));

describe('paintRidges', () => {
  it('draws the back row first and the front row last, each lower and wider than the one behind', () => {
    const { strokes } = paint();
    const first = strokes[0];
    const last = strokes[strokes.length - 1];

    // Row RIDGE_ROWS sits at depth 1 with alpha 0, so it is not drawn.
    expect(strokes).toHaveLength(RIDGE_ROWS);
    expect(lowest(last)).toBeGreaterThan(lowest(first));
    expect(last.points[0][0]).toBeLessThan(first.points[0][0]);
    expect(last.alpha).toBeGreaterThan(first.alpha);
  });

  it('hides the rows behind a ridge by filling it with the card colour before inking it', () => {
    const { strokes, fills } = paint();

    expect(fills).toHaveLength(strokes.length);
    expect(new Set(fills)).toEqual(new Set(['#fff']));
    expect(new Set(strokes.map((s) => s.style))).toEqual(new Set(['#111']));
  });

  it('keeps every ridge inside the canvas', () => {
    const { strokes } = paint({ peaks: new Array<number>(300).fill(1), energy: 1, kick: 1, timeSeconds: 0.25 });

    expect(Math.min(...strokes.map(highest))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...strokes.map(lowest))).toBeLessThanOrEqual(120);
  });

  it('draws flat ground past the end of the track', () => {
    const { strokes } = paint({ playhead: 299 });
    const beyond = strokes[strokes.length - 2];

    expect(highest(beyond)).toBe(lowest(beyond));
  });

  it('a playing frame moves the front ridge; a resting frame does not', () => {
    const rest = paint({ timeSeconds: 0.2 }).strokes.at(-1);
    const sameRest = paint({ timeSeconds: 0.9 }).strokes.at(-1);
    const live = paint({ timeSeconds: 0.2, energy: 1 }).strokes.at(-1);

    expect(sameRest).toEqual(rest);
    expect(live?.points).not.toEqual(rest?.points);
  });
});
