/**
 * Cell placement moves whole block boxes with flex, but a block that wraps is
 * already full width, so only `text-align` can line its text up. Each cell
 * resets it, so a nested table never inherits the outer cell's alignment.
 * Rendering is checked in test/playwright/tests/tools/table/table-cell-placement.spec.ts.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/** Index and body of the first rule whose whole selector is `selector`. */
const findRule = (selector: string): { index: number; body: string } | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);

  return match === null ? null : { index: match.index, body: match[1] };
};

describe('table cell text alignment', () => {
  it('starts every cell at the start edge, so nested tables do not inherit the outer cell', () => {
    expect(findRule('[data-blok-table-cell-blocks]')?.body).toMatch(/text-align:\s*start/);
  });

  it.each([
    ['-center', 'center'],
    ['-right', 'right'],
  ])('aligns the text of *%s placements to the %s', (suffix, value) => {
    // Two attributes: the build lowers `text-align: start` to `:not(:lang(…rtl…))`,
    // which lifts the reset to two-attribute specificity, so one attribute loses.
    const rule = findRule(`[data-blok-table-cell-blocks][data-blok-cell-placement$="${suffix}"]`);
    const reset = findRule('[data-blok-table-cell-blocks]');

    expect(rule?.body).toMatch(new RegExp(`text-align:\\s*${value}`));
    // Equal specificity after lowering, so it must come later to win.
    expect(rule?.index).toBeGreaterThan(reset?.index ?? Infinity);
  });
});
