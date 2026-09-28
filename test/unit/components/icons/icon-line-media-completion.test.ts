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

  it('shares a closed speaker cone with space before either sound or mute marks', () => {
    const audible = Array.from(svgOf(Icons.IconPlayerVolume).querySelectorAll('path'));
    const muted = Array.from(svgOf(Icons.IconPlayerVolumeMute).querySelectorAll('path'));
    const speaker = audible[0].getAttribute('d') ?? '';
    const mouth = numbers(audible[0])[0];
    const stroke = Number(audible[0].getAttribute('stroke-width'));

    expect(speaker).toMatch(/z$/i);
    expect(muted[0].getAttribute('d')).toBe(speaker);
    expect(speaker.match(/a1 1/g)).toHaveLength(2);
    for (const mark of [audible[1], muted[1]]) {
      expect(numbers(mark)[0] - mouth - stroke).toBeGreaterThanOrEqual(stroke);
    }
  });

  it('splits the speed dial into equal segments around the needle hub, sized like the image accent', () => {
    const speed = svgOf(Icons.IconPlayerSpeed);
    const [dial, needle] = Array.from(speed.querySelectorAll('path'));
    const hub = speed.querySelector('circle');
    const imageAccent = svgOf(Icons.IconImage).querySelector('circle');

    if (dial === undefined || needle === undefined || hub === null) {
      throw new Error('Missing speed dial');
    }
    expect(hub.getAttribute('r')).toBe(imageAccent?.getAttribute('r'));

    const center = [Number(hub.getAttribute('cx')), Number(hub.getAttribute('cy'))];
    const segments = (dial.getAttribute('d') ?? '').split(/(?=M)/).map(part => part.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? []);
    const angle = ([x, y]: number[]): number => Math.atan2(y - center[1], x - center[0]);
    const sweeps = segments.map(([x1, y1, radius, , , , , x2, y2]) => {
      expect(Math.hypot(x1 - center[0], y1 - center[1])).toBeCloseTo(radius, 1);
      expect(Math.hypot(x2 - center[0], y2 - center[1])).toBeCloseTo(radius, 1);

      return [angle([x1, y1]), angle([x2, y2])];
    });
    const lengths = sweeps.map(([from, to]) => (to - from + 2 * Math.PI) % (2 * Math.PI));
    const gaps = sweeps.slice(1).map(([from], index) => (from - sweeps[index][1] + 2 * Math.PI) % (2 * Math.PI));
    const [first] = segments;
    const last = segments[segments.length - 1];

    expect(segments).toHaveLength(3);
    lengths.forEach(length => expect(length).toBeCloseTo(lengths[0], 2));
    expect(gaps[0]).toBeCloseTo(gaps[1], 2);
    // A gap must survive at 16px: its chord, minus one stroke, stays over half a pixel.
    expect((2 * first[2] * Math.sin(gaps[0] / 2) - 1.25) * 16 / 20).toBeGreaterThan(0.5);
    expect(first[0] + last[7]).toBeCloseTo(20, 5);
    // The dial opens at the bottom, so centre the visible arc, not the hub.
    expect((center[1] - first[2] + first[1]) / 2).toBeCloseTo(10, 5);
    expect(numbers(needle).slice(0, 2)).toEqual(center);
    // The needle tip stays a full stroke inside the dial.
    expect(first[2] - Math.hypot(numbers(needle)[2] - center[0], numbers(needle)[3] - center[1]) - 1.25).toBeGreaterThanOrEqual(1.25);
  });


  it('draws the loop as a racetrack whose arrowheads chase each other with a clear gap', () => {
    const [firstTrack, firstHead, secondTrack, secondHead] = Array.from(svgOf(Icons.IconPlayerLoop).querySelectorAll('path'));
    const track = numbers(firstTrack);
    const head = numbers(firstHead);
    const stroke = Number(firstTrack.getAttribute('stroke-width'));

    expect(track).toHaveLength(10);
    // Semicircular ends: the arc radius is half the track height.
    expect(track[2]).toBe(-track[8] / 2);
    expect(numbers(secondHead)).toEqual(head.map(value => 20 - value));
    expect(numbers(secondTrack).slice(0, 2)).toEqual(track.slice(0, 2).map(value => 20 - value));
    expect(numbers(secondTrack).slice(2)).toEqual([...track.slice(2, 7), ...track.slice(7).map(value => 0 - value)]);

    const tip = [track[0] + track[7] + track[9], track[1] + track[8]];
    const nextTrackStart = 20 - track[0];

    expect(head.slice(2, 4)).toEqual(tip);
    expect(head[4] - head[0]).toBe(0);
    // The two inner arms, one above the other at the centre, stay a stroke apart.
    expect(Math.hypot(numbers(secondHead)[4] - head[4], numbers(secondHead)[5] - head[5]) - stroke).toBeGreaterThanOrEqual(stroke);
    expect(nextTrackStart - tip[0] - stroke).toBeGreaterThanOrEqual(stroke);
    // The rounded ends stay inside the 3–17 drawing area.
    expect(track[0] - track[2]).toBeGreaterThanOrEqual(3);
    expect(nextTrackStart + track[2]).toBeLessThanOrEqual(17);
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

  it('cuts the cloud open around a round badge that carries the failure cross', () => {
    const svg = svgOf(Icons.IconUploadFailed);
    const [cloud, cross] = Array.from(svg.querySelectorAll('path'));
    const badge = svg.querySelector('circle');

    if (cloud === undefined || cross === undefined || badge === null) {
      throw new Error('Missing upload failure parts');
    }

    const stroke = Number(cloud.getAttribute('stroke-width'));
    const [cx, cy, radius] = ['cx', 'cy', 'r'].map(name => Number(badge.getAttribute(name)));
    const commands = Array.from((cloud.getAttribute('d') ?? '').matchAll(/([MHa])([^MHa]*)/g));
    const ends: number[][] = [];
    let point = [0, 0];

    for (const [, command, args] of commands) {
      const values = args.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];

      if (command === 'M') {
        point = values;
      } else if (command === 'H') {
        point = [values[0], point[1]];
      } else {
        point = [point[0] + values[5], point[1] + values[6]];
      }
      ends.push(point);
    }

    const crossPoints = cross.getAttribute('d')?.split(/(?=M)/).map(part => part.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? []) ?? [];

    expect(badge.getAttribute('stroke')).toBe('currentColor');
    expect(badge.getAttribute('stroke-width')).toBe(String(stroke));
    // Both open ends of the cloud stop a full stroke short of the badge.
    for (const [x, y] of [ends[0], ends[ends.length - 1]]) {
      expect(Math.hypot(x - cx, y - cy) - radius - stroke).toBeGreaterThanOrEqual(stroke);
    }
    // The badge stays inside the overlay drawing area (3–17 at 20 units = 3.6–20.4 here).
    expect(cy + radius).toBeLessThanOrEqual(20.4);
    expect(cx + radius).toBeLessThanOrEqual(20.4);
    for (const [x, y, dx, dy] of crossPoints) {
      expect(x + dx / 2).toBeCloseTo(cx, 5);
      expect(y + dy / 2).toBeCloseTo(cy, 5);
      // A full stroke of space between the cross and the badge ring.
      expect(Math.hypot(dx, dy) / 2 + stroke / 2 + stroke).toBeLessThanOrEqual(radius - stroke / 2 + 1e-9);
    }
  });

});
