import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const declarations = (token: string): string[] =>
  [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map(match => match[1].trim());

const spread = (hex: string): number => {
  const channels = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));

  return Math.max(...channels) - Math.min(...channels);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('block controls ("+" and the drag handle)', () => {
  it('are a neutral grey in every theme, with no blue cast', () => {
    const values = declarations('--blok-block-control');

    expect(values).toHaveLength(3);
    values.forEach(value => {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
      expect(spread(value)).toBeLessThanOrEqual(12);
    });
  });

  it('are exposed as the text-block-control utility', () => {
    expect(declarations('--color-block-control')).toEqual(['var(--blok-block-control)']);
  });
});
