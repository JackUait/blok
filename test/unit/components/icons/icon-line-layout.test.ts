import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildIconColumnsCount,
  IconBoard,
  IconCalendar,
  IconCallout,
  IconColumns,
  IconDatabase,
  IconEmojiBall,
  IconEmojiFlag,
  IconEmojiLightbulb,
  IconEmojiSmile,
  IconEmojiSprout,
  IconEmojiStar,
  IconEmojiUtensils,
  IconGallery,
  IconHeaderColumn,
  IconHeaderRow,
  IconImage,
  IconList,
  IconMergeCells,
  IconMultiSelect,
  IconPaintRoller,
  IconPlacement,
  IconPreview,
  IconSelect,
  IconSpacer,
  IconSplitCell,
  IconSplitView,
  IconTable,
  IconTableOfContents,
  IconTabs,
  IconTimeline,
  IconUpload,
} from '../../../../src/components/icons';

const layoutIcons = {
  IconBoard, IconCalendar, IconCallout, IconColumns, IconDatabase,
  IconEmojiBall, IconEmojiFlag, IconEmojiLightbulb, IconEmojiSmile,
  IconEmojiSprout, IconEmojiStar, IconEmojiUtensils, IconGallery,
  IconHeaderColumn, IconHeaderRow, IconImage, IconList, IconMergeCells,
  IconMultiSelect, IconPaintRoller, IconPlacement, IconPreview, IconSelect,
  IconSpacer, IconSplitCell, IconSplitView, IconTable, IconTabs, IconUpload,
};

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

const required = (root: ParentNode, selector: string): Element => {
  const element = root.querySelector(selector);

  if (element === null) {
    throw new Error(`Missing ${selector}`);
  }

  return element;
};

const numberOf = (element: Element, attribute: string): number => {
  const value = element.getAttribute(attribute);

  if (value === null) {
    throw new Error(`Missing ${attribute}`);
  }

  return Number(value);
};

const frameOf = (icon: string): number[] => {
  const frame = required(svgOf(icon), 'rect');

  return ['x', 'y', 'width', 'height', 'rx'].map(attribute => numberOf(frame, attribute));
};

type Point = [number, number];

const linePoints = (path: Element): Point[][] => {
  const commands = path.getAttribute('d')?.match(/[MLHVmlhv][^MLHVmlhv]*/g) ?? [];
  const contours: Point[][] = [];
  let x = 0;
  let y = 0;
  let current: Point[] = [];

  commands.forEach(command => {
    const letter = command.charAt(0);
    const values = command.slice(1).match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
    const relative = letter === letter.toLowerCase();

    if (letter.toLowerCase() === 'm') {
      current = [];
      contours.push(current);
    }

    for (let i = 0; i < values.length;) {
      if (letter.toLowerCase() === 'h') {
        x = (relative ? x : 0) + values[i++];
      } else if (letter.toLowerCase() === 'v') {
        y = (relative ? y : 0) + values[i++];
      } else {
        x = (relative ? x : 0) + values[i++];
        y = (relative ? y : 0) + values[i++];
      }
      current.push([x, y]);
    }
  });

  return contours;
};

/** Path vertices, including arc end points (absolute and relative M/L/H/V/A). */
const arcAwarePoints = (path: Element): Point[] => {
  const commands = path.getAttribute('d')?.match(/[MLHVAZmlhvaz][^MLHVAZmlhvaz]*/g) ?? [];
  const points: Point[] = [];
  let x = 0;
  let y = 0;

  commands.forEach(command => {
    const letter = command.charAt(0);
    const lower = letter.toLowerCase();
    const values = command.slice(1).match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
    const relative = letter === lower;
    const step = { a: 7, h: 1, v: 1 }[lower] ?? 2;

    for (let i = 0; i + step <= values.length; i += step) {
      const chunk = values.slice(i, i + step);

      if (lower === 'h') {
        x = (relative ? x : 0) + chunk[0];
      } else if (lower === 'v') {
        y = (relative ? y : 0) + chunk[0];
      } else {
        x = (relative ? x : 0) + chunk[step - 2];
        y = (relative ? y : 0) + chunk[step - 1];
      }
      points.push([x, y]);
    }
  });

  return points;
};

const distanceToSegment = ([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));

  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};

describe('Blok Line layout geometry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(layoutIcons))('%s keeps rounded, explicit house strokes on its 20-unit canvas', (_name, icon) => {
    const svg = required(svgOf(icon), 'svg');
    const shapes = Array.from(svg.querySelectorAll('[stroke="currentColor"]'));

    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.querySelectorAll('[stroke="currentColor"], [fill="currentColor"]').length).toBeGreaterThan(0);

    for (const shape of shapes) {
      expect(shape.getAttribute('stroke-width')).toBe('1.25');
      expect(shape.getAttribute('stroke-linecap')).toBe('round');
      expect(shape.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it.each(Object.entries({ IconImage, IconTable, IconHeaderRow, IconHeaderColumn, IconColumns, IconCallout, IconCalendar, IconSelect }))(
    '%s shares the panel keyline instead of changing size between menu rows',
    (_name, icon) => {
      expect(frameOf(icon)).toStrictEqual([3, 4, 14, 12, 2]);
    }
  );

  it('gives the table two columns and three equally spaced rows, shared by both headers', () => {
    const grid = required(svgOf(IconTable), 'path[stroke="currentColor"]');
    const contours = linePoints(grid);

    expect(contours).toStrictEqual([
      [[3, 8], [17, 8]],
      [[3, 12], [17, 12]],
      [[8, 4], [8, 16]],
    ]);
    for (const icon of [IconHeaderRow, IconHeaderColumn]) {
      expect(linePoints(required(svgOf(icon), 'path[stroke="currentColor"]'))).toStrictEqual(contours);
      expect(svgOf(icon).querySelectorAll('path[fill="currentColor"]')).toHaveLength(1);
    }
  });

  it('keeps a full pixel between the preview pupil and both eyelids at 16px', () => {
    const svg = svgOf(IconPreview);
    const eyelid = required(svg, 'path');
    const pupil = required(svg, 'circle');
    const coordinates = eyelid.getAttribute('d')?.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
    const cy = numberOf(pupil, 'cy');
    const radius = numberOf(pupil, 'r');
    const strokeClearance = (numberOf(eyelid, 'stroke-width') + numberOf(pupil, 'stroke-width')) / 2;
    const upper = (coordinates[1] + 3 * coordinates[3] + 3 * coordinates[5] + coordinates[7]) / 8;
    const lower = (coordinates[7] + 3 * coordinates[9] + 3 * coordinates[11] + coordinates[13]) / 8;

    expect((cy - radius - upper - strokeClearance) * 16 / 20).toBeGreaterThanOrEqual(1);
    expect((lower - cy - radius - strokeClearance) * 16 / 20).toBeGreaterThanOrEqual(1);
    expect(coordinates).toHaveLength(14);
  });

  it('layers a small hill on the big slope and keeps the sun clear of both at 16px', () => {
    const svg = svgOf(IconImage);
    const sun = required(svg, 'circle');
    const center: Point = [numberOf(sun, 'cx'), numberOf(sun, 'cy')];
    const radius = numberOf(sun, 'r');
    const [mountain, hill] = linePoints(required(svg, 'path'));
    const gaps = [mountain, hill].flatMap(ridge =>
      ridge.slice(1).map((point, index) => distanceToSegment(center, ridge[index], point) - radius - 1.25 / 2));

    expect(radius).toBe(0.85);
    expect(Math.min(...gaps) * 16 / 20).toBeGreaterThanOrEqual(0.9);
    // The hill starts on the mountain's far slope, so it reads as standing in front.
    expect(distanceToSegment(hill[0], mountain[1], mountain[2])).toBeCloseTo(0, 5);
    // Both ridges end on the panel: the left and bottom edges, then the right edge above the corner.
    expect(mountain[0][0]).toBe(3);
    expect(mountain[2][1]).toBe(16);
    expect(hill[2][0]).toBe(17);
    expect(hill[2][1]).toBeLessThanOrEqual(16 - 2);
  });


  it.each([2, 3, 4, 5])('builds %i equal-width columns on the same rounded panel', count => {
    const icon = buildIconColumnsCount(count);
    const svg = svgOf(icon);
    const dividers = Array.from(svg.querySelectorAll('line'));
    const edges = [3, ...dividers.map(line => numberOf(line, 'x1')), 17];

    expect(frameOf(icon)).toStrictEqual([3, 4, 14, 12, 2]);
    expect(dividers).toHaveLength(count - 1);
    dividers.forEach(line => {
      expect(numberOf(line, 'x1')).toBe(numberOf(line, 'x2'));
      expect(numberOf(line, 'y1')).toBe(4);
      expect(numberOf(line, 'y2')).toBe(16);
      expect(line.getAttribute('stroke')).toBe('currentColor');
      expect(line.getAttribute('stroke-width')).toBe('1.25');
    });
    edges.slice(1).forEach((edge, index) => {
      expect(Math.abs(edge - edges[index] - 14 / count)).toBeLessThanOrEqual(0.01);
    });
  });

  it('draws the timeline as three open bars that start later as they go down', () => {
    const bars = Array.from(svgOf(IconTimeline).querySelectorAll('rect'));
    const at = (bar: Element, attribute: string): number => numberOf(bar, attribute);

    expect(bars).toHaveLength(3);
    bars.forEach(bar => {
      expect(at(bar, 'rx')).toBe(1);
      expect(at(bar, 'height') - 1.25).toBeGreaterThanOrEqual(1.75);
      expect(at(bar, 'x')).toBeGreaterThanOrEqual(3);
      expect(at(bar, 'x') + at(bar, 'width')).toBeLessThanOrEqual(17);
    });
    bars.slice(1).forEach((bar, index) => {
      const previous = bars[index];

      expect(at(bar, 'x')).toBeGreaterThan(at(previous, 'x'));
      expect((at(bar, 'y') - at(previous, 'y') - at(previous, 'height') - 1.25) * 16 / 20).toBeGreaterThanOrEqual(1);
    });
  });

  it('gives board cards real interiors rather than filled specks inside a second frame', () => {
    const svg = svgOf(IconBoard);
    const cards = Array.from(svg.querySelectorAll('rect'));
    const heights = cards.map(card => numberOf(card, 'height'));

    expect(cards).toHaveLength(3);
    expect(svg.querySelectorAll('[fill="currentColor"]')).toHaveLength(0);
    expect(new Set(heights).size).toBe(3);
    cards.forEach(card => {
      expect(numberOf(card, 'width') - 1.25).toBeGreaterThanOrEqual(1.75);
      expect(numberOf(card, 'rx')).toBe(1);
    });
    cards.slice(1).forEach((card, index) => {
      const previous = cards[index];
      const gap = numberOf(card, 'x') - numberOf(previous, 'x') - numberOf(previous, 'width') - 1.25;

      expect(gap * 16 / 20).toBeGreaterThanOrEqual(1);
    });
  });

  it.each(Object.entries({ IconGallery, IconList, IconMultiSelect, IconSplitView }))(
    '%s keeps miniature cards open and separated at 16px',
    (_name, icon) => {
      const cards = Array.from(svgOf(icon).querySelectorAll('rect'));

      expect(cards.length).toBeGreaterThanOrEqual(2);
      cards.forEach(card => {
        expect(numberOf(card, 'rx')).toBe(1);
        expect(numberOf(card, 'height') - 1.25).toBeGreaterThanOrEqual(3);
        expect(numberOf(card, 'width') - 1.25).toBeGreaterThanOrEqual(3);
      });
      for (const [index, card] of cards.entries()) {
        for (const other of cards.slice(index + 1)) {
          const gapX = Math.max(numberOf(other, 'x') - numberOf(card, 'x') - numberOf(card, 'width'),
            numberOf(card, 'x') - numberOf(other, 'x') - numberOf(other, 'width'));
          const gapY = Math.max(numberOf(other, 'y') - numberOf(card, 'y') - numberOf(card, 'height'),
            numberOf(card, 'y') - numberOf(other, 'y') - numberOf(other, 'height'));

          expect((Math.max(gapX, gapY) - 1.25) * 16 / 20).toBeGreaterThanOrEqual(1);
        }
      }
    }
  );

  it('uses two roomy full-width list rows, distinct from gallery tiles and split panels', () => {
    const rows = Array.from(svgOf(IconList).querySelectorAll('rect'));

    expect(rows).toHaveLength(2);
    rows.forEach(row => {
      expect(numberOf(row, 'x')).toBe(3);
      expect(numberOf(row, 'width')).toBe(14);
      expect(numberOf(row, 'height')).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('keeps circular category keylines aligned and removes the crowded ball polygon', () => {
    for (const icon of [IconEmojiSmile, IconEmojiBall]) {
      const outline = required(svgOf(icon), 'circle[stroke="currentColor"]');

      expect(['cx', 'cy', 'r'].map(attribute => numberOf(outline, attribute))).toStrictEqual([10, 10, 6.5]);
    }
    const ball = svgOf(IconEmojiBall);
    const seams = Array.from(ball.querySelectorAll('path'))
      .flatMap(path => path.getAttribute('d')?.match(/M[^M]+/g) ?? []);

    expect(ball.querySelector('polygon, [fill="currentColor"]')).toBeNull();
    expect(seams).toHaveLength(2);
    for (const seam of seams) {
      expect(seam).not.toMatch(/[zZ]/);
    }
  });

  it('keeps placement dots lighter than the gaps between them', () => {
    const dots = Array.from(svgOf(IconPlacement).querySelectorAll('circle'));

    expect(dots).toHaveLength(9);
    dots.forEach(dot => {
      expect(numberOf(dot, 'r')).toBeLessThanOrEqual(0.85);
      expect(dot.getAttribute('fill')).toBe('currentColor');
    });
    expect(new Set(dots.map(dot => numberOf(dot, 'cx'))).size).toBe(3);
    expect(new Set(dots.map(dot => numberOf(dot, 'cy'))).size).toBe(3);
  });
  it('lights the open tab and curves the floor up into its edge, unlike the calendar header', () => {
    const svg = svgOf(IconTabs);
    const floor = required(svg, 'path:not([fill])');
    const tab = required(svg, 'path[fill="currentColor"]');
    const floorPoints = arcAwarePoints(floor);
    const tabPoints = arcAwarePoints(tab);
    const [floorStart] = floorPoints;
    const floorEnd = floorPoints[floorPoints.length - 1];
    const floorY = floorStart[1];

    expect(frameOf(IconTabs)).toStrictEqual(frameOf(IconTable));
    // The floor starts on the panel's right edge and ends on its top edge.
    expect(floorStart[0]).toBe(17);
    expect(floorEnd[1]).toBe(4);
    // It stops at the open tab, so it is not the calendar's full-width line.
    expect(Math.min(...floorPoints.map(([x]) => x))).toBeGreaterThan(3);
    expect(floor.getAttribute('d')).toMatch(/A/i);
    // The lit tab fills the corner up to the floor and follows its curve.
    expect(Math.min(...tabPoints.map(([x]) => x))).toBe(3);
    expect(Math.min(...tabPoints.map(([, y]) => y))).toBe(4);
    expect(Math.max(...tabPoints.map(([, y]) => y))).toBe(floorY);
    expect(floorPoints.filter(([x, y]) => y < floorY || x === floorEnd[0])
      .every(point => tabPoints.some(([x, y]) => x === point[0] && y === point[1]))).toBe(true);
    // Nothing sticks out above the panel the way calendar rings do.
    expect(Math.min(...[...floorPoints, ...tabPoints].map(([, y]) => y))).toBe(4);
  });

  it('steps each table of contents row right by the same amount, as a dash then a rule', () => {
    const paths = Array.from(svgOf(IconTableOfContents).querySelectorAll('path'));

    expect(paths).toHaveLength(1);

    const segments = linePoints(paths[0]);
    const rows = [...new Set(segments.map(([[, y]]) => y))];

    expect(segments).toHaveLength(6);
    expect(rows).toHaveLength(3);

    const pairs = rows.map(row => segments
      .filter(([[, y]]) => y === row)
      .map(([[a], [b]]) => [Math.min(a, b), Math.max(a, b)])
      .sort(([a], [b]) => a - b));
    const steps = pairs.slice(1).map(([[dash]], i) => dash - pairs[i][0][0]);

    pairs.forEach(([dash, rule]) => {
      expect(dash[1] - dash[0]).toBeLessThan(rule[1] - rule[0]);
      // A full stroke of clear space keeps the dash apart from its rule at 16 px.
      expect(rule[0] - dash[1] - 1.25).toBeGreaterThanOrEqual(1.25);
    });
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps[1]).toBe(steps[0]);
    expect(Math.min(...pairs.flat(2))).toBe(3);
    expect(Math.max(...pairs.flat(2))).toBe(17);
  });
});
