/**
 * Regression test for BUG #18 — placeholder stays visible behind the + (plus) menu.
 *
 * The UI wrapper carries a CSS rule that hides a focused empty block's placeholder
 * while the toolbox is open (`data-blok-toolbox-opened=true`). That rule must target
 * the placeholder attributes the tools ACTUALLY render:
 *   - paragraph → `data-blok-placeholder-active`
 *   - header    → `data-placeholder`
 *
 * The historical bug targeted `[data-blok-placeholder]`, which matches neither, so
 * the rule was inert and the placeholder showed through the menu.
 */
import { describe, it, expect } from 'vitest';

import { PLACEHOLDER_HIDE_ON_TOOLBOX_CLASSES } from '../../../../src/components/modules/ui';

describe('UI placeholder-hide-on-toolbox classes', () => {
  it('targets the paragraph placeholder attribute (data-blok-placeholder-active)', () => {
    const matches = PLACEHOLDER_HIDE_ON_TOOLBOX_CLASSES.some((cls) =>
      cls.includes('[data-blok-placeholder-active]')
    );

    expect(matches).toBe(true);
  });

  it('targets the header placeholder attribute (data-placeholder)', () => {
    const matches = PLACEHOLDER_HIDE_ON_TOOLBOX_CLASSES.some((cls) =>
      cls.includes('[data-placeholder]')
    );

    expect(matches).toBe(true);
  });

  it('does not rely on the inert [data-blok-placeholder] selector that matches neither tool', () => {
    const inert = PLACEHOLDER_HIDE_ON_TOOLBOX_CLASSES.some((cls) =>
      cls.includes('[data-blok-placeholder]')
    );

    expect(inert).toBe(false);
  });

  it('only hides the placeholder while the toolbox is open on a focused editable block', () => {
    for (const cls of PLACEHOLDER_HIDE_ON_TOOLBOX_CLASSES) {
      expect(cls).toContain('[data-blok-toolbox-opened=true]');
      expect(cls).toContain('[contentEditable=true]');
      expect(cls).toContain(':focus');
      expect(cls).toContain(':before:opacity-0!');
    }
  });
});
