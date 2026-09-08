import { describe, it, expect } from 'vitest';

import { formatBytes } from '../../../../src/components/utils/format-bytes';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

describe('formatBytes mutants', () => {
  it('answers with nothing for a size that is not usable', () => {
    expect([formatBytes(0), formatBytes(-1), formatBytes(Number.NaN), formatBytes(Number.POSITIVE_INFINITY)])
      .toStrictEqual(['', '', '', '']);
  });

  // Every unit hands over at exactly its own multiple, never one byte later.
  it('hands each unit over on its boundary', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(KB)).toBe('1 KB');
    expect(formatBytes(MB)).toBe('1.0 MB');
    expect(formatBytes(GB)).toBe('1.0 GB');
  });

  it('rounds away the decimal once a size reaches double digits', () => {
    expect(formatBytes(9.5 * MB)).toBe('9.5 MB');
    expect(formatBytes(10 * MB)).toBe('10 MB');
    expect(formatBytes(9.5 * GB)).toBe('9.5 GB');
    expect(formatBytes(10 * GB)).toBe('10 GB');
  });

  it('rounds a kilobyte count rather than showing a fraction', () => {
    expect(formatBytes(1536)).toBe('2 KB');
  });
});
