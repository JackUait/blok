import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(icon, 'image/svg+xml').querySelector('svg');

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

// Each subpath's end points, absolute; a closing Z adds nothing.
const subpathsOf = (element: Element | undefined): Point[][] =>
  segmentsOf(element?.getAttribute('d') ?? '').reduce<Point[][]>((all, segment) => {
    if (segment.cmd === 'M') {
      all.push([]);
    }
    if (segment.cmd !== 'Z') {
      all[all.length - 1].push(segment.points[segment.points.length - 1]);
    }

    return all;
  }, []);

const numbers = (element: Element, attribute = 'd'): number[] =>
  (element.getAttribute(attribute)?.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

const close = (a: Point, b: Point): boolean => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;

// Points along every straight and arc stroke of a path, for clearance checks.
const inkOf = (d: string): Point[] => segmentsOf(d).filter(({ cmd }) => cmd !== 'M').flatMap((segment): Point[] => {
  const end = segment.points[segment.points.length - 1];
  const steps = 24;

  if (segment.cmd === 'A' && segment.arc !== undefined) {
    const { rx: r, large, sweep } = segment.arc;
    const [x1, y1] = segment.from;
    const mid: Point = [(x1 + end[0]) / 2, (y1 + end[1]) / 2];
    const half = Math.hypot(end[0] - x1, end[1] - y1) / 2;
    const rise = Math.sqrt(Math.max(0, r ** 2 - half ** 2));
    const side = large === sweep ? -1 : 1;
    const center: Point = [mid[0] + side * rise * -(end[1] - y1) / (2 * half), mid[1] + side * rise * (end[0] - x1) / (2 * half)];
    const from = Math.atan2(y1 - center[1], x1 - center[0]);
    let turn = Math.atan2(end[1] - center[1], end[0] - center[0]) - from;

    if (sweep === 1 && turn < 0) {
      turn += 2 * Math.PI;
    }
    if (sweep === 0 && turn > 0) {
      turn -= 2 * Math.PI;
    }

    return Array.from({ length: steps + 1 }, (_, i): Point => [
      center[0] + r * Math.cos(from + turn * i / steps),
      center[1] + r * Math.sin(from + turn * i / steps),
    ]);
  }

  return Array.from({ length: steps + 1 }, (_, i): Point => [
    segment.from[0] + (end[0] - segment.from[0]) * i / steps,
    segment.from[1] + (end[1] - segment.from[1]) * i / steps,
  ]);
});

const STROKE = 1.25;
// Keyline: neighbouring strokes keep one unit of clear space between their ink.
const CLEAR = 1;

describe('Blok Line media completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crop is two rounded L rails, a half turn apart, crossing near each corner', () => {
    const paths = Array.from(svgOf(Icons.IconCrop).querySelectorAll('path'));
    const [first, second] = subpathsOf(paths[0]);
    const corners = segmentsOf(paths[0].getAttribute('d') ?? '').filter(({ cmd }) => cmd === 'A');

    expect(paths).toHaveLength(1);
    expect(corners.map(({ arc }) => arc?.rx)).toEqual([1, 1]);
    expect([...second].reverse()).toEqual(first.map(([x, y]) => [20 - x, 20 - y]));
    // The first rail's stem crosses the second rail's bar and runs a full stroke past it.
    const [[stemX, stemTop]] = first;
    const [[barStart, barY], [barEnd]] = second;

    expect(stemX).toBeGreaterThan(barStart);
    expect(stemX).toBeLessThan(barEnd);
    expect(barY - stemTop).toBeGreaterThanOrEqual(2 * STROKE);
    expect(stemX - barStart).toBeGreaterThanOrEqual(2 * STROKE);
  });

  it('reverses four equal fullscreen corners without adding diagonal shafts', () => {
    const [expandedPath] = Array.from(svgOf(Icons.IconExpandFullscreen).querySelectorAll('path'));
    const [contractedPath] = Array.from(svgOf(Icons.IconCollapseFullscreen).querySelectorAll('path'));
    const expanded = subpathsOf(expandedPath);
    const contracted = subpathsOf(contractedPath);
    const boxOf = (points: Point[]): number[] => {
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);

      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };

    expect(expanded).toHaveLength(4);
    expect(contracted).toHaveLength(4);
    // Outward corners turn on the frame radius; inward ones are sharp.
    segmentsOf(expandedPath.getAttribute('d') ?? '').filter(({ cmd }) => cmd === 'A')
      .forEach(({ arc }) => expect(arc?.rx).toBe(2.5));
    [expandedPath, contractedPath].forEach((path) => {
      segmentsOf(path.getAttribute('d') ?? '').filter(({ cmd }) => cmd === 'L').forEach(({ from, points: [[x, y]] }) => {
        expect(x === from[0] || y === from[1]).toBe(true);
      });
    });
    expanded.forEach((corner, index) => {
      const box = boxOf(corner);
      const inner: Point = [
        Math.abs(box[0] - 10) < Math.abs(box[2] - 10) ? box[0] : box[2],
        Math.abs(box[1] - 10) < Math.abs(box[3] - 10) ? box[1] : box[3],
      ];
      const reverse = contracted[index];

      expect(box[2] - box[0]).toBe(box[3] - box[1]);
      expect(boxOf(reverse)).toEqual(box);
      expect(reverse).toHaveLength(3);
      expect(reverse[1]).toEqual(inner);
      expect(new Set([reverse[0], reverse[2]].map(String))).toEqual(new Set([corner[0], corner[corner.length - 1]].map(String)));
    });
  });

  it('mirrors filled seek triangles with a Keyline gap between them', () => {
    const forward = Array.from(svgOf(Icons.IconPlayerForward).querySelectorAll('path'));
    const backward = Array.from(svgOf(Icons.IconPlayerBackward).querySelectorAll('path'));

    expect(forward).toHaveLength(2);
    expect(backward).toHaveLength(2);

    const [[first], [second]] = forward.map((path) => subpathsOf(path));

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(Math.min(...second.map(([x]) => x)) - Math.max(...first.map(([x]) => x)) - STROKE)
      .toBeGreaterThanOrEqual(CLEAR);
    forward.forEach((path, index) => {
      expect(path.getAttribute('fill')).toBe('currentColor');
      expect(backward[index].getAttribute('fill')).toBe('currentColor');
      expect(subpathsOf(backward[index])).toEqual(subpathsOf(path).map((points) => points.map(([x, y]) => [20 - x, y])));
    });
  });

  it('paints the pause bars like the play triangle: filled and stroked, equal and centred', () => {
    const play = svgOf(Icons.IconPlayerPlay).querySelector('path');
    const bars = Array.from(svgOf(Icons.IconPlayerPause).querySelectorAll('path'));
    const paint = (element: Element | null): (string | null)[] =>
      ['fill', 'stroke', 'stroke-width', 'stroke-linejoin'].map((name) => element?.getAttribute(name) ?? null);

    expect(play?.getAttribute('fill')).toBe('currentColor');
    expect(bars).toHaveLength(2);
    const boxes = bars.map((bar) => {
      const [points] = subpathsOf(bar);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);

      expect(paint(bar)).toEqual(paint(play));

      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    });
    const [[x0, y0, width, height], [x1]] = boxes;

    expect(boxes[1].slice(1)).toEqual(boxes[0].slice(1));
    expect(x0 + x1 + width).toBe(20);
    expect(y0 + height / 2).toBe(10);
    // The bars' ink stays two strokes wide or less, so they do not outweigh the play triangle.
    expect(width + STROKE).toBeLessThanOrEqual(2 * STROKE + 0.25);
  });

  it('shares a closed speaker cone with space before either sound or mute marks', () => {
    const audible = Array.from(svgOf(Icons.IconPlayerVolume).querySelectorAll('path'));
    const muted = Array.from(svgOf(Icons.IconPlayerVolumeMute).querySelectorAll('path'));
    const speaker = audible[0].getAttribute('d') ?? '';
    const mouth = numbers(audible[0])[0];
    const stroke = Number(audible[0].getAttribute('stroke-width'));

    expect(speaker).toMatch(/z$/i);
    expect(muted[0].getAttribute('d')).toBe(speaker);
    expect(speaker.match(/a1 1/g)).toHaveLength(2);
    for (const mark of [audible[1], muted[1]]) {
      expect(numbers(mark)[0] - mouth - stroke).toBeGreaterThanOrEqual(stroke);
    }
  });

  it('splits the speed dial into equal segments around the needle hub, sized like the image accent', () => {
    const speed = svgOf(Icons.IconPlayerSpeed);
    const [dial, needle] = Array.from(speed.querySelectorAll('path'));
    const hub = speed.querySelector('circle');
    const imageAccent = svgOf(Icons.IconImage).querySelector('circle');

    if (dial === undefined || needle === undefined || hub === null) {
      throw new Error('Missing speed dial');
    }
    expect(hub.getAttribute('r')).toBe(imageAccent?.getAttribute('r'));

    const center: Point = [Number(hub.getAttribute('cx')), Number(hub.getAttribute('cy'))];
    const arcs = segmentsOf(dial.getAttribute('d') ?? '').filter(({ cmd }) => cmd === 'A');
    const radius = arcs[0].arc?.rx ?? 0;
    const angle = ([x, y]: Point): number => Math.atan2(y - center[1], x - center[0]);
    const sweeps = arcs.map(({ from, points: [to], arc }) => {
      expect(arc?.rx).toBe(radius);
      expect(Math.hypot(from[0] - center[0], from[1] - center[1])).toBeCloseTo(radius, 1);
      expect(Math.hypot(to[0] - center[0], to[1] - center[1])).toBeCloseTo(radius, 1);

      return [angle(from), angle(to)];
    });
    const lengths = sweeps.map(([from, to]) => (to - from + 2 * Math.PI) % (2 * Math.PI));
    const gaps = sweeps.slice(1).map(([from], index) => (from - sweeps[index][1] + 2 * Math.PI) % (2 * Math.PI));
    const [[needleStart, needleTip]] = subpathsOf(needle);

    expect(arcs).toHaveLength(3);
    // Arc ends are rounded to two decimals, so equal sweeps differ by about half a degree.
    lengths.forEach(length => expect(length).toBeCloseTo(lengths[0], 1));
    expect(gaps[0]).toBeCloseTo(gaps[1], 2);
    expect(2 * radius * Math.sin(gaps[0] / 2) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(arcs[0].from[0] + arcs[2].points[0][0]).toBeCloseTo(20, 5);
    // The dial opens at the bottom, so centre the visible arc, not the hub.
    expect((center[1] - radius + arcs[0].from[1]) / 2).toBeCloseTo(10, 1);
    expect(needleStart).toEqual(center);
    // The needle tip stays a full stroke inside the dial.
    expect(radius - Math.hypot(needleTip[0] - center[0], needleTip[1] - center[1]) - STROKE).toBeGreaterThanOrEqual(STROKE);
  });

  it('draws the loop as a racetrack whose arrowheads chase each other with a clear gap', () => {
    const paths = Array.from(svgOf(Icons.IconPlayerLoop).querySelectorAll('path'));
    const [[track, head], [secondTrack, secondHead]] = paths.map((path) => subpathsOf(path));
    const [bend] = segmentsOf(paths[0].getAttribute('d') ?? '').filter(({ cmd }) => cmd === 'A');
    const half = ([x, y]: Point): Point => [20 - x, 20 - y];
    const tip = track[track.length - 1];

    expect(paths).toHaveLength(2);
    // Semicircular end: the arc radius is half the track height.
    expect(bend.arc?.rx).toBe(Math.abs(track[1][1] - track[0][1]) / 2);
    // The second run is the first turned a half turn about the centre.
    expect(secondTrack).toEqual(track.map(half));
    const turnedHead = [...secondHead].reverse();

    expect(turnedHead).toEqual(head.map(half));
    expect(head[1]).toEqual(tip);
    expect(head[2][0] - head[0][0]).toBe(0);
    // The two inner arms, one above the other at the centre, stay a stroke apart.
    expect(Math.hypot(turnedHead[2][0] - head[2][0], turnedHead[2][1] - head[2][1]) - STROKE).toBeGreaterThanOrEqual(STROKE);
    expect(secondTrack[0][0] - tip[0] - STROKE).toBeGreaterThanOrEqual(CLEAR);
    // The rounded ends stay inside the 3–17 drawing area.
    expect(track[0][0] - (bend.arc?.rx ?? 0)).toBeGreaterThanOrEqual(3);
    expect(secondTrack[0][0] + (bend.arc?.rx ?? 0)).toBeLessThanOrEqual(17);
  });

  it('keeps music noteheads equal outlined rings and both stems parallel to the beam spacing', () => {
    const svg = svgOf(Icons.IconMusic);
    const heads = Array.from(svg.querySelectorAll('circle'));
    const beam = svg.querySelector('path');

    expect(heads).toHaveLength(2);

    if (beam === null) {
      throw new Error('Missing music beam');
    }

    const [[[leftX, leftBottom], [, leftTop], [rightX, rightTop], [, rightBottom]]] = subpathsOf(beam);

    expect(leftBottom - leftTop).toBe(rightBottom - rightTop);
    expect(Number(heads[0].getAttribute('cy')) - Number(heads[1].getAttribute('cy'))).toBe(leftTop - rightTop);
    heads.forEach((head, index) => {
      expect(head.getAttribute('r')).toBe(heads[0].getAttribute('r'));
      expect(head.getAttribute('fill')).toBeNull();
      expect(head.getAttribute('stroke')).toBe('currentColor');
      expect(Number(head.getAttribute('cx')) + Number(head.getAttribute('r'))).toBe(index === 0 ? leftX : rightX);
      expect(Number(head.getAttribute('cy'))).toBe(index === 0 ? leftBottom : rightBottom);
    });
  });

  it('closes the cloud and centres the failure cross inside it, clear of every edge', () => {
    const svg = svgOf(Icons.IconUploadFailed);
    const [cloud, cross] = Array.from(svg.querySelectorAll('path'));
    // Overlay icons are the 20-grid drawing scaled x1.2.
    const scale = 1.2;

    if (cloud === undefined || cross === undefined) {
      throw new Error('Missing upload failure parts');
    }

    const stroke = Number(cloud.getAttribute('stroke-width'));
    const arms = subpathsOf(cross);
    const outline = inkOf(cloud.getAttribute('d') ?? '');
    const crossInk = inkOf(cross.getAttribute('d') ?? '');
    const mid = (arm: Point[]): Point => [(arm[0][0] + arm[1][0]) / 2, (arm[0][1] + arm[1][1]) / 2];

    expect(svg.querySelector('circle')).toBeNull();
    expect(cloud.getAttribute('d')).toMatch(/z$/i);
    expect(arms).toHaveLength(2);
    expect(close(mid(arms[0]), mid(arms[1]))).toBe(true);
    expect(mid(arms[0])[0]).toBeCloseTo(12, 5);
    arms.forEach(([[x0, y0], [x1, y1]]) => expect(Math.abs(x1 - x0)).toBeCloseTo(Math.abs(y1 - y0), 5));
    // Everything stays inside the overlay drawing area (3–17 at 20 units); the slack covers
    // two-decimal rounding of the scaled arcs.
    [...outline, ...crossInk].forEach(([x, y]) => {
      expect(Math.min(x, y)).toBeGreaterThanOrEqual(3 * scale - 0.05);
      expect(Math.max(x, y)).toBeLessThanOrEqual(17 * scale + 0.05);
    });
    // The cross keeps a scaled Keyline gap from the cloud outline.
    const gap = Math.min(...crossInk.flatMap(([x, y]) => outline.map(([ox, oy]) => Math.hypot(x - ox, y - oy))));

    expect(gap - stroke).toBeGreaterThanOrEqual(CLEAR * scale - 0.05);
  });
});
