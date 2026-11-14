import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconLock, IconPageEmpty } from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return svg;
};

describe('IconLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('centers its shackle and keyhole over a body as wide as the Blok page frame', () => {
    const svg = svgOf(IconLock);
    const body = svg.querySelector('rect');
    const shackle = svg.querySelector('path');
    const keyhole = svg.querySelector('circle');
    const page = svgOf(IconPageEmpty).querySelector('rect');

    expect(shackle?.getAttribute('d')).toBe('M7 8V6.5a3 3 0 0 1 6 0V8');
    expect(Number(body?.getAttribute('x')) + Number(body?.getAttribute('width')) / 2).toBe(10);
    expect(keyhole?.getAttribute('cx')).toBe('10');
    expect(body?.getAttribute('y')).toBe('8');
    for (const attribute of ['x', 'width', 'rx', 'stroke-width']) {
      expect(body?.getAttribute(attribute)).toBe(page?.getAttribute(attribute));
    }
  });
});
