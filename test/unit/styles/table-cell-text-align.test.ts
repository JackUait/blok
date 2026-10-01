/**
 * Cell placement moves whole block boxes with flex, but a block that wraps is
 * already full width, so only `text-align` can line its text up. Each cell
 * resets it, so a nested table never inherits the outer cell's alignment.
 * Left/right mean the grid's start/end.
 * Rendering is checked in test/playwright/tests/tools/table/table-cell-placement.spec.ts
 * and test/playwright/tests/tools/table-rtl.spec.ts.
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
  // Physical values keyed on the editor: a block's content carries its own
  // text's dir, so start/end would follow the text, not the grid.
  it.each([
    ['[data-blok-table-cell-blocks]', 'left'],
    ['[data-blok-rtl="true"] [data-blok-table-cell-blocks]', 'right'],
  ])('starts every cell at the grid start (%s), so nested tables do not inherit the outer cell', (selector, value) => {
    expect(findRule(selector)?.body).toMatch(new RegExp(`text-align:\\s*${value}`));
  });

  it.each([
    ['[data-blok-table-cell-blocks][data-blok-cell-placement$="-center"]', 'center', '[data-blok-rtl="true"] [data-blok-table-cell-blocks]'],
    ['[data-blok-table-cell-blocks][data-blok-cell-placement$="-right"]', 'right', '[data-blok-rtl="true"] [data-blok-table-cell-blocks]'],
    ['[data-blok-rtl="true"] [data-blok-table-cell-blocks][data-blok-cell-placement$="-right"]', 'left', '[data-blok-table-cell-blocks][data-blok-cell-placement$="-right"]'],
  ])('%s aligns to the %s and comes after the rule it must beat', (selector, value, beats) => {
    const rule = findRule(selector);

    expect(rule?.body).toMatch(new RegExp(`text-align:\\s*${value}`));
    expect(rule?.index).toBeGreaterThan(findRule(beats)?.index ?? Infinity);
  });
});
