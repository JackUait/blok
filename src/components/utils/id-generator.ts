/**
 * ID generation utilities
 */

import { nanoid } from 'nanoid';

/**
 * Constants for ID generation
 */
const ID_RANDOM_MULTIPLIER = 100_000_000; // 1e8
const HEXADECIMAL_RADIX = 16;

/**
 * Create a block id
 * @returns unique block ID
 */
export const generateBlockId = (): string => {
  const idLen = 10;

  return nanoid(idLen);
};

/**
 * Returns random generated identifier
 * @param prefix - identifier prefix
 * @returns unique identifier with prefix
 */
export const generateId = (prefix = ''): string => {
  return `${prefix}${(Math.floor(Math.random() * ID_RANDOM_MULTIPLIER)).toString(HEXADECIMAL_RADIX)}`;
};
