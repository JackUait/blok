import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconArrowUp,
  IconBookmark,
  IconChart,
  IconChevronRight,
  IconDotsHorizontal,
  IconGlobe,
  IconHash,
  IconInsertAbove,
  IconInsertBelow,
  IconInsertLeft,
  IconInsertRight,
  IconMail,
  IconMap,
  IconMenu,
  IconMessage,
  IconMinus,
  IconMoveDown,
  IconMoveLeft,
  IconMoveRight,
  IconPageEmpty,
  IconPencil,
  IconPlus,
  IconReturn,
  IconTable,
  IconWarning,
} from '../../../../src/components/icons';

const standardIcons = {
  IconBookmark, IconChart, IconDotsHorizontal, IconGlobe, IconHash,
  IconArrowUp, IconInsertAbove, IconInsertBelow, IconInsertLeft, IconInsertRight,
  IconMail, IconMap, IconMenu, IconMessage, IconMinus, IconMoveDown,
  IconMoveLeft, IconMoveRight, IconPencil, IconPlus,
  IconReturn, IconWarning,
};

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

const pathOf = (icon: string, index = 0): string =>
  svgOf(icon).querySelectorAll('path')[index]?.getAttribute('d') ?? '';

const attributesOf = (element: Element | null, attributes: string[]): number[] =>
  attributes.map(attribute => Number(element?.getAttribute(attribute) ?? Number.NaN));

const dotsOf = (icon: string): number[][] =>
  Array.from(svgOf(icon).querySelectorAll('circle'), dot => attributesOf(dot, ['cx', 'cy', 'r']));

type Point = [number, number];

const SIZES: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, a: 7, c: 6 };

/** The point one path command lands on; h and v keep the other coordinate. */
const stepTo = (lower: string, relative: boolean, chunk: number[], [x, y]: Point): Point => {
  const [ox, oy] = relative ? [x, y] : [0, 0];

  if (lower === 'h') {
    return [ox + chunk[0], y];
  }
  if (lower === 'v') {
    return [x, oy + chunk[0]];
  }

  return [ox + chunk[chunk.length - 2], oy + chunk[chunk.length - 1]];
};

/** Absolute end points of every subpath (M/L/H/V/A/C, curve handles left out). */
const subpathsOf = (d: string): Point[][] => {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let point: Point = [0, 0];

  for (const [, letter, args] of d.matchAll(/([MLHVACZmlhvacz])([^MLHVACZmlhvacz]*)/g)) {
    const lower = letter.toLowerCase();
    const size = SIZES[lower] ?? 0;
    const values = (args.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

    if (lower === 'z') {
      point = current[0] ?? point;
      continue;
    }
    if (lower === 'm') {
      current = [];
      subpaths.push(current);
    }
    for (let i = 0; i + size <= values.length; i += size) {
      point = stepTo(lower, letter === lower, values.slice(i, i + size), point);
      current.push(point);
    }
  }

  return subpaths;
};

/** Every subpath of every path in the icon, in document order. */
const strokesOf = (icon: string): Point[][] =>
  Array.from(svgOf(icon).querySelectorAll('path')).flatMap(path => subpathsOf(path.getAttribute('d') ?? ''));

/** An arrowhead as its two arms, measured from the tip, in a fixed order. */
const armsOf = ([a, tip, b]: Point[]): number[][] =>
  [[a[0] - tip[0], a[1] - tip[1]], [b[0] - tip[0], b[1] - tip[1]]].sort((p, q) => p[0] - q[0] || p[1] - q[1]);

const sorted = (points: number[][]): number[][] => [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const unique = (points: Point[]): Point[] =>
  points.filter((point, index) => points.findIndex(([x, y]) => x === point[0] && y === point[1]) === index);

const length = ([a, b]: Point[]): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

describe('Blok Line navigation completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(standardIcons))('%s preserves its canvas and rounded house stroke', (_name, icon) => {
    const document = svgOf(icon);
    const svg = document.querySelector('svg');

    expect(document.querySelector('parsererror')).toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');

    for (const shape of document.querySelectorAll('[stroke="currentColor"]')) {
      expect(shape.getAttribute('stroke-width')).toBe('1.25');
      expect(shape.getAttribute('stroke-linecap')).toBe('round');
      expect(shape.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it('uses the same dots on a square grip grid and an evenly spaced ellipsis', () => {
    const grip = dotsOf(IconMenu);
    const ellipsis = dotsOf(IconDotsHorizontal);
    const pitch = ellipsis[1][0] - ellipsis[0][0];

    expect(ellipsis.map(dot => dot[2])).toEqual(grip.slice(0, 3).map(dot => dot[2]));
    expect(ellipsis.map(dot => dot[1])).toEqual([10, 10, 10]);
    expect(ellipsis[2][0] - ellipsis[1][0]).toBe(pitch);
    expect(ellipsis[1][0]).toBe(10);
    // table-grip-visuals.ts rotates IconMenu about (10, 10).
    expect(sorted(grip.map(([cx, cy]) => [20 - cx, 20 - cy]))).toEqual(sorted(grip.map(([cx, cy]) => [cx, cy])));
    expect(grip[1][0] - grip[0][0]).toBe(pitch);
    expect(grip[2][1] - grip[0][1]).toBe(pitch);
    expect(pitch - 2 * ellipsis[0][2]).toBeGreaterThanOrEqual(1.25);
  });

  it('builds plus from minus and one equal, centred upright arm', () => {
    const [bar] = subpathsOf(pathOf(IconMinus));
    const plus = subpathsOf(pathOf(IconPlus));

    expect(bar).toEqual([[4, 10], [16, 10]]);
    expect(plus).toEqual([bar, [[10, 4], [10, 16]]]);
  });

  it('shares the 3.5-unit chevron arms across the arrowheads', () => {
    const [shaft, head] = subpathsOf(pathOf(IconArrowUp));
    const [chevron] = subpathsOf(pathOf(IconChevronRight));

    // The arrow-up head is the right chevron turned to point up.
    expect(armsOf(head)).toEqual(armsOf(chevron.map(([x, y]): Point => [y, 20 - x])));
    expect(armsOf(head)).toEqual([[-3.5, 3.5], [3.5, 3.5]]);
    expect(shaft).toEqual([[10, 16], [10, 4]]);
    expect(shaft[1]).toEqual(head[1]);
  });

  it.each([
    ['down', IconMoveDown, (x: number, y: number): number[] => [20 - x, 20 - y]],
    ['left', IconMoveLeft, (x: number, y: number): number[] => [y, 20 - x]],
    ['right', IconMoveRight, (x: number, y: number): number[] => [20 - y, x]],
  ] as const)('rotates the complete up arrow to point %s', (_direction, icon, rotate) => {
    const up = strokesOf(IconArrowUp);
    const turned = strokesOf(icon);

    expect(turned).toHaveLength(up.length);
    up.forEach((stroke, index) => {
      expect(sorted(turned[index])).toEqual(sorted(stroke.map(([x, y]) => rotate(x, y))));
    });
  });

  it.each([
    ['above', IconInsertAbove, IconArrowUp, 1],
    ['below', IconInsertBelow, IconMoveDown, 1],
    ['left', IconInsertLeft, IconMoveLeft, 0],
    ['right', IconInsertRight, IconMoveRight, 0],
  ] as const)('reuses the %s arrowhead and separates its shaft from the insertion boundary', (_direction, insert, move, axis) => {
    const [shaft, head, boundary] = strokesOf(insert);
    const [, moveHead] = strokesOf(move);

    expect(armsOf(head)).toEqual(armsOf(moveHead));
    expect(shaft).toHaveLength(2);
    expect(boundary).toHaveLength(2);
    // Keyline's short arrow: an 8-unit shaft that ends at the head's tip.
    expect(length(shaft)).toBe(8);
    expect(shaft[1]).toEqual(head[1]);
    // The boundary is a minus-length rule, square to the shaft, one stroke clear of its tail.
    expect(boundary[0][axis]).toBe(boundary[1][axis]);
    expect(length(boundary)).toBe(length(subpathsOf(pathOf(IconMinus))[0]));
    expect(Math.abs(boundary[0][axis] - shaft[0][axis]) - 1.25).toBeGreaterThanOrEqual(1.25);
    expect((boundary[0][1 - axis] + boundary[1][1 - axis]) / 2).toBe(10);
  });

  it('leaves a clear unit between the warning stem and dot', () => {
    const dot = attributesOf(svgOf(IconWarning).querySelector('circle'), ['cx', 'cy', 'r']);
    const [stem] = subpathsOf(pathOf(IconWarning, 1));

    expect(stem).toEqual([[10, 8], [10, 10.5]]);
    expect(dot).toEqual([10, 13.25, 1]);
    expect(dot[1] - dot[2] - stem[1][1] - 1.25 / 2).toBeGreaterThanOrEqual(1);
    expect(pathOf(IconWarning)).toContain('a1.5 1.5');
  });

  it('opens the pencil barrel with a perpendicular cap seam and a symmetric nib', () => {
    const [barrel] = subpathsOf(pathOf(IconPencil));
    const [seam] = subpathsOf(pathOf(IconPencil, 1));
    const [start, top, cap, bottom, nib, base] = barrel;
    const along = ([x, y]: number[]): number => x - y;
    const across = ([x, y]: number[]): number => x + y;

    // The barrel's long edges run on x + y = 17 and x + y = 23; the seam crosses square from one to the other.
    expect(across(start)).toBe(17);
    expect(across(top)).toBe(17);
    expect(across(cap)).toBe(23);
    expect(across(bottom)).toBe(23);
    expect(across(seam[0])).toBe(17);
    expect(across(seam[1])).toBe(23);
    expect(along(seam[0])).toBe(along(seam[1]));
    expect(length(seam) - 1.25).toBeGreaterThanOrEqual(2.75);
    // The nib tip sits on the barrel's centre line, its two corners level with each other along it.
    expect(across(nib)).toBe(20);
    expect(along(bottom)).toBe(along(base));
    expect(base).toEqual(start);
  });

  it('uses the keyline circle and one open meridian on the globe', () => {
    const document = svgOf(IconGlobe);
    const circle = attributesOf(document.querySelector('circle'), ['cx', 'cy', 'r']);
    const meridian = attributesOf(document.querySelector('ellipse'), ['cx', 'cy', 'rx', 'ry']);

    expect(circle).toEqual([10, 10, 7]);
    expect(meridian).toEqual([circle[0], circle[1], 3, circle[2]]);
    expect(subpathsOf(pathOf(IconGlobe))).toEqual([[[circle[0] - circle[2], 10], [circle[0] + circle[2], 10]]]);
    expect(circle[2] - meridian[2] - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(document.querySelectorAll('path, circle, ellipse')).toHaveLength(3);
  });

  it('gives the bookmark two page-radius shoulders and a centered open notch', () => {
    const outline = pathOf(IconBookmark);
    const page = attributesOf(svgOf(IconPageEmpty).querySelector('rect'), ['y', 'height', 'rx']);
    const points = unique(subpathsOf(outline)[0]);
    const notch = points.find(([, y]) => y > page[0] + 1 && y < page[0] + page[1] - 1 && points.filter(p => p[1] === y).length === 1);

    expect(outline.match(new RegExp(`a${page[2]} ${page[2]}`, 'g'))).toHaveLength(2);
    // Same height as the Blok page frame.
    expect(Math.min(...points.map(([, y]) => y))).toBe(page[0]);
    expect(Math.max(...points.map(([, y]) => y))).toBe(page[0] + page[1]);
    expect(notch?.[0]).toBe(10);
    expect(sorted(points.map(([x, y]) => [20 - x, y]))).toEqual(sorted(points));
  });

  it('shares the panel frame for mail and centres its flap V inside it', () => {
    const frameAttributes = ['x', 'y', 'width', 'height', 'rx'];
    const frame = attributesOf(svgOf(IconMail).querySelector('rect'), frameAttributes);
    const [flap] = subpathsOf(pathOf(IconMail));
    const [left, apex, right] = flap;

    expect(frame).toEqual(attributesOf(svgOf(IconTable).querySelector('rect'), frameAttributes));
    expect(flap).toHaveLength(3);
    expect(apex[0]).toBe(frame[0] + frame[2] / 2);
    expect(left[1]).toBe(right[1]);
    expect(left[0] + right[0]).toBe(2 * apex[0]);
    expect(apex[1] - left[1]).toBeGreaterThanOrEqual(3);
    // The flap stays one stroke clear of the frame's sides.
    expect(left[0] - frame[0] - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('leans the hash stems in parallel and keeps both crossbars centered on them', () => {
    const [stemA, stemB, barA, barB] = subpathsOf(pathOf(IconHash));

    // Both stems run top to bottom over the same span with the same lean.
    expect(stemA[0][1]).toBe(stemB[0][1]);
    expect(stemA[1][1]).toBe(stemB[1][1]);
    expect(stemA[1][0] - stemA[0][0]).toBe(stemB[1][0] - stemB[0][0]);
    expect(stemA[1][0] - stemA[0][0]).toBeLessThan(0);
    const gap = stemB[0][0] - stemA[0][0];

    expect(stemB[1][0] - stemA[1][0]).toBe(gap);

    // Crossbars are level, equal in length, and centered on the stems they cross.
    expect(barA[0][1]).toBe(barA[1][1]);
    expect(barB[0][1]).toBe(barB[1][1]);
    expect(length(barA)).toBe(length(barB));
    const stemAt = (y: number): number =>
      stemA[0][0] + (stemA[1][0] - stemA[0][0]) * (y - stemA[0][1]) / (stemA[1][1] - stemA[0][1]);

    for (const [[left, y], [right]] of [barA, barB]) {
      expect((left + right) / 2).toBeCloseTo(stemAt(y) + gap / 2, 2);
    }

    // A hash reads squashed when its counter is wider than tall, or when the
    // crossbars carry the ink box wider than the stems carry it tall.
    expect(barB[0][1] - barA[0][1]).toBe(gap);
    expect(stemA[1][1] - stemA[0][1]).toBeGreaterThanOrEqual(
      Math.max(barA[1][0], barB[1][0]) - Math.min(barA[0][0], barB[0][0])
    );
  });

  it('reuses the left arrowhead for Return and the panel radius for its turn', () => {
    const [, leftHead] = subpathsOf(pathOf(IconMoveLeft));
    const [shaft, head] = subpathsOf(pathOf(IconReturn));
    const panelRadius = Number(svgOf(IconTable).querySelector('rect')?.getAttribute('rx'));

    expect(armsOf(head)).toEqual(armsOf(leftHead));
    expect(shaft[shaft.length - 1]).toEqual(head[1]);
    expect(pathOf(IconReturn)).toMatch(new RegExp(`a${panelRadius} ${panelRadius} 0 0 1`));
  });

  it('gives the trifold map equal-width panels with folds attached to their corners', () => {
    const [outline, leftFold, rightFold] = strokesOf(IconMap);
    const top = outline.slice(0, 4);
    const bottom = outline.slice(4, 8);

    expect(top[1][0] - top[0][0]).toBe(top[2][0] - top[1][0]);
    expect(top[2][0] - top[1][0]).toBe(top[3][0] - top[2][0]);
    expect(leftFold).toEqual([top[1], bottom[2]]);
    expect(rightFold).toEqual([top[2], bottom[1]]);
    expect(leftFold[1][1] - leftFold[0][1]).toBe(rightFold[1][1] - rightFold[0][1]);
  });

  it('anchors the chart with open axes and evenly spaced bars above the baseline', () => {
    const [axes] = subpathsOf(pathOf(IconChart));
    const bars = subpathsOf(pathOf(IconChart, 1));
    const [top, corner, end] = axes;

    expect(axes).toHaveLength(3);
    // Open axes: an L, square with the keyline square's 13-unit sides.
    expect(top[0]).toBe(corner[0]);
    expect(corner[1]).toBe(end[1]);
    expect(corner[1] - top[1]).toBe(13);
    expect(end[0] - corner[0]).toBe(13);
    expect(bars).toHaveLength(3);
    expect(bars[1][0][0] - bars[0][0][0]).toBe(bars[2][0][0] - bars[1][0][0]);
    bars.forEach(([base, tip]) => {
      expect(base[0]).toBe(tip[0]);
      expect(base[1]).toBe(bars[0][0][1]);
      expect(tip[1]).toBeLessThan(base[1]);
    });
    expect(corner[1] - bars[0][0][1] - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(bars[0][0][0] - corner[0] - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('uses four panel-radius corners and one integral tail for the message outline', () => {
    const outline = pathOf(IconMessage);
    const [x, , width, rx] = attributesOf(svgOf(IconTable).querySelector('rect'), ['x', 'y', 'width', 'rx']);
    const [points] = subpathsOf(outline);
    const xs = points.map(([px]) => px);

    expect(outline.match(new RegExp(`[aA]${rx} ${rx} `, 'g'))).toHaveLength(4);
    expect(Math.min(...xs)).toBe(x);
    expect(Math.max(...xs)).toBe(x + width);
    expect(svgOf(IconMessage).querySelectorAll('path')).toHaveLength(1);
    expect(subpathsOf(outline)).toHaveLength(1);
  });
});
