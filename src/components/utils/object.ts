/**
 * Object manipulation utilities
 */

import { isObject } from './type-guards';

/**
 * Deep merge two objects recursively. Arrays are overwritten (not merged).
 * Undefined values in source are skipped (matching lodash.mergeWith behavior).
 * @param target - target object
 * @param source - source object
 * @returns new merged object
 */
const deepMergeTwo = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...target };

  Object.keys(source).forEach((key) => {
    const targetValue = result[key];
    const sourceValue = source[key];

    if (sourceValue === undefined) {
      return;
    }

    const shouldRecurseMerge = isObject(sourceValue) && isObject(targetValue) && !Array.isArray(sourceValue);

    if (shouldRecurseMerge) {
      result[key] = deepMergeTwo(
        targetValue,
        sourceValue
      );

      return;
    }

    result[key] = sourceValue;
  });

  return result;
};

/**
 * Deep merge objects. Arrays are overwritten (not merged).
 * Mutates and returns the target object for compatibility with lodash.mergeWith.
 * @param target - target object to merge into
 * @param sources - source objects to merge from
 * @returns merged object (same reference as target)
 */
export const deepMerge = <T extends Record<string, unknown>> (target: T, ...sources: Partial<T>[]): T => {
  if (!isObject(target) || sources.length === 0) {
    return target;
  }

  const merged = sources.reduce((acc, source) => {
    if (!isObject(source)) {
      return acc;
    }

    return deepMergeTwo(acc, source as Record<string, unknown>);
  }, target as Record<string, unknown>);

  Object.assign(target, merged);

  return target;
};

/**
 * Compares two arrays deeply for equality
 * @param arr1 - first array
 * @param arr2 - second array
 * @returns true if arrays are equal
 */
const arraysEqual = (arr1: unknown[], arr2: unknown[]): boolean => {
  if (arr1.length !== arr2.length) {
    return false;
  }

  return arr1.every((item, index) => equals(item, arr2[index]));
};

/**
 * Compares two values deeply for equality
 * @param var1 - value to compare
 * @param var2 - value to compare with
 * @returns true if they are equal
 */
export const equals = (var1: unknown, var2: unknown): boolean => {
  if (var1 === var2) {
    return true;
  }

  if (var1 === null || var2 === null || typeof var1 !== 'object' || typeof var2 !== 'object') {
    return false;
  }

  if (Array.isArray(var1) !== Array.isArray(var2)) {
    return false;
  }

  if (Array.isArray(var1) && Array.isArray(var2)) {
    return arraysEqual(var1, var2);
  }

  const keys1 = Object.keys(var1);
  const keys2 = Object.keys(var2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  return keys1.every((key) =>
    Object.prototype.hasOwnProperty.call(var2, key) &&
    equals((var1 as Record<string, unknown>)[key], (var2 as Record<string, unknown>)[key])
  );
};
