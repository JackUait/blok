import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keyCodes } from '../../../../src/components/utils/constants';
import { isEmpty, isPrintableKey } from '../../../../src/components/utils/type-guards';

/**
 * Mutant-killing tests for src/components/utils/type-guards.ts.
 *
 * Every recorded live mutant in this file is killable, so there is no
 * equivalence proof to record here. Two observations make them visible:
 *
 * 1. `isEmpty` on a primitive that is neither a string, array, Map nor Set is
 *    the only input that reaches the trailing `return false`. Object.keys on a
 *    primitive returns an empty array (measured: Object.keys(5) is []), so a
 *    mutant that widens the `typeof value === 'object'` test reports the number
 *    5 as empty.
 * 2. `isPrintableKey` compares strictly, so each range bound is itself NOT
 *    printable. Asserting false at every bound distinguishes > from >= and
 *    < from <=. The bounds were checked against the other ranges: none of 47,
 *    58, 64, 95, 112, 185, 193, 218, 223 falls inside a different range, so
 *    each assertion isolates one comparison.
 */
describe('type-guards mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isEmpty', () => {
    it('reports a number as not empty', () => {
      expect(isEmpty(5)).toBe(false);
      expect(isEmpty(0)).toBe(false);
    });

    it('reports a boolean as not empty', () => {
      expect(isEmpty(true)).toBe(false);
      expect(isEmpty(false)).toBe(false);
    });

    it('reports a function as not empty', () => {
      expect(isEmpty(() => undefined)).toBe(false);
    });
  });

  describe('isPrintableKey range bounds', () => {
    it('excludes both bounds of the number range', () => {
      expect(isPrintableKey(keyCodes.NUMBER_KEY_MIN)).toBe(false);
      expect(isPrintableKey(keyCodes.NUMBER_KEY_MAX)).toBe(false);
    });

    it('excludes both bounds of the letter range', () => {
      expect(isPrintableKey(keyCodes.LETTER_KEY_MIN)).toBe(false);
      expect(isPrintableKey(keyCodes.LETTER_KEY_MAX)).toBe(false);
    });

    it('excludes both bounds of the numpad range', () => {
      expect(isPrintableKey(keyCodes.NUMPAD_KEY_MIN)).toBe(false);
      expect(isPrintableKey(keyCodes.NUMPAD_KEY_MAX)).toBe(false);
    });

    it('excludes both bounds of the punctuation range', () => {
      expect(isPrintableKey(keyCodes.PUNCTUATION_KEY_MIN)).toBe(false);
      expect(isPrintableKey(keyCodes.PUNCTUATION_KEY_MAX)).toBe(false);
    });

    it('excludes both bounds of the bracket range', () => {
      expect(isPrintableKey(keyCodes.BRACKET_KEY_MIN)).toBe(false);
      expect(isPrintableKey(keyCodes.BRACKET_KEY_MAX)).toBe(false);
    });

    it('still includes the first and last code inside each range', () => {
      expect(isPrintableKey(keyCodes.NUMBER_KEY_MIN + 1)).toBe(true);
      expect(isPrintableKey(keyCodes.NUMBER_KEY_MAX - 1)).toBe(true);
      expect(isPrintableKey(keyCodes.LETTER_KEY_MIN + 1)).toBe(true);
      expect(isPrintableKey(keyCodes.LETTER_KEY_MAX - 1)).toBe(true);
      expect(isPrintableKey(keyCodes.NUMPAD_KEY_MIN + 1)).toBe(true);
      expect(isPrintableKey(keyCodes.NUMPAD_KEY_MAX - 1)).toBe(true);
      expect(isPrintableKey(keyCodes.PUNCTUATION_KEY_MIN + 1)).toBe(true);
      expect(isPrintableKey(keyCodes.PUNCTUATION_KEY_MAX - 1)).toBe(true);
      expect(isPrintableKey(keyCodes.BRACKET_KEY_MIN + 1)).toBe(true);
      expect(isPrintableKey(keyCodes.BRACKET_KEY_MAX - 1)).toBe(true);
    });
  });
});
