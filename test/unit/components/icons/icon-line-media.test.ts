import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const document = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = document.querySelector('svg');

  if (svg === null || document.querySelector('parsererror') !== null) {
    throw new Error('Invalid SVG');
  }

  return svg;
};

const required = (element: Element, attribute: string): string => {
  const value = element.getAttribute(attribute);

  if (value === null) {
    throw new Error(`Missing ${attribute} on ${element.tagName}`);
  }

  return value;
};

type Point = [number, number];

interface Segment {
  cmd: string;
  from: Point;
  points: Point[];
  arc?: { rx: number; ry: number; large: number; sweep: number };
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Every command made absolute: H/V become L, S/T get their reflected control point.
const segmentsOf = (d: string): Segment[] => {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) ?? [];
  const out: Segment[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let cmd = '';
  let index = 0;

  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) {
      cmd = tokens[index];
      index += 1;
    }
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const args = tokens.slice(index, index + ARITY[upper]).map(Number);

    index += ARITY[upper];
    const at = (x: number, y: number): Point => relative ? [pen[0] + x, pen[1] + y] : [x, y];
    const previous = out[out.length - 1];
    const reflect = (): Point => {
      const control = previous !== undefined && ['C', 'Q'].includes(previous.cmd) ? previous.points[previous.points.length - 2] : pen;

      return [2 * pen[0] - control[0], 2 * pen[1] - control[1]];
    };
    let segment: Segment;

    switch (upper) {
      case 'M': segment = { cmd: 'M', from: pen, points: [at(args[0], args[1])] }; start = segment.points[0]; cmd = relative ? 'l' : 'L'; break;
      case 'L': segment = { cmd: 'L', from: pen, points: [at(args[0], args[1])] }; break;
      case 'H': segment = { cmd: 'L', from: pen, points: [[relative ? pen[0] + args[0] : args[0], pen[1]]] }; break;
      case 'V': segment = { cmd: 'L', from: pen, points: [[pen[0], relative ? pen[1] + args[0] : args[0]]] }; break;
      case 'C': segment = { cmd: 'C', from: pen, points: [at(args[0], args[1]), at(args[2], args[3]), at(args[4], args[5])] }; break;
      case 'S': segment = { cmd: 'C', from: pen, points: [reflect(), at(args[0], args[1]), at(args[2], args[3])] }; break;
      case 'Q': segment = { cmd: 'Q', from: pen, points: [at(args[0], args[1]), at(args[2], args[3])] }; break;
      case 'T': segment = { cmd: 'Q', from: pen, points: [reflect(), at(args[0], args[1])] }; break;
      case 'A': segment = { cmd: 'A', from: pen, points: [at(args[5], args[6])], arc: { rx: args[0], ry: args[1], large: args[3], sweep: args[4] } }; break;
      default: segment = { cmd: 'Z', from: pen, points: [start] };
    }
    out.push(segment);
    pen = segment.points[segment.points.length - 1];
  }

  return out;
};

const subpathsOf = (path: Element): Point[][] => segmentsOf(required(path, 'd')).reduce<Point[][]>((all, segment) => {
  if (segment.cmd === 'M') {
    all.push([]);
  }
  if (segment.cmd !== 'Z') {
    all[all.length - 1].push(segment.points[segment.points.length - 1]);
  }

  return all;
}, []);

const boxOf = (rect: Element): number[] => ['x', 'y', 'width', 'height', 'rx'].map((attribute) => Number(required(rect, attribute)));

const imageFrame = (): Element => {
  const frame = svgOf(Icons.IconImage).querySelector('rect');

  if (frame === null) {
    throw new Error('Missing image frame');
  }

  return frame;
};

// Keyline: neighbouring strokes keep one unit of clear space between their ink.
const CLEAR = 1;

/**
 * No icon is a rescaled copy of another any more. The overlay family exists
 * only to be CSS-sized; a drawing that also exists at 20 units is imported
 * from there instead of redrawn here.
 */
const overlayIcons = {
  IconImageBroken: Icons.IconImageBroken,
  IconUploadFailed: Icons.IconUploadFailed,
  IconLinkExternal: Icons.IconLinkExternal,
  IconArrowDownLine: Icons.IconArrowDownLine,
};

describe('Blok Line media family', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(overlayIcons))('%s retains CSS sizing and uses the same optical stroke as menu icons', (_name, icon) => {
    const svg = svgOf(icon);

    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.hasAttribute('width')).toBe(false);
    expect(svg.hasAttribute('height')).toBe(false);

    for (const shape of Array.from(svg.children)) {
      const stroke = shape.getAttribute('stroke') ?? svg.getAttribute('stroke');

      if (stroke === null || stroke === 'none') {
        continue;
      }

      expect(shape.getAttribute('stroke')).toBe('currentColor');
      expect(Number(required(shape, 'stroke-width')) / 24).toBe(1.25 / 20);
      expect(shape.getAttribute('stroke-linecap') ?? svg.getAttribute('stroke-linecap')).toBe('round');
      expect(shape.getAttribute('stroke-linejoin') ?? svg.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it.each([
    ['video', Icons.IconVideo],
  ])('%s uses the image family frame', (_name, icon) => {
    const frame = svgOf(icon).querySelector('rect');

    expect(frame).not.toBeNull();

    if (frame === null) {
      return;
    }

    expect(boxOf(frame)).toEqual(boxOf(imageFrame()));
  });

  it('floats a small window inside the image frame, clear of its inline-end and bottom edges', () => {
    const svg = svgOf(Icons.IconPlayerPip);
    const [frame, window] = Array.from(svg.querySelectorAll('rect'));

    if (frame === undefined || window === undefined) {
      throw new Error('Missing picture-in-picture parts');
    }

    const [frameX, frameY, frameWidth, frameHeight] = boxOf(frame);
    const [x, y, width, height] = boxOf(window);
    const stroke = Number(required(frame, 'stroke-width'));

    expect(svg.children).toHaveLength(2);
    expect(boxOf(frame)).toEqual(boxOf(imageFrame()));
    expect(window.getAttribute('rx')).toBe('1');
    expect(window.getAttribute('stroke')).toBe('currentColor');
    expect(window.getAttribute('fill')).toBeNull();
    // The window sits in the bottom-right quarter, one Keyline gap inside the frame.
    expect(x + width / 2).toBeGreaterThan(frameX + frameWidth / 2);
    expect(y + height / 2).toBeGreaterThan(frameY + frameHeight / 2);
    expect(frameX + frameWidth - (x + width) - stroke).toBeGreaterThanOrEqual(CLEAR);
    expect(frameY + frameHeight - (y + height) - stroke).toBeGreaterThanOrEqual(CLEAR);
  });

  it('slides one outlined block between two text lines to show alignment', () => {
    const icons = [Icons.IconAlignLeft, Icons.IconAlignCenter, Icons.IconAlignRight].map(icon => svgOf(icon));
    const stroke = 1.25;
    const blocks = icons.map((svg) => {
      const rects = Array.from(svg.querySelectorAll('rect'));

      expect(rects).toHaveLength(1);
      expect(rects[0].getAttribute('fill')).toBeNull();
      expect(required(rects[0], 'stroke')).toBe('currentColor');
      expect(Number(required(rects[0], 'stroke-width'))).toBe(stroke);

      return ['x', 'y', 'width', 'height', 'rx'].map(name => Number(required(rects[0], name)));
    });

    // Left edge, centre and right edge of the text lines (x 3.5 to 16.5).
    expect(blocks[0][0]).toBe(3.5);
    expect(blocks[1][0] + blocks[1][2] / 2).toBe(10);
    expect(blocks[2][0] + blocks[2][2]).toBe(16.5);
    blocks.forEach(block => expect(block.slice(1)).toEqual(blocks[0].slice(1)));

    icons.forEach((svg) => {
      expect(svg.querySelectorAll('[fill="currentColor"]')).toHaveLength(0);
      expect(Array.from(svg.querySelectorAll('path'), path => path.getAttribute('d'))).toEqual(['M3.5 4.5h13M3.5 15.5h13']);
    });

    const [, y, , height] = blocks[0];

    expect(y - stroke / 2 - (4.5 + stroke / 2)).toBeGreaterThanOrEqual(stroke);
    expect(15.5 - stroke / 2 - (y + height + stroke / 2)).toBeGreaterThanOrEqual(stroke);
  });

  it('points the theater arrows outward from the centre of the wide screen', () => {
    const svg = svgOf(Icons.IconPlayerTheater);
    const screen = svg.querySelector('rect');
    const arrows = svg.querySelector('path');

    if (screen === null || arrows === null) {
      throw new Error('Missing theater parts');
    }

    const [, y, width, height] = ['x', 'y', 'width', 'height'].map(name => Number(required(screen, name)));

    expect(width).toBeGreaterThan(height * 1.5);
    expect(y + height / 2).toBe(10);
    expect(required(arrows, 'd')).toBe('M8.5 10h-3M7 8.5 5.5 10 7 11.5M11.5 10h3M13 8.5l1.5 1.5-1.5 1.5');
  });

  it('slides two pieces of IconImage apart and keeps them inside the overlay drawing area', () => {
    const broken = svgOf(Icons.IconImageBroken);
    const [left, right] = Array.from(broken.querySelectorAll('path'))
      .map(path => required(path, 'd'))
      .filter(d => d.endsWith('Z'));
    const sun = broken.querySelector('circle');
    const piece = /^M([\d.]+) ([\d.]+)H([\d.]+)a([\d.]+) \4 0 0 [01] ?-?\4 \4v([\d.]+)a\4 \4 0 0 [01] ?-?\4 \4H([\d.]+)l([^Z]+)Z$/;
    const leftParts = left?.match(piece)?.slice(1);
    const rightParts = right?.match(piece)?.slice(1);

    if (leftParts === undefined || rightParts === undefined || sun === null) {
      throw new Error('Missing broken image pieces');
    }

    const [leftTopX, top, leftCornerX, radius, side] = leftParts.map(Number);
    const [rightTopX, rightTop, rightCornerX] = rightParts.map(Number);
    const bottom = top + side + 2 * radius;
    const crack = (leftParts[6].match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);
    const slide = rightTopX - leftTopX;
    const stroke = 1.5;

    // The pieces are IconImage scaled to fit: its 14×12 panel and radius 2 keep their proportions.
    expect(radius / (bottom - top)).toBeCloseTo(2 / 12, 2);
    // Both pieces stay inside the overlay drawing area, 3.6–20.4.
    expect(leftCornerX - radius).toBeGreaterThanOrEqual(3.6 - 0.01);
    expect(rightCornerX + radius).toBeLessThanOrEqual(20.4 + 0.01);
    expect(rightTop).toBe(top);
    expect(top + bottom).toBeCloseTo(24, 1);
    // Across every crack segment the slide leaves a full stroke of space between the pieces.
    for (let index = 0; index < crack.length; index += 2) {
      const [dx, dy] = [crack[index], crack[index + 1]];

      expect(slide * Math.abs(dy) / Math.hypot(dx, dy) - stroke).toBeGreaterThanOrEqual(stroke - 0.05);
    }
    // The sun is IconImage's accent at the same scale, which keeps it a stroke clear of the crack and the edge.
    expect(Number(sun.getAttribute('r'))).toBeCloseTo(0.85 * radius / 2, 2);
  });


  it('breaks the image into two pieces along one crack, so the pieces fit back together', () => {
    const pieces = Array.from(svgOf(Icons.IconImageBroken).querySelectorAll('path'))
      .map(path => required(path, 'd'))
      .filter(d => d.endsWith('Z'));

    expect(pieces).toHaveLength(2);
    expect(pieces[0].match(/l[^Z]+Z$/)?.[0]).toBe(pieces[1].match(/l[^Z]+Z$/)?.[0]);
  });


  it('separates one left-aligned caption from the panel and its sun from the ridge', () => {
    const svg = svgOf(Icons.IconCaption);
    const frame = svg.querySelector('rect');
    const sun = svg.querySelector('circle');
    const paths = Array.from(svg.querySelectorAll('path'));
    const image = svgOf(Icons.IconImage);
    const imageSun = image.querySelector('circle');
    const imageRidge = image.querySelector('path');

    expect(paths).toHaveLength(2);

    if (frame === null || sun === null || imageSun === null || imageRidge === null) {
      throw new Error('Missing caption image');
    }

    const ridges = subpathsOf(paths[0]);
    const [[captionStart, captionEnd], ...extra] = subpathsOf(paths[1]);
    const [frameX, frameTop, frameWidth, frameHeight, frameRadius] = boxOf(frame);
    const sunX = Number(required(sun, 'cx'));
    const sunY = Number(required(sun, 'cy'));
    const sunRadius = Number(required(sun, 'r'));

    expect(extra).toHaveLength(0);
    expect(captionStart[0]).toBe(frameX);
    expect(captionStart[1]).toBe(captionEnd[1]);
    expect(captionStart[1] - (frameTop + frameHeight) - 1.25).toBeGreaterThanOrEqual(1.5);
    expect(captionEnd[0] - captionStart[0]).toBeLessThan(frameWidth);
    // A shorter IconImage: same frame width and radius, same accent sun, same 45-degree hills.
    expect([frameX, frameWidth, frameRadius]).toEqual([0, 2, 4].map((index) => boxOf(imageFrame())[index]));
    expect(sunRadius).toBe(Number(required(imageSun, 'r')));
    expect(sun.getAttribute('fill')).toBe(imageSun.getAttribute('fill'));
    [...ridges, ...subpathsOf(imageRidge)].forEach((ridge) => {
      ridge.slice(1).forEach(([x, y], index) => {
        expect(Math.abs(x - ridge[index][0])).toBeCloseTo(Math.abs(y - ridge[index][1]), 5);
      });
    });
    expect(ridges[0][0][0]).toBe(frameX);
    // One Keyline gap between the sun and the panel top.
    expect(sunY - sunRadius - (frameTop + 1.25 / 2)).toBeGreaterThanOrEqual(CLEAR);

    ridges.forEach((ridge) => {
      for (let index = 1; index < ridge.length; index++) {
        const [startX, startY] = ridge[index - 1];
        const dx = ridge[index][0] - startX;
        const dy = ridge[index][1] - startY;
        const projection = Math.max(0, Math.min(1, ((sunX - startX) * dx + (sunY - startY) * dy) / (dx * dx + dy * dy)));
        const distance = Math.hypot(sunX - startX - projection * dx, sunY - startY - projection * dy);

        expect(distance - sunRadius - 1.25 / 2).toBeGreaterThanOrEqual(CLEAR);
      }
    });
  });

  it('draws download as the Keyline arrow over a rounded tray, with clear bottom spacing', () => {
    const path = svgOf(Icons.IconDownload).querySelector('path');

    if (path === null) {
      throw new Error('Missing download path');
    }

    const d = required(path, 'd');
    const [shaft, head, tray] = subpathsOf(path);
    const [, tip] = shaft;

    // src/tools/file/ui.ts splits this one path at the tray's move command.
    expect(d.split('M3.5 13')).toHaveLength(2);
    expect(tray[0]).toEqual([3.5, 13]);
    // Keyline arrowhead: 3.5 arms meeting at the shaft's end.
    expect(head).toEqual([[tip[0] - 3.5, tip[1] - 3.5], tip, [tip[0] + 3.5, tip[1] - 3.5]]);

    const trayBottomY = Math.max(...tray.map(([, y]) => y));

    expect(trayBottomY - tip[1] - Number(required(path, 'stroke-width'))).toBeGreaterThanOrEqual(2.5);
  });

  it('shares the page frame and fold between the generic file and document glyphs', () => {
    const pages = [Icons.IconFile, Icons.IconFileDoc].map((icon) =>
      Array.from(svgOf(icon).querySelectorAll('path'), (path) => required(path, 'd')));

    expect(pages[1].slice(0, 2)).toEqual(pages[0].slice(0, 2));

    const frame = svgOf(Icons.IconFile).querySelector('path');

    if (frame === null) {
      throw new Error('Missing page frame');
    }

    const corners = segmentsOf(required(frame, 'd')).filter(({ cmd }) => cmd === 'A');

    expect(corners).toHaveLength(3);
    expect(corners.map(({ arc }) => [arc?.rx, arc?.ry])).toEqual([[2, 2], [2, 2], [2, 2]]);
  });

  it.each([
    ['sheet', Icons.IconFileSheet],
    ['slides', Icons.IconFileSlides],
    ['archive', Icons.IconFileArchive],
  ])('%s keeps the folded file frame and a family-cornered inset mark', (_name, icon) => {
    const svg = svgOf(icon);
    const file = Array.from(svgOf(Icons.IconFile).querySelectorAll('path'), (path) => required(path, 'd'));
    const rectangles = Array.from(svg.querySelectorAll('rect'));

    expect(Array.from(svg.querySelectorAll('path'), (path) => required(path, 'd')).slice(0, 2)).toEqual(file);
    expect(rectangles).toHaveLength(1);
    expect(rectangles[0].getAttribute('rx')).toBe('1');
  });

  it('theater retains its wide screen with the image frame corners', () => {
    const screen = svgOf(Icons.IconPlayerTheater).querySelector('rect');

    expect(screen?.getAttribute('rx')).toBe(imageFrame().getAttribute('rx'));
  });

  it('keeps speaker outlines identical between audible and muted states', () => {
    const speakers = [Icons.IconPlayerVolume, Icons.IconPlayerVolumeMute].map((icon) =>
      svgOf(icon).querySelector('path'));

    expect(speakers[0]?.getAttribute('d')).toBe(speakers[1]?.getAttribute('d'));
    speakers.forEach((speaker) => {
      expect(speaker?.getAttribute('fill')).not.toBe('currentColor');
      expect(speaker?.getAttribute('stroke')).toBe('currentColor');
      expect(speaker?.getAttribute('stroke-width')).toBe('1.25');
    });
  });

  describe('player settings gear', () => {
    const gear = (): { rim: Element; hub: Element } => {
      const svg = svgOf(Icons.IconPlayerSettings);
      const [rim] = Array.from(svg.querySelectorAll('path'));
      const [hub] = Array.from(svg.querySelectorAll('circle'));

      return { rim, hub };
    };
    /** Where each straight or curved stroke of the rim ends, as distance and angle from the middle. */
    const corners = (): { radius: number; angle: number }[] =>
      segmentsOf(required(gear().rim, 'd'))
        // The start point is also where the last curve ends, so it is not counted twice.
        .filter(({ cmd }) => cmd !== 'Z' && cmd !== 'M')
        .map(({ points }) => {
          const [x, y] = points[points.length - 1];

          return { radius: Math.hypot(x - 10, y - 10), angle: (Math.atan2(y - 10, x - 10) * 180 / Math.PI + 450) % 360 };
        });

    it('is one rim and one hub, nothing else', () => {
      const svg = svgOf(Icons.IconPlayerSettings);

      expect(svg.querySelectorAll('path')).toHaveLength(1);
      expect(svg.querySelectorAll('circle')).toHaveLength(1);
      expect(svg.children).toHaveLength(2);
    });

    it('has six teeth: twelve corners on the tip circle and twelve on the root circle', () => {
      const tips = corners().filter(({ radius }) => Math.abs(radius - 7) < 0.02);
      const roots = corners().filter(({ radius }) => Math.abs(radius - 5) < 0.02);

      expect(tips).toHaveLength(12);
      expect(roots).toHaveLength(12);
      expect(corners()).toHaveLength(24);
    });

    it('spaces the teeth evenly, a sixth of a turn apart, with one pointing straight up', () => {
      const tips = corners().filter(({ radius }) => Math.abs(radius - 7) < 0.02).map(({ angle }) => angle).sort((a, b) => a - b);
      // Each tooth is 20 degrees wide at the tip: its two corners sit 10 either side of its middle.
      const middles = [0, 60, 120, 180, 240, 300];
      const expected = middles.flatMap((middle) => [(middle + 350) % 360, (middle + 10) % 360]).sort((a, b) => a - b);

      tips.forEach((angle, index) => {
        expect(Math.abs(angle - expected[index])).toBeLessThan(0.5);
      });
    });

    it('makes each tooth wider at the root than at the tip', () => {
      const widths = (radius: number): number[] => {
        const angles = corners().filter((corner) => Math.abs(corner.radius - radius) < 0.02).map(({ angle }) => angle);

        // The pair around 0 degrees wraps, so measure the pair around 60.
        return angles.filter((angle) => angle > 30 && angle < 90).sort((a, b) => a - b);
      };
      const [tipStart, tipEnd] = widths(7);
      const [rootStart, rootEnd] = widths(5);

      expect(tipEnd - tipStart).toBeCloseTo(20, 0);
      expect(rootEnd - rootStart).toBeCloseTo(32, 0);
    });

    it('stays inside the 3 to 17 content box', () => {
      corners().forEach(({ radius }) => expect(radius).toBeLessThanOrEqual(7.01));
    });

    it('centres the hub and leaves a full stroke of clear space between it and the rim', () => {
      const { hub } = gear();
      const radius = Number(required(hub, 'r'));

      expect([required(hub, 'cx'), required(hub, 'cy')]).toEqual(['10', '10']);
      expect(radius).toBe(2.25);
      // Root circle 5 and hub 2.25, each losing half a stroke to its own line.
      expect(5 - radius - 1.25).toBeGreaterThanOrEqual(1.25);
    });
  });
});
