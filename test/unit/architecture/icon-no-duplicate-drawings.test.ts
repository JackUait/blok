/**
 * Architectural enforcement: no two exported icons are the same drawing.
 *
 * Blok used to ship a second, 24-unit copy of a dozen 20-unit menu icons for
 * image and embed overlay chrome. Both families use the same 6.25% stroke
 * ratio, so the copies rendered identically at any display size — the only
 * real difference was the intrinsic width/height the overlay markup did not
 * want. Two names for one drawing means a redraw silently lands on half the UI
 * and the two copies drift apart.
 *
 * The comparison is resolution-independent: every coordinate, radius and
 * stroke width is divided by the icon's own viewBox, so a 20-unit icon and its
 * 1.2x 24-unit copy normalize to the same signature. Paint is resolved through
 * the root element, so `fill` on the `<svg>` and `fill` on each child compare
 * equal. Path data is absolutized, split into subpaths, and each straight-line
 * subpath is direction-normalized, because a stroked open polyline looks the
 * same drawn either way.
 *
 * Deliberately different optical weights stay legal: the signature carries the
 * stroke ratio, so IconCross (6.25%) and IconCloseThick (7.29%) are distinct,
 * as are IconChevronRight and IconChevronRightSmall.
 *
 * Line caps and joins are deliberately NOT in the signature. They only change
 * open ends and hard corners, the current families were verified pixel-equal
 * by rendering them, and a law that errs toward flagging is the safe
 * direction — a new hit gets a human look rather than slipping through.
 */
import { describe, expect, it } from 'vitest';
import * as icons from '../../../src/components/icons';

/** Attributes that place or size a shape, per SVG element type. */
const GEOMETRY_ATTRS: Readonly<Record<string, readonly string[]>> = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
};

/** Parameter counts per absolute path command. */
const PARAM_COUNT: Readonly<Record<string, number>> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

/**
 * Quantizes to 3 decimals with an epsilon nudge.
 *
 * 6.75/20 is exactly 0.3375 while 8.1/24 lands on 0.33749999999999997; without
 * the nudge the same drawing at two scales rounds to different thousandths.
 */
const round = (value: number): string => (Math.round(value * 1000 + 1e-9) / 1000).toString();

interface Segment {
  command: string;
  params: number[];
}

/** Splits path data into absolute segments, expanding implicit repeats. */
const absolutize = (d: string): Segment[] => {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const segments: Segment[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let letter = '';
  let index = 0;

  const readNumbers = (count: number): number[] => {
    const values: number[] = [];

    for (let i = 0; i < count; i++) {
      values.push(Number(tokens[index++]));
    }

    return values;
  };

  while (index < tokens.length) {
    const token = tokens[index];

    if (/[A-Za-z]/.test(token)) {
      letter = token;
      index++;
    } else if (letter === 'M') {
      letter = 'L';
    } else if (letter === 'm') {
      letter = 'l';
    }

    const upper = letter.toUpperCase();
    const relative = letter !== upper;
    const params = readNumbers(PARAM_COUNT[upper] ?? 0);

    if (upper === 'Z') {
      segments.push({ command: 'Z', params: [] });
      cursorX = startX;
      cursorY = startY;
      continue;
    }

    if (upper === 'H') {
      cursorX = relative ? cursorX + params[0] : params[0];
      segments.push({ command: 'L', params: [cursorX, cursorY] });
      continue;
    }

    if (upper === 'V') {
      cursorY = relative ? cursorY + params[0] : params[0];
      segments.push({ command: 'L', params: [cursorX, cursorY] });
      continue;
    }

    if (upper === 'A') {
      const [rx, ry, rotation, largeArc, sweep, x, y] = params;
      const absX = relative ? cursorX + x : x;
      const absY = relative ? cursorY + y : y;

      segments.push({ command: 'A', params: [rx, ry, rotation, largeArc, sweep, absX, absY] });
      cursorX = absX;
      cursorY = absY;
      continue;
    }

    const absolute = params.map((value, i) => (relative ? value + (i % 2 === 0 ? cursorX : cursorY) : value));

    cursorX = absolute[absolute.length - 2];
    cursorY = absolute[absolute.length - 1];

    if (upper === 'M') {
      startX = cursorX;
      startY = cursorY;
    }
    segments.push({ command: upper, params: absolute });
  }

  return segments;
};

/**
 * Canonicalizes one path: subpaths are compared independently, straight-line
 * subpaths lose their drawing direction, and the subpaths are sorted so paint
 * order does not change the signature.
 */
const canonicalPath = (d: string, scale: number): string => {
  const segments = absolutize(d);
  const subpaths: Segment[][] = [];

  for (const segment of segments) {
    if (segment.command === 'M' || subpaths.length === 0) {
      subpaths.push([]);
    }
    subpaths[subpaths.length - 1].push(segment);
  }

  // An arc's rotation angle and its two boolean flags are not lengths; scaling
  // them would make the same arc at two canvas sizes look like two arcs.
  const scaleParams = (segment: Segment): string =>
    segment.params
      .map((value, i) => (segment.command === 'A' && i >= 2 && i <= 4 ? value.toString() : round(value * scale)))
      .join(' ');

  const rendered = subpaths.map((subpath) => {
    const straight = subpath.every((segment) => segment.command === 'M' || segment.command === 'L');
    const forward = subpath.map((segment) => `${segment.command} ${scaleParams(segment)}`).join(' ');

    if (!straight) {
      return forward;
    }

    const points = subpath.map((segment) => segment.params.map((n) => round(n * scale)).join(' '));
    const backward = [...points].reverse().join(' > ');

    return [points.join(' > '), backward].sort()[0];
  });

  return rendered.sort().join(' | ');
};

/** Scales a whitespace/comma separated `points` list. */
const scalePoints = (points: string, scale: number): string =>
  (points.match(/-?\d*\.?\d+/g) ?? []).map((n) => round(Number(n) * scale)).join(' ');

/**
 * Reduces one icon to a paint- and scale-independent signature.
 *
 * Returns `null` when the markup has no parsable square viewBox — such an icon
 * cannot be compared and is reported separately rather than silently skipped.
 */
const signatureOf = (markup: string): string | null => {
  const host = document.createElement('div');

  host.innerHTML = markup.trim();

  const root = host.querySelector('svg');

  if (root === null) {
    return null;
  }

  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);

  if (viewBox.length !== 4 || viewBox.some((n) => Number.isNaN(n))) {
    return null;
  }

  const [, , width, height] = viewBox;

  if (width !== height || width === 0) {
    return null;
  }

  const scale = 1 / width;
  const inherited = (name: string): string | null => root.getAttribute(name);
  const parts: string[] = [];

  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    const fill = el.getAttribute('fill') ?? inherited('fill') ?? 'black';
    const strokePaint = el.getAttribute('stroke') ?? inherited('stroke') ?? 'none';
    const strokeWidth =
      strokePaint === 'none'
        ? '0'
        : round(Number(el.getAttribute('stroke-width') ?? inherited('stroke-width') ?? 1) * scale);
    const geometry: string[] = [];

    if (tag === 'path') {
      geometry.push(canonicalPath(el.getAttribute('d') ?? '', scale));
    } else {
      for (const attr of GEOMETRY_ATTRS[tag] ?? []) {
        const raw = el.getAttribute(attr);

        if (raw === null) {
          continue;
        }
        geometry.push(`${attr}=${attr === 'points' ? scalePoints(raw, scale) : round(Number(raw) * scale)}`);
      }
    }

    parts.push(`${tag}|${geometry.join(' ')}|${fill}|${strokePaint}|${strokeWidth}`);
  }

  return parts.sort().join('\n');
};

const iconEntries = Object.entries(icons).filter(
  (entry): entry is [string, string] => entry[0].startsWith('Icon') && typeof entry[1] === 'string'
);

describe('icon duplication law', () => {
  it('exports enough icons for the comparison to mean anything', () => {
    expect(iconEntries.length).toBeGreaterThan(100);
  });

  it('gives every icon a comparable square viewBox', () => {
    const unparsable = iconEntries.filter(([, markup]) => signatureOf(markup) === null).map(([name]) => name);

    expect(unparsable).toEqual([]);
  });

  it('keeps deliberately heavier optical variants distinct', () => {
    expect(signatureOf(icons.IconCross)).not.toEqual(signatureOf(icons.IconCloseThick));
    expect(signatureOf(icons.IconChevronRight)).not.toEqual(signatureOf(icons.IconChevronRightSmall));
  });

  it('never exports the same drawing under two names', () => {
    const bySignature = new Map<string, string[]>();

    for (const [name, markup] of iconEntries) {
      const signature = signatureOf(markup);

      if (signature === null) {
        continue;
      }
      const bucket = bySignature.get(signature) ?? [];

      bucket.push(name);
      bySignature.set(signature, bucket);
    }

    const duplicates = Array.from(bySignature.values())
      .filter((names) => names.length > 1)
      .map((names) => names.sort().join(' == '))
      .sort();

    expect(duplicates).toEqual([]);
  });
});
