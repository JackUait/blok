import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(icon, 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Missing SVG');
  }

  return svg;
};

const numbers = (element: Element, attribute = 'd'): number[] =>
  (element.getAttribute(attribute)?.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

describe('Blok Line media completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crop leaves a clear break at both crossing rails', () => {
    const scale = 1;
    const paths = Array.from(svgOf(Icons.IconCrop).querySelectorAll('path'));

    expect(paths).toHaveLength(4);

    const vertical = numbers(paths[0]);
    const upperCorner = numbers(paths[1]);
    const lowerTail = numbers(paths[3]);
    const stroke = Number(paths[0].getAttribute('stroke-width'));

    expect(upperCorner[0] - vertical[0] - stroke).toBeGreaterThanOrEqual(stroke);
    expect(lowerTail[1] - upperCorner[upperCorner.length - 1] - stroke).toBeGreaterThanOrEqual(stroke);
    for (const path of paths.slice(0, 2)) {
      const radii = path.getAttribute('d')?.match(/a([\d.]+) ([\d.]+)/);

      expect(radii?.slice(1).map(Number)).toEqual([scale, scale]);
    }
  });

  it('reverses four equal fullscreen corners without adding diagonal shafts', () => {
    const expanded = Array.from(svgOf(Icons.IconExpandFullscreen).querySelectorAll('path'));
    const contracted = Array.from(svgOf(Icons.IconCollapseFullscreen).querySelectorAll('path'));

    expect(expanded).toHaveLength(4);
    expect(contracted).toHaveLength(4);
    expanded.forEach((path, index) => {
      const points = numbers(path);
      const x = points.filter((_value, position) => position % 2 === 0);
      const y = points.filter((_value, position) => position % 2 === 1);
      const sums = [Math.min(...x) + Math.max(...x), Math.min(...y) + Math.max(...y)];

      expect(points).toHaveLength(6);
      expect(Math.max(...x) - Math.min(...x)).toBe(Math.max(...y) - Math.min(...y));
      expect(numbers(contracted[index])).toEqual(points.map((value, position) => sums[position % 2] - value));
    });
  });

  it('mirrors filled seek triangles with a full stroke of space between them', () => {
    const forward = Array.from(svgOf(Icons.IconPlayerForward).querySelectorAll('path'));
    const backward = Array.from(svgOf(Icons.IconPlayerBackward).querySelectorAll('path'));

    expect(forward).toHaveLength(2);
    expect(backward).toHaveLength(2);

    const first = numbers(forward[0]);
    const second = numbers(forward[1]);
    const stroke = Number(forward[0].getAttribute('stroke-width'));

    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect(Math.min(second[0], second[2], second[4]) - Math.max(first[0], first[2], first[4]) - stroke)
      .toBeGreaterThanOrEqual(stroke);
    forward.forEach((path, index) => {
      const points = numbers(path);

      expect(path.getAttribute('fill')).toBe('currentColor');
      expect(backward[index].getAttribute('fill')).toBe('currentColor');
      expect(numbers(backward[index])).toEqual(points.map((value, position) => position % 2 === 0 ? 20 - value : value));
    });
  });

  it('balances the filled pause bars against the play outline weight', () => {
    const play = svgOf(Icons.IconPlayerPlay).querySelector('path');
    const bars = Array.from(svgOf(Icons.IconPlayerPause).querySelectorAll('rect'));

    expect(play?.getAttribute('stroke-width')).toBe('1.25');
    expect(play?.getAttribute('fill')).toBe('currentColor');
    expect(bars).toHaveLength(2);
    const width = Number(bars[0].getAttribute('width'));
    const height = Number(bars[0].getAttribute('height'));

    expect(width).toBe(2 * Number(play?.getAttribute('stroke-width')));
    expect(Number(bars[0].getAttribute('x')) + Number(bars[1].getAttribute('x')) + width).toBe(20);
    bars.forEach(bar => {
      expect(Number(bar.getAttribute('y')) + height / 2).toBe(10);
      expect(Number(bar.getAttribute('width'))).toBe(width);
      expect(Number(bar.getAttribute('height'))).toBe(height);
      expect(bar.getAttribute('rx')).toBe('1');
    });
  });

  it('shares an open speaker mouth with space before either sound or mute marks', () => {
    const audible = Array.from(svgOf(Icons.IconPlayerVolume).querySelectorAll('path'));
    const muted = Array.from(svgOf(Icons.IconPlayerVolumeMute).querySelectorAll('path'));
    const speaker = audible[0].getAttribute('d') ?? '';
    const mouth = numbers(audible[0])[0];
    const stroke = Number(audible[0].getAttribute('stroke-width'));

    expect(speaker).not.toMatch(/z/i);
    expect(muted[0].getAttribute('d')).toBe(speaker);
    expect(speaker.match(/a1 1/g)).toHaveLength(2);
    for (const mark of [audible[1], muted[1]]) {
      expect(numbers(mark)[0] - mouth - stroke).toBeGreaterThanOrEqual(stroke);
    }
  });

  it('centers the speed needle on its circular dial and uses the image accent size', () => {
    const speed = svgOf(Icons.IconPlayerSpeed);
    const dial = speed.querySelector('path');
    const hub = speed.querySelector('circle');
    const imageAccent = svgOf(Icons.IconImage).querySelector('circle');

    expect(hub?.getAttribute('r')).toBe(imageAccent?.getAttribute('r'));

    if (dial === null || hub === null) {
      throw new Error('Missing speed dial');
    }

    const [x, y, radius, , , , , chord] = numbers(dial);
    const centerX = x + chord / 2;
    const centerY = y - Math.sqrt(radius * radius - chord * chord / 4);

    expect(Number(hub.getAttribute('cx'))).toBeCloseTo(centerX, 5);
    expect(Number(hub.getAttribute('cy'))).toBeCloseTo(centerY, 5);
    expect([centerX, centerY]).toEqual([10, 10]);
  });

  it('gives the loop matching panel radii and rotationally equal arrowheads', () => {
    const paths = Array.from(svgOf(Icons.IconPlayerLoop).querySelectorAll('path'));
    const panelRadius = svgOf(Icons.IconImage).querySelector('rect')?.getAttribute('rx');

    for (const path of [paths[0], paths[2]]) {
      const radii = path.getAttribute('d')?.match(/[aA]([\d.]+) ([\d.]+)/);

      expect(radii?.slice(1)).toEqual([panelRadius, panelRadius]);
    }
    const top = numbers(paths[1]);
    const bottom = numbers(paths[3]);

    expect(top).toHaveLength(6);
    expect(bottom).toEqual(top.map(value => 20 - value));
    expect(Math.abs(top[2] - top[0])).toBe(Math.abs(top[3] - top[1]));
  });

  it('keeps music noteheads equal and both stems parallel to the beam spacing', () => {
    const svg = svgOf(Icons.IconMusic);
    const heads = Array.from(svg.querySelectorAll('ellipse'));
    const beam = svg.querySelector('path');

    expect(heads).toHaveLength(2);

    if (beam === null) {
      throw new Error('Missing music beam');
    }

    const [leftX, leftBottom, leftTop, rightX, rightTop, rightBottom] = numbers(beam);

    expect(leftBottom - leftTop).toBe(rightBottom - rightTop);
    expect(Number(heads[0].getAttribute('cy')) - Number(heads[1].getAttribute('cy'))).toBe(leftTop - rightTop);
    heads.forEach((head, index) => {
      expect(head.getAttribute('rx')).toBe(heads[0].getAttribute('rx'));
      expect(head.getAttribute('ry')).toBe(heads[0].getAttribute('ry'));
      expect(head.getAttribute('fill')).toBe('currentColor');
      expect(Number(head.getAttribute('cx')) + Number(head.getAttribute('rx'))).toBe(index === 0 ? leftX : rightX);
      expect(Number(head.getAttribute('cy'))).toBe(index === 0 ? leftBottom : rightBottom);
    });
  });

  it('puts the upload failure cross in the cloud opening instead of slashing through it', () => {
    const paths = Array.from(svgOf(Icons.IconUploadFailed).querySelectorAll('path'));

    expect(paths).toHaveLength(2);

    const cloud = numbers(paths[0]);
    const cross = numbers(paths[1]);
    const stroke = Number(paths[0].getAttribute('stroke-width'));
    const leftEdge = cloud[0];
    const rightEdge = 24 - leftEdge;
    const x = cross.filter((_value, index) => index % 2 === 0);

    expect(cross).toHaveLength(8);
    expect(Math.min(...x) - leftEdge).toBeGreaterThan(stroke);
    expect(rightEdge - Math.max(...x)).toBeGreaterThan(stroke);
    expect(Math.hypot(Math.min(...x) - leftEdge, cross[1] - cloud[1]) - stroke).toBeGreaterThanOrEqual(stroke);
    expect(Math.hypot(rightEdge - Math.max(...x), cross[3] - cloud[1]) - stroke).toBeGreaterThanOrEqual(stroke);
    expect(cross[0] + cross[2]).toBe(24);
    expect(cross[1]).toBe(cross[5]);
    expect(cross[3]).toBe(cross[7]);
  });
});
