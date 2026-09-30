import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory } from '../../../../../src/tools/image/darkroom/history';

const snap = (x: number, ratioKey = 'free') => ({ rect: { x, y: 0, w: 50, h: 50 }, ratioKey });

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
});
