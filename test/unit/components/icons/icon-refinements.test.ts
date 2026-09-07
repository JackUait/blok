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
    it('should draw the bar as a hairline stroke, not a heavy solid fill', () => {
      const svg = parseSvg(IconQuote);
      const strokes = Array.from(svg.querySelectorAll('path'));

      expect(svg.querySelector('rect')).toBeNull();
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.getAttribute('stroke')).toBe('currentColor');
      expect(strokes[0]?.getAttribute('stroke-width')).toBe('1.25');
      expect(strokes[0]?.getAttribute('fill')).not.toBe('currentColor');

      const d = strokes[0]?.getAttribute('d') ?? '';
      const bar = d.match(/^M([\d.]+) ([\d.]+)v([\d.]+)/);
      const lines = Array.from(d.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)/g))
        .map((match) => match.slice(1).map(Number));

      expect(bar).not.toBeNull();
      expect(lines).toHaveLength(3);
      expect(lines.map(([x]) => x)).toEqual([8, 8, 8]);
      expect(lines[1][1] - lines[0][1]).toBe(4);
      expect(lines[2][1] - lines[1][1]).toBe(4);
      expect(lines[0][0] - Number(bar?.[1])).toBeGreaterThan(1.25);
      expect(Number(bar?.[2])).toBeLessThan(lines[0][1]);
      expect(Number(bar?.[2]) + Number(bar?.[3])).toBeGreaterThan(lines[2][1]);
      expect(lines[2][2]).toBeLessThan(lines[0][2]);
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
    it.each([
      ['merge', IconMergeCells],
      ['split', IconSplitCell],
    ])('should keep the %s arrows separate from the dotted divider', (action, icon) => {
      const paths = Array.from(parseSvg(icon).querySelectorAll('path'));
      const divider = paths[0];
      const dividerX = Number(divider.getAttribute('d')?.match(/^M([\d.]+)/)?.[1]);
      const stroke = Number(divider.getAttribute('stroke-width'));

      expect(paths).toHaveLength(3);
      expect(divider.getAttribute('stroke-dasharray')).toBe('0.1 2.6');
      expect(divider.getAttribute('stroke-linecap')).toBe('round');

      for (const arrow of paths.slice(1)) {
        const d = arrow.getAttribute('d') ?? '';
        const shaft = d.match(/^M([\d.]+) ([\d.]+)([hH])(-?[\d.]+)/);
        const head = d.match(/M([\d.]+) ([\d.]+)l([^M]+)$/);
        const headValues = head?.[3].match(/-?[\d.]+/g)?.map(Number) ?? [];

        expect(shaft).toBeTruthy();
        expect(head).toBeTruthy();
        expect(headValues).toHaveLength(4);

        const shaftStartX = Number(shaft?.[1]);
        const shaftY = Number(shaft?.[2]);
        const shaftEndX = Number(shaft?.[4]) + (shaft?.[3] === 'h' ? shaftStartX : 0);
        const headStartX = Number(head?.[1]);
        const headStartY = Number(head?.[2]);
        const tipX = headStartX + headValues[0];
        const tipY = headStartY + headValues[1];
        const headEndX = tipX + headValues[2];
        const headEndY = tipY + headValues[3];
        const nearestX = Math.min(...[shaftStartX, shaftEndX, headStartX, headEndX].map(x => Math.abs(x - dividerX)));

        expect(tipX).toBe(shaftEndX);
        expect(tipY).toBe(shaftY);
        expect(headStartX).toBe(headEndX);
        expect(tipY - headStartY).toBe(headEndY - tipY);
        expect(nearestX - stroke).toBeGreaterThanOrEqual(stroke);
        expect(Math.abs(tipX - dividerX) < Math.abs(shaftStartX - dividerX)).toBe(action === 'merge');
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
