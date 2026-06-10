import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
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
  IconToggleList,
  IconListNumbered,
} from '../../../../src/components/icons';

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg as unknown as SVGSVGElement;
};

const paths = (icon: string): SVGPathElement[] => Array.from(parseSvg(icon).querySelectorAll('path'));

describe('notion-style heading / list / toggle icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('heading family letterforms', () => {
    const numbered: Record<string, string> = {
      IconH1,
      IconH2,
      IconH3,
      IconH4,
      IconH5,
      IconH6,
    };

    it.each(Object.entries(numbered))('%s should be two filled glyph paths (H + digit), no strokes', (_name, icon) => {
      const all = paths(icon);

      expect(all.length).toBe(2);

      for (const p of all) {
        expect(p.getAttribute('fill')).toBe('currentColor');
        expect(p.getAttribute('stroke')).toBeNull();
      }
    });

    it('IconHeading should be a single filled H glyph', () => {
      const all = paths(IconHeading);

      expect(all.length).toBe(1);
      expect(all[0].getAttribute('fill')).toBe('currentColor');
      expect(all[0].getAttribute('stroke')).toBeNull();
    });
  });

  describe('toggle headings', () => {
    const toggles: Record<string, string> = {
      IconToggleH1,
      IconToggleH2,
      IconToggleH3,
    };

    it.each(Object.entries(toggles))('%s should lead with a solid triangle followed by filled glyphs', (_name, icon) => {
      const all = paths(icon);

      expect(all.length).toBe(3);

      // triangle marker: filled, rounded corners via stroke join
      expect(all[0].getAttribute('fill')).toBe('currentColor');
      expect(all[0].getAttribute('stroke-linejoin')).toBe('round');
      expect(all[0].getAttribute('d')).toContain('Z');

      // letterforms: filled, no stroke
      expect(all[1].getAttribute('fill')).toBe('currentColor');
      expect(all[1].getAttribute('stroke')).toBeNull();
      expect(all[2].getAttribute('fill')).toBe('currentColor');
      expect(all[2].getAttribute('stroke')).toBeNull();
    });

    it.each(Object.entries(toggles))('%s should not keep the old trailing chevron', (_name, icon) => {
      expect(icon).not.toContain('M16 7l2.5 3-2.5 3');
    });
  });

  describe('IconToggleList', () => {
    it('should mark with a solid triangle instead of a stroked chevron', () => {
      expect(IconToggleList).not.toContain('m3.5 2.75 2.5 2.25-2.5 2.25');

      const triangle = paths(IconToggleList).find((p) => p.getAttribute('fill') === 'currentColor');

      expect(triangle).toBeDefined();
      expect(triangle?.getAttribute('stroke-linejoin')).toBe('round');
    });

    it('should keep the three list lines', () => {
      expect(IconToggleList).toContain('M9 5h8M6 10h11M6 15h11');
    });
  });

  describe('IconListNumbered', () => {
    it('should render digits as filled glyph paths, not <text>', () => {
      const svg = parseSvg(IconListNumbered);

      expect(svg.querySelectorAll('text').length).toBe(0);

      const digitPaths = paths(IconListNumbered).filter((p) => p.getAttribute('fill') === 'currentColor');

      expect(digitPaths.length).toBe(3);

      for (const p of digitPaths) {
        expect(p.getAttribute('stroke')).toBeNull();
      }
    });

    it('should keep the three list lines', () => {
      expect(IconListNumbered).toContain('M8 5h9M8 10h9M8 15h9');
    });
  });
});
