import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { simpleDiffString } from '../../../../../src/components/modules/yjs/simple-diff';

const splice = (text: string, index: number, remove: number, insert: string): string =>
  text.slice(0, index) + insert + text.slice(index + remove);

const expectDiff = (before: string, after: string, expected: { index: number; remove: number; insert: string }): void => {
  const change = simpleDiffString(before, after);

  expect(change).toEqual(expected);
  expect(splice(before, change.index, change.remove, change.insert)).toBe(after);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('simpleDiffString', () => {
  // Cases from lib0's diff.test.js (testDiffing).
  it('finds the one changed region', () => {
    expectDiff('abc', 'axc', { index: 1, remove: 1, insert: 'x' });
    expectDiff('bc', 'xc', { index: 0, remove: 1, insert: 'x' });
    expectDiff('ab', 'ax', { index: 1, remove: 1, insert: 'x' });
    expectDiff('b', 'x', { index: 0, remove: 1, insert: 'x' });
    expectDiff('', 'abc', { index: 0, remove: 0, insert: 'abc' });
    expectDiff('abc', 'xyz', { index: 0, remove: 3, insert: 'xyz' });
    expectDiff('axz', 'au', { index: 1, remove: 2, insert: 'u' });
    expectDiff('ax', 'axy', { index: 2, remove: 0, insert: 'y' });
  });

  it('reports no change for equal strings', () => {
    expectDiff('', '', { index: 0, remove: 0, insert: '' });
    expectDiff('same', 'same', { index: 4, remove: 0, insert: '' });
  });

  it('never splits a pair that shares its high surrogate', () => {
    expectDiff('\u{d83d}\u{dc77}', '\u{d83d}\u{dea7}\u{d83d}\u{dc77}', { index: 0, remove: 0, insert: '🚧' });
    expectDiff('\u{d83d}\u{dea7}\u{d83d}\u{dc77}', '\u{d83d}\u{dc77}', { index: 0, remove: 2, insert: '' });
  });

  it('never splits a pair that shares its low surrogate', () => {
    expectDiff('\u{d83d}\u{dfe6}\u{d83d}\u{dfe6}', '\u{d83c}\u{dfe6}\u{d83d}\u{dfe6}', { index: 0, remove: 2, insert: '🏦' });
  });

  it('keeps four-unit flags whole at the pair boundary', () => {
    expectDiff('🇦🇨', '🇦🇩', { index: 2, remove: 2, insert: '🇩' });
    expectDiff('a🇧🇩', '🇦🇩', { index: 0, remove: 3, insert: '🇦' });
  });

  // lib0's testRepeatDiffing, seeded so a red run reproduces.
  it('recomposes the target for random pairs', () => {
    const alphabet = ['a', 'b', 'c', ' ', 'é', '🚧', '👷', '\u{d83d}', '\u{dc77}'];
    let seed = 0x2f6b9e1;
    const next = (bound: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;

      return (seed >>> 0) % bound;
    };
    const word = (): string => Array.from({ length: next(12) }, () => alphabet[next(alphabet.length)]).join('');

    for (let iteration = 0; iteration < 5000; iteration += 1) {
      const before = word();
      const after = word();
      const change = simpleDiffString(before, after);

      expect(splice(before, change.index, change.remove, change.insert), `seed step ${iteration}: ${JSON.stringify([before, after])}`).toBe(after);
    }
  });
});
