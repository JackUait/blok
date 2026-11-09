import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const NAV_ICONS = [
  'IconEmojiNavSparkles', 'IconEmojiNavSmile', 'IconEmojiNavCat', 'IconEmojiNavBurger', 'IconEmojiNavBall',
  'IconEmojiNavCar', 'IconEmojiNavBulb', 'IconEmojiNavHeart', 'IconEmojiNavFlag',
] as const;

const markupOf = (name: string): string => {
  const value: unknown = (icons as Record<string, unknown>)[name];

  if (typeof value !== 'string') {
    throw new Error(`${name} is not exported`);
  }

  return value;
};

const parse = (markup: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Invalid SVG');
  }

  return svg;
};

describe('Emoji picker category row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(NAV_ICONS)('%s is drawn on the 20-unit grid at the row weight of 1.5', (name) => {
    const svg = parse(markupOf(name));
    const widths = [...svg.querySelectorAll('[stroke-width]')].map(node => Number(node.getAttribute('stroke-width')));

    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(new Set([1.5]));
  });

  it('gives every category its own drawing', () => {
    const drawings = NAV_ICONS.map(name => parse(markupOf(name)).innerHTML.replace(/\s+/g, ' ').trim());

    expect(new Set(drawings).size).toBe(NAV_ICONS.length);
  });
});
