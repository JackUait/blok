import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const parse = (name: string): SVGSVGElement => {
  const markup = Object.entries(icons).find(([key]) => key === name)?.[1];

  expect(typeof markup, name).toBe('string');
  const svg = new DOMParser().parseFromString(String(markup), 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error(`Invalid SVG: ${name}`);
  }

  return svg;
};
const numbers = (path: string): number[] => path.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
const pathOf = (svg: SVGSVGElement, index = 0): string => svg.querySelectorAll('path')[index]?.getAttribute('d') ?? '';
const numeric = (element: Element, attribute: string): number => Number(element.getAttribute(attribute));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('compact emoji picker artwork', () => {
  it.each([
    'Star', 'Smile', 'Sprout', 'Utensils', 'Ball', 'Globe', 'Lightbulb', 'Heart', 'Flag', 'Dice', 'Trash',
  ])('%s keeps the standard canvas, self-contained paint and decorative accessibility', (name) => {
    const svg = parse(`IconEmoji${name}`);

    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelector('text, image, use, style, filter, foreignObject')).toBeNull();
    for (const stroke of svg.querySelectorAll('[stroke]')) {
      expect(stroke.getAttribute('stroke')).toBe('currentColor');
      expect(stroke.getAttribute('stroke-width')).toBe('1.25');
      expect(stroke.getAttribute('stroke-linecap')).toBe('round');
      expect(stroke.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it('mirrors the heart lobes about the canvas centre and spans the family circle box', () => {
    const svg = parse('IconEmojiHeart');
    const outline = pathOf(svg);
    const values = numbers(outline);
    const points = values.flatMap((value, index) => (index % 2 === 1 ? [[values[index - 1] ?? 0, value]] : []));
    const key = (x: number, y: number): string => `${x},${y}`;
    const drawn = points.map(([x, y]) => key(x ?? 0, y ?? 0));
    const face = parse('IconEmojiSmile').querySelector('circle');

    if (face === null) {
      throw new Error('IconEmojiSmile lost the family circle');
    }

    expect(outline.endsWith('Z')).toBe(true);
    expect(svg.getAttribute('fill')).toBe('none');

    // A lopsided heart reads as a scribble next to the family's symmetric shapes.
    for (const [x, y] of points) {
      expect(drawn, `unmirrored point ${key(x ?? 0, y ?? 0)}`).toContain(key(20 - (x ?? 0), y ?? 0));
    }

    const edge = numeric(face, 'cx') - numeric(face, 'r');
    const xs = points.map(([x]) => x ?? 0);

    expect(Math.min(...xs)).toBe(edge);
    expect(Math.max(...xs)).toBe(20 - edge);
  });

  it('rounds both the five star tips and their inner valleys without filling the silhouette', () => {
    const svg = parse('IconEmojiStar');
    const outline = pathOf(svg);

    expect(outline.match(/Q/g)).toHaveLength(10);
    expect(outline.endsWith('Z')).toBe(true);
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('centers one open smile curve with clear space below the eyes and above the frame', () => {
    const svg = parse('IconEmojiSmile');
    const mouth = pathOf(svg);

    expect(mouth).toMatch(/^M[\d. ]+C[\d. ]+$/);
    const [left, top, controlX1, controlY1, controlX2, controlY2, right, endY] = numbers(mouth);

    expect(left + right).toBe(20);
    expect(top).toBe(endY);
    expect(controlX1 + controlX2).toBe(20);
    expect(controlY1).toBe(controlY2);
    const bottom = (top + 3 * controlY1 + 3 * controlY2 + endY) / 8;

    expect(bottom - top).toBeGreaterThanOrEqual(1.25);
    expect(top - 8 - 0.75 - 0.625).toBeGreaterThanOrEqual(1.25);
    expect(16.5 - bottom - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('attaches both leaves to a centered vertical stem that stops at the upper leaf', () => {
    const svg = parse('IconEmojiSprout');
    const stemPath = pathOf(svg, 2);

    expect(stemPath).toMatch(/^M[\d. ]+V[\d.]+$/);
    expect(svg.querySelectorAll('path')).toHaveLength(3);
    const stem = numbers(stemPath);

    expect(stem).toHaveLength(3);
    expect(stem[0]).toBe(10);

    for (const index of [0, 1]) {
      const outline = pathOf(svg, index);

      expect(outline).toMatch(/^M[\d. ]+C[\d. ]+C[\d. ]+Z$/);
      const leaf = numbers(outline);

      expect(leaf).toHaveLength(14);
      expect(leaf.slice(12)).toStrictEqual(leaf.slice(0, 2));
      expect(leaf[0]).toBe(stem[0]);
      expect(leaf[1]).toBeGreaterThanOrEqual(stem[2]);
      expect(stem[1] - Math.max(...leaf.filter((_, coordinate) => coordinate % 2 === 1)) - 1.25).toBeGreaterThanOrEqual(1.25);
    }

    const left = numbers(pathOf(svg));
    const right = numbers(pathOf(svg, 1));

    expect(left[6]).toBeLessThan(stem[0]);
    expect(right[6]).toBeGreaterThan(stem[0]);
    expect(left[1]).toBeGreaterThan(right[1]);
    expect(stem[2]).toBe(right[1]);
  });

  it('aligns the spoon handle with its bowl and the fork baseline', () => {
    const svg = parse('IconEmojiUtensils');
    const bowl = svg.querySelector('ellipse');

    expect(bowl).not.toBeNull();
    if (bowl === null) {
      return;
    }
    const [x, top, bottom] = numbers(pathOf(svg, 2));

    expect(x).toBe(numeric(bowl, 'cx'));
    expect(top).toBe(numeric(bowl, 'cy') + numeric(bowl, 'ry'));
    expect(bottom).toBe(16.5);
    expect(x - numeric(bowl, 'rx') - 8.5 - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('keeps the ball interior open between its two curved seams', () => {
    const paths = Array.from(parse('IconEmojiBall').querySelectorAll('path'))
      .flatMap(path => path.getAttribute('d')?.match(/M[^M]+/g) ?? []);

    expect(paths).toHaveLength(2);
    for (const seam of paths) {
      expect(seam).toMatch(/^M[\d. ]+C[\d. ]+$/);
    }
  });

  it('anchors smooth continental edges to the shared circular frame', () => {
    const globe = parse('IconEmojiGlobe');
    const face = parse('IconEmojiSmile').querySelector('circle');
    const frame = globe.querySelector('circle');

    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(face?.getAttribute(attribute));
    }
    expect(globe.querySelectorAll('path')).toHaveLength(2);
    for (const element of globe.querySelectorAll('path')) {
      const outline = element.getAttribute('d') ?? '';

      expect(outline).toMatch(/^M[\d. ]+(C[\d. ]+){2,3}$/);
      const path = numbers(outline);

      expect(Math.hypot(path[0] - 10, path[1] - 10)).toBeCloseTo(6.5, 1);
      expect(Math.hypot(path[path.length - 2] - 10, path[path.length - 1] - 10)).toBeCloseTo(6.5, 1);
      for (let index = 0; index < path.length; index += 2) {
        expect(Math.hypot(path[index] - 10, path[index + 1] - 10)).toBeLessThanOrEqual(6.51);
      }
    }
  });

  it('keeps symmetric glass clear of its rounded base and internal shine', () => {
    const svg = parse('IconEmojiLightbulb');

    expect(svg.querySelectorAll('path')).toHaveLength(3);
    expect(svg.querySelector('line, polyline, polygon, circle, ellipse')).toBeNull();
    expect(svg.getAttribute('fill')).toBe('none');
    expect(pathOf(svg)).toMatch(/^M[\d. ]+C[\d. ]+a[\d. ]+C[\d. ]+Z$/);
    expect(pathOf(svg, 1)).toMatch(/^M[\d. ]+H[\d.]+C[\d. ]+C[\d. ]+Z$/);
    expect(pathOf(svg, 2)).toMatch(/^M[\d. ]+A[\d. ]+$/);
    const glass = numbers(pathOf(svg));
    const base = numbers(pathOf(svg, 1));
    const shine = numbers(pathOf(svg, 2));

    expect(glass).toHaveLength(21);
    expect(base).toHaveLength(15);
    expect(shine).toHaveLength(9);
    for (const [left, right] of [[0, 19], [2, 17], [4, 15]]) {
      expect(glass[left] + glass[right]).toBe(20);
      expect(glass[left + 1]).toBe(glass[right + 1]);
    }
    expect(glass[6] + glass[13] / 2).toBe(10);
    expect(glass[8]).toBe(glass[9]);
    expect(glass.slice(10, 13)).toStrictEqual([0, 0, 1]);
    expect(glass[13]).toBe(2 * glass[8]);
    expect(glass[14]).toBe(0);

    expect(base[0]).toBe(glass[0]);
    expect(base[2]).toBe(glass[19]);
    expect(base[2] - base[0]).toBeGreaterThanOrEqual(4);
    expect(base[1] - glass[1] - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(base.slice(13)).toStrictEqual(base.slice(0, 2));
    expect(base[7]).toBe(10);
    for (const [left, right] of [[3, 11], [5, 9]]) {
      expect(base[left] + base[right]).toBe(20);
      expect(base[left + 1]).toBe(base[right + 1]);
      expect(base[left + 1]).toBeGreaterThan(base[1]);
    }
    expect(base[8]).toBeGreaterThan(base[1]);

    expect(shine[0] + shine[2]).toBe(10);
    expect(shine[1]).toBe(glass[7]);
    expect(shine[2]).toBe(shine[3]);
    expect(shine.slice(4, 7)).toStrictEqual([0, 0, 1]);
    expect(shine[7]).toBe(10);
    expect(shine[8] + shine[3]).toBe(glass[7]);
    expect(glass[8] - shine[2] - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('attaches both cloth ends to an upright flagpole without a transform', () => {
    const svg = parse('IconEmojiFlag');
    const flag = pathOf(svg, 1);

    expect(svg.querySelector('g, [transform]')).toBeNull();
    expect(svg.hasAttribute('transform')).toBe(false);
    expect(svg.querySelectorAll(':scope > path')).toHaveLength(2);
    expect(pathOf(svg)).toMatch(/^M[\d. ]+v-[\d.]+$/);
    expect(flag).toMatch(/^M[\d. ]+C[\d. ]+L[\d. ]+C[\d. ]+$/);
    const wave = numbers(flag);
    const pole = numbers(pathOf(svg));

    expect(wave[6]).toBe(wave[8]);
    expect(wave[9] - wave[7]).toBeGreaterThanOrEqual(7.5);
    expect(wave[0]).toBe(pole[0]);
    expect(wave[14]).toBe(pole[0]);
    expect(wave[1]).toBeGreaterThan(pole[1] + pole[2]);
    expect(wave[15]).toBeLessThan(pole[1]);
  });

  it('centers five pips in a single tilted die with generous edge clearance', () => {
    const svg = parse('IconEmojiDice');
    const group = svg.querySelector('g');
    const frame = group?.querySelector('rect');
    const pips = Array.from(group?.querySelectorAll('circle') ?? []);

    expect(group?.getAttribute('transform')).toMatch(/^rotate\(-[\d.]+ 10 10\)$/);
    expect(pips).toHaveLength(5);
    expect(frame).toBeDefined();
    expect(frame).not.toBeNull();
    if (frame === undefined || frame === null) {
      return;
    }
    const left = numeric(frame, 'x');
    const top = numeric(frame, 'y');
    const right = left + numeric(frame, 'width');
    const bottom = top + numeric(frame, 'height');

    expect(pips.reduce((sum, pip) => sum + numeric(pip, 'cx'), 0) / pips.length).toBe(10);
    expect(pips.reduce((sum, pip) => sum + numeric(pip, 'cy'), 0) / pips.length).toBe(10);
    for (const pip of pips) {
      const x = numeric(pip, 'cx');
      const y = numeric(pip, 'cy');
      const radius = numeric(pip, 'r');

      expect(Math.min(x - left, right - x, y - top, bottom - y) - radius - 0.625).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('lifts the trash lid as one attached piece above a tapered open bin', () => {
    const svg = parse('IconEmojiTrash');
    const lid = svg.querySelector('g');
    const bin = svg.querySelector(':scope > path');
    const ribs = svg.querySelectorAll(':scope > path')[1];

    expect(lid?.getAttribute('transform')).toMatch(/^rotate\(-[\d.]+ 10 5.5\)$/);
    expect(lid?.querySelectorAll('path')).toHaveLength(2);
    expect(bin?.getAttribute('d')).not.toMatch(/[zZ]/);
    const body = numbers(bin?.getAttribute('d') ?? '');
    const slats = numbers(ribs?.getAttribute('d') ?? '');

    expect(body[0]).toBeLessThan(body[2]);
    expect(body[1]).toBeGreaterThanOrEqual(8.5);
    expect(slats).toHaveLength(6);
    expect(slats[0] + slats[3]).toBe(20);
    expect(slats[1]).toBe(slats[4]);
    expect(slats[2]).toBe(slats[5]);
    expect(slats[0] - body[2] - 1.25).toBeGreaterThanOrEqual(1.25);
  });
});
