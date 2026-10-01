import { nanoid } from 'nanoid';
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

const MAX_ITEMS = 500;
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

const SHAPES: readonly Shape[] = ['rect', 'ellipse', 'line', 'arrow'];
const STYLES: readonly ImageMarkupTextStyle[] = ['outline', 'background'];

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

const isStroke = (m: ImageMarkup): m is ImageMarkupStroke => m.type === 'pen' || m.type === 'highlighter';
const isText = (m: ImageMarkup): m is ImageMarkupText => m.type === 'text';
const isBox = (type: Shape): boolean => type === 'rect' || type === 'ellipse';

export function newMarkupId(): string {
  return nanoid(12);
}

/* Builders fix the key order, so saved JSON and structural compares are stable. */

const buildStroke = (id: string, type: ImageMarkupStroke['type'], color: string, points: number[], size: number): ImageMarkupStroke =>
  ({ id, type, color, points, size });

const buildShape = (src: Omit<ImageMarkupShape, 'size' | 'fill'> & { size: number; fill?: boolean }): ImageMarkupShape => {
  const box = isBox(src.type);
  const [x1, x2] = box && src.x2 < src.x1 ? [src.x2, src.x1] : [src.x1, src.x2];
  const [y1, y2] = box && src.y2 < src.y1 ? [src.y2, src.y1] : [src.y1, src.y2];
  const out: ImageMarkupShape = {
    id: src.id, type: src.type, color: src.color, x1: coord(x1), y1: coord(y1), x2: coord(x2), y2: coord(y2), size: sizeOf(src.size),
  };

  if (box && src.fill === true) out.fill = true;

  return out;
};

const buildText = (src: Omit<ImageMarkupText, 'rotation'> & { rotation?: number }): ImageMarkupText => {
  const out: ImageMarkupText = {
    id: src.id, type: 'text', color: src.color, x: coord(src.x), y: coord(src.y), text: src.text, size: sizeOf(src.size),
  };
  const rotation = isNum(src.rotation) ? normaliseRotation(src.rotation) : 0;

  if (src.style !== undefined && STYLES.includes(src.style)) out.style = src.style;
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

const readStyle = (v: unknown): ImageMarkupTextStyle | undefined => STYLES.find((s) => s === v);

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

    return points.length === 0 ? null : buildStroke(id, type, ink, points, sizeOf(size));
  }

  const shapeType = SHAPES.find((s) => s === type);

  if (shapeType !== undefined) {
    const { x1, y1, x2, y2 } = raw;

    if (!isNum(x1) || !isNum(y1) || !isNum(x2) || !isNum(y2)) return null;

    return buildShape({ id, type: shapeType, color: ink, x1, y1, x2, y2, size, fill: raw.fill === true });
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
    if (out.length >= MAX_ITEMS) break;

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

    return buildStroke(item.id, item.type, item.color, points, item.size);
  }

  if (isText(item)) {
    const c = f({ x: item.x, y: item.y });

    return buildText({ ...item, x: c.x, y: c.y, rotation: turn(item.rotation ?? 0) });
  }

  const a = f({ x: item.x1, y: item.y1 });
  const b = f({ x: item.x2, y: item.y2 });

  return buildShape({ ...item, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
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
export function commitMarkupItem(item: ImageMarkup): ImageMarkup {
  const clean = readItem(item, item.id);

  if (clean === null) return item;

  return isStroke(clean) ? { ...clean, points: simplify(clean.points) } : clean;
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
