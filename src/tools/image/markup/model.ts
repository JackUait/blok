import { nanoid } from 'nanoid';
import { bakeMousePressure, inkRadius, smoothStroke } from './freehand';
import type {
  ImageData,
  ImageMarkup,
  ImageMarkupShape,
  ImageMarkupStroke,
  ImageMarkupText,
  ImageMarkupTextStyle,
} from '../../../../types/tools/image';
import type { Box, Point, Size } from '../darkroom/camera';

/** Palette order is the swatch order in the panel. */
export const MARKUP_COLORS: readonly string[] = [
  '#ffffff', '#111111', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#ff2d55',
];

/** Thin, medium, thick — fractions of the image's short side. Shapes use the pen sizes. */
export const MARKUP_SIZES = {
  pen: [0.006, 0.012, 0.024],
  text: [0.04, 0.06, 0.09],
} as const;

export const HIGHLIGHTER_SCALE = 3;

/** readMarkup drops every mark past this on load. */
export const MAX_MARKUP_ITEMS = 500;
const MAX_POINTS = 4000;
const MAX_TEXT = 2000;
const MIN_COORD = -0.5;
const MAX_COORD = 1.5;
const MIN_SIZE = 0.0001;
const MAX_SIZE = 0.5;
const MAX_ID = 64;
const COLOR = /^#[0-9a-f]{6}$/i;

/** Text box estimate shared by bounds, hit testing and the text editor. */
export const TEXT_CHAR_WIDTH = 0.56;
export const TEXT_LINE_HEIGHT = 1.25;

/** RDP tolerance in fractions: about half a pixel on the 1000 px stand-in. */
const SIMPLIFY_TOLERANCE = 0.0005;
/** A pressure change this large keeps a point RDP would drop, so tapers survive. */
const SIMPLIFY_PRESSURE = 0.08;

type Shape = ImageMarkupShape['type'];
type Cut = NonNullable<ImageMarkupStroke['cut']>;

const SHAPES: readonly Shape[] = ['rect', 'rounded-rect', 'ellipse', 'line', 'arrow', 'bubble', 'star', 'polygon'];
/** Shapes whose outline turns with the image: they keep a rotation. */
const TURNING: readonly Shape[] = ['star', 'polygon'];

const STAR_POINTS = 5;
/** Inner radius of a star, as a share of the outer one. */
const STAR_INNER = 0.45;
const POLYGON_SIDES = 6;
/** Corner radius as a share of the shorter side. */
const ROUNDED_CORNER = 0.18;
const BUBBLE_CORNER = 0.3;
/** Segments per quarter-circle corner: enough that the outline reads as a curve. */
const CORNER_STEPS = 8;
/** Tail base width as a share of the edge it leaves from. */
const TAIL_BASE = 0.24;
/** Default tail tip, in box widths and heights from the top-left corner. */
const TAIL_AT = { x: 0.25, y: 1.5 };
const TEXT_STYLE_VALUES: readonly ImageMarkupTextStyle[] = ['outline', 'background'];
const CUT_VALUES: readonly Cut[] = ['start', 'end', 'both'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `+ 0` turns -0 into 0, so saved data never carries "-0". */
const q4 = (v: number): number => Math.round(v * 10000) / 10000 + 0;
const q2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const coord = (v: number): number => q4(clamp(v, MIN_COORD, MAX_COORD));
const sizeOf = (v: number): number => q4(clamp(v, MIN_SIZE, MAX_SIZE));

const normaliseRotation = (deg: number): number => {
  const r = ((deg % 360) + 360) % 360;

  return q2(r > 180 ? r - 360 : r);
};

const UNIT: Size = { w: 1, h: 1 };
const scalePoints = (points: number[], sx: number, sy: number): number[] => {
  const scale = [sx, sy, 1];

  return points.map((v, i) => v * (scale[i % 3] ?? 1));
};
const inPx = (points: number[], o: Size): number[] => scalePoints(points, o.w, o.h);
const inUnits = (points: number[], o: Size): number[] => scalePoints(points, 1 / o.w, 1 / o.h);
const quantizePoints = (points: number[]): number[] => points.map((v, i) => (i % 3 === 2 ? q2(v) : q4(v)));

const isStroke = (m: ImageMarkup): m is ImageMarkupStroke => m.type === 'pen' || m.type === 'highlighter';
const isText = (m: ImageMarkup): m is ImageMarkupText => m.type === 'text';
const isBox = (type: Shape): boolean => type !== 'line' && type !== 'arrow';

/** A shape that encloses its box, so it can take a fill. */
export const isClosedShape = (type: string): boolean => SHAPES.some((s) => s === type && isBox(s));

export function newMarkupId(): string {
  return nanoid(12);
}

/* Builders fix the key order, so saved JSON and structural compares are stable. */

const buildStroke = (id: string, type: ImageMarkupStroke['type'], color: string, points: number[], size: number, cut?: Cut): ImageMarkupStroke =>
  (cut === undefined ? { id, type, color, points, size } : { id, type, color, points, size, cut });

/** Where a bubble's tail points; a bubble without one points below its box. */
const tailTip = (s: Pick<ImageMarkupShape, 'x1' | 'y1' | 'x2' | 'y2' | 'tx' | 'ty'>): Point => ({
  x: isNum(s.tx) ? s.tx : Math.min(s.x1, s.x2) + Math.abs(s.x2 - s.x1) * TAIL_AT.x,
  y: isNum(s.ty) ? s.ty : Math.min(s.y1, s.y2) + Math.abs(s.y2 - s.y1) * TAIL_AT.y,
});

const buildShape = (src: Omit<ImageMarkupShape, 'size' | 'fill'> & { size: number; fill?: boolean }): ImageMarkupShape => {
  const box = isBox(src.type);
  const [x1, x2] = box && src.x2 < src.x1 ? [src.x2, src.x1] : [src.x1, src.x2];
  const [y1, y2] = box && src.y2 < src.y1 ? [src.y2, src.y1] : [src.y1, src.y2];
  const out: ImageMarkupShape = {
    id: src.id, type: src.type, color: src.color, x1: coord(x1), y1: coord(y1), x2: coord(x2), y2: coord(y2), size: sizeOf(src.size),
  };
  const rotation = isNum(src.rotation) ? normaliseRotation(src.rotation) : 0;

  if (box && src.fill === true) out.fill = true;
  if (TURNING.includes(src.type) && rotation !== 0) out.rotation = rotation;
  if (src.type === 'bubble') {
    const tip = tailTip({ x1, y1, x2, y2, tx: src.tx, ty: src.ty });

    out.tx = coord(tip.x);
    out.ty = coord(tip.y);
  }

  return out;
};

const buildText = (src: Omit<ImageMarkupText, 'rotation'> & { rotation?: number }): ImageMarkupText => {
  const out: ImageMarkupText = {
    id: src.id, type: 'text', color: src.color, x: coord(src.x), y: coord(src.y), text: src.text, size: sizeOf(src.size),
  };
  const rotation = isNum(src.rotation) ? normaliseRotation(src.rotation) : 0;

  if (src.style !== undefined && TEXT_STYLE_VALUES.includes(src.style)) out.style = src.style;
  if (rotation !== 0) out.rotation = rotation;

  return out;
};

interface Triple<T> { x: T; y: T; p: T }

/** Flat x, y, p list as triples; a trailing partial triple is dropped. */
const triples = <T>(flat: readonly T[]): Triple<T>[] =>
  Array.from({ length: Math.floor(flat.length / 3) }, (_, k) => k * 3).flatMap((i) => {
    const [x, y, p] = [flat[i], flat[i + 1], flat[i + 2]];

    return x === undefined || y === undefined || p === undefined ? [] : [{ x, y, p }];
  });

const readPoints = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];

  const list: readonly unknown[] = raw;

  return triples(list)
    .flatMap(({ x, y, p }) => (isNum(x) && isNum(y) ? [coord(x), coord(y), q2(isNum(p) ? clamp(p, 0, 1) : 0.5)] : []))
    .slice(0, MAX_POINTS * 3);
};

const readStyle = (v: unknown): ImageMarkupTextStyle | undefined => TEXT_STYLE_VALUES.find((s) => s === v);

const readText = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  // Code points, so a cut never splits a surrogate pair.
  const chars = Array.from(raw);

  return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT).join('') : raw;
};

const readItem = (raw: unknown, id: string): ImageMarkup | null => {
  if (!isRecord(raw)) return null;

  const { type, color, size } = raw;

  if (typeof color !== 'string' || !COLOR.test(color) || !isNum(size) || size <= 0) return null;

  const ink = color.toLowerCase();

  if (type === 'pen' || type === 'highlighter') {
    const points = readPoints(raw.points);

    return points.length === 0 ? null : buildStroke(id, type, ink, points, sizeOf(size), CUT_VALUES.find((c) => c === raw.cut));
  }

  const shapeType = SHAPES.find((s) => s === type);

  if (shapeType !== undefined) {
    const { x1, y1, x2, y2, rotation, tx, ty } = raw;

    if (!isNum(x1) || !isNum(y1) || !isNum(x2) || !isNum(y2)) return null;

    return buildShape({
      id, type: shapeType, color: ink, x1, y1, x2, y2, size, fill: raw.fill === true,
      rotation: isNum(rotation) ? rotation : undefined,
      ...(isNum(tx) && isNum(ty) ? { tx, ty } : {}),
    });
  }

  if (type === 'text') {
    const value = readText(raw.text);
    const { x, y, rotation } = raw;

    if (value === null || !isNum(x) || !isNum(y)) return null;

    return buildText({
      id, type, color: ink, x, y, text: value, size, style: readStyle(raw.style), rotation: isNum(rotation) ? rotation : undefined,
    });
  }

  return null;
};

const readId = (raw: unknown): string | null => {
  const id = isRecord(raw) ? raw.id : undefined;

  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID ? id : null;
};

export function readMarkup(raw: unknown): ImageMarkup[] {
  if (!Array.isArray(raw)) return [];

  const out: ImageMarkup[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (out.length >= MAX_MARKUP_ITEMS) break;

    const wanted = readId(entry);
    const id = wanted !== null && !seen.has(wanted) ? wanted : newMarkupId();
    const item = readItem(entry, id);

    if (item === null) continue;
    seen.add(id);
    out.push(item);
  }

  return out;
}

export function markupFields(m: ImageMarkup[]): Pick<ImageData, 'markup'> {
  return m.length > 0 ? { markup: m } : {};
}

/** Applies `f` to every point; text rotation goes through `turn`. */
const mapMarkup = (item: ImageMarkup, f: (p: Point) => Point, turn: (deg: number) => number): ImageMarkup => {
  if (isStroke(item)) {
    const points = triples(item.points).flatMap(({ x, y, p }) => {
      const at = f({ x, y });

      return [coord(at.x), coord(at.y), p];
    });

    return buildStroke(item.id, item.type, item.color, points, item.size, item.cut);
  }

  if (isText(item)) {
    const c = f({ x: item.x, y: item.y });

    return buildText({ ...item, x: c.x, y: c.y, rotation: turn(item.rotation ?? 0) });
  }

  const a = f({ x: item.x1, y: item.y1 });
  const b = f({ x: item.x2, y: item.y2 });
  const tip = item.tx !== undefined && item.ty !== undefined ? f({ x: item.tx, y: item.ty }) : null;

  return buildShape({
    ...item, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    ...(TURNING.includes(item.type) ? { rotation: turn(item.rotation ?? 0) } : {}),
    ...(tip ? { tx: tip.x, ty: tip.y } : {}),
  });
};

/** View-space quarter turn counter-clockwise, like `rotateLeft` in geometry.ts. */
export function turnMarkupLeft(m: ImageMarkup[]): ImageMarkup[] {
  return m.map((item) => mapMarkup(item, (p) => ({ x: p.y, y: 1 - p.x }), (deg) => deg - 90));
}

/** Mirror left to right, like `flipHorizontal`. Text stays readable: only its turn negates. */
export function flipMarkup(m: ImageMarkup[]): ImageMarkup[] {
  return m.map((item) => mapMarkup(item, (p) => ({ x: 1 - p.x, y: p.y }), (deg) => -deg));
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);

    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
  }

  return a === b;
};

export function sameMarkup(a: ImageMarkup[], b: ImageMarkup[]): boolean {
  return sameValue(a, b);
}

const lineDistance = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);

  return len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / len;
};

/** Ramer–Douglas–Peucker over x, y; a point whose pressure departs from the chord is also kept. */
const simplify = (points: number[]): number[] => {
  const n = points.length / 3;

  if (n <= 2) return points;

  const keep = new Uint8Array(n);
  const stack: [number, number][] = [[0, n - 1]];

  keep[0] = 1;
  keep[n - 1] = 1;

  const pts = triples(points);
  /** How far point i strays from the chord, in tolerances; above 1 it must stay. */
  const stray = (i: number, first: number, last: number): number => {
    const a = pts[first] ?? { x: 0, y: 0, p: 0 };
    const b = pts[last] ?? a;
    const v = pts[i] ?? a;
    const t = (i - first) / (last - first);

    return Math.max(
      lineDistance(v.x, v.y, a.x, a.y, b.x, b.y) / SIMPLIFY_TOLERANCE,
      Math.abs(v.p - (a.p + (b.p - a.p) * t)) / SIMPLIFY_PRESSURE
    );
  };

  // Iterative: 4000 points could blow the call stack.
  while (stack.length > 0) {
    const [first, last] = stack.pop() ?? [0, 0];
    const worst = Array.from({ length: Math.max(0, last - first - 1) }, (_, k) => first + 1 + k)
      .reduce((best, i) => {
        const score = stray(i, first, last);

        return score > best.score ? { i, score } : best;
      }, { i: -1, score: 1 });

    if (worst.i > 0) {
      keep[worst.i] = 1;
      stack.push([first, worst.i], [worst.i, last]);
    }
  }

  return points.filter((_, i) => keep[Math.floor(i / 3)] === 1);
};

/** Quantises a finished mark and simplifies a stroke. Keeps the id. */
export function commitMarkupItem(item: ImageMarkup, o: Size = UNIT): ImageMarkup {
  const clean = readItem(item, item.id);

  if (clean === null) return item;
  if (!isStroke(clean)) return clean;
  // Baked in O px, where render.ts simulates it, so the committed pen keeps its live width.
  const points = clean.type === 'pen' ? inUnits(bakeMousePressure(inPx(clean.points, o), clean.size * Math.min(o.w, o.h)), o) : clean.points;

  return { ...clean, points: simplify(quantizePoints(points)) };
}

const shortSide = (o: Size): number => Math.min(o.w, o.h);

/** Arrow wing reach either side of the shaft, in head lengths. render.ts draws with it. */
export const ARROW_HEAD_HALF_WIDTH = 0.45;

/** Arrow head length in px for a stroke `width` px and a shaft `len` px long. */
export function arrowHeadLength(width: number, len: number): number {
  const head = Math.max(4 * width, Math.min(0.12 * len, 10 * width));

  return len > 0 ? Math.min(head, 0.6 * len) : head;
}

export function textBoxSize(item: ImageMarkupText, o: Size): Size {
  const font = item.size * shortSide(o);
  const lines = item.text.split('\n');
  const longest = Math.max(...lines.map((line) => Array.from(line).length));

  return { w: longest * TEXT_CHAR_WIDTH * font, h: lines.length * TEXT_LINE_HEIGHT * font };
}

const boxAround = (xs: number[], ys: number[], pad: number): Box => {
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;

  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
};

const pxBox = (item: ImageMarkupShape, o: Size): Box => {
  const x = Math.min(item.x1, item.x2) * o.w;
  const y = Math.min(item.y1, item.y2) * o.h;

  return { x, y, w: Math.abs(item.x2 - item.x1) * o.w, h: Math.abs(item.y2 - item.y1) * o.h };
};

/** Points round an ellipse inscribed in `b`, starting at the top and going clockwise. */
const ring = (b: Box, radii: number[], rotation: number): Point[] => {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const turn = (rotation * Math.PI) / 180;

  return radii.map((k, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / radii.length + turn;

    return { x: c.x + (b.w / 2) * k * Math.cos(a), y: c.y + (b.h / 2) * k * Math.sin(a) };
  });
};

const arc = (c: Point, r: number, from: number): Point[] =>
  Array.from({ length: CORNER_STEPS + 1 }, (_, k) => {
    const a = from + ((Math.PI / 2) * k) / CORNER_STEPS;

    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });

type Side = 'top' | 'right' | 'bottom' | 'left';

/** Rounded box, clockwise from the top edge; `tail` points go in the middle of their side. */
const roundedBox = (b: Box, r: number, tail: { side: Side; pts: Point[] } | null): Point[] => {
  const x2 = b.x + b.w;
  const y2 = b.y + b.h;
  const on = (side: Side): Point[] => (tail?.side === side ? tail.pts : []);

  return [
    ...on('top'),
    ...arc({ x: x2 - r, y: b.y + r }, r, -Math.PI / 2),
    ...on('right'),
    ...arc({ x: x2 - r, y: y2 - r }, r, 0),
    ...on('bottom'),
    ...arc({ x: b.x + r, y: y2 - r }, r, Math.PI / 2),
    ...on('left'),
    ...arc({ x: b.x + r, y: b.y + r }, r, Math.PI),
  ];
};

const sideFacing = (vertical: boolean, positive: boolean): Side => {
  if (vertical) return positive ? 'bottom' : 'top';

  return positive ? 'right' : 'left';
};

/** The tail: base on the side facing the tip, clear of the corners. Null when the tip is inside the body. */
const bubbleTail = (b: Box, r: number, tip: Point): { side: Side; pts: Point[] } | null => {
  const dx = b.w > 0 ? (tip.x - (b.x + b.w / 2)) / (b.w / 2) : 0;
  const dy = b.h > 0 ? (tip.y - (b.y + b.h / 2)) / (b.h / 2) : 0;

  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return null;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const side = sideFacing(vertical, (vertical ? dy : dx) > 0);
  const len = vertical ? b.w : b.h;
  const half = (len * TAIL_BASE) / 2;
  const lo = (vertical ? b.x : b.y) + r + half;
  const hi = (vertical ? b.x + b.w : b.y + b.h) - r - half;
  const mid = lo > hi ? (lo + hi) / 2 : clamp(vertical ? tip.x : tip.y, lo, hi);
  const at = (t: number): Point => {
    if (side === 'top') return { x: t, y: b.y };
    if (side === 'bottom') return { x: t, y: b.y + b.h };

    return side === 'left' ? { x: b.x, y: t } : { x: b.x + b.w, y: t };
  };
  // Clockwise: top and right run with the axis, bottom and left against it.
  const forward = side === 'top' || side === 'right';
  const [first, last] = forward ? [mid - half, mid + half] : [mid + half, mid - half];

  return { side, pts: [at(first), tip, at(last)] };
};

/** The closed outline (O px) of a rounded rect, bubble, star or polygon; null for other marks. */
export function shapeOutline(item: ImageMarkup, o: Size): Point[] | null {
  if (isStroke(item) || isText(item)) return null;
  const b = pxBox(item, o);
  const rotation = item.rotation ?? 0;

  if (item.type === 'star') {
    return ring(b, Array.from({ length: STAR_POINTS * 2 }, (_, i) => (i % 2 === 0 ? 1 : STAR_INNER)), rotation);
  }
  if (item.type === 'polygon') return ring(b, Array.from({ length: POLYGON_SIDES }, () => 1), rotation);
  if (item.type === 'rounded-rect') return roundedBox(b, Math.min(b.w, b.h) * ROUNDED_CORNER, null);
  if (item.type === 'bubble') {
    const r = Math.min(b.w, b.h) * BUBBLE_CORNER;
    const tip = tailTip(item);

    return roundedBox(b, r, bubbleTail(b, r, { x: tip.x * o.w, y: tip.y * o.h }));
  }

  return null;
}

/** Even-odd test against a closed outline. */
const encloses = (p: Point, pts: Point[]): boolean =>
  pts.reduce((acc, a, i) => {
    const b = pts[(i + 1) % pts.length] ?? a;
    const crosses = (a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;

    return crosses ? !acc : acc;
  }, false);

const outlineDistance = (p: Point, pts: Point[]): number =>
  Math.min(...pts.map((a, i) => segmentDistance(p, a, pts[(i + 1) % pts.length] ?? a)));

/** O px box padded by half the stroke (arrows: the head's wings). Editors pass it to resizeMarkup as `from`. */
export function markupBounds(item: ImageMarkup, o: Size): Box {
  const half = (item.size * shortSide(o)) / 2;

  if (isStroke(item)) {
    const pts = triples(item.points);

    return boxAround(pts.map((v) => v.x * o.w), pts.map((v) => v.y * o.h), half);
  }

  if (isText(item)) {
    const box = textBoxSize(item, o);
    const t = ((item.rotation ?? 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(t));
    const s = Math.abs(Math.sin(t));
    const w = box.w * c + box.h * s;
    const h = box.w * s + box.h * c;

    return { x: item.x * o.w - w / 2, y: item.y * o.h - h / 2, w, h };
  }

  const outline = shapeOutline(item, o);

  if (outline !== null) return boxAround(outline.map((v) => v.x), outline.map((v) => v.y), half);

  const len = Math.hypot((item.x2 - item.x1) * o.w, (item.y2 - item.y1) * o.h);
  const wings = item.type === 'arrow' ? arrowHeadLength(half * 2, len) * ARROW_HEAD_HALF_WIDTH : 0;

  return boxAround([item.x1 * o.w, item.x2 * o.w], [item.y1 * o.h, item.y2 * o.h], Math.max(half, wings));
}

export function moveMarkup(item: ImageMarkup, dx: number, dy: number): ImageMarkup {
  return mapMarkup(item, (p) => ({ x: p.x + dx, y: p.y + dy }), (deg) => deg);
}

/** Maps a mark from box `from` to box `to` (both O px). A flat side keeps its scale. */
export function resizeMarkup(item: ImageMarkup, from: Box, to: Box, o: Size): ImageMarkup {
  const sx = from.w !== 0 ? to.w / from.w : 1;
  const sy = from.h !== 0 ? to.h / from.h : 1;
  const f = (p: Point): Point => ({
    x: (to.x + (p.x * o.w - from.x) * sx) / o.w,
    y: (to.y + (p.y * o.h - from.y) * sy) / o.h,
  });
  const moved = mapMarkup(item, f, (deg) => deg);

  if (isText(moved)) return { ...moved, size: sizeOf(moved.size * Math.abs(sy)) };
  if (isStroke(moved)) return { ...moved, size: sizeOf(moved.size * Math.sqrt(Math.abs(sx * sy))) };

  return moved;
}

const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);

  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Distance to an ellipse outline, first-order (exact on the axes, good near the curve). */
const ellipseDistance = (p: Point, c: Point, rx: number, ry: number): number => {
  if (rx === 0 || ry === 0) {
    return segmentDistance(p, { x: c.x - rx, y: c.y - ry }, { x: c.x + rx, y: c.y + ry });
  }

  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const f = (dx / rx) ** 2 + (dy / ry) ** 2 - 1;
  const g = Math.hypot((2 * dx) / (rx * rx), (2 * dy) / (ry * ry));

  return g === 0 ? Math.min(rx, ry) : Math.abs(f) / g;
};

const hits = (item: ImageMarkup, p: Point, o: Size, tolerance: number): boolean => {
  const width = item.size * shortSide(o);
  const reach = width / 2 + tolerance;
  const px = (x: number, y: number): Point => ({ x: x * o.w, y: y * o.h });

  if (isStroke(item)) {
    const pts = triples(item.points).map((v) => px(v.x, v.y));

    if (pts.length === 1 && pts[0] !== undefined) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach;

    return pts.some((a, i) => {
      const b = pts[i + 1];

      return b !== undefined && segmentDistance(p, a, b) <= reach;
    });
  }

  if (isText(item)) {
    const box = textBoxSize(item, o);
    const t = (-(item.rotation ?? 0) * Math.PI) / 180;
    const dx = p.x - item.x * o.w;
    const dy = p.y - item.y * o.h;
    const lx = dx * Math.cos(t) - dy * Math.sin(t);
    const ly = dx * Math.sin(t) + dy * Math.cos(t);

    return Math.abs(lx) <= box.w / 2 + tolerance && Math.abs(ly) <= box.h / 2 + tolerance;
  }

  const outline = shapeOutline(item, o);

  if (outline !== null) return outlineDistance(p, outline) <= reach || (item.fill === true && encloses(p, outline));

  const a = px(item.x1, item.y1);
  const b = px(item.x2, item.y2);

  if (item.type === 'line' || item.type === 'arrow') return segmentDistance(p, a, b) <= reach;

  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);

  if (item.type === 'rect') {
    const outside = Math.max(left - p.x, p.x - right, top - p.y, p.y - bottom);

    return item.fill === true ? outside <= reach : Math.abs(outside) <= reach;
  }

  const c = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const inside = rx > 0 && ry > 0 && ((p.x - c.x) / rx) ** 2 + ((p.y - c.y) / ry) ** 2 <= 1;

  return (item.fill === true && inside) || ellipseDistance(p, c, rx, ry) <= reach;
};

interface Ink { x: number; y: number; p: number; r: number }

/** Where along a→b (0..1) the ink comes within `radius` of `c`. Ink width varies linearly with t. */
const insideSpan = (a: Ink, b: Ink, c: Point, radius: number): [number, number] | null => {
  const ex = a.x - c.x;
  const ey = a.y - c.y;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = radius + a.r;
  const m = b.r - a.r;
  // |e + t·d|² = (k + t·m)²
  const qa = dx * dx + dy * dy - m * m;
  const qb = 2 * (ex * dx + ey * dy - k * m);
  const qc = ex * ex + ey * ey - k * k;

  if (qa <= 1e-9) {
    // A tiny segment with a big width change: treat it at its wider end.
    const reach = radius + Math.max(a.r, b.r);

    return segmentDistance(c, a, b) < reach ? [0, 1] : null;
  }
  const disc = qb * qb - 4 * qa * qc;

  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  const t0 = Math.max(0, (-qb - root) / (2 * qa));
  const t1 = Math.min(1, (-qb + root) / (2 * qa));

  return t0 < t1 ? [t0, t1] : null;
};

const mixInk = (a: Ink, b: Ink, t: number): Ink => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t, r: a.r + (b.r - a.r) * t,
});

const joinCut = (start: boolean, end: boolean): Cut | undefined => {
  if (start && end) return 'both';
  if (start) return 'start';

  return end ? 'end' : undefined;
};

interface Run { pts: Ink[]; cutStart: boolean; cutEnd: boolean }

/** The runs of a stroke left outside the eraser; null when it does not reach the ink. */
const cutStroke = (item: ImageMarkupStroke, c: Point, radius: number, o: Size): Run[] | null => {
  const width = item.size * shortSide(o);
  const ink = triples(item.points).map(({ x, y, p }) => ({
    x: x * o.w, y: y * o.h, p, r: item.type === 'pen' ? inkRadius(width, p) : width / 2,
  }));
  // The renderer draws through smoothed points; cut where the ink is drawn, keep the stored points.
  const flat = smoothStroke(ink.flatMap((v) => [v.x, v.y, v.p]));
  const drawn = ink.map((v, i) => ({ ...v, x: flat[i * 3] ?? v.x, y: flat[i * 3 + 1] ?? v.y }));
  const first = ink[0];

  if (first === undefined) return null;
  if (ink.length === 1) return Math.hypot(first.x - c.x, first.y - c.y) < radius + first.r ? [] : null;
  const runs: Run[] = [{ pts: [first], cutStart: item.cut === 'start' || item.cut === 'both', cutEnd: false }];
  const state = { touched: false, inside: false };

  ink.slice(1).forEach((b, i) => {
    const a = ink[i] ?? b;
    const da = drawn[i] ?? a;
    const db = drawn[i + 1] ?? b;
    const span = insideSpan(da, db, c, radius);
    const run = runs[runs.length - 1];

    if (span === null) {
      if (state.inside) runs.push({ pts: [a], cutStart: true, cutEnd: false });
      state.inside = false;
      runs[runs.length - 1]?.pts.push(b);

      return;
    }
    state.touched = true;
    const [t0, t1] = span;

    if (!state.inside && t0 > 0 && run) {
      run.pts.push(mixInk(da, db, t0));
      run.cutEnd = true;
    } else if (!state.inside && run) {
      run.cutEnd = true;
    }
    state.inside = t1 >= 1;
    if (!state.inside) runs.push({ pts: [mixInk(da, db, t1), b], cutStart: true, cutEnd: false });
  });
  if (!state.touched) return null;
  const last = runs[runs.length - 1];

  if (last && !state.inside) last.cutEnd = item.cut === 'end' || item.cut === 'both';

  // A one-point run is a start that was already inside the eraser.
  return runs.filter((r) => r.pts.length > 1);
};

/**
 * Erases what lies under a round eraser at `at` (O px) of `radius` px. Strokes lose only the
 * ink under it and may split; shapes and text it touches go whole. The first piece keeps the id.
 * Returns `list` itself when nothing changed.
 */
export function eraseMarkup(list: ImageMarkup[], at: Point, radius: number, o: Size): ImageMarkup[] {
  const state = { changed: false, count: list.length };
  const out = list.flatMap((item): ImageMarkup[] => {
    if (!isStroke(item)) {
      if (!hits(item, at, o, radius)) return [item];
      state.changed = true;
      state.count -= 1;

      return [];
    }
    const b = markupBounds(item, o);
    const reach = radius + (item.size * shortSide(o));

    if (at.x < b.x - reach || at.x > b.x + b.w + reach || at.y < b.y - reach || at.y > b.y + b.h + reach) return [item];
    const runs = cutStroke(item, at, radius, o);

    if (runs === null) return [item];
    state.changed = true;
    // Past the cap the extra pieces would vanish on the next load; take the stroke whole instead.
    if (state.count - 1 + runs.length > MAX_MARKUP_ITEMS) {
      state.count -= 1;

      return [];
    }
    state.count += runs.length - 1;

    return runs.map((run, k) => buildStroke(
      k === 0 ? item.id : newMarkupId(),
      item.type,
      item.color,
      quantizePoints(run.pts.flatMap((v) => [coord(v.x / o.w), coord(v.y / o.h), clamp(v.p, 0, 1)])),
      item.size,
      joinCut(run.cutStart, run.cutEnd)
    ));
  });

  return state.changed ? out : list;
}

/** Top-most mark under `p` (O px), or null. */
export function hitTest(m: ImageMarkup[], p: Point, o: Size, tolerance: number): ImageMarkup | null {
  return [...m].reverse().find((item) => hits(item, p, o, tolerance)) ?? null;
}

const channel = (v: number): number => {
  const c = v / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);

  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

const DARK_INK = '#111111';
const LIGHT_INK = '#ffffff';

/** The ink (near-black or white) with more contrast against `color`. Invalid colours count as white. */
export function contrastInk(color: string): string {
  const l = COLOR.test(color) ? luminance(color) : 1;
  const dark = luminance(DARK_INK);

  return (l + 0.05) / (dark + 0.05) >= 1.05 / (l + 0.05) ? DARK_INK : LIGHT_INK;
}

export function isMarkupColor(v: unknown): v is string {
  return typeof v === 'string' && COLOR.test(v);
}
