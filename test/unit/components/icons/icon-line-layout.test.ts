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
  IconPageLayout,
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
  IconMultiSelect, IconPageLayout, IconPaintRoller, IconPlacement, IconPreview, IconSelect,
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

// Keyline's landscape panel: x, y, width, height, rx.
const PANEL = [3, 4.5, 14, 11, 2.5];

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
      expect(frameOf(icon)).toStrictEqual(PANEL);
    }
  );

  it('gives the table a header band over two equal body rows, shared by both header icons', () => {
    const contours = linePoints(required(svgOf(IconTable), 'path[stroke="currentColor"]'));
    const [x, y, width, height] = PANEL;
    const [band, row, column] = contours;

    expect(contours).toHaveLength(3);
    expect(band).toStrictEqual([[x, band[0][1]], [x + width, band[0][1]]]);
    expect(row).toStrictEqual([[x, row[0][1]], [x + width, row[0][1]]]);
    expect(column).toStrictEqual([[column[0][0], y], [column[0][0], y + height]]);
    expect(row[0][1] - band[0][1]).toBe(y + height - row[0][1]);
    expect(band[0][1] - y).toBeGreaterThan(row[0][1] - band[0][1]);

    // A header is a text rule centred in its band; the grid lines stop at the band. No fills.
    const headerRow = linePoints(required(svgOf(IconHeaderRow), 'path[stroke="currentColor"]'));

    expect(headerRow.slice(0, 2)).toStrictEqual([band, row]);
    expect(headerRow[2]).toStrictEqual([[column[0][0], band[0][1]], column[1]]);
    expect(headerRow[3][0][1]).toBe((y + band[0][1]) / 2);
    expect(headerRow[3][1][1]).toBe(headerRow[3][0][1]);

    const headerColumn = linePoints(required(svgOf(IconHeaderColumn), 'path[stroke="currentColor"]'));

    expect(headerColumn[0]).toStrictEqual(column);
    expect(headerColumn.slice(1, 3)).toStrictEqual([band, row].map(([, end]) => [[column[0][0], end[1]], end]));
    expect(headerColumn[3][0][0]).toBe((x + column[0][0]) / 2);
    expect(headerColumn[3][1][0]).toBe(headerColumn[3][0][0]);

    for (const icon of [IconTable, IconHeaderRow, IconHeaderColumn]) {
      expect(svgOf(icon).querySelectorAll('[fill="currentColor"]')).toHaveLength(0);
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

  it('layers a small hill on the big slope and keeps the sun one unit clear of both', () => {
    const svg = svgOf(IconImage);
    const sun = required(svg, 'circle');
    const center: Point = [numberOf(sun, 'cx'), numberOf(sun, 'cy')];
    const radius = numberOf(sun, 'r');
    const [mountain, hill] = linePoints(required(svg, 'path'));
    const gaps = [mountain, hill].flatMap(ridge =>
      ridge.slice(1).map((point, index) => distanceToSegment(center, ridge[index], point) - radius - 1.25 / 2));

    // Keyline's accent dot, one clear unit from both ridges.
    expect(radius).toBe(1);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1);
    // The hill starts on the mountain's far slope, so it reads as standing in front.
    expect(distanceToSegment(hill[0], mountain[1], mountain[2])).toBeCloseTo(0, 5);
    // Both ridges end on the panel: the left and bottom edges, then the right edge above the corner.
    const [x, y, width, height, rx] = frameOf(IconImage);

    expect(mountain[0][0]).toBe(x);
    expect(mountain[2][1]).toBe(y + height);
    expect(hill[2][0]).toBe(x + width);
    expect(hill[2][1]).toBeLessThanOrEqual(y + height - rx);
  });


  it.each([2, 3, 4, 5])('builds %i equal-width columns on the same rounded panel', count => {
    const icon = buildIconColumnsCount(count);
    const svg = svgOf(icon);
    const dividers = Array.from(svg.querySelectorAll('line'));
    const [x, y, width, height] = PANEL;
    const edges = [x, ...dividers.map(line => numberOf(line, 'x1')), x + width];

    expect(frameOf(icon)).toStrictEqual(PANEL);
    expect(dividers).toHaveLength(count - 1);
    dividers.forEach(line => {
      expect(numberOf(line, 'x1')).toBe(numberOf(line, 'x2'));
      expect(numberOf(line, 'y1')).toBe(y);
      expect(numberOf(line, 'y2')).toBe(y + height);
      expect(line.getAttribute('stroke')).toBe('currentColor');
      expect(line.getAttribute('stroke-width')).toBe('1.25');
    });
    edges.slice(1).forEach((edge, index) => {
      expect(Math.abs(edge - edges[index] - width / count)).toBeLessThanOrEqual(0.01);
    });
  });

  it('draws the timeline as three open pill bars that start later as they go down', () => {
    const bars = Array.from(svgOf(IconTimeline).querySelectorAll('rect'));
    const at = (bar: Element, attribute: string): number => numberOf(bar, attribute);

    expect(bars).toHaveLength(3);
    bars.forEach(bar => {
      expect(at(bar, 'rx')).toBe(at(bar, 'height') / 2);
      // One clear unit inside keeps the bar open.
      expect(at(bar, 'height') - 1.25).toBeGreaterThanOrEqual(1);
      expect(at(bar, 'x')).toBeGreaterThanOrEqual(3);
      expect(at(bar, 'x') + at(bar, 'width')).toBeLessThanOrEqual(17);
    });
    bars.slice(1).forEach((bar, index) => {
      const previous = bars[index];

      expect(at(bar, 'x')).toBeGreaterThan(at(previous, 'x'));
      expect(at(bar, 'y') - at(previous, 'y') - at(previous, 'height') - 1.25).toBeGreaterThanOrEqual(1);
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

  it.each(Object.entries({ IconGallery, IconList, IconMultiSelect, IconPageLayout, IconSplitView }))(
    '%s keeps miniature cards open and separated at 16px',
    (_name, icon) => {
      const cards = Array.from(svgOf(icon).querySelectorAll('rect'));

      expect(cards.length).toBeGreaterThanOrEqual(2);
      cards.forEach(card => {
        // Keyline's small inset rect.
        expect(numberOf(card, 'rx')).toBe(1.5);
        expect(numberOf(card, 'height') - 1.25).toBeGreaterThanOrEqual(3);
        expect(numberOf(card, 'width') - 1.25).toBeGreaterThanOrEqual(3);
      });
      for (const [index, card] of cards.entries()) {
        for (const other of cards.slice(index + 1)) {
          const gapX = Math.max(numberOf(other, 'x') - numberOf(card, 'x') - numberOf(card, 'width'),
            numberOf(card, 'x') - numberOf(other, 'x') - numberOf(other, 'width'));
          const gapY = Math.max(numberOf(other, 'y') - numberOf(card, 'y') - numberOf(card, 'height'),
            numberOf(card, 'y') - numberOf(other, 'y') - numberOf(other, 'height'));

          expect(Math.max(gapX, gapY) - 1.25).toBeGreaterThanOrEqual(1.25);
        }
      }
    }
  );

  it('uses two full-width list rows on the gallery tile rows, distinct from gallery tiles and split panels', () => {
    const rows = Array.from(svgOf(IconList).querySelectorAll('rect'));
    const tiles = Array.from(svgOf(IconGallery).querySelectorAll('rect'));
    const [x, , width] = PANEL;

    expect(rows).toHaveLength(2);
    rows.forEach(row => {
      expect(numberOf(row, 'x')).toBe(x);
      expect(numberOf(row, 'width')).toBe(width);
      expect(numberOf(row, 'height')).toBe(numberOf(tiles[0], 'height'));
    });
    expect(rows.map(row => numberOf(row, 'y'))).toStrictEqual([...new Set(tiles.map(tile => numberOf(tile, 'y')))]);
  });

  it('keeps circular category keylines aligned and removes the crowded ball polygon', () => {
    for (const icon of [IconEmojiSmile, IconEmojiBall]) {
      const outline = required(svgOf(icon), 'circle[stroke="currentColor"]');

      expect(['cx', 'cy', 'r'].map(attribute => numberOf(outline, attribute))).toStrictEqual([10, 10, 7]);
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
    const xs = [...new Set(dots.map(dot => numberOf(dot, 'cx')))].sort((a, b) => a - b);
    const ys = [...new Set(dots.map(dot => numberOf(dot, 'cy')))].sort((a, b) => a - b);
    const radius = numberOf(dots[0], 'r');

    expect(dots).toHaveLength(9);
    dots.forEach(dot => {
      expect(numberOf(dot, 'r')).toBe(radius);
      expect(dot.getAttribute('fill')).toBe('currentColor');
    });
    expect(xs).toHaveLength(3);
    expect(ys).toHaveLength(3);
    expect(xs[1]).toBe(10);
    expect(ys[1]).toBe(10);
    // Each gap is wider than a dot, so the grid reads as points, not a block.
    expect(xs[1] - xs[0] - 2 * radius).toBeGreaterThan(2 * radius);
    expect(ys[1] - ys[0] - 2 * radius).toBeGreaterThan(2 * radius);
  });
  it('cuts the open tab as a notch whose floor curves into its edge, unlike the calendar header', () => {
    const svg = svgOf(IconTabs);
    const notch = required(svg, 'path');
    const points = arcAwarePoints(notch);
    const [start] = points;
    const end = points[points.length - 1];
    const [x, y, width] = PANEL;
    const calendarHeader = linePoints(required(svgOf(IconCalendar), 'path'))[0];

    expect(frameOf(IconTabs)).toStrictEqual(PANEL);
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(svg.querySelector('[fill="currentColor"]')).toBeNull();
    // The tab edge drops from the panel's top, turns, and the floor runs out to the right edge.
    expect(start[1]).toBe(y);
    expect(end[0]).toBe(x + width);
    expect(notch.getAttribute('d')).toMatch(/A/i);
    // It stops at the open tab, so it is not the calendar's full-width line.
    expect(calendarHeader[0][0]).toBe(x);
    expect(Math.min(...points.map(([px]) => px))).toBeGreaterThan(x);
    // The open tab is at least a third of the panel wide.
    expect(start[0] - x).toBeGreaterThanOrEqual(width / 3);
    expect(Math.min(...points.map(([, py]) => py))).toBe(y);
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

  // research/09 §1: Notion's `layout` glyph, a tall panel beside two squares. Its panel is the
  // split view's first panel and its squares are the gallery's right column.
  it('draws the page layout from the split view panel and the gallery column', () => {
    const rectsOf = (icon: string): string[] => Array.from(svgOf(icon).querySelectorAll('rect'))
      .map(rect => ['x', 'y', 'width', 'height', 'rx'].map(attribute => rect.getAttribute(attribute)).join(' '));
    const [panel, ...squares] = rectsOf(IconPageLayout);

    expect(panel).toBe(rectsOf(IconSplitView)[0]);
    const galleryXs = Array.from(svgOf(IconGallery).querySelectorAll('rect')).map(rect => numberOf(rect, 'x'));

    expect(squares).toEqual(rectsOf(IconGallery).filter(rect => rect.startsWith(`${Math.max(...galleryXs)} `)));
  });
});
