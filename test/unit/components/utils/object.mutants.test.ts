/**
 * Mutation-hardening tests for `src/components/utils/object.ts`.
 *
 * PROVEN-EQUIVALENT survivor:
 *
 * 1. LogicalOperator on line 100 of `equals`, turning
 *    `Array.isArray(var1) && Array.isArray(var2)` into `||`.
 *
 * Lines 96-98 run first and return false whenever
 * `Array.isArray(var1) !== Array.isArray(var2)`, so by line 100 the two calls
 * are guaranteed to agree. When both operands hold the same boolean, `&&` and
 * `||` compute that same boolean, so the mutant cannot change the branch taken
 * for any input. `Array.isArray` reads an internal slot and is pure, so it
 * cannot disagree between the two calls either.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { deepMerge, equals } from '../../../../src/components/utils/object';

describe('object — mutation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('deepMerge', () => {
    it('replaces an object value with a primitive instead of recursing into it', () => {
      const target: Record<string, unknown> = { a: { b: 1 } };

      deepMerge(target, { a: 5 });

      // Recursion needs BOTH sides to be objects; a primitive source wins outright.
      expect(target.a).toBe(5);
    });

    it('replaces a primitive value with an object', () => {
      const target: Record<string, unknown> = { a: 1 };

      deepMerge(target, { a: { b: 2 } });

      expect(target.a).toEqual({ b: 2 });
    });

    it('writes nothing to the target when there are no sources', () => {
      // A frozen target turns any write into a TypeError, so the early return
      // is the only way this call can succeed.
      const target: Record<string, unknown> = Object.freeze({ a: 1 });

      expect(deepMerge(target)).toBe(target);
    });
  });

  describe('equals', () => {
    it('returns false when only the second value is an object', () => {
      expect(equals(5, {})).toBe(false);
      expect(equals('', {})).toBe(false);
    });

    it('returns false when only the first value is an object', () => {
      expect(equals({}, 5)).toBe(false);
      expect(equals({}, '')).toBe(false);
    });

    it('compares arrays by length and indexed items, ignoring extra own keys', () => {
      const withExtra = Object.assign([1], { extra: 2 });

      expect(equals(withExtra, [1])).toBe(true);
      expect(equals([1], withExtra)).toBe(true);
    });
  });
});
