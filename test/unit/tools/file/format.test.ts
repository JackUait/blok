import { describe, it, expect } from 'vitest';
import { humanFileSize } from '../../../../src/tools/file/format';

describe('humanFileSize', () => {
  it('returns empty string when size is undefined', () => {
    expect(humanFileSize(undefined)).toBe('');
  });

  it('formats bytes under 1 KB as B', () => {
    expect(humanFileSize(512)).toBe('512 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(humanFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(humanFileSize(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('formats gigabytes with one decimal', () => {
    expect(humanFileSize(3 * 1024 * 1024 * 1024)).toBe('3 GB');
  });

  it('drops the trailing .0 for whole numbers', () => {
    expect(humanFileSize(2 * 1024)).toBe('2 KB');
  });
});
