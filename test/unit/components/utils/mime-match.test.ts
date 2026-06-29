import { describe, it, expect } from 'vitest';
import { matchesMime } from '../../../../src/components/utils/mime-match';

describe('matchesMime', () => {
  it('matches an exact MIME type', () => {
    expect(matchesMime('image/png', ['image/png'])).toBe(true);
    expect(matchesMime('image/jpeg', ['image/png'])).toBe(false);
  });

  it('matches a family wildcard', () => {
    expect(matchesMime('image/avif', ['image/*'])).toBe(true);
    expect(matchesMime('video/x-matroska', ['video/*'])).toBe(true);
    expect(matchesMime('video/mp4', ['image/*'])).toBe(false);
  });

  it('matches the universal wildcard', () => {
    expect(matchesMime('application/pdf', ['*'])).toBe(true);
    expect(matchesMime('application/pdf', ['*/*'])).toBe(true);
  });

  it('is case-insensitive for both type and pattern', () => {
    expect(matchesMime('IMAGE/PNG', ['image/png'])).toBe(true);
    expect(matchesMime('image/png', ['Image/*'])).toBe(true);
  });

  it('matches when any pattern in the list matches', () => {
    expect(matchesMime('audio/mp4', ['image/*', 'audio/*'])).toBe(true);
    expect(matchesMime('text/plain', ['image/*', 'audio/*'])).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesMime('image/png', [])).toBe(false);
  });

  it('returns false for an empty file type unless a wildcard covers it', () => {
    expect(matchesMime('', ['image/*'])).toBe(false);
    expect(matchesMime('', ['*'])).toBe(true);
  });
});
