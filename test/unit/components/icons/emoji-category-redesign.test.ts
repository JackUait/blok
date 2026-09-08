import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const svgOf = (name: string): SVGSVGElement => {
  const markup = Object.entries(icons).find(([key]) => key === name)?.[1];

  expect(typeof markup, name).toBe('string');
  const svg = new DOMParser().parseFromString(String(markup), 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error(`Invalid SVG: ${name}`);
  }

  return svg;
};
const pathOf = (svg: SVGSVGElement, index: number): string => svg.querySelectorAll('path')[index]?.getAttribute('d') ?? '';
const valuesOf = (path: string): number[] => path.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('expressive emoji categories', () => {
  it.each(['Sparkles', 'Wink', 'Bowl', 'Gamepad', 'Map', 'Hearts'])('%s stays legible in the house icon frame', (name) => {
    const svg = svgOf(`IconEmoji${name}`);

    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelectorAll('path, circle, ellipse, line, polyline, polygon').length).toBeGreaterThan(1);
    for (const stroke of svg.querySelectorAll('[stroke]')) {
      expect(stroke.getAttribute('stroke')).toBe('currentColor');
      expect(stroke.getAttribute('stroke-width')).toBe('1.25');
    }
  });

  it('keeps the winking face on the same frame as the existing smile, with an open eye and mouth clearance', () => {
    const wink = svgOf('IconEmojiWink');
    const smile = svgOf('IconEmojiSmile');
    const frame = wink.querySelector('circle');
    const eye = wink.querySelector('circle[fill="currentColor"]');

    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(smile.querySelector('circle')?.getAttribute(attribute));
    }
    expect(wink.querySelectorAll('circle[fill="currentColor"]')).toHaveLength(1);
    const mouth = valuesOf(pathOf(wink, 1));

    expect(mouth[1] - Number(eye?.getAttribute('cy')) - Number(eye?.getAttribute('r')) - 0.625).toBeGreaterThanOrEqual(1.25);
  });

  it('leaves a full stroke of air between the steam and the bowl rim', () => {
    const bowl = svgOf('IconEmojiBowl');
    const rim = valuesOf(pathOf(bowl, 0));
    const steam = pathOf(bowl, 2).match(/M[^M]+/g) ?? [];

    expect(steam).toHaveLength(2);
    for (const curl of steam) {
      const ys = valuesOf(curl).filter((_, index) => index % 2 === 1);

      expect(rim[1] - Math.max(...ys) - 1.25).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('separates the controller buttons from each other and the directional pad', () => {
    const controller = svgOf('IconEmojiGamepad');
    const buttons = Array.from(controller.querySelectorAll('circle'));

    expect(buttons).toHaveLength(2);
    const [first, second] = buttons;

    if (first === undefined || second === undefined) {
      throw new Error('Missing controller buttons');
    }
    const distance = Math.hypot(Number(first.getAttribute('cx')) - Number(second.getAttribute('cx')), Number(first.getAttribute('cy')) - Number(second.getAttribute('cy')));

    expect(distance - Number(first.getAttribute('r')) - Number(second.getAttribute('r'))).toBeGreaterThanOrEqual(1.25);
    expect(Math.min(...buttons.map(button => Number(button.getAttribute('cx')) - Number(button.getAttribute('r')))) - 8.25 - 0.625).toBeGreaterThanOrEqual(1.25);
  });

  it('ends the stem at the upper leaf instead of drawing a stray vein inside it', () => {
    const sprout = svgOf('IconEmojiSprout');
    const left = valuesOf(pathOf(sprout, 0));
    const right = valuesOf(pathOf(sprout, 1));
    const stem = pathOf(sprout, 2);

    expect(stem).toMatch(/^M[\d. ]+V[\d.]+$/);
    const [x, bottom, top] = valuesOf(stem);

    expect(x).toBe(left[0]);
    expect(x).toBe(right[0]);
    expect(top).toBe(right[1]);
    expect(left[1]).toBeGreaterThan(top);
    expect(bottom - left[1]).toBeGreaterThanOrEqual(2.5);
  });

  it('draws two complete hearts instead of leaving the smaller outline dangling', () => {
    const hearts = svgOf('IconEmojiHearts');
    const paths = Array.from(hearts.querySelectorAll('path'));

    expect(paths).toHaveLength(2);
    for (const path of paths) {
      const outline = path.getAttribute('d') ?? '';

      expect(outline.endsWith('Z')).toBe(true);
      const points = valuesOf(outline);

      expect(points.slice(-2)).toEqual(points.slice(0, 2));
      expect(outline.match(/C/g)).toHaveLength(4);
    }
  });

  it('keeps the bulb base rounded and centered below the hollow glass', () => {
    const bulb = svgOf('IconEmojiLightbulb');
    const glass = pathOf(bulb, 0);
    const base = pathOf(bulb, 1);

    expect(base.endsWith('Z')).toBe(true);
    expect(base.match(/C/g)).toHaveLength(2);
    expect(bulb.getAttribute('fill')).toBe('none');
    expect(glass.endsWith('Z')).toBe(true);
    const glassPoints = valuesOf(glass);
    const basePoints = valuesOf(base);

    expect(basePoints[0]).toBe(glassPoints[0]);
    expect(basePoints[2]).toBe(glassPoints.at(-2));
    expect(basePoints[1] - glassPoints[1] - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('keeps the flag upright with both ends of its cloth attached to the pole', () => {
    const flag = svgOf('IconEmojiFlag');

    expect(flag.querySelector('[transform]')).toBeNull();
    expect(pathOf(flag, 0)).toMatch(/^M[\d. ]+v-?[\d.]+$/);
    const pole = valuesOf(pathOf(flag, 0));
    const cloth = valuesOf(pathOf(flag, 1));

    expect(cloth[0]).toBe(pole[0]);
    expect(cloth.at(-2)).toBe(pole[0]);
  });
});
