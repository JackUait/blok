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

type Point = [number, number];

interface Segment {
  cmd: string;
  from: Point;
  points: Point[];
  arc?: { rx: number; ry: number; large: number; sweep: number };
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Every command made absolute: H/V become L, S/T get their reflected control point.
const segmentsOf = (d: string): Segment[] => {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) ?? [];
  const out: Segment[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let cmd = '';
  let index = 0;

  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) {
      cmd = tokens[index];
      index += 1;
    }
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const args = tokens.slice(index, index + ARITY[upper]).map(Number);

    index += ARITY[upper];
    const at = (x: number, y: number): Point => relative ? [pen[0] + x, pen[1] + y] : [x, y];
    const previous = out[out.length - 1];
    const reflect = (): Point => {
      const control = previous !== undefined && ['C', 'Q'].includes(previous.cmd) ? previous.points[previous.points.length - 2] : pen;

      return [2 * pen[0] - control[0], 2 * pen[1] - control[1]];
    };
    let segment: Segment;

    switch (upper) {
      case 'M': segment = { cmd: 'M', from: pen, points: [at(args[0], args[1])] }; start = segment.points[0]; cmd = relative ? 'l' : 'L'; break;
      case 'L': segment = { cmd: 'L', from: pen, points: [at(args[0], args[1])] }; break;
      case 'H': segment = { cmd: 'L', from: pen, points: [[relative ? pen[0] + args[0] : args[0], pen[1]]] }; break;
      case 'V': segment = { cmd: 'L', from: pen, points: [[pen[0], relative ? pen[1] + args[0] : args[0]]] }; break;
      case 'C': segment = { cmd: 'C', from: pen, points: [at(args[0], args[1]), at(args[2], args[3]), at(args[4], args[5])] }; break;
      case 'S': segment = { cmd: 'C', from: pen, points: [reflect(), at(args[0], args[1]), at(args[2], args[3])] }; break;
      case 'Q': segment = { cmd: 'Q', from: pen, points: [at(args[0], args[1]), at(args[2], args[3])] }; break;
      case 'T': segment = { cmd: 'Q', from: pen, points: [reflect(), at(args[0], args[1])] }; break;
      case 'A': segment = { cmd: 'A', from: pen, points: [at(args[5], args[6])], arc: { rx: args[0], ry: args[1], large: args[3], sweep: args[4] } }; break;
      default: segment = { cmd: 'Z', from: pen, points: [start] };
    }
    out.push(segment);
    pen = segment.points[segment.points.length - 1];
  }

  return out;
};

// Each subpath's corners (end points), absolute; a closing Z adds nothing.
const subpathsOf = (element: Element | null | undefined): Point[][] =>
  segmentsOf(element?.getAttribute('d') ?? '').reduce<Point[][]>((all, segment) => {
    if (segment.cmd === 'M') {
      all.push([]);
    }
    if (segment.cmd !== 'Z') {
      all[all.length - 1].push(segment.points[segment.points.length - 1]);
    }

    return all;
  }, []);

const num = (element: Element | null | undefined, attribute: string): number =>
  Number(element?.getAttribute(attribute));

const box = (element: Element | null | undefined): number[] => ['x', 'y', 'width', 'height'].map(attribute => num(element, attribute));

// The Keyline landscape panel, read from the Table icon that defines it.
const panel = (): Element | null => svgOf('IconTable').querySelector('rect');

const STROKE = 1.25;

describe('Blok Line markup tool icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rectangle is the Panel box with corners tighter than the Panel, so it reads as square-cornered', () => {
    const svg = svgOf('IconRectangle');
    const rect = svg.querySelector('rect');

    expect(svg.children).toHaveLength(1);
    expect(box(rect)).toEqual(box(panel()));
    expect(num(rect, 'rx')).toBeLessThan(num(panel(), 'rx'));
  });

  it('rounded rectangle is the Panel frame with corners round enough to tell it from the rectangle', () => {
    const svg = svgOf('IconRoundedRectangle');
    const rect = svg.querySelector('rect');
    const plain = svgOf('IconRectangle').querySelector('rect');

    expect(svg.children).toHaveLength(1);
    expect(box(rect)).toEqual(box(panel()));
    expect(num(rect, 'rx')).toBeGreaterThanOrEqual(2 * num(plain, 'rx'));
    expect(num(rect, 'rx')).toBeLessThanOrEqual(6);
  });

  it('spotlight is the Panel frame around a centred inner circle, one stroke clear of it', () => {
    const svg = svgOf('IconSpotlight');
    const outer = svg.querySelector('rect');
    const inner = svg.querySelector('circle');
    const [ox, oy] = box(outer);
    const [cx, cy, r] = ['cx', 'cy', 'r'].map(attribute => num(inner, attribute));

    expect(box(outer)).toEqual(box(panel()));
    expect([cx, cy]).toEqual([10, 10]);
    expect(cx - r - ox).toBeGreaterThanOrEqual(2 * STROKE);
    expect(cy - r - oy).toBeGreaterThanOrEqual(2 * STROKE);
  });

  it('hexagon sits on the Keyline circle, point up', () => {
    const svg = svgOf('IconHexagon');
    const [corners] = subpathsOf(svg.querySelector('path'));
    const radius = num(svgOf('IconInfo').querySelector('circle'), 'r');

    expect(svg.children).toHaveLength(1);
    expect(corners).toHaveLength(6);
    expect(corners[0]).toEqual([10, 10 - radius]);
    for (const [x, y] of corners) {
      expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(radius, 1);
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
    const [[[x0, y0], [x1, y1]]] = subpathsOf(paths[0]);

    expect(paths).toHaveLength(1);
    expect(x0).toBeLessThan(x1);
    expect(y0).toBeGreaterThan(y1);
    expect(x1 - x0).toBe(y0 - y1);
    expect(x0 + x1).toBe(20);
    expect(y0 + y1).toBe(20);
  });

  it('arrow reuses the line as its shaft and lands an equal-armed square head on its top end', () => {
    const [line] = subpathsOf(svgOf('IconLineDiagonal').querySelector('path'));
    const [shaft, [[ax, ay], [hx, hy], [bx, by]]] = subpathsOf(svgOf('IconArrowDiagonal').querySelector('path'));
    const [tipX, tipY] = shaft[1];

    // The rail shows line and arrow side by side, so they must share one shaft.
    expect(shaft).toEqual(line);
    expect([hx, hy]).toEqual([tipX, tipY]);
    // One arm horizontal, one vertical, same length.
    expect(ay).toBe(tipY);
    expect(bx).toBe(tipX);
    expect(tipX - ax).toBe(by - tipY);
  });

  it('cursor is a closed pointer mirrored across the diagonal through its tip', () => {
    const paths = svgOf('IconCursor').querySelectorAll('path');
    const [[[tipX, tipY], ...others]] = subpathsOf(paths[0]);
    const rest = others.map(([x, y]) => [x - tipX, y - tipY]);

    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('d')).toMatch(/z$/i);
    expect(Math.min(...others.map(([x]) => x))).toBeGreaterThan(tipX);
    expect(Math.min(...others.map(([, y]) => y))).toBeGreaterThan(tipY);

    const mirrored = rest.map(([dx, dy]) => [dy, dx]).reverse();

    expect(mirrored).toEqual(rest);
    // Optically centered on the canvas.
    expect(tipX + Math.max(...rest.map(([dx]) => dx + tipX))).toBe(20);
  });

  it('highlighter keeps a full stroke of space between its chisel nib and the highlight mark', () => {
    const svg = svgOf('IconHighlighter');
    const paths = Array.from(svg.querySelectorAll('path'));
    const mark = paths.at(-1);
    const [[[markX, markY], [, markEndY]]] = subpathsOf(mark);
    const lowest = Math.max(...paths.slice(0, -1).flatMap(path => subpathsOf(path).flat()).map(([, y]) => y));

    expect(paths).toHaveLength(3);
    expect(markEndY).toBe(markY);
    expect(markY - lowest - STROKE).toBeGreaterThanOrEqual(STROKE);
    expect(markX).toBeGreaterThanOrEqual(3);
  });

  it('eraser body is a rectangle with a divider parallel to its short sides, standing on a baseline', () => {
    const paths = svgOf('IconEraser').querySelectorAll('path');
    // p4 p1 p2 p3 p4 then the baseline end; the divider is its own subpath.
    const [[[x4, y4], [x1, y1], [x2, y2], [x3, y3], [x4b, y4b], [baseEnd, baseY]], [[dx0, dy0], [dx1, dy1]]] = subpathsOf(paths[0]);
    const short = [x1 - x4, y1 - y4];
    const long = [x2 - x1, y2 - y1];

    expect(paths).toHaveLength(1);
    expect([x4b, y4b]).toEqual([x4, y4]);
    expect([x3 - x2, y3 - y2]).toEqual([-short[0], -short[1]]);
    expect(short[0] * long[0] + short[1] * long[1]).toBe(0);
    expect(baseY).toBe(y4);
    expect(baseEnd).toBeGreaterThan(x4);
    expect((dx1 - dx0) / (dy1 - dy0)).toBe(short[0] / short[1]);
    // Divider ends sit on the two long sides.
    expect((dx0 - x1) * long[1] - (dy0 - y1) * long[0]).toBe(0);
    expect((dx1 - x4) * long[1] - (dy1 - y4) * long[0]).toBe(0);
  });

  it('fill is a droplet with a level line across the widest point of its round body, and no solid fill', () => {
    const svg = svgOf('IconFill');
    const [outline, level] = Array.from(svg.querySelectorAll('path'));
    const segments = segmentsOf(outline.getAttribute('d') ?? '');
    const arc = segments.find(segment => segment.cmd === 'A');
    const [rightX, rightY] = arc?.from ?? [0, 0];
    const [leftX] = arc?.points[0] ?? [0, 0];
    const radius = arc?.arc?.rx ?? 0;
    const centerX = (rightX + leftX) / 2;
    const centerY = rightY + Math.sqrt(radius ** 2 - ((rightX - leftX) / 2) ** 2);
    const [[[x0, y0], [x1, y1]]] = subpathsOf(level);

    expect(svg.querySelector('[fill="currentColor"]')).toBeNull();
    expect(outline.getAttribute('d')).toMatch(/z$/i);
    expect(arc?.arc?.large).toBe(1);
    expect(y1).toBe(y0);
    expect(y0).toBeCloseTo(centerY, 1);
    expect([x0, x1]).toEqual([centerX - radius, centerX + radius]);
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
