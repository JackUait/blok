/**
 * Type guard utilities for runtime type checking
 */

import { keyCodes } from './constants';

/**
 * Check if passed variable is a function
 */
export const isFunction = (fn: unknown): fn is (...args: unknown[]) => unknown => {
  return typeof fn === 'function';
};

/**
 * Checks if passed argument is a plain object (created by {} or Object constructor)
 */
export const isObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(v) as Record<string, unknown> | null;

  return proto === null || proto === Object.prototype;
};

/**
 * Checks if passed argument is a string
 */
export const isString = (v: unknown): v is string => {
  return typeof v === 'string';
};

/**
 * Checks if passed argument is boolean
 */
export const isBoolean = (v: unknown): v is boolean => {
  return typeof v === 'boolean';
};

/**
 * Checks if passed argument is number (including NaN, which has typeof 'number')
 */
export const isNumber = (v: unknown): v is number => {
  return typeof v === 'number';
};

/**
 * Checks if passed argument is undefined
 */
export const isUndefined = function (v: unknown): v is undefined {
  return v === undefined;
};

/**
 * Checks if value is empty (null, undefined, empty string, empty array, empty object, empty Map/Set)
 */
export const isEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
};

/**
 * Returns true if passed key code is printable (a-Z, 0-9, etc) character.
 */
export const isPrintableKey = (keyCode: number): boolean => {
  return (keyCode > keyCodes.NUMBER_KEY_MIN && keyCode < keyCodes.NUMBER_KEY_MAX) || // number keys
    keyCode === keyCodes.SPACE || keyCode === keyCodes.ENTER || // Space bar & return key(s)
    keyCode === keyCodes.PROCESSING_KEY || // processing key input for certain languages — Chinese, Japanese, etc.
    (keyCode > keyCodes.LETTER_KEY_MIN && keyCode < keyCodes.LETTER_KEY_MAX) || // letter keys
    (keyCode > keyCodes.NUMPAD_KEY_MIN && keyCode < keyCodes.NUMPAD_KEY_MAX) || // Numpad keys
    (keyCode > keyCodes.PUNCTUATION_KEY_MIN && keyCode < keyCodes.PUNCTUATION_KEY_MAX) || // ;=,-./` (in order)
    (keyCode > keyCodes.BRACKET_KEY_MIN && keyCode < keyCodes.BRACKET_KEY_MAX); // [\]' (in order)
};
