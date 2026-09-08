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

  it('keeps the open grin centered between the eyes with room inside the face', () => {
    const svg = parse('IconEmojiSmile');
    const mouth = pathOf(svg);

    expect(mouth.endsWith('Z')).toBe(true);
    const [left, top, right, rightY, controlX1, controlY1, controlX2, controlY2, endX, endY] = numbers(mouth);

    expect(left + right).toBe(20);
    expect(top).toBe(rightY);
    expect(endX).toBe(left);
    expect(endY).toBe(top);
    expect(controlX1 + controlX2).toBe(20);
    expect(controlY1).toBe(controlY2);
    const bottom = (top + 3 * controlY1 + 3 * controlY2 + endY) / 8;

    expect(bottom - top - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(16.5 - bottom - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('gives one open leaf a continuous diagonal vein extending into its stem', () => {
    const svg = parse('IconEmojiSprout');

    expect(svg.querySelectorAll('path')).toHaveLength(2);
    const outline = pathOf(svg);
    const vein = pathOf(svg, 1);

    expect(outline.endsWith('Z')).toBe(true);
    expect(outline.match(/C/g)).toHaveLength(2);
    expect(vein).toMatch(/^M[\d. ]+L[\d. ]+$/);
    const leaf = numbers(outline);
    const [startX, startY, endX, endY] = numbers(vein);

    expect(startX).toBeLessThan(leaf[0]);
    expect(startY).toBeGreaterThan(leaf[1]);
    expect(startX + startY).toBe(20);
    expect(endX + endY).toBe(20);
    expect(endX).toBeGreaterThan(leaf[0]);
    expect(endX).toBeLessThan(leaf[6]);
    expect(endY).toBeLessThan(leaf[1]);
    expect(endY).toBeGreaterThan(leaf[7]);
    expect(Math.hypot(leaf[6] - endX, leaf[7] - endY) - 1.25).toBeGreaterThanOrEqual(1.25);
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

  it('anchors the ball diagonal and both continental edges to the shared circular frame', () => {
    const ball = parse('IconEmojiBall');
    const diameter = Array.from(ball.querySelectorAll('path')).find(path => /^M[\d. ]+L[\d. ]+$/.test(path.getAttribute('d') ?? ''));

    expect(diameter).toBeDefined();
    const line = numbers(diameter?.getAttribute('d') ?? '');

    expect(line).toHaveLength(4);
    expect(line[0] + line[2]).toBe(20);
    expect(line[1] + line[3]).toBe(20);

    const globe = parse('IconEmojiGlobe');
    const face = parse('IconEmojiSmile').querySelector('circle');
    const frame = globe.querySelector('circle');

    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(face?.getAttribute(attribute));
    }
    for (const path of [line, numbers(pathOf(globe)), numbers(pathOf(globe, 1))]) {
      expect(Math.hypot(path[0] - 10, path[1] - 10)).toBeCloseTo(6.5, 1);
      expect(Math.hypot(path[path.length - 2] - 10, path[path.length - 1] - 10)).toBeCloseTo(6.5, 1);
    }
  });

  it('keeps the rounded bulb clear of rays with a broad neck and simple base', () => {
    const svg = parse('IconEmojiLightbulb');

    expect(svg.querySelectorAll('path')).toHaveLength(2);
    const glass = pathOf(svg);
    const base = pathOf(svg, 1);
    const neck = numbers(glass);

    expect(glass.endsWith('Z')).toBe(true);
    expect(glass).toContain('a5 5 0 0 1 10 0');
    expect(base).toMatch(/^M[\d. ]+h[\d.]+$/);
    const [left, baseline, width] = numbers(base);

    expect(glass.match(/[A-Za-z]/g)).toStrictEqual(['M', 'V', 'C', 'a', 'c', 'v', 'Z']);
    expect(neck).toHaveLength(23);
    const rightX = neck[7] + neck[14] + neck[20];
    const rightY = neck[8] + neck[15] + neck[21] + neck[22];

    expect(rightX - neck[0]).toBeGreaterThanOrEqual(5);
    expect((neck[0] + rightX) / 2).toBe(10);
    expect(rightY).toBe(neck[1]);
    expect(width).toBeGreaterThanOrEqual(4);
    expect(left + width / 2).toBe(10);
    expect(left).toBeGreaterThanOrEqual(neck[0]);
    expect(left + width).toBeLessThanOrEqual(rightX);
    expect(baseline - rightY - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('leaves a visible swallowtail inset while the flag meets its pole', () => {
    const svg = parse('IconEmojiFlag');
    const flag = pathOf(svg, 1);
    const tail = flag.match(/L[\d. ]+L[\d. ]+/)?.[0] ?? '';

    expect(tail).not.toBe('');
    const [notchX, notchY, tipX, tipY] = numbers(tail);

    expect(tipX - notchX).toBeGreaterThanOrEqual(1.25);
    expect(tipY - notchY).toBeGreaterThanOrEqual(2.5);
    expect(numbers(flag)[0]).toBe(numbers(pathOf(svg))[0]);
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
