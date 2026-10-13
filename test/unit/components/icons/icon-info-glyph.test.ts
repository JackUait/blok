import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconEmojiSmile, IconInfo, IconWarning } from '../../../../src/components/icons';

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
