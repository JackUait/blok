/**
 * Mutation-hardening tests for `src/tools/list/utils.ts`.
 *
 * `numberToLowerRoman` walks a table of [value, numeral] pairs. Every guard in
 * that walk is exercised here through a fractional input, which is the only
 * input that can drive `idx` past the end of the table: a whole number always
 * terminates on the [1, i] entry, so the index guard never fires.
 *
 * PROVEN-EQUIVALENT survivors (both on the `remaining` half of the guard):
 *
 * 1. EqualityOperator `remaining <= 0` to `remaining < 0`.
 * 2. ConditionalExpression `remaining <= 0` to `false`.
 *
 * Both only change behaviour when `remaining` is exactly 0, and `remaining`
 * can never be negative because a subtraction only happens on the
 * `remaining >= value` branch. With `remaining` at 0 every table value is 1 or
 * more, so no numeral branch can be taken: the recursion can only increment
 * `idx` until `idx >= romanNumerals.length` returns the same empty string the
 * original returned straight away. The two mutants therefore differ from the
 * original only in how many frames they burn before returning ''. Checked over
 * every integer in -20..4000 plus fractions, NaN and both infinities: zero
 * output differences.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { numberToLowerRoman } from '../../../../src/tools/list/utils';

describe('numberToLowerRoman — mutation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops at the end of the numeral table when a remainder cannot be spent', () => {
    // A fraction below 1 matches no table entry, so the walk runs off the end
    // of the table. Only the index guard stops it.
    expect(numberToLowerRoman(2.5)).toBe('ii');
    expect(numberToLowerRoman(0.5)).toBe('');
    expect(numberToLowerRoman(1.5)).toBe('i');
  });

  it('returns an empty string for non-positive input', () => {
    expect(numberToLowerRoman(0)).toBe('');
    expect(numberToLowerRoman(-1)).toBe('');
    expect(numberToLowerRoman(-0.5)).toBe('');
  });
});
