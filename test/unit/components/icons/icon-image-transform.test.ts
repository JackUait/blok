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

describe('Blok Line image edit icon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('breaks each slider rail around its knob and staggers the knobs', () => {
    const svg = svgOf(Icons.IconSliders);
    const knobs = Array.from(svg.querySelectorAll('circle'));
    const rails = Array.from(svg.querySelectorAll('path'));
    const stroke = Number(rails[0].getAttribute('stroke-width'));

    expect(knobs).toHaveLength(3);
    expect(rails).toHaveLength(3);

    knobs.forEach((knob, row) => {
      const cx = Number(knob.getAttribute('cx'));
      const cy = Number(knob.getAttribute('cy'));
      const outer = Number(knob.getAttribute('r')) + stroke / 2;
      // Each rail: "M a y H b M c y H d" — two segments on the knob's row.
      const [a, y1, b, c, y2, d] = numbers(rails[row]);

      expect([y1, y2]).toEqual([cy, cy]);
      expect(a).toBe(3.5);
      expect(d).toBe(16.5);
      // A visible gap of at least half a stroke between rail cap and knob ring.
      expect(cx - outer - (b + stroke / 2)).toBeGreaterThanOrEqual(stroke / 2);
      expect((c - stroke / 2) - (cx + outer)).toBeGreaterThanOrEqual(stroke / 2);
    });

    const [top, middle, bottom] = knobs.map(knob => Number(knob.getAttribute('cx')));

    expect(middle).not.toBe(top);
    expect(middle).not.toBe(bottom);
  });
});
