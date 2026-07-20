import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconQuote,
  IconCaption,
  IconCaptionImage,
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
      // the quote bar used to be a 2.25u-wide solid rect, which read ~2x heavier
      // than the 1.25 hairline lines beside it; it is now a 1.25 stroke line
      expect(parseSvg(IconQuote).querySelector('rect')).toBeNull();

      const strokes = Array.from(parseSvg(IconQuote).querySelectorAll('path')).filter(
        (p) => p.getAttribute('stroke') === 'currentColor',
      );

      expect(strokes.length).toBeGreaterThanOrEqual(4);

      for (const p of strokes) {
        expect(p.getAttribute('stroke-width')).toBe('1.25');
      }
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
