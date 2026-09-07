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

const numbersOf = (path: string): number[] => (path.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

const attributesOf = (element: Element | null, attributes: string[]): number[] =>
  attributes.map(attribute => Number(element?.getAttribute(attribute) ?? Number.NaN));

const dotsOf = (icon: string): number[][] =>
  Array.from(svgOf(icon).querySelectorAll('circle'), dot => attributesOf(dot, ['cx', 'cy', 'r']));

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

  it('uses the same light dots on a square grip grid and an evenly spaced ellipsis', () => {
    const grip = dotsOf(IconMenu);
    const ellipsis = dotsOf(IconDotsHorizontal);

    expect(ellipsis.map(dot => dot[2])).toEqual(grip.slice(0, 3).map(dot => dot[2]));
    expect(grip).toEqual([
      [8, 6, 1], [12, 6, 1],
      [8, 10, 1], [12, 10, 1],
      [8, 14, 1], [12, 14, 1],
    ]);
    expect(ellipsis).toEqual([[6, 10, 1], [10, 10, 1], [14, 10, 1]]);
    expect(ellipsis[1][0] - ellipsis[0][0]).toBe(grip[1][0] - grip[0][0]);
    expect(grip[2][1] - grip[0][1]).toBe(grip[1][0] - grip[0][0]);
    expect(ellipsis[1][0] - ellipsis[0][0] - 2 * ellipsis[0][2]).toBeGreaterThanOrEqual(1.25);
  });

  it('keeps plus and minus on one compact ten-unit cross', () => {
    const minus = pathOf(IconMinus);

    expect(minus).toBe('M5 10h10');
    expect(pathOf(IconPlus)).toBe(`${minus}M10 5v10`);
  });

  it('shares four-unit chevron arms across the move arrows', () => {
    const head = numbersOf(pathOf(IconArrowUp, 1));
    const chevron = numbersOf(pathOf(IconChevronRight));

    expect(head).toEqual([chevron[1], 17 - chevron[0], chevron[3], 17 - chevron[2], chevron[5], 17 - chevron[4]]);
    expect(head).toEqual([6, 9, 10, 5, 14, 9]);
    expect(numbersOf(pathOf(IconArrowUp))).toEqual([10, 15, 10, 5]);
  });

  it.each([
    ['down', IconMoveDown, (x: number, y: number): number[] => [20 - x, 20 - y]],
    ['left', IconMoveLeft, (x: number, y: number): number[] => [y, 20 - x]],
    ['right', IconMoveRight, (x: number, y: number): number[] => [20 - y, x]],
  ] as const)('rotates the complete up arrow to point %s', (_direction, icon, rotate) => {
    for (const index of [0, 1]) {
      const up = numbersOf(pathOf(IconArrowUp, index));
      const rotated = up.reduce<number[]>((points, value, offset) =>
        offset % 2 === 0 ? [...points, ...rotate(value, up[offset + 1])] : points, []);

      expect(numbersOf(pathOf(icon, index))).toEqual(rotated);
    }
    expect(svgOf(icon).querySelectorAll('path')).toHaveLength(2);
  });

  it.each([
    ['above', IconInsertAbove, IconArrowUp, 1],
    ['below', IconInsertBelow, IconMoveDown, 1],
    ['left', IconInsertLeft, IconMoveLeft, 0],
    ['right', IconInsertRight, IconMoveRight, 0],
  ] as const)('reuses the %s arrowhead and separates its shaft from the insertion boundary', (_direction, insert, move, axis) => {
    const shaft = numbersOf(pathOf(insert));
    const head = numbersOf(pathOf(insert, 1));
    const boundary = numbersOf(pathOf(insert, 2));

    expect(head).toEqual(numbersOf(pathOf(move, 1)));
    expect(shaft).toHaveLength(4);
    expect(boundary).toHaveLength(4);
    expect(Math.abs(shaft[axis] - shaft[axis + 2])).toBe(7.5);
    expect(Math.abs(boundary[axis] - shaft[axis]) - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(boundary[axis]).toBe(boundary[axis + 2]);
    expect(Math.abs(boundary[1 - axis] - boundary[3 - axis])).toBe(10);
    expect(shaft.slice(2)).toEqual(head.slice(2, 4));
  });

  it('leaves a stroke-width gap between the warning stem and dot', () => {
    const document = svgOf(IconWarning);
    const dot = attributesOf(document.querySelector('circle'), ['cx', 'cy', 'r']);
    const stem = numbersOf(pathOf(IconWarning, 1));

    expect(dot[1] - dot[2] - stem[1] - stem[2] - 1.25 / 2).toBeGreaterThanOrEqual(1.25);
    expect(dot).toEqual([10, 13.25, 0.75]);
    expect(pathOf(IconWarning)).toContain('a1.5 1.5');
    expect(stem).toEqual([10, 8, 2.5]);
  });

  it('opens the pencil barrel with a perpendicular cap seam and a symmetric nib', () => {
    const seam = numbersOf(pathOf(IconPencil, 1));

    expect(seam).toEqual([11.5, 5.5, 14.5, 8.5]);
    expect(seam[2] - seam[0]).toBe(seam[3] - seam[1]);
    expect(Math.hypot(seam[2] - seam[0], seam[3] - seam[1]) - 1.25).toBeGreaterThanOrEqual(2.75);
    expect(pathOf(IconPencil)).toContain('M4.5 12.5L13 4');
    expect(pathOf(IconPencil)).toContain('L7.5 15.5l-4 1 1-4Z');
    expect(seam[0] + seam[1]).toBe(4.5 + 12.5);
    expect(seam[2] + seam[3]).toBe(7.5 + 15.5);
  });

  it('uses the standalone circle keyline and one open meridian on the globe', () => {
    const document = svgOf(IconGlobe);
    const circle = attributesOf(document.querySelector('circle'), ['cx', 'cy', 'r']);
    const meridian = attributesOf(document.querySelector('ellipse'), ['cx', 'cy', 'rx', 'ry']);

    expect(circle).toEqual([10, 10, 6.5]);
    expect(meridian).toEqual([circle[0], circle[1], 3, circle[2]]);
    expect(pathOf(IconGlobe)).toBe(`M${circle[0] - circle[2]} 10H${circle[0] + circle[2]}`);
    expect(circle[2] - meridian[2] - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(document.querySelectorAll('path, circle, ellipse')).toHaveLength(3);
  });

  it('gives the bookmark two panel-radius shoulders and a centered open notch', () => {
    const outline = pathOf(IconBookmark);

    expect(outline.match(/a2 2/g)).toHaveLength(2);
    expect(outline).toBe('M7 3.5h6a2 2 0 0 1 2 2v11l-5-3-5 3v-11a2 2 0 0 1 2-2Z');
  });

  it('shares the approved panel frame for mail and gives its flap a clear V', () => {
    const frameAttributes = ['x', 'y', 'width', 'height', 'rx'];
    const mail = svgOf(IconMail);
    const frame = attributesOf(mail.querySelector('rect'), frameAttributes);
    const flap = numbersOf(pathOf(IconMail));

    expect(frame).toEqual(attributesOf(svgOf(IconTable).querySelector('rect'), frameAttributes));
    expect(flap).toEqual([3, 6, 10, 11, 17, 6]);
    expect(flap[0]).toBe(frame[0]);
    expect(flap[4]).toBe(frame[0] + frame[2]);
    expect(flap[2]).toBe(frame[0] + frame[2] / 2);
    expect(flap[3] - flap[1]).toBe(5);
  });

  it('leans the hash stems in parallel and keeps both crossbars centered on them', () => {
    const stems = numbersOf(pathOf(IconHash));
    const bars = numbersOf(pathOf(IconHash, 1));

    expect(stems).toEqual([8.5, 5, 6.5, 15, 13.5, 5, 11.5, 15]);
    expect(stems.slice(4)).toEqual(stems.slice(0, 4).map((value, index) => value + (index % 2 === 0 ? 5 : 0)));
    expect(bars).toEqual([5, 8, 16, 8, 4, 12, 15, 12]);
    expect(bars.slice(4)).toEqual(bars.slice(0, 4).map((value, index) => value + (index % 2 === 0 ? -1 : 4)));
  });

  it('reuses the left arrowhead for Return and the panel radius for its turn', () => {
    const left = numbersOf(pathOf(IconMoveLeft, 1));

    expect(numbersOf(pathOf(IconReturn, 1))).toEqual(left.map((value, index) => value + (index % 2 === 1 ? 1 : 0)));
    expect(pathOf(IconReturn)).toBe('M15 5V9a2 2 0 0 1-2 2H5');
    expect(numbersOf(pathOf(IconReturn, 1)).slice(2, 4)).toEqual([5, 11]);
  });

  it('gives the trifold map equal-width panels with folds attached to their corners', () => {
    const outline = numbersOf(pathOf(IconMap));
    const leftFold = numbersOf(pathOf(IconMap, 1));
    const rightFold = numbersOf(pathOf(IconMap, 2));
    const top = outline.slice(0, 8);

    expect(top[2] - top[0]).toBe(top[4] - top[2]);
    expect(top[4] - top[2]).toBe(top[6] - top[4]);
    expect(top).toEqual([3.25, 5.5, 7.75, 3.5, 12.25, 5.5, 16.75, 3.5]);
    expect(leftFold).toEqual([...top.slice(2, 4), ...outline.slice(12, 14)]);
    expect(rightFold).toEqual([...top.slice(4, 6), ...outline.slice(10, 12)]);
    expect(leftFold[3] - leftFold[1]).toBe(rightFold[3] - rightFold[1]);
  });

  it('anchors the chart with open axes and evenly spaced bars above the baseline', () => {
    const axes = numbersOf(pathOf(IconChart));
    const bars = numbersOf(pathOf(IconChart, 1));

    expect(pathOf(IconChart)).toBe('M3.5 4.5V16H16.5');
    expect(bars).toEqual([7, 13, 7, 10, 10.5, 13, 10.5, 5, 14, 13, 14, 8]);
    expect(bars[4] - bars[0]).toBe(bars[8] - bars[4]);
    expect(bars[1]).toBe(bars[5]);
    expect(bars[5]).toBe(bars[9]);
    expect(axes[2] - bars[1] - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(bars[0] - axes[0] - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('uses four panel-radius corners and one integral tail for the message outline', () => {
    const outline = pathOf(IconMessage);
    const panel = attributesOf(svgOf(IconTable).querySelector('rect'), ['x', 'y', 'width', 'rx']);

    expect(outline.match(/a2 2/g)).toHaveLength(4);
    expect(outline).toContain(`M${panel[0] + panel[3]} ${panel[1]}h${panel[2] - 2 * panel[3]}`);
    expect(outline).toContain('H9l-4 3v-3');
    expect(svgOf(IconMessage).querySelectorAll('path')).toHaveLength(1);
  });
});
