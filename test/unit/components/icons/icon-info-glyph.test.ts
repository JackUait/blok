import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconEmojiSmile, IconHelp, IconInfo, IconWarning } from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return svg;
};

describe('IconInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The (i) is the warning's stem and dot, flipped, inside the standard circle.
  it('draws the warning stem and dot, flipped, inside the standard circle', () => {
    const svg = svgOf(IconInfo);
    const [ring, dot] = [...svg.querySelectorAll('circle')];
    const stem = svg.querySelector('path');
    const standard = svgOf(IconEmojiSmile).querySelector('circle');
    const warningDot = svgOf(IconWarning).querySelector('circle');

    expect(['cx', 'cy', 'r', 'stroke-width'].map((a) => ring?.getAttribute(a))).toEqual(['cx', 'cy', 'r', 'stroke-width'].map((a) => standard?.getAttribute(a)));
    expect(dot?.getAttribute('r')).toBe(warningDot?.getAttribute('r'));
    expect(dot?.getAttribute('cx')).toBe('10');
    expect(stem?.getAttribute('d')).toBe('M10 9.25v4');
    // The dot clears the stem's round cap by at least one stroke width.
    expect(9.25 - 0.625 - (Number(dot?.getAttribute('cy')) + Number(dot?.getAttribute('r')))).toBeGreaterThanOrEqual(1.25);
  });
});

describe('IconHelp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The (?) shares the (i)'s ring and dot size, so the two read as one pair.
  it('draws a hook and dot inside the same circle as IconInfo', () => {
    const svg = svgOf(IconHelp);
    const [ring, dot] = [...svg.querySelectorAll('circle')];
    const [infoRing, infoDot] = [...svgOf(IconInfo).querySelectorAll('circle')];
    const hookEnd = 11;

    expect(['cx', 'cy', 'r', 'stroke-width'].map((a) => ring?.getAttribute(a))).toEqual(['cx', 'cy', 'r', 'stroke-width'].map((a) => infoRing?.getAttribute(a)));
    expect(dot?.getAttribute('r')).toBe(infoDot?.getAttribute('r'));
    expect(dot?.getAttribute('cx')).toBe('10');
    // Ends at (10, 11): the hook's arc starts at (8, 8) around (10, 8).
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M8 8a2 2 0 1 1 3.41 1.41c-.6.6-1.41 .95-1.41 1.59');
    // The dot clears the hook's round cap by at least one stroke width.
    expect(Number(dot?.getAttribute('cy')) - Number(dot?.getAttribute('r')) - (hookEnd + 0.625)).toBeGreaterThanOrEqual(1.25);
  });
});
