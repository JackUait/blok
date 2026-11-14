import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const parse = (markup: string): Document => new DOMParser().parseFromString(markup, 'image/svg+xml');

const boxOf = (rect: Element | null | undefined): string[] => ['x', 'y', 'width', 'height', 'rx'].map((name) => rect?.getAttribute(name) ?? '');

/** The shared Keyline panel, read from IconTable. */
const hasPanel = (markup: string): boolean => {
  const panel = boxOf(parse(icons.IconTable).querySelector('rect')).join();

  return [...parse(markup).querySelectorAll('rect')].some((rect) => boxOf(rect).join() === panel);
};

const paths = (markup: string): string[] => [...parse(markup).querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');

const subpaths = (markup: string): string[] => paths(markup).flatMap((d) => d.match(/M[^M]+/g) ?? []);

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

/** A point on an SVG arc segment, from the endpoint form (SVG 1.1 F.6.5). Rotation is ignored: these icons draw circular arcs. */
const arcPointAt = ({ from, to, arc }: Segment, t: number): Point => {
  const [rx = 0, , , large = 0, sweep = 0] = arc;
  const mx = (from[0] - to[0]) / 2;
  const my = (from[1] - to[1]) / 2;
  const radius = Math.max(rx, Math.hypot(mx, my));
  const offset = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, radius * radius / (mx * mx + my * my) - 1));
  const cx = (from[0] + to[0]) / 2 + offset * my;
  const cy = (from[1] + to[1]) / 2 - offset * mx;
  const begin = Math.atan2(from[1] - cy, from[0] - cx);
  let turn = Math.atan2(to[1] - cy, to[0] - cx) - begin;

  if (sweep === 1 && turn < 0) {
    turn += 2 * Math.PI;
  }
  if (sweep === 0 && turn > 0) {
    turn -= 2 * Math.PI;
  }

  return [cx + radius * Math.cos(begin + turn * t), cy + radius * Math.sin(begin + turn * t)];
};

/** Points along every drawn segment, for stroke-to-stroke distances. */
const samplesOf = (d: string): Point[] => segmentsOf(d).flatMap((segment) => {
  if (segment.command === 'M') {
    return [segment.to];
  }

  return Array.from({ length: 41 }, (_, step) => {
    if (segment.command === 'A') {
      return arcPointAt(segment, step / 40);
    }
    // De Casteljau works for lines, quadratics and cubics alike.
    let level = [segment.from, ...segment.controls, segment.to];

    while (level.length > 1) {
      level = level.slice(1).map(([x, y], index) => {
        const [px, py] = level[index] ?? [x, y];

        return [px + (x - px) * step / 40, py + (y - py) * step / 40] as Point;
      });
    }

    return level[0] ?? segment.to;
  });
});

/** On-curve and control points: every coordinate the path draws through or bends toward. */
const pointsOf = (d: string): Point[] => segmentsOf(d).flatMap(({ command, controls, to }) => (command === 'Z' ? [] : [...controls, to]));

const nearest = (a: Point[], b: Point[]): number =>
  Math.min(...a.flatMap(([x, y]) => b.map(([bx, by]) => Math.hypot(x - bx, y - by))));

/** Keyline keeps neighbouring strokes at least one unit of clear space apart. */
const CLEAR = 1;
const STROKE = 1.25;

const glyphs = {
  IconViewFeed: icons.IconViewFeed,
  IconViewCalendar: icons.IconViewCalendar,
  IconViewTimeline: icons.IconViewTimeline,
  IconViewForm: icons.IconViewForm,
  IconForm: icons.IconForm,
  IconDatabaseInline: icons.IconDatabaseInline,
  IconDatabaseLinked: icons.IconDatabaseLinked,
  IconFolderQuestion: icons.IconFolderQuestion,
  IconTemplates: icons.IconTemplates,
};

describe('database creation glyphs drawn after Notion (findings-creation N02, N08, N18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports every glyph on the 20-unit canvas', () => {
    for (const [name, markup] of Object.entries(glyphs)) {
      expect(markup, name).toContain('viewBox="0 0 20 20"');
    }
  });

  it('draws Database - Inline and Linked view apart from each other and from the cylinder', () => {
    expect(icons.IconDatabaseInline).not.toBe(icons.IconDatabaseLinked);
    expect(icons.IconDatabaseInline).not.toBe(icons.IconDatabase);
    expect(icons.IconDatabaseLinked).not.toBe(icons.IconDatabase);
  });

  it('draws the calendar view as IconCalendar without its binder rings', () => {
    const view = parse(icons.IconViewCalendar);
    const calendar = parse(icons.IconCalendar);
    const [band = ''] = subpaths(icons.IconViewCalendar);
    const circles = (doc: Document): string[] => [...doc.querySelectorAll('circle')].map((dot) => dot.outerHTML);

    expect(hasPanel(icons.IconViewCalendar)).toBe(true);
    expect(subpaths(icons.IconViewCalendar)).toEqual([band]);
    expect(subpaths(icons.IconCalendar)[0]).toBe(band);
    expect(circles(view)).toEqual(circles(calendar));
    // Keyline: the header is a rule across the panel, not a filled band.
    expect(view.querySelector('path[fill]')).toBeNull();
  });

  it('lays the calendar\'s accent dots in one even row, centred under the header rule', () => {
    const dots = [...parse(icons.IconViewCalendar).querySelectorAll('circle')].map((dot) => ({
      x: Number(dot.getAttribute('cx')),
      y: Number(dot.getAttribute('cy')),
      r: Number(dot.getAttribute('r')),
      fill: dot.getAttribute('fill'),
    }));
    const [[, bandY] = [0, 0]] = pointsOf(subpaths(icons.IconViewCalendar)[0] ?? '');
    const panel = parse(icons.IconViewCalendar).querySelector('rect');
    const panelBottom = Number(panel?.getAttribute('y')) + Number(panel?.getAttribute('height'));
    const xs = dots.map((dot) => dot.x).sort((a, b) => a - b);
    const [row = 0] = dots.map((dot) => dot.y);

    expect(dots).toHaveLength(3);
    expect(new Set(dots.map((dot) => dot.y)).size).toBe(1);
    for (const dot of dots) {
      expect(dot.r).toBe(1);
      expect(dot.fill).toBe('currentColor');
    }
    expect(((xs[0] ?? 0) + (xs[2] ?? 0)) / 2).toBe(10);
    expect((xs[1] ?? 0) - (xs[0] ?? 0)).toBe((xs[2] ?? 0) - (xs[1] ?? 0));
    expect((xs[1] ?? 0) - (xs[0] ?? 0) - 2).toBeGreaterThanOrEqual(CLEAR);
    // Within one 0.25 snap of the middle of the body.
    expect(Math.abs(row - (bandY + panelBottom) / 2)).toBeLessThanOrEqual(0.25);
    expect(row - 1 - bandY - STROKE / 2).toBeGreaterThanOrEqual(CLEAR);
  });

  // r9-addview-svgs.raw (newspaper): text lines on the sheet, right of its fold-out column.
  it('draws the feed sheet with two equal lines centred between its inner column and its right edge', () => {
    const [sheet = '', lines = ''] = paths(icons.IconViewFeed);
    const rules = (lines.match(/M[^M]+/g) ?? []).map(pointsOf);
    const sheetPoints = pointsOf(sheet);
    const columnX = sheetPoints[0]?.[0] ?? 0;
    const right = Math.max(...sheetPoints.map(([x]) => x));
    const lefts = rules.map((rule) => rule[0]?.[0] ?? 0);
    const ends = rules.map((rule) => rule[1]?.[0] ?? 0);
    const ys = rules.map((rule) => rule[0]?.[1] ?? 0);
    const left = lefts[0] ?? 0;

    expect(parse(icons.IconViewFeed).querySelector('rect')).toBeNull();
    expect(rules).toHaveLength(2);
    expect(new Set(lefts).size).toBe(1);
    expect(new Set(ends).size).toBe(1);
    expect(left + (ends[0] ?? 0)).toBe(columnX + right);
    expect(left - columnX - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect((ys[1] ?? 0) - (ys[0] ?? 0) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  // r9-addview-menu.png, 81-scratch-form.png (Notion "form"): a sheet, two lines, a pencil in its open corner.
  it('draws the form pencil with IconPencilLine\'s tip and width, clear of the sheet\'s open corner', () => {
    const [sheet = '', lines = '', pencil = ''] = paths(icons.IconForm);
    /** Each vertex's offset from the tip, so a moved copy compares equal. */
    const offsets = (d: string): string[] => {
      const points = pointsOf(d);
      const [tipX = 0, tipY = 0] = points[0] ?? [];

      return points.map(([x, y]) => `${x - tipX},${y - tipY}`);
    };
    const line = offsets(paths(icons.IconPencilLine)[0] ?? '');
    const form = offsets(pencil);
    const [shoulderX = 0, shoulderY = 0] = pointsOf(pencil)[1] ?? [];
    const [shaftX = 0, shaftY = 0] = pointsOf(pencil)[2] ?? [];
    const [capX = 0, capY = 0] = pointsOf(pencil)[3] ?? [];
    const rules = (lines.match(/M[^M]+/g) ?? []).map(pointsOf);
    const sheetPoints = pointsOf(sheet);
    const openEnds = [sheetPoints[0] ?? [0, 0], sheetPoints.at(-1) ?? [0, 0]];

    expect(form).toHaveLength(line.length);
    // Same tip: both edges leave the point at IconPencilLine's angles and lengths.
    expect([form[1], form[4]]).toEqual([line[1], line[4]]);
    // The shaft runs at 45 degrees, and its cap is as wide as IconPencilLine's.
    expect(shaftX - shoulderX).toBe(shoulderY - shaftY);
    expect([capX - shaftX, capY - shaftY]).toEqual([2, 2]);
    expect(nearest(openEnds, samplesOf(pencil)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(rules).toHaveLength(2);
    expect(rules[1]?.[0]?.[0]).toBe(rules[0]?.[0]?.[0]);
    expect(nearest(rules.flat(), samplesOf(pencil)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('draws the timeline as two staggered bars in the shared panel', () => {
    expect(hasPanel(icons.IconViewTimeline)).toBe(true);
    expect(paths(icons.IconViewTimeline)).toEqual(['M6 8.5h5M9 11.5h5']);
  });

  it('keeps the linked view on the table glyph\'s header row and first column', () => {
    const [header = '', , column = ''] = subpaths(icons.IconTable);

    expect(subpaths(icons.IconDatabaseLinked)).toContain(header);
    expect(subpaths(icons.IconDatabaseLinked)).toContain(column);
  });
});
