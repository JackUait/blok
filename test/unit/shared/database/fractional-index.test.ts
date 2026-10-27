// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';
import oracle from './fixtures/fractional-indexing-4.0.0.json';

/*
 * The fixture is fractional-indexing 4.0.0's own output, recorded while the
 * package was installed. Shipped clients wrote keys with that version, so the
 * port must keep giving the same answers. A null answer means it threw.
 */

const outcome = (run: () => string): string | null => {
  try {
    return run();
  } catch {
    return null;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateKeyBetween', () => {
  it.each(oracle.between)('matches fractional-indexing 4.0.0 for (%s, %s)', (a, b, expected) => {
    expect(outcome(() => generateKeyBetween(a, b))).toBe(expected);
  });

  it('chains of appends, prepends and squeezes match 4.0.0', () => {
    const walk = (next: (key: string | null) => string): string[] =>
      Array.from({ length: 80 }).reduce<string[]>(keys => [...keys, next(keys.at(-1) ?? null)], []);

    expect(walk(key => generateKeyBetween(key, null))).toEqual(oracle.walks.append);
    expect(walk(key => generateKeyBetween(null, key))).toEqual(oracle.walks.prepend);
    expect(walk(key => generateKeyBetween('a0', key ?? 'a1'))).toEqual(oracle.walks.squeeze);
  });

  // Default-alphabet cases from the package's own src/test.js.
  it.each([
    [null, null, 'a0'],
    [null, 'a0', 'Zz'],
    [null, 'Zz', 'Zy'],
    ['a0', null, 'a1'],
    ['a1', null, 'a2'],
    ['a0', 'a1', 'a0V'],
    ['a1', 'a2', 'a1V'],
    ['a0V', 'a1', 'a0l'],
    ['Zz', 'a0', 'ZzV'],
    ['Zz', 'a1', 'a0'],
    [null, 'Y00', 'Xzzz'],
    ['bzz', null, 'c000'],
    ['a0', 'a0V', 'a0G'],
    ['a0', 'a0G', 'a08'],
    ['b125', 'b129', 'b127'],
    ['a0', 'a1V', 'a1'],
    ['Zz', 'a01', 'a0'],
    [null, 'a0V', 'a0'],
    [null, 'b999', 'b99'],
    [null, 'A000000000000000000000000001', 'A000000000000000000000000000V'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzy', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzz'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzz', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzV'],
    ['a1', 'a0', 'a0V'],
  ] as const)('(%s, %s) gives %s', (a, b, expected) => {
    expect(generateKeyBetween(a, b)).toBe(expected);
  });

  it.each([
    [null, 'A00000000000000000000000000', 'invalid order key: A00000000000000000000000000'],
    ['a00', null, 'invalid order key: a00'],
    ['a00', 'a1', 'invalid order key: a00'],
    ['0', '1', 'invalid order key head: 0'],
  ] as const)('(%s, %s) throws "%s"', (a, b, message) => {
    expect(() => generateKeyBetween(a, b)).toThrow(message);
  });

  it('keeps 1000 random inserts strictly between their neighbours and in code-unit order', () => {
    // The package's testOrdering: a fixed LCG, so a failure replays.
    const random = ((): (() => number) => {
      let seed = 1;

      return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    })();
    const keys: string[] = [];

    Array.from({ length: 1000 }).forEach(() => {
      const at = Math.floor(random() * (keys.length + 1));
      const low = keys[at - 1] ?? null;
      const high = keys[at] ?? null;
      const key = generateKeyBetween(low, high);

      expect(low === null || low < key).toBe(true);
      expect(high === null || key < high).toBe(true);
      keys.splice(at, 0, key);
    });
    expect([...keys].sort()).toEqual(keys);
  });
});
