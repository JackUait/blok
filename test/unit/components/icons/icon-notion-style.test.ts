import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconToggleList, IconListNumbered,
} from '../../../../src/components/icons';

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg;
};

const paths = (icon: string): SVGPathElement[] => Array.from(parseSvg(icon).querySelectorAll('path'));
const rows = 'M8.5 6.5H16.5M8.5 13.5H16.5';

describe('heading, list and toggle icon structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries({
    IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
    IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  }))('%s has one main glyph and one digit, both stroked', (_name, icon) => {
    const all = paths(icon);

    expect(all).toHaveLength(2);

    for (const path of all) {
      expect(path.getAttribute('stroke')).toBe('currentColor');
      expect(path.getAttribute('fill')).toBeNull();
      expect(path.getAttribute('stroke-linecap')).toBe('round');
    }
  });

  it('IconHeading has a single stroked H glyph', () => {
    const all = paths(IconHeading);

    expect(all).toHaveLength(1);
    expect(all[0]?.getAttribute('stroke')).toBe('currentColor');
    expect(all[0]?.getAttribute('fill')).toBeNull();
  });

  it('toggle list keeps a small disclosure triangle beside each row', () => {
    const triangle = paths(IconToggleList).find((path) => path.getAttribute('fill') === 'currentColor');
    const d = triangle?.getAttribute('d') ?? '';

    expect(triangle).toBeDefined();
    expect(triangle?.getAttribute('stroke-linejoin')).toBe('round');
    expect(d.match(/[zZ]/g)).toHaveLength(2);
    expect(paths(IconToggleList)[0]?.getAttribute('d')).toBe(rows);
  });

  it('numbered list renders two stroked digits without font dependencies or solid fills', () => {
    const svg = parseSvg(IconListNumbered);
    const digit = paths(IconListNumbered)[1];

    expect(svg.querySelectorAll('text')).toHaveLength(0);
    expect(paths(IconListNumbered)).toHaveLength(2);
    expect(digit?.getAttribute('stroke')).toBe('currentColor');
    expect(digit?.getAttribute('fill')).not.toBe('currentColor');
    expect(digit?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(paths(IconListNumbered)[0]?.getAttribute('d')).toBe(rows);
  });

  it('leaves three units of vertical space between the numbered markers', () => {
    const d = paths(IconListNumbered)[1]?.getAttribute('d') ?? '';
    const digits = d.split('M').filter(Boolean);

    expect(digits).toHaveLength(2);

    // The first digit ends in a relative vertical stem.
    const first = digits[0].match(/^[\d.]+ [\d.]+ [\d.]+ ([\d.]+)v([\d.]+)$/);
    const second = digits[1].match(/^[\d.]+ [\d.]+C[\d.]+ [\d.]+ [\d.]+ ([\d.]+)/);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const firstBottom = Number(first?.[1]) + Number(first?.[2]);
    const secondTop = Number(second?.[1]);

    expect(secondTop - firstBottom).toBeCloseTo(3, 10);
  });
});
