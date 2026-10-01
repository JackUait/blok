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
const isShape = (m: ImageMarkup | undefined): m is ImageMarkupShape =>
  m?.type === 'rect' || m?.type === 'ellipse' || m?.type === 'line' || m?.type === 'arrow';
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
