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
const numeric = (element: Element | null | undefined, attribute: string): number => Number(element?.getAttribute(attribute));

interface Segment { command: string; from: [number, number]; values: number[] }

/** Splits absolute path data into segments that know where the pen started. */
const segmentsOf = (path: string): Segment[] => {
  const pen: [number, number] = [0, 0];

  return Array.from(path.matchAll(/([MLHVCQAZ])([^MLHVCQAZ]*)/g), ([, command = '', args = '']) => {
    const values = valuesOf(args);
    const segment = { command, from: [pen[0], pen[1]] as [number, number], values };

    if (command === 'H') {
      pen[0] = values[0] ?? pen[0];
    } else if (command === 'V') {
      pen[1] = values[0] ?? pen[1];
    } else if (values.length >= 2) {
      pen[0] = values.at(-2) ?? 0;
      pen[1] = values.at(-1) ?? 0;
    }

    return segment;
  });
};

/** On-curve and control points: every coordinate pair the path draws through or bends toward. */
const pointsOf = (path: string): Array<[number, number]> => segmentsOf(path).flatMap(({ command, from, values }) => {
  if (command === 'H') {
    return [[values[0] ?? 0, from[1]] as [number, number]];
  }
  if (command === 'V') {
    return [[from[0], values[0] ?? 0] as [number, number]];
  }
  const pairs = command === 'A' ? values.slice(5) : values;

  return pairs.flatMap((value, index) => (index % 2 === 1 ? [[pairs[index - 1] ?? 0, value] as [number, number]] : []));
});

/** Points along every curve and line of a path, for stroke-to-stroke distances. */
const sampleCurves = (path: string): Array<[number, number]> => segmentsOf(path).flatMap(({ command, from, values }) => {
  const controls = command === 'C' || command === 'Q' || command === 'L' ? values : [];
  const hull: Array<[number, number]> = [from];

  for (let index = 0; index + 1 < controls.length; index += 2) {
    hull.push([controls[index] ?? 0, controls[index + 1] ?? 0]);
  }
  if (hull.length < 2) {
    return [];
  }

  return Array.from({ length: 21 }, (_, step) => {
    // De Casteljau works for lines, quadratics and cubics alike.
    let level = hull;

    while (level.length > 1) {
      level = level.slice(1).map(([x, y], index) => {
        const [px, py] = level[index] ?? [0, 0];

        return [px + (x - px) * step / 20, py + (y - py) * step / 20] as [number, number];
      });
    }

    return level[0] ?? [0, 0];
  });
});
const nearest = (a: Array<[number, number]>, b: Array<[number, number]>): number =>
  Math.min(...a.flatMap(([x, y]) => b.map(([bx, by]) => Math.hypot(x - bx, y - by))));

/** Every point has a twin mirrored across the vertical line x = axis. */
const expectMirrored = (points: Array<[number, number]>, axis: number): void => {
  const drawn = points.map(([x, y]) => `${x},${y}`);

  for (const [x, y] of points) {
    expect(drawn, `unmirrored point ${x},${y}`).toContain(`${Math.round((2 * axis - x) * 100) / 100},${y}`);
  }
};

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

  it('draws two symmetric four-point sparkles and a twinkle dot, each a full stroke apart', () => {
    const sparkles = svgOf('IconEmojiSparkles');
    const stars = [pathOf(sparkles, 0), pathOf(sparkles, 1)];

    for (const star of stars) {
      expect(star).toMatch(/^M[\d. ]+(Q[\d. ]+){4}Z$/);
      const points = pointsOf(star);
      const [tipX] = points[0] ?? [0, 0];

      expectMirrored(points, tipX);
    }
    const [big = [], small = []] = stars.map(star => sampleCurves(star));

    expect(nearest(big, small) - 1.25).toBeGreaterThanOrEqual(1.25);

    const dot = sparkles.querySelector('circle');

    expect(dot?.getAttribute('fill')).toBe('currentColor');
    expect(nearest([[numeric(dot, 'cx'), numeric(dot, 'cy')]], [...big, ...small]) - numeric(dot, 'r') - 0.625).toBeGreaterThanOrEqual(1.25);
  });

  it('winks the open smile: same frame and eye, a closed eye mirrored across, and an open grin', () => {
    const wink = svgOf('IconEmojiWink');
    const smile = svgOf('IconEmojiSmile');
    const [frame, eye] = Array.from(wink.querySelectorAll('circle'));
    const [smileFrame, smileEye] = Array.from(smile.querySelectorAll('circle'));

    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(smileFrame?.getAttribute(attribute));
      expect(eye?.getAttribute(attribute)).toBe(smileEye?.getAttribute(attribute));
    }
    expect(wink.querySelectorAll('circle[fill="currentColor"]')).toHaveLength(1);

    const closedEye = valuesOf(pathOf(wink, 0));

    expect(pathOf(wink, 0)).toMatch(/^M[\d. ]+Q[\d. ]+$/);
    expect((closedEye[0] + closedEye[4]) / 2).toBe(20 - numeric(eye, 'cx'));
    expect(closedEye[1]).toBe(closedEye[5]);

    const mouth = pathOf(wink, 1);

    expect(mouth.endsWith('Z')).toBe(true);
    const points = pointsOf(mouth);

    expectMirrored(points, 10);
    const top = Math.min(...points.map(([, y]) => y));
    const bottom = Math.max(...points.map(([, y]) => y));

    expect(top - numeric(eye, 'cy') - numeric(eye, 'r') - 0.625).toBeGreaterThanOrEqual(1.25);
    expect(16.5 - bottom - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('centers the bowl, its foot and both steam wisps, with a full stroke of air above the rim', () => {
    const bowl = svgOf('IconEmojiBowl');
    const rim = pointsOf(pathOf(bowl, 0));
    const steam = pathOf(bowl, 2).match(/M[^M]+/g) ?? [];

    expectMirrored(rim, 10);
    const [footX = 0, , footWidth = 0] = valuesOf(pathOf(bowl, 1));

    expect(pathOf(bowl, 1)).toMatch(/^M[\d. ]+h[\d.]+$/);
    expect(2 * footX + footWidth).toBe(20);
    expect(steam).toHaveLength(2);
    const [left, right] = steam.map(curl => valuesOf(curl));

    expect((left?.[0] ?? 0) + (right?.[0] ?? 0)).toBe(20);
    for (const curl of steam) {
      const ys = valuesOf(curl).filter((_, index) => index % 2 === 1);

      expect((rim[0]?.[1] ?? 0) - Math.max(...ys) - 1.25).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('draws a symmetric controller body with no cable, a d-pad and two separated buttons', () => {
    const controller = svgOf('IconEmojiGamepad');

    expect(controller.querySelectorAll('path')).toHaveLength(2);
    expectMirrored(pointsOf(pathOf(controller, 0)), 10);

    const buttons = Array.from(controller.querySelectorAll('circle'));

    expect(buttons).toHaveLength(2);
    const [first, second] = buttons;
    const distance = Math.hypot(numeric(first, 'cx') - numeric(second, 'cx'), numeric(first, 'cy') - numeric(second, 'cy'));

    expect(distance - numeric(first, 'r') - numeric(second, 'r')).toBeGreaterThanOrEqual(1.25);
    const [padLeft, , padWidth] = valuesOf(pathOf(controller, 1));

    expect(Math.min(...buttons.map(button => numeric(button, 'cx') - numeric(button, 'r'))) - (padLeft + padWidth) - 0.625).toBeGreaterThanOrEqual(1.25);
  });

  it('plants a centered location pin in an open ground ring that never crosses the pin', () => {
    const pin = svgOf('IconEmojiMap');
    const outline = pathOf(pin, 0);
    const hole = pin.querySelector('circle');
    const ground = pointsOf(pathOf(pin, 1));

    expect(outline).toMatch(/^M[\d. ]+C[\d. ]+A[\d. ]+C[\d. ]+Z$/);
    const [tipX, tipY] = valuesOf(outline);

    expect(tipX).toBe(10);
    expect(numeric(hole, 'cx')).toBe(10);
    expect(hole?.hasAttribute('fill')).toBe(false);

    expect(pathOf(pin, 1).endsWith('Z')).toBe(false);
    expectMirrored(ground, 10);
    const lowest = Math.max(...ground.map(([, y]) => y));
    const [start] = ground;

    expect(tipY).toBeLessThan(lowest);
    // The ring breaks where the pin stands; its loose ends keep a full stroke of air from the pin.
    expect(nearest([start ?? [0, 0], ground.at(-1) ?? [0, 0]], sampleCurves(outline)) - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(lowest).toBeLessThanOrEqual(17);
  });

  it('pairs an outlined heart with a smaller solid heart, both symmetric and a stroke apart', () => {
    const hearts = svgOf('IconEmojiHearts');
    const paths = Array.from(hearts.querySelectorAll('path'));

    expect(paths).toHaveLength(2);
    const [outline, solid] = paths;

    expect(outline?.getAttribute('stroke')).toBe('currentColor');
    expect(solid?.getAttribute('fill')).toBe('currentColor');
    expect(solid?.hasAttribute('stroke')).toBe(false);

    const shapes = paths.map(path => pointsOf(path.getAttribute('d') ?? ''));

    for (const [index, path] of paths.entries()) {
      expect(path.getAttribute('d')?.endsWith('Z')).toBe(true);
      const points = shapes[index] ?? [];

      expect(points.at(-1)).toEqual(points[0]);
      expectMirrored(points, points[0]?.[0] ?? 0);
    }
    const big = shapes[0] ?? [];
    const small = shapes[1] ?? [];
    const gap = nearest(sampleCurves(outline?.getAttribute('d') ?? ''), sampleCurves(solid?.getAttribute('d') ?? ''));

    expect(Math.max(...small.map(([x]) => x)) - Math.min(...small.map(([x]) => x)))
      .toBeLessThan(Math.max(...big.map(([x]) => x)) - Math.min(...big.map(([x]) => x)));
    expect(gap - 0.625).toBeGreaterThanOrEqual(1.25);
  });
});
