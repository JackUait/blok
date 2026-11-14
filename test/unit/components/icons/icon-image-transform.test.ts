import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../../../src/components/icons';

const svgOf = (icon: string | undefined): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(icon ?? '', 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Missing SVG');
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

const pointsOf = (element: Element): Point[] =>
  segmentsOf(element.getAttribute('d') ?? '').map((segment) => segment.points[segment.points.length - 1]);

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
    const path = svg.querySelector('path');
    const stroke = Number(path?.getAttribute('stroke-width'));
    const segments = segmentsOf(path?.getAttribute('d') ?? '');
    const arc = segments.find((segment) => segment.cmd === 'A');
    const lastMove = segments.map((segment) => segment.cmd).lastIndexOf('M');
    const head = segments.slice(lastMove);
    const shaftEnd = segments[lastMove - 1].points[0];

    expect(panel?.getAttribute('rx')).toBe('1.5');
    expect(panel?.getAttribute('width')).toBe(panel?.getAttribute('height'));

    const left = Number(panel?.getAttribute('x'));
    const top = Number(panel?.getAttribute('y'));
    const right = left + Number(panel?.getAttribute('width'));

    // A counter-clockwise quarter turn: it starts on a vertical rail and leaves on a horizontal one.
    expect(arc?.arc).toEqual({ rx: arc?.arc?.rx, ry: arc?.arc?.rx, large: 0, sweep: 0 });
    const radius = arc?.arc?.rx ?? 0;
    const [fromX, fromY] = arc?.from ?? [0, 0];
    const [toX, toY] = arc?.points[0] ?? [0, 0];

    expect([toX - fromX, toY - fromY]).toEqual([-radius, -radius]);
    // Its centre sits on the panel's top edge, and the arc keeps a Keyline gap from the corner.
    const center: Point = [fromX - radius, fromY];

    expect(center[1]).toBe(top);
    expect(radius - Math.hypot(center[0] - right, center[1] - top)).toBeGreaterThanOrEqual(2.25);

    // Head apex is the shaft's end point, so the head cannot drift off it.
    const [armA, apex, armB] = head.map((segment) => segment.points[0]);

    expect(apex).toEqual(shaftEnd);
    expect(armA[0] - apex[0]).toBe(armB[0] - apex[0]);
    expect(armB[1] - apex[1]).toBe(apex[1] - armA[1]);

    // The head points over the panel and keeps Keyline's one unit of clear space above it.
    expect(apex[0]).toBeGreaterThan(left);
    expect(apex[0]).toBeLessThan(right);
    expect(top - Math.max(armA[1], armB[1]) - stroke).toBeGreaterThanOrEqual(1);
    expect(segments[0].points[0][0] - right - stroke).toBeGreaterThanOrEqual(1);
  });

  it('flip horizontal mirrors two triangles across a dashed axis at x 10', () => {
    const paths = Array.from(svgOf(Icons.IconFlipHorizontal).querySelectorAll('path'));

    expect(paths).toHaveLength(3);

    const [axis, first, second] = paths;
    const axisPoints = pointsOf(axis);
    const stroke = Number(first.getAttribute('stroke-width'));

    expect(axis.getAttribute('d')?.match(/M/g)).toHaveLength(3);
    axisPoints.forEach(([x]) => expect(x).toBe(10));
    // Dashes sit symmetric about the vertical center.
    const ys = axisPoints.map(([, y]) => y);

    ys.forEach((y, index) => expect(y + ys[ys.length - 1 - index]).toBe(20));

    const points = pointsOf(first);

    expect(first.getAttribute('d')).toMatch(/z$/i);
    expect(pointsOf(second)).toEqual(points.map(([x, y]) => [20 - x, y]));

    const apex = Math.max(...points.map(([x]) => x));

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

  it('stops each slider rail on its knob ring and staggers the knobs', () => {
    const svg = svgOf(Icons.IconSliders);
    const knobs = Array.from(svg.querySelectorAll('circle'));
    const rails = Array.from(svg.querySelectorAll('path'));

    expect(knobs).toHaveLength(3);
    expect(rails).toHaveLength(3);

    knobs.forEach((knob, row) => {
      const cx = Number(knob.getAttribute('cx'));
      const cy = Number(knob.getAttribute('cy'));
      const r = Number(knob.getAttribute('r'));
      // Each rail is two runs on the knob's row that stop on the knob's ring, never inside it.
      const [[a, y1], [b], [c, y2], [d]] = pointsOf(rails[row]);

      expect([y1, y2]).toEqual([cy, cy]);
      expect(a).toBe(3.5);
      expect(d).toBe(16.5);
      expect([b, c]).toEqual([cx - r, cx + r]);
    });

    const [top, middle, bottom] = knobs.map(knob => Number(knob.getAttribute('cx')));

    expect(middle).not.toBe(top);
    expect(middle).not.toBe(bottom);
  });
});
