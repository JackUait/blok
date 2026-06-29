import { describe, it, expect } from 'vitest';
import { formatBytes } from '../../../../src/components/utils/format-bytes';

describe('formatBytes', () => {
  it('returns empty string for non-positive or non-finite input', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(-5)).toBe('');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });

  it('formats bytes under 1 KiB as B', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kibibytes as rounded KB', () => {
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('keeps one decimal for MB below 10, rounds at or above 10', () => {
    // 10485760 = 10 MiB exactly
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    // ~10.5 MiB (the figure from the reported Kaiten error)
    expect(formatBytes(10975799)).toBe('10 MB');
    // 3.5 MiB keeps a decimal
    expect(formatBytes(Math.round(3.5 * 1024 * 1024))).toBe('3.5 MB');
  });

  it('formats gibibytes', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});
