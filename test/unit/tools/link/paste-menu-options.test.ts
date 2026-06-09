import { describe, it, expect } from 'vitest';
import { buildPasteMenuOptions } from '../../../../src/tools/link/paste-menu/options';

const types = (url: string, hasSelection = false): string[] =>
  buildPasteMenuOptions(url, { hasSelection }).map((option) => option.type);

describe('buildPasteMenuOptions', () => {
  it('offers plain, bookmark and mention for a generic http URL', () => {
    const result = types('https://example.com/article');

    expect(result).toContain('plain');
    expect(result).toContain('bookmark');
    expect(result).toContain('mention');
  });

  it('does not offer embed for a generic URL', () => {
    expect(types('https://example.com/article')).not.toContain('embed');
  });

  it('offers embed for a known provider URL', () => {
    expect(types('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('embed');
  });

  it('lists embed before bookmark when both apply', () => {
    const result = types('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result.indexOf('embed')).toBeLessThan(result.indexOf('bookmark'));
  });

  it('offers only the plain option when text is selected (Notion just hyperlinks)', () => {
    expect(types('https://example.com/article', true)).toEqual(['plain']);
  });

  it('offers only the plain option for a non-http string', () => {
    expect(types('not a url')).toEqual(['plain']);
  });
});
