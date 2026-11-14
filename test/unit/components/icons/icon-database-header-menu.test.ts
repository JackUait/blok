/**
 * The database column header menu's action glyphs (notion-live-8/80-menu-number.png):
 * Change type is a square loop of two arrows, Group is two rules each over a row of
 * three dots, and Insert left / right push an arrow into a column bar.
 */
import { describe, expect, it } from 'vitest';

import { IconArrowRightLine, IconChangeType, IconColumnInsertLeft, IconColumnInsertRight, IconGroup, IconInsertLeft } from '../../../../src/components/icons';

const svgOf = (markup: string): Element => {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;

  return svg;
};

const paths = (markup: string): string[] => [...svgOf(markup).querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');

interface Box { x: number; y: number; width: number; height: number }

const rects = (markup: string): Box[] => [...svgOf(markup).querySelectorAll('rect')].map((rect) => ({
  x: Number(rect.getAttribute('x')),
  y: Number(rect.getAttribute('y')),
  width: Number(rect.getAttribute('width')),
  height: Number(rect.getAttribute('height')),
}));

const STROKE = 1.25;

describe('column insert glyphs', () => {
  it('mirror each other across the canvas centre', () => {
    const [left] = rects(IconColumnInsertLeft);
    const [right] = rects(IconColumnInsertRight);

    expect(left.x + left.width / 2 + right.x + right.width / 2).toBe(20);
    expect(right.y).toBe(left.y);
    expect(right.height).toBe(left.height);
  });

  it('point the arrow into the bar, a stroke clear of it', () => {
    const [bar] = rects(IconColumnInsertLeft);
    const tip = Number(/H(\d+(?:\.\d+)?)/.exec(paths(IconColumnInsertLeft)[0])?.[1]);

    // The left bar's arrow tip sits to the bar's right, so the arrow points at it.
    expect(tip).toBeGreaterThan(bar.x + bar.width);
    expect(tip - (bar.x + bar.width) - STROKE).toBeGreaterThanOrEqual(STROKE);
  });

  it('use a bar as tall as the Keyline square frame (y 3.5 to 16.5)', () => {
    const [bar] = rects(IconColumnInsertLeft);

    expect([bar.y, bar.y + bar.height]).toEqual([3.5, 16.5]);
  });
});

describe('group glyph', () => {
  const boxes = rects(IconGroup);

  it('draws two rows of three dots', () => {
    expect(boxes).toHaveLength(6);
    expect(new Set(boxes.map((box) => box.y)).size).toBe(2);
  });

  it('keeps one stroke between each dot and its neighbour', () => {
    const row = boxes.filter((box) => box.y === boxes[0].y).sort((a, b) => a.x - b.x);

    for (let i = 1; i < row.length; i++) {
      expect(row[i].x - (row[i - 1].x + row[i - 1].width) - STROKE).toBeGreaterThanOrEqual(STROKE - 0.01);
    }
  });

  it('runs each rule over its whole row of dots, inside the 3 to 17 content box', () => {
    const rules = paths(IconGroup).join('').split('M').filter(Boolean).map((rule) => {
      const [x, rest] = rule.split(' ');
      const length = Number(/h([\d.]+)/.exec(rest)?.[1]);

      return { from: Number(x), to: Number(x) + length };
    });
    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.width));

    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.from).toBeGreaterThanOrEqual(3);
      expect(rule.from).toBeLessThanOrEqual(left);
      expect(rule.to).toBeGreaterThanOrEqual(right);
      expect(rule.to).toBeLessThanOrEqual(17);
    }
  });
});

describe('change type glyph', () => {
  it('draws two arrows whose tips sit on opposite sides of the loop', () => {
    const heads = paths(IconChangeType)
      .flatMap((d) => d.match(/M[^M]+/g) ?? [])
      .filter((d) => /^M[\d.]+ [\d.]+l/.test(d));

    expect(heads).toHaveLength(2);
    // A head is "M x y l dx1 dy1 dx2 dy2"; its tip is the middle point.
    const tips = heads.map((d) => {
      const [x = 0, y = 0, dx = 0, dy = 0] = (d.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

      return [x + dx, y + dy];
    });
    const [first = [], second = []] = tips;

    // Opposite sides: the tips are a half turn apart about the canvas centre.
    expect([(first[0] ?? 0) + (second[0] ?? 0), (first[1] ?? 0) + (second[1] ?? 0)]).toEqual([20, 20]);
  });

  it('stays inside the 3 to 17 content box', () => {
    const numbers = paths(IconChangeType).join(' ').match(/M[\d.]+ [\d.]+/g) ?? [];

    for (const move of numbers) {
      const [x, y] = move.slice(1).split(' ').map(Number);

      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThanOrEqual(17);
      expect(y).toBeGreaterThanOrEqual(3);
      expect(y).toBeLessThanOrEqual(17);
    }
  });
});

// notion-motion.md Round 29 §2, r29-wrapmenu.png: Unwrap is an arrow pointing right into a line (→|).
describe('unwrap glyph', () => {
  it('keeps IconInsertLeft\'s line and shaft span, with the head at the line end', () => {
    const [shaft, line] = paths(IconArrowRightLine);
    const [insertShaft, insertLine] = paths(IconInsertLeft);

    expect(line).toBe(insertLine);
    const ends = (d: string): number[] => (/M(\d+(?:\.\d+)?) 10h(-?\d+(?:\.\d+)?)/.exec(d) ?? []).slice(1).map(Number);
    const [start, run] = ends(shaft);
    const [insertStart, insertRun] = ends(insertShaft);

    // An 8-unit short arrow over the same span.
    expect(run).toBe(8);
    expect([start, start + run].sort()).toEqual([insertStart + insertRun, insertStart].sort());
    // The head points right, at the tip, one stroke and more clear of the line.
    expect(shaft).toMatch(/M9 6\.5l3\.5 3\.5L9 13\.5/);
    expect(15.5 - (start + run)).toBeGreaterThanOrEqual(2.25);
  });
});

