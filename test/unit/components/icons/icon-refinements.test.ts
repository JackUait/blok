import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconQuote,
  IconCaption,
  IconPencil,
  IconMergeCells,
  IconSplitCell,
  IconHeading,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconToggleH1,
  IconToggleH2,
  IconToggleH3,
} from '../../../../src/components/icons';

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg;
};

describe('icon refinements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('IconQuote', () => {
    const marksOf = (): string[] => (parseSvg(IconQuote).querySelector('path')?.getAttribute('d') ?? '')
      .split('Z')
      .filter(Boolean);
    const numbersOf = (d: string): number[] => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);

    it('should draw printed quotation marks as solid shapes with no outline', () => {
      const svg = parseSvg(IconQuote);
      const paths = Array.from(svg.querySelectorAll('path'));

      expect(paths).toHaveLength(1);
      expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
      expect(paths[0]?.hasAttribute('stroke')).toBe(false);
      expect(svg.querySelector('rect, circle, line, polyline')).toBeNull();
    });

    it('should give each mark a round ball and a round-ended tail, and set the pair as one shape moved sideways', () => {
      const [first, second] = marksOf();

      expect(marksOf()).toHaveLength(2);

      for (const mark of [first, second]) {
        const arcs = Array.from(mark.matchAll(/A([\d.]+) ([\d.]+) /g));

        expect(arcs).toHaveLength(2);

        for (const [, rx, ry] of arcs) {
          expect(rx).toBe(ry);
        }
      }

      const a = numbersOf(first.replace(/A[\d.]+ [\d.]+ \d \d \d /g, 'A'));
      const b = numbersOf(second.replace(/A[\d.]+ [\d.]+ \d \d \d /g, 'A'));
      const shift = b[0] - a[0];

      expect(shift).toBeGreaterThan(0);
      expect(b).toHaveLength(a.length);
      b.forEach((value, i) => {
        expect(value).toBeCloseTo(i % 2 === 0 ? a[i] + shift : a[i], 5);
      });
    });

    it('should stay inside the 3-17 frame and sit centred', () => {
      const [first, second] = marksOf();
      // Each mark starts at its ball's left edge; the ball is its last, largest arc.
      const ballOf = (mark: string): { left: number; radius: number } => ({
        left: numbersOf(mark)[0],
        radius: Math.max(...Array.from(mark.matchAll(/A([\d.]+) /g), ([, rx]) => Number(rx))),
      });
      const left = ballOf(first).left;
      const right = ballOf(second).left + 2 * ballOf(second).radius;
      const ys = numbersOf(marksOf().join('').replace(/A[\d.]+ [\d.]+ \d \d \d /g, 'A'))
        .filter((_, i) => i % 2 === 1);

      expect(left).toBeGreaterThanOrEqual(3);
      expect(right).toBeLessThanOrEqual(17);
      expect(left + right).toBeCloseTo(20, 5);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...ys)).toBeLessThanOrEqual(17);
    });
  });

  describe('IconCaption', () => {
    it('should show image content in the panel so it does not read as a monitor', () => {
      const svg = parseSvg(IconCaption);

      const panel = svg.querySelector('rect');
      const paths = Array.from(svg.querySelectorAll('path'));
      const caption = paths[1]?.getAttribute('d')?.match(/^M([\d.]+) ([\d.]+)h([\d.]+)$/);

      expect(panel).not.toBeNull();
      expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('currentColor');
      expect(paths).toHaveLength(2);
      expect(paths[0]?.getAttribute('stroke')).toBe('currentColor');
      expect(caption).toBeTruthy();

      const [left, y, width] = caption?.slice(1).map(Number) ?? [];
      const panelBottom = Number(panel?.getAttribute('y')) + Number(panel?.getAttribute('height'));

      expect(left).toBe(Number(panel?.getAttribute('x')));
      expect(width).toBeGreaterThan(Number(panel?.getAttribute('width')) / 2);
      expect(width).toBeLessThan(Number(panel?.getAttribute('width')));
      expect(y - panelBottom - 1.25).toBeGreaterThanOrEqual(1.25);
      expect(y + 0.625).toBeLessThanOrEqual(17);
    });
  });

  describe('IconPencil', () => {
    it('should have a pointed tip instead of a chopped heel', () => {
      const outline = parseSvg(IconPencil).querySelector('path')?.getAttribute('d') ?? '';
      const start = outline.match(/^M([\d.]+) ([\d.]+)/)?.slice(1).map(Number) ?? [];
      const nib = outline.match(/L([\d.]+) ([\d.]+)l(-?[\d.]+) (-?[\d.]+) (-?[\d.]+)(-?[\d.]+)Z$/)?.slice(1).map(Number) ?? [];

      expect(start).toHaveLength(2);
      expect(nib).toHaveLength(6);

      const [baseX, baseY, tipDx, tipDy, returnDx, returnDy] = nib;
      const tip = [baseX + tipDx, baseY + tipDy];

      expect(tip[0] + returnDx).toBe(start[0]);
      expect(tip[1] + returnDy).toBe(start[1]);
      expect(tip[0]).toBeLessThan(Math.min(start[0], baseX));
      expect(tip[1]).toBeGreaterThan(Math.max(start[1], baseY));
      expect(Math.hypot(tipDx, tipDy)).toBeCloseTo(Math.hypot(returnDx, returnDy), 10);
      expect(tip[0] + tip[1]).toBeCloseTo((start[0] + start[1] + baseX + baseY) / 2, 10);
    });
  });

  describe('IconMergeCells / IconSplitCell', () => {
    // Blok Line keeps separate features one stroke apart.
    const CLEARANCE = 1.25;

    it.each([
      ['merge', IconMergeCells, 'M10 4v2M10 16v-2'],
      ['split', IconSplitCell, 'M10 4v12'],
    ])('should draw the %s result: an opened wall or a full one, with mirrored chevrons', (action, icon, wall) => {
      const svg = parseSvg(icon);
      const frame = svg.querySelector('rect');
      const paths = Array.from(svg.querySelectorAll('path'));

      expect(['x', 'y', 'width', 'height', 'rx'].map(name => Number(frame?.getAttribute(name)))).toEqual([3, 4, 14, 12, 2]);
      expect(paths).toHaveLength(2);
      expect(paths[0].getAttribute('d')).toBe(wall);

      const stroke = Number(paths[1].getAttribute('stroke-width'));
      const chevrons = (paths[1].getAttribute('d') ?? '').split(/(?=M)/).map(part => part.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? []);

      expect(chevrons).toHaveLength(2);
      expect(chevrons[0][0] + chevrons[1][0]).toBe(20);

      for (const [x, y, dx1, dy1, dx2, dy2] of chevrons) {
        const tipX = x + dx1;

        expect(y + dy1).toBe(10);
        expect(dx2).toBe(-dx1);
        expect(dy2).toBe(dy1);
        expect(Math.abs(tipX - 10) < Math.abs(x - 10)).toBe(action === 'merge');
        // Clear of the frame sides, and of the wall where the wall is drawn.
        expect(Math.min(tipX, x) - 3 - stroke).toBeGreaterThanOrEqual(CLEARANCE - 1e-9);
        expect(17 - Math.max(tipX, x) - stroke).toBeGreaterThanOrEqual(CLEARANCE - 1e-9);
        if (action === 'split') {
          expect(Math.min(Math.abs(tipX - 10), Math.abs(x - 10)) - stroke).toBeGreaterThanOrEqual(CLEARANCE - 1e-9);
        }
      }
    });
  });

  describe('heading family grid snap', () => {
    const family: Record<string, string> = {
      IconHeading,
      IconH1,
      IconH2,
      IconH3,
      IconH4,
      IconH5,
      IconH6,
      IconToggleH1,
      IconToggleH2,
      IconToggleH3,
    };

    it.each(Object.entries(family))('%s should not carry legacy off-grid coordinates', (_name, icon) => {
      // 24→20 scale leftovers like 3.33334 / 1.6667 — everything snaps to ≤2 decimals
      expect(icon).not.toMatch(/\d\.\d{3}/);
    });
  });

});
