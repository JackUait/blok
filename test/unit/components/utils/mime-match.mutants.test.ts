import { describe, it, expect } from 'vitest';

import { matchesMime } from '../../../../src/components/utils/mime-match';

describe('matchesMime mutants', () => {
  it('accepts either spelling of the universal wildcard', () => {
    expect(matchesMime('image/png', ['*'])).toBe(true);
    expect(matchesMime('image/png', ['*/*'])).toBe(true);
  });

  it('accepts a family wildcard only for that family', () => {
    expect(matchesMime('image/png', ['image/*'])).toBe(true);
    expect(matchesMime('video/mp4', ['image/*'])).toBe(false);
  });

  // Trimming one character too few off the family wildcard would leave a bare
  // "i", which any type starting with that letter satisfies.
  it('trims the whole wildcard suffix, not part of it', () => {
    expect(matchesMime('inode/directory', ['image/*'])).toBe(false);
  });

  // An exact pattern must not be read as a prefix: the wildcard test decides
  // which of the two comparisons runs.
  it('compares an exact pattern for equality, never as a prefix', () => {
    expect(matchesMime('image/png', ['image/pngx'])).toBe(false);
    expect(matchesMime('IMAGE/PNG', ['image/png'])).toBe(true);
  });
});
