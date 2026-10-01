import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../../../src/components/icons';

const svgOf = (icon: string | undefined): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(icon ?? '', 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Missing SVG');
  }

  return svg;
};

const numbers = (element: Element, attribute = 'd'): number[] =>
  (element.getAttribute(attribute)?.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

describe('Blok Line image transform icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rotate left wraps its arc around the small panel corner and lands the head on the shaft', () => {
    const svg = svgOf(Icons.IconRotateLeft);
    const panel = svg.querySelector('rect');
    const [shaft, head] = Array.from(svg.querySelectorAll('path'));
    const stroke = Number(shaft.getAttribute('stroke-width'));

    expect(panel?.getAttribute('rx')).toBe('1');
    expect(panel?.getAttribute('width')).toBe(panel?.getAttribute('height'));

    // Shaft: M x0 y0 V y1 a r r 0 0 0 -r -r H tip
    const [startX, , , radius, , , , , dx, dy, tip] = numbers(shaft);
    const left = Number(panel?.getAttribute('x'));
    const top = Number(panel?.getAttribute('y'));
    const right = left + Number(panel?.getAttribute('width'));
    const arcCenter = [startX - radius, numbers(shaft)[2]];

    // A counter-clockwise quarter turn centered on the panel's top-right corner.
    expect(shaft.getAttribute('d')).toMatch(/a([\d.]+) \1 0 0 0-\1-\1H/);
    expect([dx, dy]).toEqual([-radius, -radius]);
    expect(arcCenter).toEqual([right, top]);

    // Head apex is the shaft's end point, so the head cannot drift off it.
    const headPoints = numbers(head);
    const shaftEndY = arcCenter[1] - radius;

    expect([headPoints[2], headPoints[3]]).toEqual([tip, shaftEndY]);
    expect(headPoints[0] - headPoints[2]).toBe(1.75);
    expect(headPoints[0]).toBe(headPoints[4]);
    expect(headPoints[5] - headPoints[3]).toBe(headPoints[3] - headPoints[1]);

    // The head points over the panel and keeps a full stroke of space above it.
    expect(tip).toBeGreaterThan(left);
    expect(tip).toBeLessThan(right);
    expect(top - headPoints[5] - stroke).toBeGreaterThanOrEqual(stroke);
    expect(startX - right - stroke).toBeGreaterThanOrEqual(stroke);
  });

  it('flip horizontal mirrors two triangles across a dashed axis at x 10', () => {
    const paths = Array.from(svgOf(Icons.IconFlipHorizontal).querySelectorAll('path'));

    expect(paths).toHaveLength(3);

    const [axis, first, second] = paths;
    const axisPoints = numbers(axis);
    const stroke = Number(first.getAttribute('stroke-width'));

    expect(axis.getAttribute('d')?.match(/M/g)).toHaveLength(3);
    for (let index = 0; index < axisPoints.length; index += 3) {
      expect(axisPoints[index]).toBe(10);
    }
    // Dashes sit symmetric about the vertical center.
    expect(axisPoints[1] + axisPoints[7] + axisPoints[8]).toBe(20);

    const points = numbers(first);

    expect(first.getAttribute('d')).toMatch(/z$/i);
    expect(numbers(second)).toEqual(points.map((value, position) => position % 2 === 0 ? 20 - value : value));

    const apex = Math.max(...points.filter((_value, position) => position % 2 === 0));

    expect(10 - apex - stroke).toBeGreaterThanOrEqual(stroke);
  });
});
