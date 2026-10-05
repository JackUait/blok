import { describe, it, expect } from 'vitest';
import { pairParts, type PartBox } from '../../../../src/tools/link/embed/morph';

const box = (x: number, y: number, width: number, height: number, body = false): PartBox => ({ x, y, width, height, body });

describe('embed morph pairing', () => {
  it('flies the window body from the old body, even when another part is nearer', () => {
    const olds = [box(30, 12, 140, 88, true), box(95, 50, 10, 10)];
    const [pair] = pairParts(olds, [box(95, 50, 12, 12, true)]);

    expect(pair?.from).toBe(0);
  });

  it('starts a part from the nearest old part', () => {
    const olds = [box(0, 0, 10, 10), box(100, 100, 10, 10)];
    const [pair] = pairParts(olds, [box(96, 98, 10, 10)]);

    expect(pair?.from).toBe(1);
  });

  it('prefers an unused old part, so the new parts spread out', () => {
    const olds = [box(0, 0, 10, 10), box(30, 0, 10, 10)];
    const pairs = pairParts(olds, [box(0, 0, 10, 10), box(2, 0, 10, 10)]);

    expect(pairs.map((pair) => pair?.from)).toEqual([0, 1]);
  });

  it('moves the new part centre onto the old part centre', () => {
    const [pair] = pairParts([box(0, 0, 20, 20)], [box(40, 30, 20, 20)]);

    expect(pair).toMatchObject({ dx: -40, dy: -30, sx: 1, sy: 1 });
  });

  it('scales the new part to the old part size, within limits', () => {
    const pairs = pairParts([box(0, 0, 200, 1)], [box(0, 0, 10, 10), box(0, 0, 0, 0)]);

    expect(pairs[0]).toMatchObject({ sx: 6, sy: 0.15 });
    expect(Number.isFinite(pairs[1]?.sx)).toBe(true);
    expect(Number.isFinite(pairs[1]?.sy)).toBe(true);
  });

  it('pairs nothing when there is no old scene', () => {
    expect(pairParts([], [box(0, 0, 10, 10)])).toEqual([null]);
  });

  it('pairs nothing for a body when the old scene has no body', () => {
    expect(pairParts([box(0, 0, 10, 10)], [box(0, 0, 10, 10, true)])).toEqual([null]);
  });
});
