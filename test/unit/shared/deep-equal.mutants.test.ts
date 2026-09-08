import { describe, it, expect } from 'vitest';

import { deepEqual } from '../../../src/shared/deep-equal';

/**
 * One survivor is equivalent: widening the array branch to `||`. The guard
 * above it already returned when the two answers disagreed, so at that point
 * both flags hold the same value and either operator picks the same branch.
 */
describe('deepEqual mutants', () => {
  it('compares plain values and nested structures', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(undefined, null)).toBe(false);
  });

  // A primitive has no own keys, so falling through to the key walk would
  // report it equal to an empty object.
  it('refuses a primitive against an object, in either order', () => {
    expect(deepEqual(1, {})).toBe(false);
    expect(deepEqual({}, 1)).toBe(false);
  });

  // null is typeof "object", so only the explicit null test keeps the key walk
  // from dereferencing it.
  it('refuses null against an object without dereferencing it', () => {
    expect(deepEqual({}, null)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('refuses an array against an object of the same shape', () => {
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });

  // Arrays are compared by length and index, never by own keys: an extra
  // non-index property is not content.
  it('compares two arrays by their elements alone', () => {
    expect(deepEqual(Object.assign([1], { tag: 'x' }), [1])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });
});
