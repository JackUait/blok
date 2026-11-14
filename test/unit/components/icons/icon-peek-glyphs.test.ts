/**
 * The row page top bar (feel/findings-rowpage R04): Notion's close », diagonal
 * expand, and one window glyph per peek mode (`peekSide`, `peekCenter`, `peekFull`).
 */
import { describe, expect, it } from 'vitest';

import * as Icons from '../../../../src/components/icons';

const svgOf = (markup: string): Document => new DOMParser().parseFromString(markup, 'image/svg+xml');

const iconOf = (name: string): string => {
  const icon: unknown = Object.entries(Icons).find(([key]) => key === name)?.[1];

  if (typeof icon !== 'string') {
    throw new Error(`Missing ${name}`);
  }

  return icon;
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

const subpathsOf = (d: string): Point[][] => segmentsOf(d).reduce<Point[][]>((all, segment) => {
  if (segment.cmd === 'M') {
    all.push([]);
  }
  all[all.length - 1].push(segment.points[segment.points.length - 1]);

  return all;
}, []);

interface Box { x: number; y: number; width: number; height: number }

const rects = (name: string): Element[] => [...svgOf(iconOf(name)).querySelectorAll('rect')];
const frameOf = (name: string): Element | undefined => rects(name).find((r) => r.getAttribute('stroke') === 'currentColor');
const frameBoxOf = (name: string): Box => {
  const frame = frameOf(name);

  return {
    x: Number(frame?.getAttribute('x')),
    y: Number(frame?.getAttribute('y')),
    width: Number(frame?.getAttribute('width')),
    height: Number(frame?.getAttribute('height')),
  };
};

// The open page: an outlined inner rect drawn as one closed path.
const regionOf = (name: string): Box => {
  const paths = [...svgOf(iconOf(name)).querySelectorAll('path')];
  const points = subpathsOf(paths[0]?.getAttribute('d') ?? '').flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};
const STROKE = 1.25;
// Keyline: neighbouring strokes keep one unit of clear space between their ink.
const CLEAR = 1;

describe('peek mode glyphs', () => {
  const modes = ['IconPeekSide', 'IconPeekCenter', 'IconPeekFull'];

  it.each(modes)('%s draws the page frame of IconSidebarRight', (name) => {
    const frame = svgOf(Icons.IconSidebarRight).querySelector('rect');

    expect(['x', 'y', 'width', 'height', 'rx'].map((a) => frameOf(name)?.getAttribute(a))).toStrictEqual(
      ['x', 'y', 'width', 'height', 'rx'].map((a) => frame?.getAttribute(a))
    );
  });

  it.each(modes)('%s outlines one region that keeps clear of the frame', (name) => {
    const markup = svgOf(iconOf(name));
    const region = regionOf(name);
    const frame = frameBoxOf(name);
    const path = markup.querySelector('path');

    expect(rects(name)).toHaveLength(1);
    expect(markup.querySelectorAll('path')).toHaveLength(1);
    expect(path?.getAttribute('d')).toMatch(/^M[^M]*z$/i);
    expect(path?.getAttribute('fill')).toBeNull();
    // Both outlines are stroked, so the clear space is one stroke less than the centre-line gap.
    expect(region.x - frame.x - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(region.y - frame.y - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(frame.x + frame.width - (region.x + region.width) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(frame.y + frame.height - (region.y + region.height) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('puts the side peek in the inline-end half', () => {
    expect(regionOf('IconPeekSide').x).toBeGreaterThanOrEqual(10);
  });

  it('centres the center peek, and the full page fills more of the frame', () => {
    const center = regionOf('IconPeekCenter');
    const full = regionOf('IconPeekFull');

    expect(center.x + center.width / 2).toBe(10);
    expect(center.y + center.height / 2).toBe(10);
    expect(full.width * full.height).toBeGreaterThan(center.width * center.height * 1.4);
  });
});

describe('IconChevronDoubleRight', () => {
  it('repeats IconChevronRight twice, 4 apart and centred on it', () => {
    const [single] = subpathsOf(svgOf(Icons.IconChevronRight).querySelector('path')?.getAttribute('d') ?? '');
    const paths = [...svgOf(iconOf('IconChevronDoubleRight')).querySelectorAll('path')];
    const chevrons = subpathsOf(paths[0]?.getAttribute('d') ?? '');

    expect(paths).toHaveLength(1);
    expect(chevrons).toStrictEqual([-2, 2].map((dx) => single.map(([x, y]) => [x + dx, y])));
  });
});

describe('IconExpandDiagonal', () => {
  it('is IconArrowDiagonal with the same head turned onto the other end', () => {
    const paths = [...svgOf(iconOf('IconExpandDiagonal')).querySelectorAll('path')];
    const [shaft, head, tail] = subpathsOf(paths[0]?.getAttribute('d') ?? '');
    const arrow = subpathsOf(svgOf(Icons.IconArrowDiagonal).querySelector('path')?.getAttribute('d') ?? '');

    expect(paths).toHaveLength(1);
    expect([shaft, head]).toStrictEqual(arrow);
    // A half turn about the centre: equal heads, one on each end of the shaft.
    expect(tail).toStrictEqual(head.map(([x, y]) => [20 - x, 20 - y]));
    expect(head[1]).toStrictEqual(shaft[1]);
    expect(tail[1]).toStrictEqual(shaft[0]);
  });

  it('is not IconArrowDiagonal\'s one-way arrow', () => {
    expect(iconOf('IconExpandDiagonal')).not.toBe(Icons.IconArrowDiagonal);
  });
});
