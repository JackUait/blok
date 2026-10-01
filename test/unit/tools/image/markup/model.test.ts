import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ImageMarkup, ImageMarkupShape, ImageMarkupStroke, ImageMarkupText } from '../../../../../types/tools/image';
import type { Size } from '../../../../../src/tools/image/darkroom/camera';
import { IDENTITY, rotateLeft, flipHorizontal } from '../../../../../src/tools/image/geometry';
import {
  MARKUP_COLORS,
  MARKUP_SIZES,
  HIGHLIGHTER_SCALE,
  readMarkup,
  markupFields,
  turnMarkupLeft,
  flipMarkup,
  sameMarkup,
  newMarkupId,
  commitMarkupItem,
  markupBounds,
  moveMarkup,
  resizeMarkup,
  hitTest,
  contrastInk,
  arrowHeadLength,
  eraseMarkup,
  MAX_MARKUP_ITEMS,
  shapeOutline,
  isClosedShape,
  takesFill,
} from '../../../../../src/tools/image/markup/model';

const O: Size = { w: 1000, h: 500 };

const pen = (over: Partial<ImageMarkupStroke> = {}): ImageMarkupStroke => ({
  id: 'p1', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.1, 0.5], size: 0.01, ...over,
});
const shape = (over: Partial<ImageMarkupShape> = {}): ImageMarkupShape => ({
  id: 's1', type: 'rect', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.01, ...over,
});
const text = (over: Partial<ImageMarkupText> = {}): ImageMarkupText => ({
  id: 't1', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.06, ...over,
});

const isStroke = (m: ImageMarkup | undefined): m is ImageMarkupStroke => m?.type === 'pen' || m?.type === 'highlighter';
const isShape = (m: ImageMarkup | undefined): m is ImageMarkupShape => m !== undefined && !isStroke(m) && m.type !== 'text';
const isText = (m: ImageMarkup | undefined): m is ImageMarkupText => m?.type === 'text';

const asStroke = (m: ImageMarkup | undefined | null): ImageMarkupStroke => {
  if (m === null || !isStroke(m)) throw new Error('expected a stroke');

  return m;
};
const asShape = (m: ImageMarkup | undefined | null): ImageMarkupShape => {
  if (m === null || !isShape(m)) throw new Error('expected a shape');

  return m;
};
const asText = (m: ImageMarkup | undefined | null): ImageMarkupText => {
  if (m === null || !isText(m)) throw new Error('expected a text');

  return m;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('palette and sizes', () => {
  it('lists the palette in spec order, white first', () => {
    expect(MARKUP_COLORS).toEqual([
      '#ffffff', '#111111', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#ff2d55',
    ]);
  });

  it('has thin, medium and thick sizes and a 3x highlighter', () => {
    expect(MARKUP_SIZES.pen).toEqual([0.006, 0.012, 0.024]);
    expect(MARKUP_SIZES.text).toEqual([0.04, 0.06, 0.09]);
    expect(HIGHLIGHTER_SCALE).toBe(3);
  });
});

describe('readMarkup', () => {
  it('never throws and returns [] for non-arrays', () => {
    for (const input of [null, undefined, 'x', 42, {}, { length: 3 }, true]) {
      expect(readMarkup(input)).toEqual([]);
    }
  });

  it('drops garbage items without throwing', () => {
    const input: unknown[] = [null, 'x', 7, [], { type: 'blob' }, { type: 'pen' }, { type: 'text', text: 3 }];

    expect(readMarkup(input)).toEqual([]);
  });

  it('keeps a valid item of every type with stable key order', () => {
    const items: unknown[] = [pen(), shape(), shape({ id: 's2', type: 'arrow' }), text()];
    const out = readMarkup(items);

    expect(out).toEqual(items);
    expect(Object.keys(out[0] ?? {})).toEqual(['id', 'type', 'color', 'points', 'size']);
    expect(Object.keys(out[1] ?? {})).toEqual(['id', 'type', 'color', 'x1', 'y1', 'x2', 'y2', 'size']);
    expect(Object.keys(out[3] ?? {})).toEqual(['id', 'type', 'color', 'x', 'y', 'text', 'size']);
  });

  it('validates and lower-cases colour, dropping anything else', () => {
    expect(readMarkup([pen({ color: '#FF3B30' })])[0]?.color).toBe('#ff3b30');
    expect(readMarkup([pen({ color: 'red' })])).toEqual([]);
    expect(readMarkup([pen({ color: '#fff' })])).toEqual([]);
    expect(readMarkup([pen({ color: '#ff3b30;x' })])).toEqual([]);
  });

  it('clamps coords to [-0.5, 1.5] and quantises to 4 decimals, pressure to 2', () => {
    const out = asStroke(readMarkup([pen({ points: [2, -3, 0.123456, 0.123456789, 0.5, 0.876] })])[0]);

    expect(out.points).toEqual([1.5, -0.5, 0.12, 0.1235, 0.5, 0.88]);
  });

  it('defaults bad pressure to 0.5 and clamps it to [0, 1]', () => {
    const out = asStroke(readMarkup([pen({ points: [0.1, 0.1, Number.NaN, 0.2, 0.2, 4, 0.3, 0.3, -1] })])[0]);

    expect(out.points).toEqual([0.1, 0.1, 0.5, 0.2, 0.2, 1, 0.3, 0.3, 0]);
  });

  it('drops triples with non-finite coords, a trailing partial triple, and strokes with no points', () => {
    const out = asStroke(readMarkup([pen({ points: [0.1, Number.NaN, 0.5, 0.2, 0.2, 0.5, 0.3] })])[0]);

    expect(out.points).toEqual([0.2, 0.2, 0.5]);
    expect(readMarkup([pen({ points: [] })])).toEqual([]);
    expect(readMarkup([{ ...pen(), points: 'nope' }])).toEqual([]);
  });

  it('keeps at most 4000 points per stroke', () => {
    const points = Array.from({ length: 4100 }, (_, i) => [i / 5000, 0.5, 0.5]).flat();
    const out = asStroke(readMarkup([pen({ points })])[0]);

    expect(out.points).toHaveLength(4000 * 3);
  });

  it('clamps size to (0, 0.5] and drops non-positive or non-finite sizes', () => {
    expect(readMarkup([pen({ size: 3 })])[0]).toMatchObject({ size: 0.5 });
    expect(readMarkup([pen({ size: 0.000001 })])[0]).toMatchObject({ size: 0.0001 });
    expect(readMarkup([pen({ size: 0 })])).toEqual([]);
    expect(readMarkup([pen({ size: -1 })])).toEqual([]);
    expect(readMarkup([pen({ size: Number.NaN })])).toEqual([]);
    expect(readMarkup([pen({ size: Number.POSITIVE_INFINITY })])).toEqual([]);
  });

  it('keeps the first 500 valid items', () => {
    const items = Array.from({ length: 520 }, (_, i) => (i === 0 ? { type: 'bad' } : pen({ id: `p${i}` })));
    const out = readMarkup(items);

    expect(out).toHaveLength(500);
    expect(out[0]?.id).toBe('p1');
  });

  it('mints a fresh id for missing or duplicate ids, keeping the first owner', () => {
    const out = readMarkup([pen({ id: 'a' }), pen({ id: 'a' }), { ...pen(), id: 3 }, pen({ id: '' })]);
    const ids = out.map((m) => m.id);

    expect(ids[0]).toBe('a');
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('drops shapes with non-finite corners and keeps fill only when true on rect/ellipse', () => {
    expect(readMarkup([shape({ x1: Number.NaN })])).toEqual([]);
    expect(readMarkup([shape({ fill: true })])[0]).toMatchObject({ fill: true });
    expect(readMarkup([shape({ fill: false })])[0]).not.toHaveProperty('fill');
    expect(readMarkup([{ ...shape(), fill: 'yes' }])[0]).not.toHaveProperty('fill');
    expect(readMarkup([shape({ type: 'line', fill: true })])[0]).not.toHaveProperty('fill');
  });

  it('normalises rect and ellipse corners but keeps line and arrow direction', () => {
    expect(readMarkup([shape({ x1: 0.5, y1: 0.6, x2: 0.1, y2: 0.2 })])[0])
      .toMatchObject({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 });
    expect(readMarkup([shape({ type: 'arrow', x1: 0.5, y1: 0.6, x2: 0.1, y2: 0.2 })])[0])
      .toMatchObject({ x1: 0.5, y1: 0.6, x2: 0.1, y2: 0.2 });
  });

  it('drops empty text, caps it at 2000 chars, and omits plain style and zero rotation', () => {
    expect(readMarkup([text({ text: '   \n ' })])).toEqual([]);
    expect(asText(readMarkup([text({ text: 'x'.repeat(2100) })])[0]).text).toHaveLength(2000);

    const plain = readMarkup([text({ style: 'plain', rotation: 0 })])[0];

    expect(plain).not.toHaveProperty('style');
    expect(plain).not.toHaveProperty('rotation');
    expect(readMarkup([{ ...text(), style: 'neon' }])[0]).not.toHaveProperty('style');
    expect(readMarkup([text({ style: 'background' })])[0]).toMatchObject({ style: 'background' });
  });

  it('normalises rotation to (-180, 180]', () => {
    expect(readMarkup([text({ rotation: 270 })])[0]).toMatchObject({ rotation: -90 });
    expect(readMarkup([text({ rotation: -180 })])[0]).toMatchObject({ rotation: 180 });
    expect(readMarkup([text({ rotation: 540 })])[0]).toMatchObject({ rotation: 180 });
    expect(readMarkup([text({ rotation: 360 })])[0]).not.toHaveProperty('rotation');
    expect(readMarkup([text({ rotation: Number.NaN })])[0]).not.toHaveProperty('rotation');
  });
});

describe('readMarkup cut ends', () => {
  it('keeps a valid cut and drops anything else', () => {
    expect(readMarkup([pen({ cut: 'both' })])[0]).toEqual(pen({ cut: 'both' }));
    expect(Object.keys(readMarkup([pen({ cut: 'end' })])[0] ?? {})).toEqual(['id', 'type', 'color', 'points', 'size', 'cut']);
    expect(readMarkup([{ ...pen(), cut: 'middle' }])[0]).toEqual(pen());
  });

  it('keeps the cut through a turn, a flip and a move', () => {
    const m = pen({ cut: 'start' });

    expect(turnMarkupLeft([m])[0]).toHaveProperty('cut', 'start');
    expect(flipMarkup([m])[0]).toHaveProperty('cut', 'start');
    expect(moveMarkup(m, 0.1, 0)).toHaveProperty('cut', 'start');
  });
});

describe('markupFields', () => {
  it('omits markup when empty', () => {
    expect(markupFields([])).toEqual({});
    expect(markupFields([pen()])).toEqual({ markup: [pen()] });
  });
});

describe('turnMarkupLeft / flipMarkup', () => {
  const mixed = (): ImageMarkup[] => [
    pen({ points: [0.1, 0.2, 0.5, 0.3, 0.7, 0.9] }),
    shape({ x1: 0.12, y1: 0.08, x2: 0.52, y2: 0.63 }),
    shape({ id: 'a', type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.4 }),
    text({ x: 0.3, y: 0.7, rotation: 30 }),
  ];

  it('moves a rect exactly like rotateLeft moves a crop', () => {
    const crop = { x: 12, y: 8, w: 40, h: 55 };
    const turned = rotateLeft(IDENTITY, crop).crop;
    const rect = asShape(turnMarkupLeft([shape({ x1: 0.12, y1: 0.08, x2: 0.52, y2: 0.63 })])[0]);

    expect(rect.x1).toBeCloseTo(turned.x / 100, 10);
    expect(rect.y1).toBeCloseTo(turned.y / 100, 10);
    expect(rect.x2 - rect.x1).toBeCloseTo(turned.w / 100, 10);
    expect(rect.y2 - rect.y1).toBeCloseTo(turned.h / 100, 10);
  });

  it('moves a rect exactly like flipHorizontal moves a crop', () => {
    const crop = { x: 12, y: 8, w: 40, h: 55 };
    const flipped = flipHorizontal(IDENTITY, crop).crop;
    const rect = asShape(flipMarkup([shape({ x1: 0.12, y1: 0.08, x2: 0.52, y2: 0.63 })])[0]);

    expect(rect.x1).toBeCloseTo(flipped.x / 100, 10);
    expect(rect.y1).toBeCloseTo(flipped.y / 100, 10);
    expect(rect.x2 - rect.x1).toBeCloseTo(flipped.w / 100, 10);
  });

  it('maps points (x, y) to (y, 1 - x) and turns text -90', () => {
    const [stroke, , arrow, label] = turnMarkupLeft(mixed());

    expect(asStroke(stroke).points).toEqual([0.2, 0.9, 0.5, 0.7, 0.7, 0.9]);
    expect(asShape(arrow)).toMatchObject({ x1: 0.2, y1: 0.9, x2: 0.4, y2: 0.2 });
    expect(asText(label)).toMatchObject({ x: 0.7, y: 0.7, rotation: -60 });
  });

  it('flip mirrors x and negates text rotation only', () => {
    const [stroke, , arrow, label] = flipMarkup(mixed());

    expect(asStroke(stroke).points).toEqual([0.9, 0.2, 0.5, 0.7, 0.7, 0.9]);
    expect(asShape(arrow)).toMatchObject({ x1: 0.9, y1: 0.2, x2: 0.2, y2: 0.4 });
    expect(asText(label)).toMatchObject({ x: 0.7, y: 0.7, rotation: -30 });
  });

  it('keeps rect and ellipse corners ordered after a turn', () => {
    const rect = asShape(turnMarkupLeft([shape()])[0]);

    expect(rect.x1).toBeLessThan(rect.x2);
    expect(rect.y1).toBeLessThan(rect.y2);
  });

  it('four turns and two flips are the identity', () => {
    const m = mixed();
    const four = turnMarkupLeft(turnMarkupLeft(turnMarkupLeft(turnMarkupLeft(m))));

    expect(sameMarkup(four, m)).toBe(true);
    expect(sameMarkup(flipMarkup(flipMarkup(m)), m)).toBe(true);
  });

  it('wraps text rotation into (-180, 180] and drops it at 0', () => {
    expect(turnMarkupLeft([text({ rotation: -120 })])[0]).toMatchObject({ rotation: 150 });
    expect(turnMarkupLeft([text({ rotation: 90 })])[0]).not.toHaveProperty('rotation');
    expect(flipMarkup([text({ rotation: 180 })])[0]).toMatchObject({ rotation: 180 });
  });
});

describe('sameMarkup', () => {
  it('compares structurally', () => {
    expect(sameMarkup([pen(), text()], [pen(), text()])).toBe(true);
    expect(sameMarkup([pen()], [pen({ size: 0.02 })])).toBe(false);
    expect(sameMarkup([pen()], [pen({ points: [0.1, 0.1, 0.5] })])).toBe(false);
    expect(sameMarkup([pen()], [])).toBe(false);
    expect(sameMarkup([shape()], [shape({ fill: true })])).toBe(false);
    expect(sameMarkup([text()], [text({ id: 'other' })])).toBe(false);
  });
});

describe('newMarkupId', () => {
  it('returns distinct non-empty strings', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newMarkupId()));

    expect(ids.size).toBe(200);
    expect([...ids].every((id) => id.length >= 8)).toBe(true);
  });
});

describe('commitMarkupItem', () => {
  it('quantises a shape and keeps its id', () => {
    expect(commitMarkupItem(shape({ x1: 0.123456, size: 0.0123456 }))).toEqual(shape({ x1: 0.1235, size: 0.0123 }));
  });

  it('simplifies a straight run of points down to its ends', () => {
    const points = Array.from({ length: 50 }, (_, i) => [0.1 + i * 0.01, 0.3, 0.5]).flat();
    // A highlighter is not pressure-baked, so this reads RDP alone.
    const out = asStroke(commitMarkupItem(pen({ type: 'highlighter', points })));

    expect(out.points).toEqual([0.1, 0.3, 0.5, 0.59, 0.3, 0.5]);
  });

  it('keeps corners and pressure changes', () => {
    const corner = [0.1, 0.1, 0.5, 0.3, 0.1, 0.5, 0.5, 0.1, 0.5, 0.5, 0.3, 0.5];
    const ramp = [0.1, 0.1, 0.2, 0.2, 0.1, 0.9, 0.3, 0.1, 0.2];

    expect(asStroke(commitMarkupItem(pen({ type: 'highlighter', points: corner }))).points).toEqual([0.1, 0.1, 0.5, 0.5, 0.1, 0.5, 0.5, 0.3, 0.5]);
    expect(asStroke(commitMarkupItem(pen({ points: ramp }))).points).toEqual(ramp);
  });

  it('keeps a slow mouse stroke as wide as it was drawn after simplifying', () => {
    const points = Array.from({ length: 50 }, (_, i) => [0.1 + i * 0.001, 0.3, 0.5]).flat();
    const out = asStroke(commitMarkupItem(pen({ points })));
    const pressures = out.points.filter((_, i) => i % 3 === 2);

    expect(pressures.at(-1)).toBeGreaterThan(0.6);
  });

  it('keeps a single-point stroke', () => {
    expect(asStroke(commitMarkupItem(pen({ points: [0.2, 0.2, 0.5] }))).points).toEqual([0.2, 0.2, 0.5]);
  });
});

describe('markupBounds', () => {
  it('pads a stroke by half its width (O px)', () => {
    // size 0.01 x min(1000, 500) = 5 px, half = 2.5
    const box = markupBounds(pen({ points: [0.1, 0.1, 0.5, 0.2, 0.4, 0.5] }), O);

    expect(box).toEqual({ x: 97.5, y: 47.5, w: 105, h: 155 });
  });

  it('pads a rect by half its width', () => {
    expect(markupBounds(shape({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 }), O)).toEqual({ x: 97.5, y: 97.5, w: 405, h: 205 });
  });

  it('pads an arrow enough to hold its head', () => {
    // 400 px shaft at 5 px: head 48 long, wings 0.45 x 48 = 21.6 either side of the shaft
    const box = markupBounds(shape({ type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 }), O);

    expect(box.y).toBeLessThanOrEqual(100 - 21.6);
    expect(box.y + box.h).toBeGreaterThanOrEqual(100 + 21.6);
  });

  it('estimates text from its longest line and line count', () => {
    // font = 0.06 x 500 = 30 px; width = 5 x 0.56 x 30 = 84; height = 2 x 1.25 x 30 = 75
    const box = markupBounds(text({ text: 'Hello\nab' }), O);

    expect(box.w).toBeCloseTo(84, 6);
    expect(box.h).toBeCloseTo(75, 6);
    expect(box.x + box.w / 2).toBeCloseTo(500, 6);
    expect(box.y + box.h / 2).toBeCloseTo(250, 6);
  });

  it('boxes rotated text by its turned rect', () => {
    const box = markupBounds(text({ text: 'Hello\nab', rotation: 90 }), O);

    expect(box.w).toBeCloseTo(75, 6);
    expect(box.h).toBeCloseTo(84, 6);
  });
});

describe('moveMarkup', () => {
  it('shifts every kind by fractions', () => {
    expect(asStroke(moveMarkup(pen({ points: [0.1, 0.1, 0.4] }), 0.1, -0.05)).points).toEqual([0.2, 0.05, 0.4]);
    expect(moveMarkup(shape(), 0.1, 0.1)).toMatchObject({ x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.7 });
    expect(moveMarkup(text(), -0.2, 0)).toMatchObject({ x: 0.3, y: 0.5 });
  });
});

describe('resizeMarkup', () => {
  it('is the identity when the box does not change', () => {
    for (const item of [pen(), shape(), text()]) {
      const box = markupBounds(item, O);

      expect(sameMarkup([resizeMarkup(item, box, box, O)], [item])).toBe(true);
    }
  });

  it('maps rect corners from one box to another', () => {
    const from = { x: 100, y: 100, w: 400, h: 200 };
    const to = { x: 100, y: 100, w: 800, h: 100 };

    expect(resizeMarkup(shape({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 }), from, to, O))
      .toMatchObject({ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.4, size: 0.01 });
  });

  it('scales text font by the height ratio and moves its centre', () => {
    const from = { x: 450, y: 200, w: 100, h: 100 };
    const to = { x: 450, y: 200, w: 100, h: 200 };

    expect(resizeMarkup(text(), from, to, O)).toMatchObject({ x: 0.5, y: 0.6, size: 0.12 });
  });

  it('scales stroke points and size by the geometric mean', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 0, y: 0, w: 200, h: 800 };
    const out = asStroke(resizeMarkup(pen({ points: [0.1, 0.2, 0.5] }), from, to, O));

    expect(out.points).toEqual([0.2, 1.5, 0.5]);
    expect(out.size).toBe(0.04);
  });

  it('does not divide by zero on a flat box', () => {
    const from = { x: 100, y: 100, w: 0, h: 200 };
    const to = { x: 200, y: 100, w: 50, h: 200 };
    const out = asShape(resizeMarkup(shape({ type: 'line', x1: 0.1, y1: 0.2, x2: 0.1, y2: 0.6 }), from, to, O));

    expect(out.x1).toBe(0.2);
    expect(Number.isFinite(out.y2)).toBe(true);
  });

  it('re-orders rect corners when the box is dragged inside out', () => {
    const from = { x: 100, y: 100, w: 400, h: 200 };
    const to = { x: 500, y: 100, w: -400, h: 200 };
    const out = asShape(resizeMarkup(shape({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 }), from, to, O));

    expect(out.x1).toBeLessThan(out.x2);
  });
});

describe('hitTest', () => {
  it('returns null on an empty list or a miss', () => {
    expect(hitTest([], { x: 1, y: 1 }, O, 4)).toBeNull();
    expect(hitTest([pen()], { x: 900, y: 450 }, O, 4)).toBeNull();
  });

  it('hits a stroke within half its width plus tolerance', () => {
    // segment (100,50)->(500,50) at width 5
    const stroke = pen({ points: [0.1, 0.1, 0.5, 0.5, 0.1, 0.5] });

    expect(hitTest([stroke], { x: 300, y: 56 }, O, 4)?.id).toBe('p1');
    expect(hitTest([stroke], { x: 300, y: 57 }, O, 4)).toBeNull();
  });

  it('hits a single-point stroke around the dot', () => {
    expect(hitTest([pen({ points: [0.5, 0.5, 0.5] })], { x: 503, y: 250 }, O, 1)?.id).toBe('p1');
  });

  it('picks the top-most mark', () => {
    const under = shape({ id: 'under', fill: true });
    const over = shape({ id: 'over', fill: true });

    expect(hitTest([under, over], { x: 300, y: 200 }, O, 2)?.id).toBe('over');
  });

  it('hits an unfilled rect only near its outline', () => {
    const rect = shape({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 });

    expect(hitTest([rect], { x: 300, y: 200 }, O, 3)).toBeNull();
    expect(hitTest([rect], { x: 104, y: 200 }, O, 3)?.id).toBe('s1');
    expect(hitTest([rect], { x: 300, y: 302 }, O, 3)?.id).toBe('s1');
    expect(hitTest([rect], { x: 300, y: 310 }, O, 3)).toBeNull();
  });

  it('hits a filled rect anywhere inside', () => {
    expect(hitTest([shape({ fill: true })], { x: 300, y: 200 }, O, 0)?.id).toBe('s1');
  });

  it('hits an ellipse near its outline, or inside when filled', () => {
    // centre (300, 200), radii 200 x 100
    const ring = shape({ type: 'ellipse', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 });

    expect(hitTest([ring], { x: 300, y: 103 }, O, 3)?.id).toBe('s1');
    expect(hitTest([ring], { x: 497, y: 200 }, O, 3)?.id).toBe('s1');
    expect(hitTest([ring], { x: 300, y: 200 }, O, 3)).toBeNull();
    expect(hitTest([{ ...ring, fill: true }], { x: 300, y: 200 }, O, 3)?.id).toBe('s1');
    expect(hitTest([ring], { x: 120, y: 110 }, O, 3)).toBeNull();
  });

  it('hits a line and an arrow along the segment', () => {
    const line = shape({ type: 'line', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.1 });

    expect(hitTest([line], { x: 300, y: 55 }, O, 3)?.id).toBe('s1');
    expect(hitTest([line], { x: 300, y: 60 }, O, 3)).toBeNull();
    expect(hitTest([{ ...line, type: 'arrow' }], { x: 300, y: 55 }, O, 3)?.id).toBe('s1');
  });

  it('hits text inside its estimated, rotated bounds', () => {
    // 30 px font, "Hello" is 84 x 37.5
    const label = text({ text: 'Hello' });

    expect(hitTest([label], { x: 535, y: 250 }, O, 0)?.id).toBe('t1');
    expect(hitTest([label], { x: 545, y: 250 }, O, 0)).toBeNull();
    expect(hitTest([{ ...label, rotation: 90 }], { x: 500, y: 285 }, O, 0)?.id).toBe('t1');
    expect(hitTest([{ ...label, rotation: 90 }], { x: 535, y: 250 }, O, 0)).toBeNull();
  });
});

describe('eraseMarkup', () => {
  // O 1000 × 500, so a pen of size 0.01 is 5 px wide and 2.5 px from centre to edge at pressure 0.5.
  const across = (over: Partial<ImageMarkupStroke> = {}): ImageMarkupStroke =>
    pen({ points: [0.1, 0.2, 0.5, 0.9, 0.2, 0.5], ...over });
  const strokes = (list: ImageMarkup[]): ImageMarkupStroke[] => list.filter(isStroke);
  const xs = (m: ImageMarkupStroke): number[] => m.points.filter((_, i) => i % 3 === 0).map((v) => v * O.w);

  it('cuts a hole in a stroke and keeps the ink on both sides', () => {
    const out = strokes(eraseMarkup([across()], { x: 500, y: 100 }, 20, O));

    expect(out).toHaveLength(2);
    const [left, right] = out;

    if (!left || !right) throw new Error('no pieces');
    // The round cap of each piece stops at the eraser's edge: 20 px + 2.5 px of ink.
    expect(Math.max(...xs(left))).toBeCloseTo(477.5, 0);
    expect(Math.min(...xs(right))).toBeCloseTo(522.5, 0);
    expect(Math.min(...xs(left))).toBeCloseTo(100, 5);
    expect(Math.max(...xs(right))).toBeCloseTo(900, 5);
  });

  it('cuts on the line as drawn, so the ink left over does not move', () => {
    // The renderer smooths the middle point from y 125 down to 137.5; a cut on the raw corner would jump up.
    const peak = pen({ points: [0.1, 0.3, 0.5, 0.5, 0.25, 0.5, 0.9, 0.3, 0.5] });
    const [left] = strokes(eraseMarkup([peak], { x: 500, y: 137.5 }, 20, O));
    const n = left?.points.length ?? 0;
    const x = (left?.points[n - 3] ?? 0) * O.w;
    const y = (left?.points[n - 2] ?? 0) * O.h;

    expect(Math.abs(y - (150 - (12.5 * (x - 100)) / 400))).toBeLessThan(0.5);
  });

  it('cuts between two far-apart points, where no point is under the eraser', () => {
    const out = strokes(eraseMarkup([across()], { x: 300, y: 105 }, 10, O));

    expect(out).toHaveLength(2);
  });

  it('keeps the id on the first piece and gives the rest new ones', () => {
    const out = eraseMarkup([across()], { x: 500, y: 100 }, 20, O);

    expect(out[0]?.id).toBe('p1');
    expect(out[1]?.id).not.toBe('p1');
    expect(out[1]?.id).toMatch(/^.{12}$/);
  });

  it('marks the cut ends, so they render blunt', () => {
    const [left, right] = strokes(eraseMarkup([across()], { x: 500, y: 100 }, 20, O));

    expect(left?.cut).toBe('end');
    expect(right?.cut).toBe('start');
  });

  it('keeps an earlier cut when the other end is cut too', () => {
    const [piece] = strokes(eraseMarkup([across({ cut: 'start' })], { x: 900, y: 100 }, 20, O));

    expect(piece?.cut).toBe('both');
  });

  it('shortens a stroke from one end without splitting it', () => {
    const out = strokes(eraseMarkup([across()], { x: 900, y: 100 }, 20, O));

    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('p1');
    expect(Math.max(...xs(out[0] ?? across()))).toBeCloseTo(877.5, 0);
  });

  it('removes a stroke the eraser covers whole', () => {
    expect(eraseMarkup([pen({ points: [0.5, 0.5, 0.5, 0.51, 0.5, 0.5] })], { x: 505, y: 250 }, 20, O)).toEqual([]);
  });

  it('removes a one-point stroke under the eraser', () => {
    expect(eraseMarkup([pen({ points: [0.5, 0.5, 0.5] })], { x: 520, y: 250 }, 18, O)).toEqual([]);
  });

  it('reaches as far as the highlighter ink, which is wider than the pen', () => {
    // 0.03 × 500 = 15 px wide: 7.5 px from centre to edge.
    const hi = across({ type: 'highlighter', size: 0.03 });

    expect(eraseMarkup([hi], { x: 500, y: 126 }, 20, O)).not.toEqual([hi]);
    expect(eraseMarkup([hi], { x: 500, y: 128 }, 20, O)).toEqual([hi]);
  });

  it('interpolates pressure at a cut', () => {
    const ramp = pen({ points: [0.1, 0.2, 0.2, 0.9, 0.2, 0.8] });
    const [left] = strokes(eraseMarkup([ramp], { x: 500, y: 100 }, 20, O));
    const p = left?.points[left.points.length - 1] ?? 0;

    expect(p).toBeGreaterThan(0.45);
    expect(p).toBeLessThan(0.5);
  });

  it('returns the same list when the eraser touches nothing', () => {
    const list = [across(), shape()];

    expect(eraseMarkup(list, { x: 950, y: 480 }, 10, O)).toBe(list);
  });

  it('removes a shape or a text it touches, whole', () => {
    const list = [shape(), text({ x: 0.8, y: 0.8 })];

    expect(eraseMarkup(list, { x: 100, y: 300 }, 4, O).map((m) => m.id)).toEqual(['t1']);
    expect(eraseMarkup(list, { x: 800, y: 400 }, 4, O).map((m) => m.id)).toEqual(['s1']);
  });

  it('keeps the list in paint order, pieces where the stroke was', () => {
    const out = eraseMarkup([shape({ id: 'a', x1: 0.95, x2: 0.99 }), across(), shape({ id: 'b', x1: 0.95, x2: 0.99 })], { x: 500, y: 100 }, 20, O);

    expect(out.map((m) => m.type)).toEqual(['rect', 'pen', 'pen', 'rect']);
  });

  it('never splits past the saved-item cap, which would drop marks on the next load', () => {
    const filler = Array.from({ length: MAX_MARKUP_ITEMS - 1 }, (_, i) => shape({ id: `f${i}`, x1: 0.95, x2: 0.99, y1: 0.95, y2: 0.99 }));
    const out = eraseMarkup([...filler, across()], { x: 500, y: 100 }, 20, O);

    expect(out.length).toBeLessThanOrEqual(MAX_MARKUP_ITEMS);
    expect(readMarkup(out)).toHaveLength(out.length);
  });

  it('writes pieces that survive a save and load unchanged', () => {
    const out = eraseMarkup([across({ points: [0.1, 0.2, 0.3, 0.4, 0.3, 0.6, 0.9, 0.2, 0.7] })], { x: 400, y: 150 }, 20, O);

    expect(readMarkup(out)).toEqual(out);
  });
});

describe('outlined shapes', () => {
  type Outlined = 'rounded-rect' | 'star' | 'polygon' | 'bubble';
  const OUTLINED: Outlined[] = ['rounded-rect', 'star', 'polygon', 'bubble'];
  // Box (100, 100)..(500, 300) px on O 1000 × 500.
  const box = (type: Outlined, over: Partial<ImageMarkupShape> = {}): ImageMarkupShape =>
    shape({ id: type, type, x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, ...(type === 'bubble' ? { tx: 0.15, ty: 0.8 } : {}), ...over });
  const outline = (m: ImageMarkupShape, o: Size = O): { x: number; y: number }[] => shapeOutline(m, o) ?? [];
  const sameSet = (a: { x: number; y: number }[], b: { x: number; y: number }[]): void => {
    const key = (p: { x: number; y: number }): string => `${Math.round(p.x)},${Math.round(p.y)}`;

    expect(a.map(key).sort()).toEqual(b.map(key).sort());
  };

  it.each(OUTLINED)('%s survives a save and load', (type) => {
    const m = box(type, type === 'star' ? { rotation: 90 } : {});

    expect(readMarkup([m])).toEqual([m]);
  });

  it('a star and a polygon keep their key order with a turn', () => {
    expect(Object.keys(readMarkup([box('star', { rotation: 90, fill: true })])[0] ?? {}))
      .toEqual(['id', 'type', 'color', 'x1', 'y1', 'x2', 'y2', 'size', 'fill', 'rotation']);
    expect(Object.keys(readMarkup([box('bubble')])[0] ?? {})).toEqual(['id', 'type', 'color', 'x1', 'y1', 'x2', 'y2', 'size', 'tx', 'ty']);
  });

  it('a bubble saved without a tail gets one below its box', () => {
    const { tx: _x, ty: _y, ...bare } = box('bubble');
    const read = asShape(readMarkup([bare])[0]);

    expect(read.ty).toBeGreaterThan(0.6);
    expect(read.tx).toBeGreaterThan(0.1);
    expect(read.tx).toBeLessThan(0.5);
  });

  it('draws a five-point star with its top point on the top edge', () => {
    const pts = outline(box('star'));

    expect(pts).toHaveLength(10);
    expect(pts[0]?.x).toBeCloseTo(300, 6);
    expect(pts[0]?.y).toBeCloseTo(100, 6);
  });

  it('draws a hexagon with a point at the top', () => {
    const pts = outline(box('polygon'));

    expect(pts).toHaveLength(6);
    expect(pts[0]?.y).toBeCloseTo(100, 6);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(300, 6);
  });

  it('rounds the corners of a rounded rect inside its box', () => {
    const pts = outline(box('rounded-rect'));

    expect(pts.every((p) => p.x >= 100 - 1e-6 && p.x <= 500 + 1e-6 && p.y >= 100 - 1e-6 && p.y <= 300 + 1e-6)).toBe(true);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - 100, p.y - 100)))).toBeGreaterThan(10);
  });

  it('gives a bubble a tail that reaches its tip', () => {
    const pts = outline(box('bubble'));

    expect(pts.some((p) => Math.abs(p.x - 150) < 1e-6 && Math.abs(p.y - 400) < 1e-6)).toBe(true);
  });

  it.each(OUTLINED)('%s is hit on its outline, and inside only when filled', (type) => {
    const m = box(type);
    const edge = outline(m)[0] ?? { x: 0, y: 0 };

    expect(hitTest([m], edge, O, 2)?.id).toBe(type);
    expect(hitTest([m], { x: 300, y: 200 }, O, 2)).toBeNull();
    expect(hitTest([box(type, { fill: true })], { x: 300, y: 200 }, O, 2)?.id).toBe(type);
  });

  it('bounds a bubble around its tail too', () => {
    const b = markupBounds(box('bubble'), O);

    expect(b.y + b.h).toBeGreaterThanOrEqual(400);
  });

  it.each(['star', 'polygon', 'bubble'] as const)('%s turns with the image, not just its box', (type) => {
    const m = box(type, { rotation: type === 'bubble' ? undefined : 30 });
    const turned = asShape(turnMarkupLeft([m])[0]);

    sameSet(outline(turned, { w: 500, h: 1000 }), outline(m).map((p) => ({ x: p.y, y: 1000 - p.x })));
  });

  it.each(['star', 'polygon', 'bubble'] as const)('%s mirrors with the image', (type) => {
    const m = box(type, { rotation: type === 'bubble' ? undefined : 30 });
    const flipped = asShape(flipMarkup([m])[0]);

    sameSet(outline(flipped), outline(m).map((p) => ({ x: 1000 - p.x, y: p.y })));
  });
});

describe('spotlight', () => {
  const spot = (over: Partial<ImageMarkupShape> = {}): ImageMarkupShape =>
    shape({ id: 'sp', type: 'spotlight', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, ...over });

  it('survives a save and load, and never keeps a fill', () => {
    expect(readMarkup([spot()])).toEqual([spot()]);
    expect(readMarkup([spot({ fill: true })])).toEqual([spot()]);
  });

  it('is a box shape that takes no fill', () => {
    expect(isClosedShape('spotlight')).toBe(true);
    expect(takesFill('spotlight')).toBe(false);
    expect(takesFill('star')).toBe(true);
    expect(takesFill('line')).toBe(false);
  });

  it('is hit on its edge, not inside the lit area where the marks it frames are', () => {
    expect(hitTest([spot()], { x: 100, y: 200 }, O, 2)?.id).toBe('sp');
    expect(hitTest([spot()], { x: 300, y: 200 }, O, 2)).toBeNull();
  });
});

describe('magnifier', () => {
  const lens = (over: Partial<ImageMarkupShape> = {}): ImageMarkupShape =>
    shape({ id: 'mg', type: 'magnifier', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.6, ...over });

  it('survives a save and load, and never keeps a fill', () => {
    expect(readMarkup([lens()])).toEqual([lens()]);
    expect(readMarkup([lens({ fill: true })])).toEqual([lens()]);
  });

  it('is a box shape without a fill', () => {
    expect(isClosedShape('magnifier')).toBe(true);
    expect(takesFill('magnifier')).toBe(false);
  });

  it('is hit anywhere in its lens, not in the corners of its box', () => {
    // Box (100, 100)..(300, 300) px: a lens of radius 100 round (200, 200).
    expect(hitTest([lens()], { x: 200, y: 200 }, O, 2)?.id).toBe('mg');
    expect(hitTest([lens()], { x: 105, y: 105 }, O, 2)).toBeNull();
  });
});

describe('contrastInk', () => {
  it('picks the ink with more contrast for every palette colour', () => {
    expect(MARKUP_COLORS.map((c) => contrastInk(c))).toEqual([
      '#111111', '#ffffff', '#111111', '#111111', '#111111', '#111111', '#111111', '#111111', '#111111',
    ]);
  });

  it('treats an invalid colour as white', () => {
    expect(contrastInk('nope')).toBe('#111111');
  });
});

describe('arrowHeadLength', () => {
  it('is at least four stroke widths and grows with a long shaft, capped', () => {
    expect(arrowHeadLength(5, 100)).toBe(20);
    expect(arrowHeadLength(5, 400)).toBe(48);
    expect(arrowHeadLength(5, 10000)).toBe(50);
  });

  it('never covers more than 60% of a short shaft', () => {
    expect(arrowHeadLength(5, 20)).toBe(12);
  });
});
