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

const commands = (path: Element): { command: string; values: number[] }[] =>
  Array.from(required(path, 'd').matchAll(/([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi), (match) => ({
    command: match[1],
    values: (match[2].match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number),
  }));

const pointsOf = (path: Element): { x: number; y: number }[] => {
  let x = 0;
  let y = 0;
  const points: { x: number; y: number }[] = [];

  commands(path).forEach(({ command, values }) => {
    const relative = command === command.toLowerCase();

    for (let index = 0; index < values.length;) {
      const horizontal = command.toUpperCase() === 'H';
      const vertical = command.toUpperCase() === 'V';

      if (horizontal) {
        x = values[index] + (relative ? x : 0);
      } else if (vertical) {
        y = values[index] + (relative ? y : 0);
      } else {
        x = values[index] + (relative ? x : 0);
        y = values[index + 1] + (relative ? y : 0);
      }

      points.push({ x, y });
      index += horizontal || vertical ? 1 : 2;
    }
  });

  return points;
};

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

    expect(['x', 'y', 'width', 'height', 'rx'].map((attribute) => Number(required(frame, attribute))))
      .toEqual([3, 4, 14, 12, 2]);
  });

  it('opens the picture-in-picture frame corner around a floating window', () => {
    const svg = svgOf(Icons.IconPlayerPip);
    const frame = svg.querySelector('path');
    const window = svg.querySelector('rect');

    if (frame === null || window === null) {
      throw new Error('Missing picture-in-picture parts');
    }

    const outline = required(frame, 'd').match(/^M17 ([\d.]+)V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h([\d.]+)$/);
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map(name => Number(required(window, name)));
    const stroke = Number(required(frame, 'stroke-width'));

    // The image-family panel (x 3–17, y 4–16, radius 2) with its bottom-right corner left open.
    expect(outline).not.toBeNull();

    const rightEndY = Number(outline?.[1]);
    const bottomEndX = 5 + Number(outline?.[2]);

    expect(window.getAttribute('rx')).toBe('1');
    expect(window.getAttribute('stroke')).toBe('currentColor');
    expect(window.getAttribute('fill')).toBeNull();
    // The window fills the open corner up to the panel edge, and both open ends clear it by a stroke.
    expect(x + width).toBe(17);
    expect(y + height).toBe(16);
    expect(y - rightEndY - stroke).toBeGreaterThanOrEqual(stroke);
    expect(x - bottomEndX - stroke).toBeGreaterThanOrEqual(stroke);
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

    expect(paths).toHaveLength(2);

    if (frame === null || sun === null) {
      throw new Error('Missing caption image');
    }

    const ridge = pointsOf(paths[0]);
    const caption = pointsOf(paths[1]);
    const captionStart = caption[0];
    const captionEnd = caption[1];
    const frameBottom = Number(required(frame, 'y')) + Number(required(frame, 'height'));
    const sunX = Number(required(sun, 'cx'));
    const sunY = Number(required(sun, 'cy'));
    const sunRadius = Number(required(sun, 'r'));

    expect(caption).toHaveLength(2);
    expect(captionStart.x).toBe(Number(required(frame, 'x')));
    expect(captionStart.y).toBe(captionEnd.y);
    expect(captionStart.y - frameBottom - 1.25).toBeGreaterThanOrEqual(1.5);
    expect(captionEnd.x - captionStart.x).toBeLessThan(Number(required(frame, 'width')));
    expect(Number(required(frame, 'rx'))).toBe(2);
    expect(sunRadius).toBe(0.85);
    const image = svgOf(Icons.IconImage);
    const imageFrame = image.querySelector('rect');
    const imageSun = image.querySelector('circle');
    const imageRidge = image.querySelector('path');

    if (imageFrame === null || imageSun === null || imageRidge === null) {
      throw new Error('Missing image landscape');
    }

    // The same landscape as IconImage, squeezed into the shorter panel so the sun keeps its clearance.
    const imageTop = Number(required(imageFrame, 'y'));
    const frameTop = Number(required(frame, 'y'));
    const squeeze = Number(required(frame, 'height')) / Number(required(imageFrame, 'height'));
    const toCaption = (y: number): number => frameTop + (y - imageTop) * squeeze;

    pointsOf(imageRidge).forEach(({ x, y }, index) => {
      expect(ridge[index].x).toBe(x);
      expect(ridge[index].y).toBeCloseTo(toCaption(y), 2);
    });
    expect(sunX).toBe(Number(required(imageSun, 'cx')));
    expect(sunY).toBeCloseTo(toCaption(Number(required(imageSun, 'cy'))), 2);
    // A full stroke between the sun and the panel top.
    expect(sunY - sunRadius - (frameTop + 1.25 / 2)).toBeGreaterThanOrEqual(1.25);

    for (let index = 1; index < ridge.length; index++) {
      const start = ridge[index - 1];
      const end = ridge[index];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const projection = Math.max(0, Math.min(1, ((sunX - start.x) * dx + (sunY - start.y) * dy) / (dx * dx + dy * dy)));
      const distance = Math.hypot(sunX - start.x - projection * dx, sunY - start.y - projection * dy);

      expect(distance - sunRadius - 1.25 / 2).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('uses the approved download shaft and rounded tray with clear bottom spacing', () => {
    const svg = svgOf(Icons.IconDownload);
    const path = svg.querySelector('path');

    expect(path?.getAttribute('d')).toBe('M10 3.5v9m-3-3 3 3 3-3M3.5 13v1.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V13');

    if (path === null) {
      throw new Error('Missing download path');
    }

    const geometry = commands(path);
    const arrowTipY = geometry[0].values[1] + geometry[1].values[0];
    const trayBottomY = geometry[3].values[1] + geometry[4].values[0] + geometry[5].values[6];

    expect(trayBottomY - arrowTipY - Number(required(path, 'stroke-width'))).toBeGreaterThanOrEqual(2.5);
  });

  it('shares the page frame and fold between the generic file and document glyphs', () => {
    const pages = [Icons.IconFile, Icons.IconFileDoc].map((icon) =>
      Array.from(svgOf(icon).querySelectorAll('path'), (path) => required(path, 'd')));

    expect(pages[1].slice(0, 2)).toEqual(pages[0].slice(0, 2));

    const frame = svgOf(Icons.IconFile).querySelector('path');

    if (frame === null) {
      throw new Error('Missing page frame');
    }

    const corners = commands(frame).filter(({ command }) => command.toUpperCase() === 'A');

    expect(corners).toHaveLength(3);
    expect(corners.map(({ values }) => values.slice(0, 2))).toEqual([[2, 2], [2, 2], [2, 2]]);
  });

  it.each([
    ['sheet', Icons.IconFileSheet],
    ['slides', Icons.IconFileSlides],
    ['archive', Icons.IconFileArchive],
    ['theater', Icons.IconPlayerTheater],
  ])('%s retains its distinct frame proportions with family corners', (_name, icon) => {
    const rectangles = Array.from(svgOf(icon).querySelectorAll('rect'));

    expect(rectangles[0].getAttribute('rx')).toBe('2');
    rectangles.slice(1).forEach((rectangle) => {
      expect(rectangle.getAttribute('rx')).toBe('1');
    });
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
      commands(gear().rim)
        // The start point is also where the last curve ends, so it is not counted twice.
        .filter(({ command }) => command !== 'Z' && command !== 'M')
        .map(({ values }) => {
          const [x, y] = values.slice(-2);

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
