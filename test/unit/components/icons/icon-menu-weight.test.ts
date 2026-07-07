import { describe, it, expect } from 'vitest';
import {
  IconText,
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
  IconListBulleted,
  IconListNumbered,
  IconListChecklist,
  IconToggleList,
  IconCallout,
  IconQuote,
  IconCode,
} from '../../../../src/components/icons';

/**
 * Root-cause guard for the recurring "some icons look thick" reports.
 *
 * The Turn-into / block menus render these icons next to each other, so they
 * must all read at the SAME visual weight. Every icon in the house set is
 * 1.25px-stroke line-art; the way an icon ends up looking "thick" is by using a
 * heavier primitive than that hairline — a fatter stroke, or (more often) a
 * SOLID FILL used for structure instead of a thin stroke:
 *   - heading letterforms extracted from a bold font (fixed: now strokes)
 *   - the quote bar as a 2.25u solid <rect> (fixed: now a 1.25 stroke)
 *   - the numbered-list digits at semibold weight (fixed: now Regular)
 *
 * This guard locks the whole menu family to hairline weight so the next heavy
 * fill or fat stroke fails CI instead of shipping.
 */

const menuIcons: Record<string, string> = {
  IconText,
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
  IconListBulleted,
  IconListNumbered,
  IconListChecklist,
  IconToggleList,
  IconCallout,
  IconQuote,
  IconCode,
};

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

describe('convert-menu icon weight (thick-icon regression guard)', () => {
  const HOUSE_STROKE = 1.25;

  it.each(Object.entries(menuIcons))('%s draws every stroke at or below the 1.25 hairline', (_name, icon) => {
    const strokedEls = Array.from(svgOf(icon).querySelectorAll('[stroke="currentColor"]'));

    for (const el of strokedEls) {
      const sw = el.getAttribute('stroke-width');

      // some accents (dots/circles) have no explicit stroke-width; only check the ones that stroke lines
      if (sw !== null) {
        expect(Number(sw)).toBeLessThanOrEqual(HOUSE_STROKE);
      }
    }
  });

  it.each(Object.entries(menuIcons))('%s uses no solid fill-bar (filled <rect>)', (_name, icon) => {
    // a filled rectangle is how a "bar" (quote/callout accent) turns into thick ink;
    // structural bars must be strokes. Panels use STROKED rects, which are fine.
    const filledRects = Array.from(svgOf(icon).querySelectorAll('rect')).filter(
      (r) => r.getAttribute('fill') === 'currentColor',
    );

    expect(filledRects).toHaveLength(0);
  });

  it('numbered-list digits are stroked hairlines, not solid glyphs', () => {
    // even at "Regular" weight, a SOLID filled digit carries more ink than a 1.25
    // hairline, so the 1/2/3 still read "thick" next to the stroked lines. Draw the
    // digits with the same primitive as every heading letterform: thin strokes.
    const doc = svgOf(IconListNumbered);

    for (const p of Array.from(doc.querySelectorAll('path'))) {
      const filled = p.getAttribute('fill') === 'currentColor';
      const stroked = p.getAttribute('stroke') === 'currentColor';

      // no pure-fill glyphs allowed — a digit must be a stroke
      expect(filled && !stroked).toBe(false);
    }

    // the digit strokes exist and stay at or below the house hairline
    const digitStrokes = Array.from(doc.querySelectorAll('path')).filter(
      (p) => p.getAttribute('stroke') === 'currentColor' && p.getAttribute('d') !== 'M8 5h9M8 10h9M8 15h9',
    );

    expect(digitStrokes.length).toBeGreaterThanOrEqual(3);

    for (const p of digitStrokes) {
      expect(Number(p.getAttribute('stroke-width'))).toBeLessThanOrEqual(HOUSE_STROKE);
    }
  });
});
