// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';
import { positionBetween, positionsBetween } from '../../../../src/shared/database/positions';

/** A fixed LCG, so a failing run replays. */
const lcg = (seed: number): (() => number) => {
  let state = seed;

  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
};

/** Shipped clients run fractional-indexing 4.0.0, which throws on a key it cannot read. */
const readableBy400 = (key: string): boolean => {
  try {
    generateKeyBetween(key, null);

    return true;
  } catch {
    return false;
  }
};

const between = (low: string | null, key: string, high: string | null): boolean =>
  (low === null || low < key) && (high === null || key < high);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('positionBetween', () => {
  it('two peers inserting into the same gap get different keys', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const mine = positionBetween('a0', 'a1');

    random.mockReturnValue(0.9);
    const theirs = positionBetween('a0', 'a1');

    expect(mine).not.toBe(theirs);
    expect(between('a0', mine, 'a1') && between('a0', theirs, 'a1')).toBe(true);
  });

  it('two peers prepending at once get different keys', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const mine = positionBetween(null, 'a0');

    random.mockReturnValue(0.9);

    expect(positionBetween(null, 'a0')).not.toBe(mine);
  });

  // The plain midpoint of a0U and a0V5 is a0V, a prefix of a0V5: a tail of 9s would overshoot it.
  it.each([0, 0.5, 0.999999])('stays below a neighbour the midpoint is a prefix of (random %s)', (value) => {
    vi.spyOn(Math, 'random').mockReturnValue(value);

    expect(between('a0U', positionBetween('a0U', 'a0V5'), 'a0V5')).toBe(true);
    expect(between('a0', positionBetween('a0', 'a01'), 'a01')).toBe(true);
    expect(between(null, positionBetween(null, 'Zz1'), 'Zz1')).toBe(true);
  });

  it('keeps 2000 random inserts strictly between their neighbours and readable by 4.0.0', () => {
    const place = lcg(1);
    const tail = lcg(2);
    const keys: string[] = [];

    vi.spyOn(Math, 'random').mockImplementation(tail);
    Array.from({ length: 2000 }).forEach(() => {
      const at = Math.floor(place() * (keys.length + 1));
      const low = keys[at - 1] ?? null;
      const high = keys[at] ?? null;
      const key = positionBetween(low, high);

      expect(between(low, key, high)).toBe(true);
      expect(readableBy400(key)).toBe(true);
      keys.splice(at, 0, key);
    });
    expect([...keys].sort()).toEqual(keys);
    expect(keys.reduce((sum, key) => sum + key.length, 0) / keys.length).toBeLessThan(12);
  });

  it.each([
    ['inserted after the first row', () => 1],
    ['inserted before the last row', (keys: string[]) => keys.length - 1],
    ['prepended', () => 0],
    ['appended', (keys: string[]) => keys.length],
  ] as const)('keeps keys short when 300 rows are %s one by one', (_, slot) => {
    vi.spyOn(Math, 'random').mockImplementation(lcg(3));
    const keys = ['a0', 'a1'];

    Array.from({ length: 300 }).forEach(() => {
      const at = slot(keys);
      const key = positionBetween(keys[at - 1] ?? null, keys[at] ?? null);

      keys.splice(at, 0, key);
    });
    expect([...keys].sort()).toEqual(keys);
    expect(keys.every(readableBy400)).toBe(true);
    expect(Math.max(...keys.map(key => key.length))).toBeLessThanOrEqual(80);
  });
});

describe('positionsBetween', () => {
  it('gives n keys in order, strictly inside the gap, each readable by 4.0.0', () => {
    const keys = positionsBetween('a0', 'a1', 200);

    expect(keys).toHaveLength(200);
    expect(['a0', ...keys, 'a1']).toEqual([...new Set(['a0', ...keys, 'a1'])].sort());
    expect(keys.every(readableBy400)).toBe(true);
  });

  it('keeps keys for many rows in one gap short', () => {
    expect(Math.max(...positionsBetween('a0', 'a1', 200).map(key => key.length))).toBeLessThanOrEqual(10);
  });

  it('gives two peers filling the same gap different keys', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const mine = positionsBetween('a0', 'a1', 5);

    random.mockReturnValue(0.9);
    const theirs = positionsBetween('a0', 'a1', 5);

    expect(mine.filter(key => theirs.includes(key))).toEqual([]);
  });

  it.each<[string | null, string | null]>([
    [null, null],
    ['a0', null],
    [null, 'a0'],
    ['a5', 'a5'],
    ['a1', 'a0'],
    ['a0000', 'a0010'],
    ['a0010', null],
    ['', 'a0'],
    ['row-1', 'row-2'],
    ['0', null],
  ])('places 7 keys after %j and before %j without throwing', (after, before) => {
    const [low, high] = after !== null && before !== null && after > before ? [before, after] : [after, before];
    const keys = positionsBetween(after, before, 7);

    expect(keys).toHaveLength(7);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(7);
    expect(keys.every(key => low === null || key > low)).toBe(true);
    if (high !== null && high !== low) expect(keys.every(key => key < high)).toBe(true);
  });

  it('keeps batches dropped into random gaps in order, inside the gap and readable by 4.0.0', () => {
    const place = lcg(4);
    const keys: string[] = [];

    vi.spyOn(Math, 'random').mockImplementation(lcg(5));
    Array.from({ length: 300 }).forEach(() => {
      const at = Math.floor(place() * (keys.length + 1));
      const low = keys[at - 1] ?? null;
      const high = keys[at] ?? null;
      const batch = positionsBetween(low, high, 1 + Math.floor(place() * 12));

      expect([low ?? '', ...batch, high ?? '~']).toEqual([...new Set([low ?? '', ...batch, high ?? '~'])].sort());
      expect(batch.every(readableBy400)).toBe(true);
      keys.splice(at, 0, ...batch);
    });
  });

  it('gives nothing for n = 0', () => {
    expect(positionsBetween('a0', 'a1', 0)).toEqual([]);
  });
});
