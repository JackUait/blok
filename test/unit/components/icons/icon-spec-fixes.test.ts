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

  return svg as unknown as SVGSVGElement;
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

      expect(svg.querySelectorAll('rect').length).toBe(3);
      expect(svg.querySelectorAll('circle').length).toBe(0);
    });

    it('should be visually distinct from IconListBulleted', () => {
      expect(IconList).not.toBe(IconListBulleted);
      // bulleted list keeps its dots — only the view icon changes shape
      expect(parseSvg(IconListBulleted).querySelectorAll('circle').length).toBe(3);
    });
  });

  describe('IconUnderline', () => {
    it('should keep the bottom rule inside the 3-17 content inset', () => {
      expect(IconUnderline).not.toContain('18.5');
      expect(IconUnderline).toContain('16.5');
    });
  });

  describe('IconUploadFailed', () => {
    it('should use a single stroke width for body and slash', () => {
      const widths = IconUploadFailed.match(/stroke-width/g) ?? [];

      expect(widths.length).toBe(1);
    });
  });

  describe('IconText', () => {
    it('should draw a plain T at heading height (5-15)', () => {
      expect(IconText).toContain('M5.5 5h9');
      expect(IconText).toContain('M10 5v10');
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
