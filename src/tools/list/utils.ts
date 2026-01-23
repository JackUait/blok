/**
 * Number formatting utilities for ordered list markers.
 */

/**
 * Convert a number to lowercase alphabetic (a, b, ..., z, aa, ab, ...)
 * @param num - The number to convert (1-based)
 * @returns The alphabetic representation
 */
export const numberToLowerAlpha = (num: number): string => {
  const convertRecursive = (n: number): string => {
    if (n <= 0) return '';
    const adjusted = n - 1;
    return convertRecursive(Math.floor(adjusted / 26)) + String.fromCharCode(97 + (adjusted % 26));
  };
  return convertRecursive(num);
};

/**
 * Convert a number to lowercase roman numerals (i, ii, iii, iv, ...)
 * @param num - The number to convert
 * @returns The roman numeral representation
 */
export const numberToLowerRoman = (num: number): string => {
  const romanNumerals: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ];

  const convertRecursive = (remaining: number, idx: number): string => {
    if (remaining <= 0 || idx >= romanNumerals.length) return '';
    const [value, numeral] = romanNumerals[idx];
    if (remaining >= value) {
      return numeral + convertRecursive(remaining - value, idx);
    }
    return convertRecursive(remaining, idx + 1);
  };

  return convertRecursive(num, 0);
};
