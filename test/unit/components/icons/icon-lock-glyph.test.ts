import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconLock, IconRectangle } from '../../../../src/components/icons';

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

  it('centers its shackle and keyhole over a panel-weight body', () => {
    const svg = svgOf(IconLock);
    const body = svg.querySelector('rect');
    const shackle = svg.querySelector('path');
    const keyhole = svg.querySelector('circle');
    const panel = svgOf(IconRectangle).querySelector('rect');

    expect(shackle?.getAttribute('d')).toBe('M7 8V6.5a3 3 0 0 1 6 0V8');
    expect(Number(body?.getAttribute('x')) + Number(body?.getAttribute('width')) / 2).toBe(10);
    expect(keyhole?.getAttribute('cx')).toBe('10');
    expect(body?.getAttribute('rx')).toBe(panel?.getAttribute('rx'));
    expect(body?.getAttribute('stroke-width')).toBe(panel?.getAttribute('stroke-width'));
  });
});
