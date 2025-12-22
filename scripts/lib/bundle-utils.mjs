/**
 * Shared utilities for bundle size tracking scripts.
 */

import { readFile } from 'fs/promises';
import { gzipSync } from 'zlib';

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes (can be negative for size decreases)
 * @returns {string} Formatted string
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const sign = bytes < 0 ? '-' : '';
  const absBytes = Math.abs(bytes);
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(absBytes) / Math.log(k));
  return sign + parseFloat((absBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Calculate percentage change between two values
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {number} Percentage change
 */
export function calculatePercentageChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Get gzip size of a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<number>} Gzip size in bytes
 */
export async function getGzipSize(filePath) {
  const content = await readFile(filePath);
  const compressed = gzipSync(content, { level: 9 });
  return compressed.length;
}

/**
 * Normalize size to object format for backward compatibility
 * Handles both old (number) and new ({ raw, gzip }) formats
 * @param {number|{raw: number, gzip: number}} size - Size value
 * @returns {{raw: number, gzip: number|null}} Normalized size object
 */
export function normalizeSize(size) {
  if (typeof size === 'number') {
    return { raw: size, gzip: null };
  }
  return size;
}

/**
 * Get the gzip size from a size object, falling back to raw if gzip not available
 * @param {{raw: number, gzip: number|null}|number} size - Size value
 * @returns {number} Size to use for comparisons
 */
export function getComparisonSize(size) {
  const normalized = normalizeSize(size);
  return normalized.gzip ?? normalized.raw;
}

/**
 * Get the raw size from a size object
 * @param {{raw: number, gzip: number|null}|number} size - Size value
 * @returns {number} Raw size
 */
export function getRawSize(size) {
  const normalized = normalizeSize(size);
  return normalized.raw;
}

/**
 * Format size for display
 * Shows gzip size when available, otherwise raw
 * @param {{raw: number, gzip: number|null}|number} size - Size value
 * @returns {string} Formatted size string
 */
export function formatSizeForDisplay(size) {
  const normalized = normalizeSize(size);
  return formatBytes(normalized.gzip ?? normalized.raw);
}

/**
 * Get chunk group name from a filename
 * Groups hashed chunks by their base pattern
 * @param {string} filename - Bundle filename
 * @returns {string} Group name
 */
export function getChunkGroup(filename) {
  // Entry points keep their exact names
  if (filename === 'blok.mjs' || filename === 'locales.mjs' || filename === '_total') {
    return filename;
  }

  // Hashed main chunks: blok-abc123.mjs -> blok-chunks
  if (/^blok-[a-zA-Z0-9]+\.mjs$/.test(filename)) {
    return 'blok-chunks';
  }

  // Hashed locale chunks: locales-abc123.mjs -> locales-chunks
  if (/^locales-[a-zA-Z0-9]+\.mjs$/.test(filename)) {
    return 'locales-chunks';
  }

  // Unknown pattern, use as-is
  return filename;
}
