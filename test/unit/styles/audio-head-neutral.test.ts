import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const declarations = (token: string): string[] =>
  [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map(match => match[1].trim());

describe('audio playhead bar', () => {
  it('is painted in the played ink, with no accent blue mixed in', () => {
    const values = declarations('--blok-audio-bar-head');

    expect(values.length).toBeGreaterThan(0);
    values.forEach(value => {
      expect(value).not.toMatch(/accent/);
      expect(value).toBe('var(--blok-audio-bar-played)');
    });
  });
});
