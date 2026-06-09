import { describe, it, expect } from 'vitest';
import { Bookmark, Embed, defaultBlockTools } from '../../../../src/tools';

describe('link tools registration', () => {
  it('exports the Bookmark and Embed block tools', () => {
    expect(Bookmark).toBeDefined();
    expect(Embed).toBeDefined();
  });

  it('includes embed and bookmark in defaultBlockTools', () => {
    expect(defaultBlockTools).toHaveProperty('embed');
    expect(defaultBlockTools).toHaveProperty('bookmark');
  });

  it('registers embed before bookmark so specific patterns win over the generic one', () => {
    const keys = Object.keys(defaultBlockTools);

    expect(keys.indexOf('embed')).toBeLessThan(keys.indexOf('bookmark'));
  });

  it('registers image before embed and bookmark so image URLs keep claiming the image tool', () => {
    const keys = Object.keys(defaultBlockTools);

    expect(keys.indexOf('image')).toBeLessThan(keys.indexOf('embed'));
  });
});
