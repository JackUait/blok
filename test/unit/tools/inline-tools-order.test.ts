import { describe, it, expect } from 'vitest';
import { defaultInlineTools } from '../../../src/tools/index';

describe('defaultInlineTools order (grid toolbar layout)', () => {
  it('matches the two-row grid: marker, bold, italic, underline, clearFormat / link, strikethrough, inlineCode, equation', () => {
    // The inline toolbar derives its render order from the key order of
    // `defaultInlineTools` (see src/components/modules/tools.ts:511 which spreads
    // `...this.inlineTools.keys()` after the prepended `convertTo`). The toolbar
    // renders as a 5-column grid below the convert row, so this key order IS the
    // visual grid order: row 1 = color (marker), bold, italic, underline, clear
    // format; row 2 = link, strikethrough, inline code, equation.
    expect(Object.keys(defaultInlineTools)).toEqual([
      'marker',
      'bold',
      'italic',
      'underline',
      'clearFormat',
      'link',
      'strikethrough',
      'inlineCode',
      'equation',
    ]);
  });
});
