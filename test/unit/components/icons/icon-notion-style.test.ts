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

    it.each(Object.entries(numbered))('%s should be two stroked line-art paths (H + digit), no fills', (_name, icon) => {
      const all = paths(icon);

      expect(all.length).toBe(2);

      for (const p of all) {
        expect(p.getAttribute('stroke')).toBe('currentColor');
        expect(p.getAttribute('fill')).toBeNull();
        expect(p.getAttribute('stroke-linecap')).toBe('round');
      }
    });

    it('IconHeading should be a single stroked H glyph', () => {
      const all = paths(IconHeading);

      expect(all.length).toBe(1);
      expect(all[0].getAttribute('stroke')).toBe('currentColor');
      expect(all[0].getAttribute('fill')).toBeNull();
    });
  });

  describe('toggle headings', () => {
    const toggles: Record<string, string> = {
      IconToggleH1,
      IconToggleH2,
      IconToggleH3,
    };

    it.each(Object.entries(toggles))('%s should lead with a solid triangle followed by stroked glyphs', (_name, icon) => {
      const all = paths(icon);

      expect(all.length).toBe(3);

      // triangle marker: filled, rounded corners via stroke join
      expect(all[0].getAttribute('fill')).toBe('currentColor');
      expect(all[0].getAttribute('stroke-linejoin')).toBe('round');
      expect(all[0].getAttribute('d')).toContain('Z');

      // letterforms: stroked line-art, no fill
      expect(all[1].getAttribute('stroke')).toBe('currentColor');
      expect(all[1].getAttribute('fill')).toBeNull();
      expect(all[2].getAttribute('stroke')).toBe('currentColor');
      expect(all[2].getAttribute('fill')).toBeNull();
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
    it('should render digits as hairline stroked glyph paths, not <text> or solid fills', () => {
      const svg = parseSvg(IconListNumbered);

      expect(svg.querySelectorAll('text').length).toBe(0);

      const digitPaths = paths(IconListNumbered).filter(
        (p) => p.getAttribute('stroke') === 'currentColor' && p.getAttribute('d') !== 'M8 5h9M8 10h9M8 15h9',
      );

      expect(digitPaths.length).toBe(3);

      // stroked, never a solid fill — that is what kept the old digits looking thick
      for (const p of digitPaths) {
        expect(p.getAttribute('fill')).not.toBe('currentColor');
      }
    });

    it('should keep the three list lines', () => {
      expect(IconListNumbered).toContain('M8 5h9M8 10h9M8 15h9');
    });

    it('should leave breathing room between stacked digits', () => {
      const digitPaths = paths(IconListNumbered).filter(
        (p) => p.getAttribute('stroke') === 'currentColor' && p.getAttribute('d') !== 'M8 5h9M8 10h9M8 15h9',
      );

      // SVGPathPen emits absolute commands; collect Y values per command type
      const yRange = (p: SVGPathElement): [number, number] => {
        const d = p.getAttribute('d') ?? '';
        const ys: number[] = [];

        for (const match of d.matchAll(/([MLQCVH])((?:\s*-?\d+(?:\.\d+)?)+)/g)) {
          const cmd = match[1];
          const nums = match[2].match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

          if (cmd === 'H') {
            continue;
          }

          if (cmd === 'V') {
            ys.push(...nums);
            continue;
          }

          ys.push(...nums.filter((_value, i) => i % 2 === 1));
        }

        return [Math.min(...ys), Math.max(...ys)];
      };

      const ranges = digitPaths.map(yRange).sort((a, b) => a[0] - b[0]);

      for (let i = 1; i < ranges.length; i++) {
        const gap = ranges[i][0] - ranges[i - 1][1];

        expect(gap).toBeGreaterThanOrEqual(0.8);
      }
    });
  });
});
