import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPosition,
  savePosition,
  toPixels,
  toPosition,
} from '../../../../../src/components/modules/find/find-position';

const size = { width: 400, height: 50 };
const viewport = { width: 1200, height: 800 };

describe('find bar position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the corners of the free space to the window edges, minus a margin', () => {
    expect(toPixels({ x: 0, y: 0 }, size, viewport)).toEqual({ left: 8, top: 8 });
    expect(toPixels({ x: 1, y: 1 }, size, viewport)).toEqual({ left: 1200 - 400 - 8, top: 800 - 50 - 8 });
  });

  it('round-trips a pixel spot through a relative position', () => {
    const position = toPosition(300, 200, size, viewport);

    expect(toPixels(position, size, viewport)).toEqual({ left: 300, top: 200 });
  });

  it('keeps a dragged bar inside the window', () => {
    expect(toPosition(-500, 5000, size, viewport)).toEqual({ x: 0, y: 1 });
  });

  it('keeps the same relative spot when the window shrinks', () => {
    const position = toPosition(1200 - 400 - 8, 8, size, viewport);

    expect(toPixels(position, size, { width: 600, height: 400 })).toEqual({ left: 600 - 400 - 8, top: 8 });
  });

  it('pins the bar to the margin when the window is narrower than the bar', () => {
    expect(toPixels({ x: 1, y: 0 }, size, { width: 300, height: 800 })).toEqual({ left: 8, top: 8 });
  });

  it('remembers a position and forgets it on reset', () => {
    savePosition({ x: 0.25, y: 0.5 });

    expect(loadPosition()).toEqual({ x: 0.25, y: 0.5 });

    savePosition(null);

    expect(loadPosition()).toBeNull();
  });

  it('ignores a stored value that is not a position', () => {
    localStorage.setItem('blok:find-bar-position', '{"x":"left","y":2}');

    expect(loadPosition()).toBeNull();
  });

  it('works without storage when the browser blocks it', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => savePosition({ x: 0, y: 0 })).not.toThrow();
    expect(loadPosition()).toBeNull();
  });
});
