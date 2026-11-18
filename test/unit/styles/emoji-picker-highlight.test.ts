/**
 * The database icon pickers' keyboard highlight (notion-motion.md Round 68 §3):
 * a neutral fill, the keyboard cursor token, with no hover gate.
 */
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const HIGHLIGHT = '[data-blok-emoji-picker] [data-emoji-highlighted]';

describe('emoji picker keyboard highlight', () => {
  it('paints with the gray keyboard cursor fill, outside the hover media query', () => {
    const found: Array<{ background: string | undefined; media: boolean }> = [];

    postcss.parse(readMainCss()).walkRules(rule => {
      if (!rule.selectors.includes(HIGHLIGHT)) return;
      let background: string | undefined;

      rule.walkDecls('background', declaration => {
        background = declaration.value;
      });
      found.push({ background, media: rule.parent?.type === 'atrule' });
    });

    // --blok-item-focus-bg is held gray by selected-state-neutral.test.ts.
    expect(found).toEqual([{ background: 'var(--blok-item-focus-bg)', media: false }]);
  });

  // notion-motion.md Round 69 §3: hover moves Notion's one fill, so these pickers paint no second, hover-only fill.
  it('gives no emoji cell a hover fill in a picker that keeps the keys in the field', () => {
    const cellHoverSelectors: string[] = [];

    postcss.parse(readMainCss()).walkRules(rule => {
      let paints = false;

      rule.walkDecls(/^background/, () => {
        paints = true;
      });
      if (!paints) return;
      cellHoverSelectors.push(...rule.selectors.filter(selector => selector.includes('[data-emoji-native]') && selector.includes(':hover')));
    });

    expect(cellHoverSelectors.length).toBeGreaterThan(0);
    for (const selector of cellHoverSelectors) {
      expect(selector).toContain('[data-emoji-native]:not([data-emoji-picker-filter-keys] *)');
    }
  });
});
