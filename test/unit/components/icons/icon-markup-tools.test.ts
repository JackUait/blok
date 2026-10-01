import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../../../src/components/icons';

const icons: Record<string, unknown> = Icons;

const svgOf = (name: string): SVGSVGElement => {
  const markup = icons[name];
  const svg = typeof markup === 'string'
    ? new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('svg')
    : null;

  if (svg === null) {
    throw new Error(`Missing SVG: ${name}`);
  }

  return svg;
};

const numbers = (element: Element | null | undefined, attribute = 'd'): number[] =>
  (element?.getAttribute(attribute)?.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

const num = (element: Element | null | undefined, attribute: string): number =>
  Number(element?.getAttribute(attribute));

const STROKE = 1.25;

describe('Blok Line markup tool icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rectangle is exactly the Panel key shape', () => {
    const svg = svgOf('IconRectangle');
    const rect = svg.querySelector('rect');

    expect(svg.children).toHaveLength(1);
    expect(['x', 'y', 'width', 'height', 'rx'].map(attribute => num(rect, attribute))).toEqual([3, 4, 14, 12, 2]);
  });

  it('rounded rectangle is the Panel frame with corners round enough to tell it from the rectangle', () => {
    const svg = svgOf('IconRoundedRectangle');
    const rect = svg.querySelector('rect');
    const plain = svgOf('IconRectangle').querySelector('rect');

    expect(svg.children).toHaveLength(1);
    expect(['x', 'y', 'width', 'height'].map(attribute => num(rect, attribute))).toEqual([3, 4, 14, 12]);
    expect(num(rect, 'rx')).toBeGreaterThanOrEqual(2 * num(plain, 'rx'));
    expect(num(rect, 'rx')).toBeLessThanOrEqual(6);
  });

  it('hexagon sits on the standalone circle, point up', () => {
    const svg = svgOf('IconHexagon');
    const pts = numbers(svg.querySelector('path'));
    const corners = Array.from({ length: pts.length / 2 }, (_, i) => ({ x: pts[i * 2], y: pts[i * 2 + 1] }));

    expect(svg.children).toHaveLength(1);
    expect(corners).toHaveLength(6);
    expect(corners[0]).toEqual({ x: 10, y: 3.5 });
    for (const c of corners) {
      expect(Math.hypot(c.x - 10, c.y - 10)).toBeCloseTo(6.5, 1);
    }
  });

  it('ellipse is a horizontal ellipse as wide as the Panel, centered on the canvas', () => {
    const svg = svgOf('IconEllipse');
    const ellipse = svg.querySelector('ellipse');

    expect(svg.children).toHaveLength(1);
    expect([num(ellipse, 'cx'), num(ellipse, 'cy')]).toEqual([10, 10]);
    expect(num(ellipse, 'rx') * 2).toBe(14);
    expect(num(ellipse, 'ry')).toBeLessThan(num(ellipse, 'rx'));
  });

  it('line runs at 45 degrees from bottom-left to top-right, centered on the canvas', () => {
    const paths = svgOf('IconLineDiagonal').querySelectorAll('path');
    const [x0, y0, x1, y1] = numbers(paths[0]);

    expect(paths).toHaveLength(1);
    expect(x0).toBeLessThan(x1);
    expect(y0).toBeGreaterThan(y1);
    expect(x1 - x0).toBe(y0 - y1);
    expect(x0 + x1).toBe(20);
    expect(y0 + y1).toBe(20);
  });

  it('arrow reuses the line as its shaft and lands an equal-armed square head on its top end', () => {
    const line = svgOf('IconLineDiagonal').querySelector('path');
    const [shaft, head] = Array.from(svgOf('IconArrowDiagonal').querySelectorAll('path'));
    const [, , tipX, tipY] = numbers(shaft);
    const [ax, ay, hx, hy, bx, by] = numbers(head);

    expect(shaft.getAttribute('d')).toBe(line?.getAttribute('d'));
    expect([hx, hy]).toEqual([tipX, tipY]);
    // One arm horizontal, one vertical, same length.
    expect(ay).toBe(tipY);
    expect(bx).toBe(tipX);
    expect(tipX - ax).toBe(by - tipY);
  });

  it('cursor is a closed pointer mirrored across the diagonal through its tip', () => {
    const paths = svgOf('IconCursor').querySelectorAll('path');
    const points = numbers(paths[0]);
    const [tipX, tipY] = points;
    const rest = [];

    for (let index = 2; index < points.length; index += 2) {
      rest.push([points[index] - tipX, points[index + 1] - tipY]);
    }

    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('d')).toMatch(/z$/i);
    expect(Math.min(...points.filter((_value, position) => position % 2 === 0))).toBe(tipX);
    expect(Math.min(...points.filter((_value, position) => position % 2 === 1))).toBe(tipY);

    const mirrored = rest.map(([dx, dy]) => [dy, dx]).reverse();

    expect(mirrored).toEqual(rest);
    // Optically centered on the canvas.
    expect(tipX + Math.max(...rest.map(([dx]) => dx + tipX))).toBe(20);
  });

  it('highlighter keeps a full stroke of space between its chisel nib and the highlight mark', () => {
    const svg = svgOf('IconHighlighter');
    const paths = Array.from(svg.querySelectorAll('path'));
    const mark = paths.at(-1);
    const [markX, markY] = numbers(mark);
    const drawn = paths.slice(0, -1).flatMap(path => numbers(path));
    const lowest = Math.max(...drawn.filter((_value, position) => position % 2 === 1));

    expect(paths).toHaveLength(3);
    expect(mark?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+H[\d.]+$/);
    expect(markY - lowest - STROKE).toBeGreaterThanOrEqual(STROKE);
    expect(markX).toBeGreaterThanOrEqual(3);
  });

  it('eraser body is a rectangle with a divider parallel to its short sides, standing on a baseline', () => {
    const [body, divider] = Array.from(svgOf('IconEraser').querySelectorAll('path'));
    // M p4 L p1 L p2 L p3 L p4 H baseEnd
    const [x4, y4, x1, y1, x2, y2, x3, y3, x4b, y4b, baseEnd] = numbers(body);
    const short = [x1 - x4, y1 - y4];
    const long = [x2 - x1, y2 - y1];
    const [dx0, dy0, dx1, dy1] = numbers(divider);

    expect([x4b, y4b]).toEqual([x4, y4]);
    expect([x3 - x2, y3 - y2]).toEqual([-short[0], -short[1]]);
    expect(short[0] * long[0] + short[1] * long[1]).toBe(0);
    expect(baseEnd).toBeGreaterThan(x4);
    expect((dx1 - dx0) / (dy1 - dy0)).toBe(short[0] / short[1]);
    // Divider ends sit on the two long sides.
    expect((dx0 - x1) * long[1] - (dy0 - y1) * long[0]).toBe(0);
    expect((dx1 - x4) * long[1] - (dy1 - y4) * long[0]).toBe(0);
  });

  it('fill is a droplet whose lower half is filled from the same arc circle', () => {
    const svg = svgOf('IconFill');
    const outline = svg.querySelector('path[stroke="currentColor"]');
    const fill = svg.querySelector('path[fill="currentColor"]');
    // M apex L right A r r 0 1 1 left Z
    const [, , rightX, rightY, radius, , , , , leftX] = numbers(outline);
    // M left A r r 0 0 0 right Z
    const [fx0, fy0, fr, , , , , fx1, fy1] = numbers(fill);
    const centerX = (rightX + leftX) / 2;
    const centerY = rightY + Math.sqrt(radius ** 2 - ((rightX - leftX) / 2) ** 2);

    expect(outline?.getAttribute('d')).toMatch(/z$/i);
    expect(fr).toBe(radius);
    expect(fy0).toBe(fy1);
    expect(fx1 - fx0).toBe(2 * radius);
    expect((fx0 + fx1) / 2).toBe(centerX);
    expect(fy0).toBeCloseTo(centerY, 1);
  });

  it('lists the whole markup tool rail together in the playground gallery', () => {
    const html = readFileSync(resolve(__dirname, '../../../../index.html'), 'utf-8');
    const group = html.match(/'Markup': \[([^\]]*)\]/)?.[1] ?? '';

    for (const name of [
      'IconCursor', 'IconPencil', 'IconHighlighter', 'IconText', 'IconRectangle',
      'IconEllipse', 'IconArrowDiagonal', 'IconLineDiagonal', 'IconEraser', 'IconFill',
    ]) {
      expect(group).toContain(`'${name}'`);
      expect(typeof icons[name]).toBe('string');
    }
  });
});
