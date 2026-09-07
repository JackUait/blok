import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconList,
  IconListBulleted,
  IconUnderline,
  IconUploadFailed,
  IconText,
  IconBold,
  IconPaintRoller,
} from '../../../../src/components/icons';

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg;
};

describe('icon house-spec fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('IconList (database list view)', () => {
    it('should draw stacked row rects, not a bulleted list', () => {
      const svg = parseSvg(IconList);

      const rows = Array.from(svg.querySelectorAll('rect'));

      expect(rows).toHaveLength(2);
      expect(svg.querySelectorAll('circle')).toHaveLength(0);
      expect(rows.map((row) => row.getAttribute('x'))).toEqual(['3', '3']);
      expect(rows.map((row) => row.getAttribute('width'))).toEqual(['14', '14']);
      expect(rows.map((row) => row.getAttribute('height'))).toEqual(['4.5', '4.5']);

      const topBottom = Number(rows[0].getAttribute('y')) + Number(rows[0].getAttribute('height'));

      expect(Number(rows[1].getAttribute('y')) - topBottom).toBe(3);
    });

    it('should be visually distinct from IconListBulleted', () => {
      expect(IconList).not.toBe(IconListBulleted);
      expect(parseSvg(IconListBulleted).querySelectorAll('circle')).toHaveLength(2);
      expect(parseSvg(IconListBulleted).querySelectorAll('rect')).toHaveLength(0);
    });
  });

  describe('IconUnderline', () => {
    it('should keep the bottom rule inside the 3-17 content inset', () => {
      const rule = parseSvg(IconUnderline).querySelectorAll('path')[1];
      const line = rule?.getAttribute('d')?.match(/^M([\d.]+) ([\d.]+)h([\d.]+)$/);

      expect(line).toBeTruthy();

      const [left, baseline, width] = line?.slice(1).map(Number) ?? [];
      const halfStroke = Number(rule?.getAttribute('stroke-width')) / 2;

      expect(baseline).toBe(15);
      expect(left - halfStroke).toBeGreaterThanOrEqual(3);
      expect(left + width + halfStroke).toBeLessThanOrEqual(17);
      expect(left + width / 2).toBe(10);
    });
  });

  describe('IconUploadFailed', () => {
    it('should use a single stroke width for body and failure mark', () => {
      const svg = parseSvg(IconUploadFailed);
      const paths = Array.from(svg.querySelectorAll('path'));

      expect(paths.length).toBeGreaterThanOrEqual(2);
      expect(svg.getAttribute('stroke-width')).toBe('1.5');

      for (const path of paths) {
        expect(path.getAttribute('stroke')).toBe('currentColor');
        expect(path.getAttribute('stroke-width')).toBe(svg.getAttribute('stroke-width'));
      }
    });
  });

  describe('IconText', () => {
    it('should center the T stem on its cap and keep the heading height (5-15)', () => {
      const path = parseSvg(IconText).querySelector('path');
      const geometry = path?.getAttribute('d')?.match(/^M([\d.]+) ([\d.]+)V([\d.]+)h([\d.]+)v([\d.]+)M([\d.]+) ([\d.]+)v([\d.]+)$/);

      expect(geometry).toBeTruthy();

      const [left, terminalY, capY, width, terminalHeight, stemX, stemY, stemHeight] = geometry?.slice(1).map(Number) ?? [];

      expect(capY).toBe(5);
      expect(stemY).toBe(capY);
      expect(stemY + stemHeight).toBe(15);
      expect(stemX).toBe(left + width / 2);
      expect(capY + terminalHeight).toBe(terminalY);
      expect(terminalHeight).toBeGreaterThan(0);
      expect(terminalY).toBeLessThan(stemY + stemHeight / 2);
    });
  });

  describe('IconBold', () => {
    it('should bake coordinates into the path instead of a transform', () => {
      expect(IconBold).not.toContain('transform');
    });
  });

  describe('IconPaintRoller', () => {
    it('should start at the 3-unit left inset', () => {
      expect(IconPaintRoller).not.toContain('x="2.5"');
      expect(IconPaintRoller).toContain('x="3"');
    });
  });
});
