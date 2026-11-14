import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const parse = (markup: string | undefined): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(markup ?? '', 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Not an SVG');
  }

  return svg;
};

const attrs = (element: Element | null, names: string[]): Record<string, number> =>
  Object.fromEntries(names.map((name) => [name, Number(element?.getAttribute(name))]));

const pathData = (markup: string | undefined): string[] =>
  [...parse(markup).querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');

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

const BOX = ['x', 'y', 'width', 'height', 'rx'];

describe('Notion template glyphs (database icons)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the currency coin is the Keyline circle frame', () => {
    expect(attrs(parse(icons.IconCurrency).querySelector('circle'), ['cx', 'cy', 'r'])).toEqual({ cx: 10, cy: 10, r: 7 });
  });

  it('the currency sign is stroked, with clear air between each stem cap and the coin', () => {
    const [sign = ''] = pathData(icons.IconCurrency);
    const coin = attrs(parse(icons.IconCurrency).querySelector('circle'), ['cy', 'r']);
    const stems = segmentsOf(sign).filter(({ command, from, to }) => command === 'L' && from[0] === 10 && to[0] === 10);
    const ys = stems.flatMap(({ from, to }) => [from[1], to[1]]);
    const cap = STROKE / 2;
    const coinTop = (coin.cy ?? 0) - (coin.r ?? 0) + cap;
    const coinBottom = (coin.cy ?? 0) + (coin.r ?? 0) - cap;

    expect(stems).toHaveLength(2);
    expect(Math.min(...ys) - cap - coinTop).toBeGreaterThanOrEqual(CLEAR);
    expect(coinBottom - (Math.max(...ys) + cap)).toBeGreaterThanOrEqual(CLEAR);
  });

  it('the card is the Keyline landscape panel', () => {
    expect(attrs(parse(icons.IconCreditCard).querySelector('rect'), BOX)).toEqual(attrs(parse(icons.IconTable).querySelector('rect'), BOX));
  });

  it('the ticket shares the card box and cuts a notch of the same size into each side', () => {
    const [outline = ''] = pathData(icons.IconTicket);
    const card = attrs(parse(icons.IconCreditCard).querySelector('rect'), BOX);
    const segments = segmentsOf(outline);
    const ends = segments.map(({ to }) => to);
    const arcs = segments.filter(({ command }) => command === 'A');
    const corners = arcs.filter(({ arc }) => arc[0] === card.rx);
    const notches = arcs.filter(({ arc }) => arc[0] !== card.rx);

    expect([Math.min(...ends.map(([x]) => x)), Math.max(...ends.map(([x]) => x))]).toEqual([card.x, (card.x ?? 0) + (card.width ?? 0)]);
    expect([Math.min(...ends.map(([, y]) => y)), Math.max(...ends.map(([, y]) => y))]).toEqual([card.y, (card.y ?? 0) + (card.height ?? 0)]);
    expect(corners).toHaveLength(4);
    expect(notches).toHaveLength(2);
    const [right, left] = notches;

    expect(right?.arc).toEqual(left?.arc);
    // Sweep 0 on both sides bends each notch inward.
    expect(right?.arc[4]).toBe(0);
    expect([right?.from[0], right?.to[0]]).toEqual([(card.x ?? 0) + (card.width ?? 0), (card.x ?? 0) + (card.width ?? 0)]);
    expect([left?.from[0], left?.to[0]]).toEqual([card.x, card.x]);
    expect((right?.from[1] ?? 0) + (right?.to[1] ?? 0)).toBe((left?.from[1] ?? 0) + (left?.to[1] ?? 0));
  });

  it('the paint brush is a handle centred on x = 10 over a wider head', () => {
    const [handle = '', head = '', marks = ''] = pathData(icons.IconPaintBrush);
    const xs = (d: string): number[] => pointsOf(d).map(([x]) => x);
    const handleXs = xs(handle);
    const headXs = xs(head);
    const [split] = (marks.match(/M[^M]+/g) ?? []).map(pointsOf).filter(([first, last]) => first?.[0] === last?.[0]);

    expect(Math.min(...handleXs) + Math.max(...handleXs)).toBe(20);
    expect(Math.min(...headXs) + Math.max(...headXs)).toBe(20);
    expect(Math.max(...headXs) - Math.min(...headXs)).toBeGreaterThan(Math.max(...handleXs) - Math.min(...handleXs));
    // The handle stands on the ferrule.
    expect(pointsOf(handle).at(-1)?.[1]).toBe(pointsOf(head)[0]?.[1]);
    expect(split?.[0]?.[0]).toBe(10);
  });

  it('the package is a box symmetric about x = 10, on the 3.5..16.5 width of the square frame', () => {
    const [outline = '', edges = ''] = pathData(icons.IconPackage);
    const points = pointsOf(outline);
    const xs = points.map(([x]) => x);
    const drawn = points.map((point) => point.join());
    const lid = (edges.match(/M[^M]+/g) ?? []).map(pointsOf);

    expect([Math.min(...xs), Math.max(...xs)]).toEqual([3.5, 16.5]);
    for (const [x, y] of points) {
      expect(drawn).toContain(`${20 - x},${y}`);
    }
    // The lid edges meet on the centre line, and the front edge drops from there.
    expect(lid[0]?.map((point) => point.join())).toEqual(['3.5,6.5', '10,10', '16.5,6.5']);
    expect(lid[1]?.[0]).toEqual([10, 10]);
    expect(lid[1]?.[1]?.[0]).toBe(10);
  });

  it('the fan deck pivots on the dot at the centre of the upright swatch\'s rounded end', () => {
    const svg = parse(icons.IconFanDeck);
    const [upright] = pathData(icons.IconFanDeck);

    expect(attrs(svg.querySelector('circle'), ['cx', 'cy'])).toEqual({ cx: 5.75, cy: 14.75 });
    // The upright swatch spans x 3.5..8, so its 2.25 end arc centres on x 5.75, y 14.75.
    expect(upright).toContain('M3.5 14.75');
    expect(upright).toContain('v10.25a2.25 2.25 0 0 1-4.5 0Z');
  });
});
