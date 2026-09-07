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
 * IconCloseThick is the only icon still drawn as a scaled copy of another: it
 * is IconCross at 1.2x with a heavier stroke, for the 14-pixel cancel controls
 * where the menu weight disappears. Every other 20-unit/24-unit twin was
 * merged into one export.
 */
const pairedIcons = [
  ['close', Icons.IconCross, Icons.IconCloseThick],
] as const;

const overlayIcons = {
  IconImageBroken: Icons.IconImageBroken,
  IconUploadFailed: Icons.IconUploadFailed,
  IconUpload: Icons.IconUpload,
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

  it.each(pairedIcons)('%s keeps the same geometry at menu and overlay sizes', (_name, standard, overlay) => {
    const small = Array.from(svgOf(standard).children);
    const large = Array.from(svgOf(overlay).children);

    expect(large).toHaveLength(small.length);
    small.forEach((shape, index) => {
      const counterpart = large[index];

      expect(counterpart.tagName).toBe(shape.tagName);

      if (shape.tagName === 'path') {
        const smallCommands = commands(shape);
        const largeCommands = commands(counterpart);

        expect(largeCommands.map(({ command }) => command)).toEqual(smallCommands.map(({ command }) => command));
        smallCommands.forEach(({ command, values }, commandIndex) => {
          const scaled = largeCommands[commandIndex].values;

          expect(scaled).toHaveLength(values.length);
          values.forEach((value, valueIndex) => {
            const arcFlag = command.toUpperCase() === 'A' && [2, 3, 4].includes(valueIndex % 7);

            expect(scaled[valueIndex]).toBeCloseTo(value * (arcFlag ? 1 : 1.2), 5);
          });
        });

        return;
      }

      for (const attribute of ['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r']) {
        if (shape.hasAttribute(attribute)) {
          expect(Number(required(counterpart, attribute))).toBeCloseTo(Number(required(shape, attribute)) * 1.2, 5);
        }
      }
    });
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

  it('keeps the tiny close at 14 pixels with its small optical stroke correction', () => {
    const svg = svgOf(Icons.IconCloseThick);
    const path = svg.querySelector('path');

    expect(svg.getAttribute('width')).toBe('14');
    expect(svg.getAttribute('height')).toBe('14');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(path?.getAttribute('stroke-width')).toBe('1.75');
  });

  it.each([
    ['video', Icons.IconVideo],
    ['picture-in-picture', Icons.IconPlayerPip],
  ])('%s uses the image family frame', (_name, icon) => {
    const frame = svgOf(icon).querySelector('rect');

    expect(frame).not.toBeNull();

    if (frame === null) {
      return;
    }

    expect(['x', 'y', 'width', 'height', 'rx'].map((attribute) => Number(required(frame, attribute))))
      .toEqual([3, 4, 14, 12, 2]);
  });

  it('keeps alignment blocks equal, mirrored and softly cornered', () => {
    const blocks = [Icons.IconAlignLeft, Icons.IconAlignCenter, Icons.IconAlignRight].map((icon) => {
      const block = svgOf(icon).querySelector('rect');

      if (block === null) {
        throw new Error('Missing alignment block');
      }

      return block;
    });
    const x = blocks.map((block) => Number(required(block, 'x')));
    const widths = blocks.map((block) => Number(required(block, 'width')));

    expect(x[0] + x[2] + widths[0]).toBe(20);
    expect(x[1] + widths[1] / 2).toBe(10);
    blocks.forEach((block) => {
      expect(Number(required(block, 'width'))).toBe(widths[0]);
      expect(Number(required(block, 'height'))).toBe(widths[0]);
      expect(block.getAttribute('rx')).toBe('1');
      expect(block.getAttribute('fill')).toBe('currentColor');
    });
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
    expect(ridge).toHaveLength(5);

    for (let index = 1; index < ridge.length; index++) {
      const start = ridge[index - 1];
      const end = ridge[index];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const projection = Math.max(0, Math.min(1, ((sunX - start.x) * dx + (sunY - start.y) * dy) / (dx * dx + dy * dy)));
      const distance = Math.hypot(sunX - start.x - projection * dx, sunY - start.y - projection * dy);

      expect(distance - sunRadius - 1.25 / 2).toBeGreaterThan(0.4);
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

  it('keeps settings knobs separate with a full stroke of vertical breathing room', () => {
    const knobs = Array.from(svgOf(Icons.IconPlayerSettings).querySelectorAll('circle'));

    expect(knobs).toHaveLength(3);

    for (let index = 1; index < knobs.length; index++) {
      const previous = knobs[index - 1];
      const next = knobs[index];
      const verticalGap = Number(required(next, 'cy')) - Number(required(previous, 'cy'))
        - Number(required(previous, 'r')) - Number(required(next, 'r')) - 1.25;

      expect(verticalGap).toBeGreaterThanOrEqual(0.75);
    }
  });
});
