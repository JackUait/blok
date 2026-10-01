import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, type Snapshot } from '../../../../../src/tools/image/darkroom/history';

const snap = (x: number, ratioKey = 'free', over: Partial<Snapshot> = {}): Snapshot => ({
  rect: { x, y: 0, w: 50, h: 50 },
  ratioKey,
  geometry: { rotation: 0, flipX: false, straighten: 0 },
  filter: 'none',
  strength: 100,
  adjust: { brightness: 0, contrast: 0, saturation: 0 },
  markup: [],
  ...over,
});

describe('darkroom history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('undo and redo walk the pushed snapshots', () => {
    const h = createHistory(snap(0));

    h.push(snap(10));
    h.push(snap(20));

    expect(h.undo()).toEqual(snap(10));
    expect(h.undo()).toEqual(snap(0));
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual(snap(10));
    expect(h.current()).toEqual(snap(10));
  });

  it('a push after an undo drops the redo tail', () => {
    const h = createHistory(snap(0));

    h.push(snap(10));
    h.undo();
    h.push(snap(30));

    expect(h.redo()).toBeNull();
    expect(h.undo()).toEqual(snap(0));
  });

  it('ignores a push equal to the current snapshot', () => {
    const h = createHistory(snap(0));

    h.push(snap(0));

    expect(h.undo()).toBeNull();
  });

  it('a ratio change alone is a new entry', () => {
    const h = createHistory(snap(0));

    h.push(snap(0, 'circle'));

    expect(h.undo()).toEqual(snap(0));
  });

  it.each<[string, Partial<Snapshot>]>([
    ['a rotation', { geometry: { rotation: 270, flipX: false, straighten: 0 } }],
    ['a flip', { geometry: { rotation: 0, flipX: true, straighten: 0 } }],
    ['a straighten', { geometry: { rotation: 0, flipX: false, straighten: 4.5 } }],
    ['a filter preset', { filter: 'mono' }],
    ['a filter strength', { strength: 40 }],
    ['an adjustment', { adjust: { brightness: 0, contrast: 12, saturation: 0 } }],
  ])('%s alone is a new entry', (_name, over) => {
    const h = createHistory(snap(0));

    h.push(snap(0, 'free', over));

    expect(h.undo()).toEqual(snap(0));
    expect(h.redo()).toEqual(snap(0, 'free', over));
  });

  it('undo walks back across crop, geometry and filter steps in order', () => {
    const h = createHistory(snap(0));
    const turned = { geometry: { rotation: 270 as const, flipX: false, straighten: 0 } };

    h.push(snap(10));
    h.push(snap(10, 'free', turned));
    h.push(snap(10, 'free', { ...turned, filter: 'noir' }));

    expect(h.undo()).toEqual(snap(10, 'free', turned));
    expect(h.undo()).toEqual(snap(10));
    expect(h.undo()).toEqual(snap(0));
  });

  it('a markup change is its own step, and the same marks again are not', () => {
    const pen = { id: 'm1', type: 'pen' as const, color: '#ff3b30', points: [0.1, 0.1, 0.5], size: 0.012 };
    const h = createHistory(snap(0));

    h.push(snap(0, 'free', { markup: [pen] }));
    h.push(snap(0, 'free', { markup: [{ ...pen, points: [0.1, 0.1, 0.5] }] }));

    expect(h.undo()).toEqual(snap(0));
    expect(h.undo()).toBeNull();
  });
});
