import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconLock, IconLockOpen, IconPageEmpty } from '../../../../src/components/icons';

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

  // The database's "Re-lock" and unlock rows (notion-motion.md Round 68 §1: Notion's lockOpenFill).
  it('opens its twin\'s shackle on the same body and keyhole, the free leg one clear stroke above the body', () => {
    const open = svgOf(IconLockOpen);
    const closed = svgOf(IconLock);
    const shackle = open.querySelector('path')?.getAttribute('d');

    expect(open.querySelector('rect')?.outerHTML).toBe(closed.querySelector('rect')?.outerHTML);
    expect(open.querySelector('circle')?.outerHTML).toBe(closed.querySelector('circle')?.outerHTML);
    // The free leg ends 2.25 above the body's top (y 8), the family's least gap; the arc's top is y 3, the live area's edge.
    expect(shackle).toBe('M7.25 8V5.75a2.75 2.75 0 0 1 5.5 0');
  });
});
