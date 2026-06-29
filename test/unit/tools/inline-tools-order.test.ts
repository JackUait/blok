import { describe, it, expect } from 'vitest';
import { defaultInlineTools } from '../../../src/tools/index';

describe('defaultInlineTools order (Notion parity)', () => {
  it('keeps the toggle group contiguous, then Link, then Color (marker) last', () => {
    // The inline toolbar derives its render order from the key order of
    // `defaultInlineTools` (see src/components/modules/tools.ts:511 which spreads
    // `...this.inlineTools.keys()` after the prepended `convertTo`). Notion parity
    // requires a contiguous toggle group (bold, italic, underline, strikethrough,
    // inline code, equation), then Link, then Color (marker) as the very last item.
    expect(Object.keys(defaultInlineTools)).toEqual([
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'inlineCode',
      'equation',
      'link',
      'marker',
    ]);
  });
});
