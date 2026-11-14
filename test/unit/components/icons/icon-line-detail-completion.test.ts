import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconClearFormat, IconCode, IconCodeBlock, IconDatabase,
  IconEmojiFlag, IconEmojiSmile, IconEmojiSprout, IconEmojiStar, IconEquation, IconInfo,
  IconMergeCells, IconSplitCell, IconText,
} from '../../../../src/components/icons';

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');
const pathOf = (icon: string, index = 0): string => {
  const path = svgOf(icon).querySelectorAll('path').item(index)?.getAttribute('d');

  if (!path) {
    throw new Error('Missing path');
  }

  return path;
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

// Each subpath's end points, absolute; a closing Z adds nothing.
const subpathsOf = (d: string): Point[][] => segmentsOf(d).reduce<Point[][]>((all, segment) => {
  if (segment.cmd === 'M') {
    all.push([]);
  }
  if (segment.cmd !== 'Z') {
    all[all.length - 1].push(segment.points[segment.points.length - 1]);
  }

  return all;
}, []);
const attributesOf = (element: Element, names: string[]): number[] =>
  names.map(name => Number(element.getAttribute(name)));
const STROKE = 1.25;
// Keyline: neighbouring strokes keep one unit of clear space between their ink.
const CLEAR = 1;
// Keyline type: cap top and baseline shared by every letter glyph.
const CAP = 4.5;
const BASELINE = 15.5;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Blok Line small-detail geometry', () => {
  it('gives the text cap short matching shoulders without a baseline serif', () => {
    const [[leftShoulder, leftCap, rightCap, rightShoulder], stem, ...rest] = subpathsOf(pathOf(IconText));

    expect(rest).toHaveLength(0);
    expect([leftCap[1], rightCap[1]]).toEqual([CAP, CAP]);
    expect(leftShoulder[1] - leftCap[1]).toBe(rightShoulder[1] - rightCap[1]);
    expect(leftCap[0] + rightCap[0]).toBe(20);
    expect(stem).toEqual([[10, CAP], [10, BASELINE]]);
  });

  it('aligns the radical with the type cap and baseline, leaving space above the radicand', () => {
    const [radical] = subpathsOf(pathOf(IconEquation));
    const radicand = subpathsOf(pathOf(IconEquation, 1)).flat();
    const clearCross = subpathsOf(pathOf(IconClearFormat, 1)).flat();
    const [, bottom, top, barEnd] = radical;
    const width = (points: Point[]): number => Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x));
    const height = (points: Point[]): number => Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y));
    const radicandTop = Math.min(...radicand.map(([, y]) => y));

    expect([top[1], bottom[1]]).toEqual([CAP, BASELINE]);
    expect(barEnd[1]).toBe(top[1]);
    expect(width(radicand)).toBeCloseTo(width(clearCross));
    expect(height(radicand)).toBeCloseTo(height(clearCross));
    expect((Math.min(...radicand.map(([x]) => x)) + Math.max(...radicand.map(([x]) => x))) / 2).toBe((top[0] + barEnd[0]) / 2);
    expect(radicandTop - top[1] - STROKE).toBeGreaterThan(STROKE);
  });

  it('uses mirrored four-unit 45-degree inline code chevrons', () => {
    const [left, right] = subpathsOf(pathOf(IconCode));

    expect(right).toEqual(left.map(([x, y]) => [20 - x, y]));
    expect(left[0][0] - left[1][0]).toBe(4);
    expect(left[1][1] - left[0][1]).toBe(4);
    expect(left[2][1] - left[1][1]).toBe(4);
  });

  it('opens the code-block brackets around a narrower, centered slash', () => {
    const [left, right] = subpathsOf(pathOf(IconCodeBlock));
    const [[slashTopX, slashTopY], [slashBottomX, slashBottomY]] = subpathsOf(pathOf(IconCodeBlock, 1))[0];
    const [bracketTopX, bracketTopY] = right[0];
    const slashAtTop = slashTopX + (slashBottomX - slashTopX) * (bracketTopY - slashTopY) / (slashBottomY - slashTopY);

    expect(right).toEqual(left.map(([x, y]) => [20 - x, y]));
    expect([(slashTopX + slashBottomX) / 2, (slashTopY + slashBottomY) / 2]).toEqual([10, 10]);
    expect([slashTopY, slashBottomY]).toEqual([CAP, BASELINE]);
    expect(bracketTopX - slashAtTop - STROKE).toBeGreaterThan(CLEAR);
  });

  it('balances the star around its vertical axis with open lower notches', () => {
    const outline = pathOf(IconEmojiStar);
    const [corners] = subpathsOf(outline);

    // Sharp corners: the round line join softens them, not curves in the path.
    expect(outline).toMatch(/^[MLZ\d. ]+$/);
    expect(outline.endsWith('Z')).toBe(true);
    expect(corners).toHaveLength(10);
    for (const [x, y] of corners) {
      expect(corners.some(([otherX, otherY]) => Math.abs(x + otherX - 20) < 0.001 && y === otherY)).toBe(true);
    }
    const lowerNotch = corners.find(([x, y]) => x === 10 && y > 10);

    if (lowerNotch === undefined) {
      throw new Error('Missing lower star notch');
    }
    const lowerTips = corners.filter(([, y]) => y - lowerNotch[1] >= STROKE);

    expect(lowerTips).toHaveLength(2);
    expect(Math.abs(lowerTips[0][0] - lowerTips[1][0])).toBeGreaterThan(6);
  });

  it('keeps the smile centered and separated from the eyes', () => {
    const eyes = Array.from(svgOf(IconEmojiSmile).querySelectorAll('circle')).slice(1);
    const accent = Array.from(svgOf(IconInfo).querySelectorAll('circle')).find(circle => circle.getAttribute('fill') === 'currentColor');
    const [eyeLeft, eyeRight] = eyes.map(eye => attributesOf(eye, ['cx', 'cy', 'r']));

    // The eyes are Keyline accent dots, placed in mirror.
    eyes.forEach(eye => expect(eye.getAttribute('r')).toBe(accent?.getAttribute('r')));
    expect(eyeLeft[0] + eyeRight[0]).toBe(20);
    expect(eyeLeft[1]).toBe(eyeRight[1]);
    const segments = segmentsOf(pathOf(IconEmojiSmile));

    expect(segments.map(({ cmd }) => cmd)).toStrictEqual(['M', 'C']);
    const [[startX, startY]] = segments[0].points;
    const [[c1x, c1y], [c2x, c2y], [endX, endY]] = segments[1].points;

    expect((startX + endX) / 2).toBe(10);
    expect(startY).toBe(endY);
    expect(c1x + c2x).toBe(20);
    expect(c1y).toBe(c2y);
    for (const eye of eyes) {
      const [cy, radius] = attributesOf(eye, ['cy', 'r']);

      expect(startY - cy - radius - STROKE / 2).toBeGreaterThan(STROKE);
    }
  });

  it('keeps both nature leaves open on opposite sides of their tip-to-base chords', () => {
    expect(svgOf(IconEmojiSprout).querySelectorAll('path')).toHaveLength(3);

    for (const index of [0, 1]) {
      const segments = segmentsOf(pathOf(IconEmojiSprout, index));

      expect(segments.map(({ cmd }) => cmd)).toStrictEqual(['M', 'C', 'C', 'Z']);
      const [base] = segments[0].points;
      const [first, second] = [segments[1], segments[2]];
      const tip = first.points[2];

      expect(second.points[2]).toStrictEqual(base);
      const dx = tip[0] - base[0];
      const dy = tip[1] - base[1];
      // Opposite signs reject a second curve that retraces the first.
      const clearances = [first, second].map(({ from, points: [c1, c2, end] }) => {
        const x = (from[0] + 3 * c1[0] + 3 * c2[0] + end[0]) / 8;
        const y = (from[1] + 3 * c1[1] + 3 * c2[1] + end[1]) / 8;

        return ((x - base[0]) * dy - (y - base[1]) * dx) / Math.hypot(dx, dy);
      });

      expect(clearances[0] * clearances[1]).toBeLessThan(0);
      expect(Math.abs(clearances[0] - clearances[1]) - STROKE).toBeGreaterThanOrEqual(STROKE);
    }
  });

  it('keeps matching flag waves and constant cloth height on an upright pole', () => {
    const svg = svgOf(IconEmojiFlag);
    const segments = segmentsOf(pathOf(IconEmojiFlag));

    expect(svg.querySelector('g, [transform]')).toBeNull();
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(segments.map(({ cmd }) => cmd)).toStrictEqual(['M', 'L', 'C', 'C', 'L', 'C', 'C']);
    const [[poleBottom], [poleTop]] = [segments[0].points, segments[1].points];
    const top = [poleTop, ...segments[2].points, ...segments[3].points];
    const bottom = [segments[4].points[0], ...segments[5].points, ...segments[6].points].reverse();
    const height = bottom[0][1] - top[0][1];

    // The pole is upright, and the cloth hangs from its top and returns to it.
    expect(poleBottom[0]).toBe(poleTop[0]);
    expect(bottom[0][0]).toBe(poleTop[0]);
    expect(height).toBeGreaterThanOrEqual(7.5);
    top.forEach(([x, y], index) => {
      expect(bottom[index][0]).toBe(x);
      expect(bottom[index][1] - y).toBe(height);
    });
  });

  it('gives the database three evenly spaced shallow shelves', () => {
    const svg = svgOf(IconDatabase);
    const ellipse = svg.querySelector('ellipse');

    if (ellipse === null) {
      throw new Error('Missing database lid');
    }
    const [cx, cy, rx, ry] = attributesOf(ellipse, ['cx', 'cy', 'rx', 'ry']);
    const [body] = subpathsOf(pathOf(IconDatabase));
    const [middle] = subpathsOf(pathOf(IconDatabase, 1));
    const shelfDepth = (d: string): number => Math.max(...segmentsOf(d).flatMap(({ points }) => points).map(([, y]) => y));

    expect(cx).toBe(10);
    // Sides run straight down from the lid's widest points.
    expect(body[0]).toEqual([cx - rx, cy]);
    expect(body[body.length - 1]).toEqual([cx + rx, cy]);
    expect(middle[0][0]).toBe(cx - rx);
    expect(middle[middle.length - 1][0]).toBe(cx + rx);
    // Lid, middle shelf and bottom shelf are evenly spaced.
    const bottomY = body[1][1];

    expect(middle[0][1] - cy).toBe(bottomY - middle[0][1]);
    // Every shelf curves as deep as the lid's lower half.
    expect(shelfDepth(pathOf(IconDatabase, 1)) - middle[0][1]).toBeCloseTo(ry, 5);
    expect(shelfDepth(pathOf(IconDatabase)) - bottomY).toBeCloseTo(ry, 5);
  });

  it('makes merge and split one cell frame with mirrored chevrons, pointing in to merge and out to split', () => {
    const frameOf = (icon: string): number[] => {
      const rect = svgOf(icon).querySelector('rect');

      return rect === null ? [] : attributesOf(rect, ['x', 'y', 'width', 'height', 'rx']);
    };
    const chevronsOf = (icon: string): Point[][] => subpathsOf(pathOf(icon, 1));
    const [mergeLeft, mergeRight] = chevronsOf(IconMergeCells);
    const [splitLeft, splitRight] = chevronsOf(IconSplitCell);
    const mergeDivider = subpathsOf(pathOf(IconMergeCells));
    const [splitDivider] = subpathsOf(pathOf(IconSplitCell));
    const [frameX, frameY, frameWidth, frameHeight] = frameOf(IconMergeCells);

    expect(frameOf(IconSplitCell)).toStrictEqual(frameOf(IconMergeCells));
    expect(mergeRight).toEqual(mergeLeft.map(([x, y]) => [20 - x, y]));
    expect(splitRight).toEqual(splitLeft.map(([x, y]) => [20 - x, y]));
    // Merge: the apex points at the centre. Split: it points away.
    expect(mergeLeft[1][0]).toBeGreaterThan(mergeLeft[0][0]);
    expect(splitLeft[1][0]).toBeLessThan(splitLeft[0][0]);
    // Split keeps one full divider; merge's divider stops at both edges, open in the middle.
    expect(splitDivider).toEqual([[10, frameY], [10, frameY + frameHeight]]);
    expect(mergeDivider.map(([start]) => start)).toEqual([[10, frameY], [10, frameY + frameHeight]]);
    mergeDivider.forEach(([, end]) => {
      expect(end[0]).toBe(10);
      // The gap spans the chevrons' rows.
      expect(Math.abs(end[1] - 10)).toBeGreaterThan(Math.abs(mergeLeft[0][1] - 10));
    });
    expect(10 - Math.max(...splitLeft.map(([x]) => x)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(Math.min(...mergeLeft.map(([x]) => x)) - frameX - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(frameX + frameWidth).toBe(20 - frameX);
  });
});
