import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconAlarm } from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return svg;
};

/** Distance from a point to the line through two points. */
const toLine = (p: [number, number], a: [number, number], b: [number, number]): number =>
  Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

describe('IconAlarm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // An alarm clock: a face with hands and two bells; the bells mirror and clear the face.
  it('mirrors its bells around the face and keeps a stroke width between them and the face', () => {
    const svg = svgOf(IconAlarm);
    const face = svg.querySelector('circle');
    const bells = [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '').filter((d) => d.startsWith('M3.5') || d.startsWith('M16.5'));
    const cx = Number(face?.getAttribute('cx'));
    const cy = Number(face?.getAttribute('cy'));
    const r = Number(face?.getAttribute('r'));

    expect(cx).toBe(10);
    expect(bells).toEqual(['M3.5 6 6 3.5', 'M16.5 6 14 3.5']);
    const gap = toLine([cx, cy], [3.5, 6], [6, 3.5]) - r - 1.25;

    expect(gap).toBeGreaterThanOrEqual(1.25);
  });
});
