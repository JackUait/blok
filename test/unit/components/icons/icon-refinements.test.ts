import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconQuote,
  IconCaption,
  IconCaptionImage,
  IconPencil,
  IconMergeCells,
  IconSplitCell,
  IconToggleList,
  IconListNumbered,
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

  return svg as unknown as SVGSVGElement;
};

describe('icon refinements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('IconQuote', () => {
    it('should accent with a solid fill bar, not a heavier stroke', () => {
      expect(IconQuote).not.toContain('stroke-width="2.5"');

      const rect = parseSvg(IconQuote).querySelector('rect');

      expect(rect?.getAttribute('fill')).toBe('currentColor');
    });
  });

  describe('IconCaption', () => {
    it('should show image content in the panel so it does not read as a monitor', () => {
      const svg = parseSvg(IconCaption);

      expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('currentColor');
      // left-aligned caption lines (a centered short line reads as a monitor stand)
      expect(IconCaption).toContain('M4.5 14.5h11');
    });
  });

  describe('IconCaptionImage', () => {
    it('should mirror the house caption treatment at the image spec', () => {
      const svg = parseSvg(IconCaptionImage);

      expect(svg.querySelector('circle')).not.toBeNull();
      expect(IconCaptionImage).toContain('M5 22h8');
    });
  });

  describe('IconPencil', () => {
    it('should have a pointed tip instead of a chopped heel', () => {
      expect(IconPencil).not.toContain('H4.5v-2z');
      expect(IconPencil).toContain('a1.65');
    });
  });

  describe('IconMergeCells / IconSplitCell', () => {
    it('should use a dotted divider with clear arrow separation', () => {
      expect(IconMergeCells).toContain('stroke-dasharray="0.1 2.6"');
      expect(IconMergeCells).toContain('M4.5 7.5 7 10 4.5 12.5');
      expect(IconSplitCell).toContain('stroke-dasharray="0.1 2.6"');
      expect(IconSplitCell).toContain('M7 7.5 4.5 10 7 12.5');
    });
  });

  describe('IconToggleList', () => {
    it('should use the ToggleH-family chevron as its marker', () => {
      expect(IconToggleList).toContain('m3.5 2.75 2.5 2.25-2.5 2.25');
    });
  });

  describe('IconListNumbered', () => {
    it('should render digits bold with an explicit font stack', () => {
      const textElements = Array.from(parseSvg(IconListNumbered).querySelectorAll('text'));

      expect(textElements.length).toBe(3);

      for (const el of textElements) {
        expect(el.getAttribute('font-weight')).toBe('600');
        expect(el.getAttribute('font-size')).toBe('5.5');
        expect(el.getAttribute('font-family')).toContain('Helvetica Neue');
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

  describe('toggle heading digits match the H-family digits', () => {
    it('should share the "1" geometry between IconH1 and IconToggleH1', () => {
      expect(IconH1).toContain('2.5-1.75V15');
      expect(IconToggleH1).toContain('2.5-1.75V15');
    });

    it('should share the "2" geometry between IconH2 and IconToggleH2', () => {
      const two = 'c0-3.25 3.5-2.5 3.5-5 0-1.25-1.75-2-3.5-.75';

      expect(IconH2).toContain(two);
      expect(IconToggleH2).toContain(two);
    });

    it('should share the "3" geometry between IconH3 and IconToggleH3', () => {
      const three = 'c1.5-.85 3-.01 3 1.25 0 .44-.18.87-.49 1.18';

      expect(IconH3).toContain(three);
      expect(IconToggleH3).toContain(three);
    });
  });
});
