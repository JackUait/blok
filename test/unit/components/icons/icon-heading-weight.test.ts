import { describe, it, expect } from 'vitest';
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
  IconText,
} from '../../../../src/components/icons';

/**
 * Root-cause guard for the "heading icons look thick" bug.
 *
 * Every icon in the house set is 1.25px-stroke line-art. The heading family used
 * to be the exception: FILLED letterform glyphs extracted from Helvetica Neue
 * Bold. Solid bold glyphs carry far more ink than a 1.25 hairline stroke, so in
 * menus that mix them (Turn-into / slash) the headings read as "thick" next to
 * IconText and the lists.
 *
 * The fix renders the heading letterforms with the SAME primitive as every other
 * icon — 1.25 strokes, round caps — so they are identical in weight everywhere.
 * This guard locks that in: a heading icon may never contain a pure-fill glyph
 * (a bold letterform), and its letterform strokes must stay at hairline weight.
 * The only filled path allowed is the toggle's small solid triangle marker.
 */

const parse = (icon: string): SVGPathElement[] => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

  return Array.from(doc.querySelectorAll('path'));
};

/** the toggle marker is the one path that is BOTH filled and stroked (a solid triangle) */
const isToggleTriangle = (p: SVGPathElement): boolean =>
  p.getAttribute('fill') === 'currentColor' && p.getAttribute('stroke') === 'currentColor';

describe('heading icon weight (thick-icon regression guard)', () => {
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

  // the house hairline, read straight off IconText so the guard tracks the source of truth
  const houseStroke = Number(parse(IconText)[0].getAttribute('stroke-width'));

  it('IconText is the 1.25 hairline reference', () => {
    expect(houseStroke).toBe(1.25);
  });

  it.each(Object.entries(family))('%s never contains a filled (bold) letterform glyph', (_name, icon) => {
    for (const p of parse(icon)) {
      const filled = p.getAttribute('fill') === 'currentColor';
      const stroked = p.getAttribute('stroke') === 'currentColor';

      // a letterform must be stroked, not a solid fill; only the toggle triangle may be filled
      expect(filled && !stroked).toBe(false);
    }
  });

  it.each(Object.entries(family))('%s letterforms are drawn at hairline stroke weight', (_name, icon) => {
    const letterforms = parse(icon).filter((p) => !isToggleTriangle(p) && p.getAttribute('stroke') === 'currentColor');

    // at least the H is always present
    expect(letterforms.length).toBeGreaterThanOrEqual(1);

    for (const p of letterforms) {
      const sw = Number(p.getAttribute('stroke-width'));

      // digits may be a touch lighter than the H so they don't dominate; never heavier than the house hairline
      expect(sw).toBeGreaterThanOrEqual(1);
      expect(sw).toBeLessThanOrEqual(houseStroke);
    }
  });
});
