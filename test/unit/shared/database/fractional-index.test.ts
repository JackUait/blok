// @vitest-environment node
import { generateKeyBetween as packageKeyBetween } from 'fractional-indexing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';

const KEYS: Array<string | null> = [
  null, 'a0', 'a1', 'a0V', 'a0l', 'a5', 'az', 'b00', 'b0z', 'Zz', 'Zy', 'Y00', 'zzzzzzzzzzzzzzzzzzzzzzzzzzz',
  'A00000000000000000000000000', 'A000000000000000000000000001', 'a00', 'a', '!0', 'a0!', 'a0 ', 'aV', 'a0V5', 'a1V', 'c000',
];

const outcome = (run: () => string): { key: string } | { error: true } => {
  try {
    return { key: run() };
  } catch {
    return { error: true };
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vendored generateKeyBetween', () => {
  it.each(KEYS.flatMap(a => KEYS.map(b => [a, b] as const)))('matches fractional-indexing for (%s, %s)', (a, b) => {
    expect(outcome(() => generateKeyBetween(a, b))).toEqual(outcome(() => packageKeyBetween(a, b)));
  });

  it('chains of appends and prepends match', () => {
    const walk = (next: (key: string | null) => string): string[] =>
      Array.from({ length: 80 }).reduce<string[]>(keys => [...keys, next(keys.at(-1) ?? null)], []);

    expect(walk(key => generateKeyBetween(key, null))).toEqual(walk(key => packageKeyBetween(key, null)));
    expect(walk(key => generateKeyBetween(null, key))).toEqual(walk(key => packageKeyBetween(null, key)));
    expect(walk(key => generateKeyBetween('a0', key ?? 'a1'))).toEqual(walk(key => packageKeyBetween('a0', key ?? 'a1')));
  });
});
