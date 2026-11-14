import { describe, expect, it } from 'vitest';
import * as icons from '../../../../src/components/icons';

const svg = (markup: string | undefined): SVGSVGElement => {
  const node = new DOMParser().parseFromString(markup ?? '', 'image/svg+xml').querySelector('svg');

  if (node === null) throw new Error('no svg');

  return node;
};

const num = (el: Element | null, attr: string): number => Number(el?.getAttribute(attr));

type Point = [number, number];

interface Segment { command: string; from: Point; to: Point; controls: Point[]; arc: number[] }

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const IMPLICIT_LINE: Record<string, string> = { M: 'L', m: 'l' };
const NORMALISED: Record<string, string> = { H: 'L', V: 'L', S: 'C', T: 'Q' };

/** Absolute segments of path data. H and V become L, S becomes C, T becomes Q; an arc keeps [rx, ry, rotation, large, sweep]. */
const segmentsOf = (d: string): Segment[] => {
  // One [letter, args] entry per drawn command; extra pairs after M are implicit L.
  const commands = Array.from(d.matchAll(/([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi), ([, letter = '', body = '']) => {
    const values = body.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
    const arity = ARITY[letter.toUpperCase()] ?? 0;
    const count = arity === 0 ? 1 : Math.max(1, values.length / arity);

    return Array.from({ length: count }, (_, index) => ({
      letter: index > 0 ? IMPLICIT_LINE[letter] ?? letter : letter,
      args: values.slice(index * arity, index * arity + arity),
    }));
  }).flat();
  const segments: Segment[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let control: Point | null = null;

  for (const { letter, args } of commands) {
    const command = letter.toUpperCase();
    const from = pen;
    const [dx, dy] = letter === command ? [0, 0] : from;
    const at = (offset: number): Point => [(args[offset] ?? 0) + dx, (args[offset + 1] ?? 0) + dy];
    const reflected: Point = control === null ? from : [2 * from[0] - control[0], 2 * from[1] - control[1]];
    const controlsBy: Record<string, Point[]> = { C: [at(0), at(2)], S: [reflected, at(0)], Q: [at(0)], T: [reflected] };
    const endBy: Record<string, Point> = { H: [(args[0] ?? 0) + dx, from[1]], V: [from[0], (args[0] ?? 0) + dy], Z: start };
    const controls = controlsBy[command] ?? [];
    const to = endBy[command] ?? at(args.length - 2);

    segments.push({ command: NORMALISED[command] ?? command, from, to, controls, arc: command === 'A' ? args.slice(0, 5) : [] });
    control = controls.at(-1) ?? null;
    pen = to;
    start = command === 'M' ? to : start;
  }

  return segments;
};

/** On-curve and control points: every coordinate the path draws through or bends toward. */
const pointsOf = (d: string): Point[] => segmentsOf(d).flatMap(({ command, controls, to }) => (command === 'Z' ? [] : [...controls, to]));

/** Keyline keeps neighbouring strokes at least one unit of clear space apart. */
const CLEAR = 1;
const STROKE = 1.25;
/** Keyline type grid. */
const CAP = 4.5;
const BASELINE = 15.5;

const dOf = (markup: string | undefined, index = 0): string => svg(markup).querySelectorAll('path')[index]?.getAttribute('d') ?? '';
const strokesOf = (d: string): Point[][] => (d.match(/M[^M]+/g) ?? []).map(pointsOf);
const circleOf = (el: Element | null | undefined): number[] => [num(el ?? null, 'cx'), num(el ?? null, 'cy'), num(el ?? null, 'r')];

describe('property type glyphs (Notion shapes on the Keyline grid)', () => {
  it('Select and Status share the Keyline circle frame: centre (10, 10), radius 7', () => {
    const select = svg(icons.IconSelectCircle).querySelector('circle');
    const [, , radius] = circleOf(select);

    expect(circleOf(select)).toEqual([10, 10, 7]);

    // Status is that circle as eight dashes: each ends on Select's radius, so its
    // round cap reaches the same outer edge as Select's stroke.
    const dashes = strokesOf(dOf(icons.IconStatusCircle));

    expect(dashes).toHaveLength(8);
    for (const [, [x, y] = [0, 0]] of dashes) {
      expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(radius ?? 0, 1);
    }
  });

  it('Text is three rules, the last one shorter, like Notion', () => {
    const rules = strokesOf(dOf(icons.IconTextLines));
    const ends = rules.map((rule) => rule[1]?.[0] ?? 0);

    expect(rules).toHaveLength(3);
    expect(ends[0]).toBe(ends[1]);
    expect(ends[2]).toBeLessThan(ends[1] ?? 0);
    expect(new Set(rules.map((rule) => rule[0]?.[0])).size).toBe(1);
  });

  it('Title draws "Aa" from strokes: the A stands from the type cap to the baseline', () => {
    const [legs = [], bar = []] = strokesOf(dOf(icons.IconLetterCase));
    const [leftFoot, apex, rightFoot] = legs;

    expect(legs).toHaveLength(3);
    expect(apex?.[1]).toBe(CAP);
    expect([leftFoot?.[1], rightFoot?.[1]]).toEqual([BASELINE, BASELINE]);
    expect(((leftFoot?.[0] ?? 0) + (rightFoot?.[0] ?? 0)) / 2).toBe(apex?.[0]);
    expect(bar[0]?.[1]).toBe(bar[1]?.[1]);
  });

  it('Title "Aa" starts at the live-area edge, sits the a on the baseline, and keeps clear air between A and a', () => {
    const root = svg(icons.IconLetterCase);
    const [legs = []] = strokesOf(dOf(icons.IconLetterCase));
    const [cx = 0, cy = 0, r = 0] = circleOf(root.querySelector('circle'));
    const [[stemX = 0, stemTop = 0] = [], [, stemBottom = 0] = []] = strokesOf(dOf(icons.IconLetterCase, 1))[0] ?? [];
    const aRight = Math.max(...legs.map(([x]) => x));

    expect(Math.min(...legs.map(([x]) => x))).toBe(3);
    expect(stemX).toBe(cx + r);
    expect(stemX).toBeLessThanOrEqual(17);
    expect([cy + r, Math.max(stemTop, stemBottom)]).toEqual([BASELINE, BASELINE]);
    expect(cx - r - aRight - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('the two people heads keep a full stroke of space between them', () => {
    const [front, back] = [...svg(icons.IconPeople).querySelectorAll('circle')];
    const gap = Math.hypot(num(back, 'cx') - num(front, 'cx'), num(back, 'cy') - num(front, 'cy'))
      - num(front, 'r') - num(back, 'r') - 1.25;

    expect(gap).toBeGreaterThanOrEqual(1.25);
  });

  it('the checked box is the 13-unit box, filled, with the check cut out', () => {
    const root = svg(icons.IconCheckboxFilled);
    const frame = root.querySelector('rect');
    const fill = root.querySelector('path');

    expect([num(frame, 'x'), num(frame, 'y'), num(frame, 'width'), num(frame, 'height')]).toEqual([3.5, 3.5, 13, 13]);
    expect(fill?.getAttribute('fill')).toBe('currentColor');
    expect(fill?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('Select\'s mark is IconChevronDown, a line chevron, not a filled caret', () => {
    const mark = svg(icons.IconSelectCircle).querySelector('path');

    expect(mark?.getAttribute('fill')).toBeNull();
    expect(mark?.getAttribute('d')).toBe(dOf(icons.IconChevronDown));
  });

  it('Clock and user circle sit on the Keyline circle frame', () => {
    const frame = circleOf(svg(icons.IconSelectCircle).querySelector('circle'));

    for (const icon of [icons.IconClock, icons.IconUserCircle]) {
      expect(circleOf(svg(icon).querySelector('circle'))).toEqual(frame);
    }
  });

  it('the user circle keeps clear air between head, ring and shoulders, and the shoulders meet the ring', () => {
    const [ring, head] = [...svg(icons.IconUserCircle).querySelectorAll('circle')];
    const [ringX = 0, ringY = 0, ringR = 0] = circleOf(ring);
    const [, headY = 0, headR = 0] = circleOf(head);
    const shoulders = pointsOf(dOf(icons.IconUserCircle));
    const ends = [shoulders[0] ?? [0, 0], shoulders.at(-1) ?? [0, 0]];
    const shoulderTop = Math.min(...shoulders.map(([, y]) => y));

    for (const [x, y] of ends) {
      expect(Math.hypot(x - ringX, y - ringY)).toBeCloseTo(ringR, 1);
    }
    expect(headY - headR - (ringY - ringR) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(shoulderTop - (headY + headR) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('the checkbox is the 13-unit box as a line, with a line check', () => {
    const root = svg(icons.IconCheckbox);
    const frame = root.querySelector('rect');

    expect([num(frame, 'x'), num(frame, 'y'), num(frame, 'width'), num(frame, 'height')]).toEqual([3.5, 3.5, 13, 13]);
    expect(root.querySelector('[fill="currentColor"]')).toBeNull();
    expect(root.querySelector('path')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('the numero N stands on the type grid', () => {
    const [n = []] = strokesOf(dOf(icons.IconNumero));
    const xs = [...new Set(n.map(([x]) => x))];

    expect(n).toHaveLength(4);
    expect(n.map(([, y]) => y)).toEqual([BASELINE, CAP, BASELINE, CAP]);
    expect(xs).toHaveLength(2);
  });

  it('the button cursor is IconCursor scaled down, clear of the button', () => {
    const offsets = (d: string): Point[] => {
      const points = pointsOf(d);
      const [x0 = 0, y0 = 0] = points[0] ?? [];

      return points.map(([x, y]) => [x - x0, y - y0]);
    };
    const base = offsets(dOf(icons.IconCursor));
    const cursor = offsets(dOf(icons.IconCursorButton, 1));
    const scale = (cursor[1]?.[0] ?? 0) / (base[1]?.[0] ?? 1);

    expect(cursor).toHaveLength(base.length);
    expect(scale).toBeLessThan(1);
    cursor.forEach(([x, y], i) => {
      expect(x).toBeCloseTo((base[i]?.[0] ?? 0) * scale, 5);
      expect(y).toBeCloseTo((base[i]?.[1] ?? 0) * scale, 5);
    });

    // The button's open ends keep a stroke plus clear air from every cursor edge.
    const outline = pointsOf(dOf(icons.IconCursorButton, 1));
    const button = pointsOf(dOf(icons.IconCursorButton, 0));
    const ends = [button[0] ?? [0, 0], button.at(-1) ?? [0, 0]];
    const toSegment = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number => {
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));

      return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
    };

    for (const end of ends) {
      const nearest = Math.min(...outline.map((a, i) => toSegment(end, a, outline[(i + 1) % outline.length] ?? a)));

      expect(nearest - STROKE).toBeGreaterThanOrEqual(CLEAR);
    }
  });

  it('the handset is symmetric about the anti-diagonal', () => {
    // Vertices only: arc segments keep their end points, not their bulge.
    const points = segmentsOf(dOf(icons.IconPhone)).map(({ to }) => to);
    const key = ([x, y]: Point): string => `${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
    const drawn = points.map(key);

    expect(points.length).toBeGreaterThanOrEqual(8);
    for (const [x, y] of points) {
      expect(drawn).toContain(key([20 - y, 20 - x]));
    }
  });
});

describe('toolbar bolt (Automations)', () => {
  it('turns onto itself a half turn about the centre', () => {
    const vertices = pointsOf(dOf(icons.IconBolt)).map((point) => point.join(' '));
    const turned = pointsOf(dOf(icons.IconBolt)).map(([x, y]) => `${20 - x} ${20 - y}`);

    expect(vertices.length).toBeGreaterThanOrEqual(6);
    expect(new Set(turned)).toEqual(new Set(vertices));
  });
});
