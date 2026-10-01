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
  // The sides come from the nearest dir above the cell (the table's), not
  // start/end: each cell paragraph carries the dir of its own text.
  it('starts every cell at the grid start, so nested tables do not inherit the outer cell', () => {
    expect(findRule('[data-blok-table-cell-blocks]')?.body).toMatch(/text-align:\s*var\(--_blok-start-side,\s*left\)/);
  });

  it.each([
    ['[data-blok-table-cell-blocks][data-blok-cell-placement$="-center"]', 'center'],
    ['[data-blok-table-cell-blocks][data-blok-cell-placement$="-right"]', 'var\\(--_blok-end-side,\\s*right\\)'],
  ])('%s aligns to %s and comes after the grid-start rule', (selector, value) => {
    const rule = findRule(selector);

    expect(rule?.body).toMatch(new RegExp(`text-align:\\s*${value}`));
    expect(rule?.index).toBeGreaterThan(findRule('[data-blok-table-cell-blocks]')?.index ?? Infinity);
  });

  it('defines the sides on every dir root, the table drag ghost included', () => {
    expect(css).toMatch(/\[data-blok-table-drag-ghost\]\[dir="rtl"\][^{]*\{[^}]*--_blok-start-side:\s*right/);
    expect(css).toMatch(/\[data-blok-table-drag-ghost\]\[dir="ltr"\][^{]*\{[^}]*--_blok-start-side:\s*left/);
  });
});
