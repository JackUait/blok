import { describe, it, expect } from 'vitest';
import {
  isFunction,
  isObject,
  isString,
  isBoolean,
  isNumber,
  isUndefined,
  isEmpty,
  isPrintableKey,
} from '../../../../src/components/utils/type-guards';
import { keyCodes } from '../../../../src/components/utils/constants';

describe('type-guards', () => {
  describe('isFunction', () => {
    it('should return true for functions', () => {
      expect(isFunction(() => {})).toBe(true);
      expect(isFunction(() => {})).toBe(true);
      expect(isFunction(async () => {})).toBe(true);
      expect(isFunction(function*() {})).toBe(true);
    });

    it('should return false for non-functions', () => {
      expect(isFunction(undefined)).toBe(false);
      expect(isFunction(null)).toBe(false);
      expect(isFunction('string')).toBe(false);
      expect(isFunction(123)).toBe(false);
      expect(isFunction({})).toBe(false);
      expect(isFunction([])).toBe(false);
    });

    it('should narrow type correctly', () => {
      const value: unknown = () => {};
      if (isFunction(value)) {
        // TypeScript should know value is a function here
        expect(value()).toBeUndefined();
      }
    });
  });

  describe('isObject', () => {
    it('should return true for plain objects', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ key: 'value' })).toBe(true);
      expect(isObject(Object.create(null))).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isObject(null)).toBe(false);
      expect(isObject(undefined)).toBe(false);
      expect(isObject('string')).toBe(false);
      expect(isObject(123)).toBe(false);
      expect(isObject(true)).toBe(false);
    });

    it('should return false for arrays', () => {
      expect(isObject([])).toBe(false);
      expect(isObject([1, 2, 3])).toBe(false);
    });

    it('should return false for class instances', () => {
      class TestClass {}
      expect(isObject(new TestClass())).toBe(false);
      expect(isObject(new Date())).toBe(false);
    });
  });

  describe('isString', () => {
    it('should return true for strings', () => {
      expect(isString('')).toBe(true);
      expect(isString('hello')).toBe(true);
      expect(isString(String('test'))).toBe(true);
    });

    it('should return false for non-strings', () => {
      expect(isString(undefined)).toBe(false);
      expect(isString(null)).toBe(false);
      expect(isString(123)).toBe(false);
      expect(isString({})).toBe(false);
      expect(isString([])).toBe(false);
    });
  });

  describe('isBoolean', () => {
    it('should return true for booleans', () => {
      expect(isBoolean(true)).toBe(true);
      expect(isBoolean(false)).toBe(true);
      expect(isBoolean(Boolean(true))).toBe(true);
    });

    it('should return false for non-booleans', () => {
      expect(isBoolean(undefined)).toBe(false);
      expect(isBoolean(null)).toBe(false);
      expect(isBoolean(1)).toBe(false);
      expect(isBoolean(0)).toBe(false);
      expect(isBoolean('true')).toBe(false);
    });
  });

  describe('isNumber', () => {
    it('should return true for numbers', () => {
      expect(isNumber(0)).toBe(true);
      expect(isNumber(123)).toBe(true);
      expect(isNumber(-123)).toBe(true);
      expect(isNumber(1.23)).toBe(true);
      expect(isNumber(NaN)).toBe(true); // NaN has typeof 'number'
      expect(isNumber(Infinity)).toBe(true);
    });

    it('should return false for non-numbers', () => {
      expect(isNumber(undefined)).toBe(false);
      expect(isNumber(null)).toBe(false);
      expect(isNumber('123')).toBe(false);
      expect(isNumber({})).toBe(false);
    });
  });

  describe('isUndefined', () => {
    it('should return true for undefined', () => {
      expect(isUndefined(undefined)).toBe(true);
      expect(isUndefined(void 0)).toBe(true);
    });

    it('should return false for defined values', () => {
      expect(isUndefined(null)).toBe(false);
      expect(isUndefined('')).toBe(false);
      expect(isUndefined(0)).toBe(false);
      expect(isUndefined(false)).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('should return true for null and undefined', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(isEmpty('')).toBe(true);
    });

    it('should return false for non-empty string', () => {
      expect(isEmpty('hello')).toBe(false);
    });

    it('should return true for empty array', () => {
      expect(isEmpty([])).toBe(true);
    });

    it('should return false for non-empty array', () => {
      expect(isEmpty([1])).toBe(false);
    });

    it('should return true for empty object', () => {
      expect(isEmpty({})).toBe(true);
    });

    it('should return false for non-empty object', () => {
      expect(isEmpty({ key: 'value' })).toBe(false);
    });

    it('should return true for empty Map', () => {
      expect(isEmpty(new Map())).toBe(true);
    });

    it('should return false for non-empty Map', () => {
      const map = new Map([['key', 'value']]);
      expect(isEmpty(map)).toBe(false);
    });

    it('should return true for empty Set', () => {
      expect(isEmpty(new Set())).toBe(true);
    });

    it('should return false for non-empty Set', () => {
      const set = new Set([1]);
      expect(isEmpty(set)).toBe(false);
    });
  });

  describe('isPrintableKey', () => {
    it('should return true for letter keys', () => {
      expect(isPrintableKey(65)).toBe(true); // A
      expect(isPrintableKey(90)).toBe(true); // Z
    });

    it('should return true for number keys', () => {
      expect(isPrintableKey(48)).toBe(true); // 0
      expect(isPrintableKey(57)).toBe(true); // 9
    });

    it('should return true for space and enter', () => {
      expect(isPrintableKey(keyCodes.SPACE)).toBe(true);
      expect(isPrintableKey(keyCodes.ENTER)).toBe(true);
    });

    it('should return true for processing key', () => {
      expect(isPrintableKey(keyCodes.PROCESSING_KEY)).toBe(true);
    });

    it('should return true for numpad keys', () => {
      expect(isPrintableKey(96)).toBe(true); // Numpad 0
      expect(isPrintableKey(111)).toBe(true); // Numpad divide
    });

    it('should return true for punctuation keys', () => {
      expect(isPrintableKey(186)).toBe(true); // semicolon
      expect(isPrintableKey(192)).toBe(true); // backtick
    });

    it('should return true for bracket keys', () => {
      expect(isPrintableKey(219)).toBe(true); // left bracket
      expect(isPrintableKey(222)).toBe(true); // quote
    });

    it('should return false for modifier keys', () => {
      expect(isPrintableKey(keyCodes.SHIFT)).toBe(false);
      expect(isPrintableKey(keyCodes.CTRL)).toBe(false);
      expect(isPrintableKey(keyCodes.ALT)).toBe(false);
      expect(isPrintableKey(keyCodes.META)).toBe(false);
    });

    it('should return false for function keys', () => {
      expect(isPrintableKey(keyCodes.ESC)).toBe(false);
      expect(isPrintableKey(keyCodes.BACKSPACE)).toBe(false);
      expect(isPrintableKey(keyCodes.DELETE)).toBe(false);
      expect(isPrintableKey(keyCodes.TAB)).toBe(false);
    });

    it('should return false for arrow keys', () => {
      expect(isPrintableKey(keyCodes.LEFT)).toBe(false);
      expect(isPrintableKey(keyCodes.UP)).toBe(false);
      expect(isPrintableKey(keyCodes.RIGHT)).toBe(false);
      expect(isPrintableKey(keyCodes.DOWN)).toBe(false);
    });
  });
});
