import { describe, it, expect } from 'vitest';
import {
  IconMarker,
  IconBold,
  IconItalic,
  IconUnderline,
  IconClearFormat,
  IconLink,
  IconStrikethrough,
  IconCode,
  IconEquation,
} from '../../../../src/components/icons';

/**
 * Inline-toolbar icon unity (2026-08-05, user-directed "make all of these
 * icons look unified when they are placed together").
 *
 * The nine inline formatting glyphs render side by side in the inline toolbar
 * grid, so they are read as ONE type specimen. Unified system:
 *
 * - one stroke weight: the 1.25 house hairline — including the B (the 1.9
 *   "semantic bold" experiment read as a different icon set in the grid)
 * - letterforms share cap line y=4 and baseline y=16
 * - symbol glyphs (code, equation) share the y 5.5-14.5 optical band,
 *   centred on (10, 10)
 * - the small × subglyphs (Tx, √x) are the same 3.4-unit glyph, sitting on
 *   their parent glyph's bottom line
 */

const INLINE_ICONS = {
  IconMarker,
  IconBold,
  IconItalic,
  IconUnderline,
  IconClearFormat,
  IconLink,
  IconStrikethrough,
  IconCode,
  IconEquation,
};

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

const spanOf = (d: string): { x: number; y: number } => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const xs = nums.filter((_v, i) => i % 2 === 0);
  const ys = nums.filter((_v, i) => i % 2 === 1);

  return {
    x: Math.max(...xs) - Math.min(...xs),
    y: Math.max(...ys) - Math.min(...ys),
  };
};

describe('inline-toolbar icon unity', () => {
  it.each(Object.entries(INLINE_ICONS))('%s strokes only at the 1.25 hairline', (_name, icon) => {
    const widths = icon.match(/stroke-width="([^"]+)"/g) ?? [];

    expect(widths.length).toBeGreaterThan(0);

    for (const w of widths) {
      expect(w).toBe('stroke-width="1.25"');
    }
  });

  it('letterforms sit on the shared cap line (y4) and baseline (y16)', () => {
    expect(IconBold).toContain('M6.5 4V16');
    // italic serifs centred on x=10: top serif 9-15, bottom serif 5-11
    expect(IconItalic).toContain('M9 4h6');
    // U bowl starts on the cap line, the rule IS the baseline
    expect(IconUnderline).toContain('M6 4v5.5');
    expect(IconUnderline).toContain('M5.5 16h9');
    // T bar on the cap line, stem runs to the baseline
    expect(IconClearFormat).toContain('M4 4h8M8 4v12');
  });

  it('symbol glyphs share the 5.5-14.5 optical band centred on (10,10)', () => {
    expect(IconCode).toContain('m8 5.5-4 4.5 4 4.5m4-9 4 4.5-4 4.5');
    expect(IconEquation).toContain('M4.25 10.5 6 14.5 8.5 5.5h7.25');
  });

  it('the small × subglyphs of Tx and √x are the same 3.4-unit glyph', () => {
    for (const icon of [IconClearFormat, IconEquation]) {
      const paths = Array.from(svgOf(icon).querySelectorAll('path'));
      const x = paths[paths.length - 1].getAttribute('d') ?? '';
      const span = spanOf(x);

      expect(span.x).toBeCloseTo(3.4, 10);
      expect(span.y).toBeCloseTo(3.4, 10);
    }
  });

  it('marker chip sits on the 3-17 content inset', () => {
    expect(IconMarker).toContain('x="3" y="3" width="14" height="14"');
  });
});
