/**
 * Unit tests for list utility functions
 */

import { describe, it, expect } from 'vitest';
import { numberToLowerAlpha, numberToLowerRoman } from '../../../../src/tools/list/utils';

describe('list/utils', () => {
  describe('numberToLowerAlpha', () => {
    it('converts 1 to "a"', () => {
      expect(numberToLowerAlpha(1)).toBe('a');
    });

    it('converts single digit numbers to single letters', () => {
      expect(numberToLowerAlpha(2)).toBe('b');
      expect(numberToLowerAlpha(3)).toBe('c');
      expect(numberToLowerAlpha(5)).toBe('e');
      expect(numberToLowerAlpha(10)).toBe('j');
    });

    it('converts 26 to "z"', () => {
      expect(numberToLowerAlpha(26)).toBe('z');
    });

    it('converts 27 to "aa"', () => {
      expect(numberToLowerAlpha(27)).toBe('aa');
    });

    it('converts numbers after z correctly', () => {
      expect(numberToLowerAlpha(28)).toBe('ab');
      expect(numberToLowerAlpha(29)).toBe('ac');
      expect(numberToLowerAlpha(52)).toBe('az');
      expect(numberToLowerAlpha(53)).toBe('ba');
    });

    it('converts three-letter sequences', () => {
      expect(numberToLowerAlpha(703)).toBe('aaa');
      expect(numberToLowerAlpha(704)).toBe('aab');
    });

    it('handles edge case: 0 returns empty string', () => {
      expect(numberToLowerAlpha(0)).toBe('');
    });

    it('handles larger numbers correctly', () => {
      expect(numberToLowerAlpha(100)).toBe('cv');
      expect(numberToLowerAlpha(500)).toBe('sf');
      expect(numberToLowerAlpha(1000)).toBe('all');
    });
  });

  describe('numberToLowerRoman', () => {
    it('converts basic roman numerals', () => {
      expect(numberToLowerRoman(1)).toBe('i');
      expect(numberToLowerRoman(5)).toBe('v');
      expect(numberToLowerRoman(10)).toBe('x');
      expect(numberToLowerRoman(50)).toBe('l');
      expect(numberToLowerRoman(100)).toBe('c');
      expect(numberToLowerRoman(500)).toBe('d');
      expect(numberToLowerRoman(1000)).toBe('m');
    });

    it('converts subtractive notation correctly', () => {
      expect(numberToLowerRoman(4)).toBe('iv');
      expect(numberToLowerRoman(9)).toBe('ix');
      expect(numberToLowerRoman(40)).toBe('xl');
      expect(numberToLowerRoman(90)).toBe('xc');
      expect(numberToLowerRoman(400)).toBe('cd');
      expect(numberToLowerRoman(900)).toBe('cm');
    });

    it('converts compound numbers correctly', () => {
      expect(numberToLowerRoman(2)).toBe('ii');
      expect(numberToLowerRoman(3)).toBe('iii');
      expect(numberToLowerRoman(6)).toBe('vi');
      expect(numberToLowerRoman(7)).toBe('vii');
      expect(numberToLowerRoman(8)).toBe('viii');
    });

    it('converts numbers with multiple place values', () => {
      expect(numberToLowerRoman(11)).toBe('xi');
      expect(numberToLowerRoman(14)).toBe('xiv');
      expect(numberToLowerRoman(19)).toBe('xix');
      expect(numberToLowerRoman(23)).toBe('xxiii');
      expect(numberToLowerRoman(44)).toBe('xliv');
      expect(numberToLowerRoman(49)).toBe('xlix');
      expect(numberToLowerRoman(99)).toBe('xcix');
    });

    it('converts larger numbers correctly', () => {
      expect(numberToLowerRoman(123)).toBe('cxxiii');
      expect(numberToLowerRoman(444)).toBe('cdxliv');
      expect(numberToLowerRoman(555)).toBe('dlv');
      expect(numberToLowerRoman(789)).toBe('dcclxxxix');
      expect(numberToLowerRoman(999)).toBe('cmxcix');
      expect(numberToLowerRoman(1444)).toBe('mcdxliv');
      expect(numberToLowerRoman(1989)).toBe('mcmlxxxix');
    });

    it('handles edge case: 0 returns empty string', () => {
      expect(numberToLowerRoman(0)).toBe('');
    });
  });
});
