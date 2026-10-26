import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');

/** Body of the first rule whose selector list holds `selector`. */
const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .find((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))?.[2] ?? '';

/** Everything from the table view's first rule on. */
const tableCss = css.slice(css.indexOf('[data-blok-database-table] {'));

const TOKENS = [
  '--blok-database-table-border',
  '--blok-database-table-header-text',
  '--blok-database-table-header-icon',
  '--blok-database-table-cell-text',
  '--blok-database-table-muted-text',
  '--blok-database-table-calc-value',
  '--blok-database-table-cell-ring',
  '--blok-database-table-drop-line',
  '--blok-database-table-resize',
];

describe('database table view styles', () => {
  it.each(TOKENS)('%s is defined in database.css for light, system dark and forced dark, and not in colors.css', (token) => {
    expect(css.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(3);
    // colors.css feeds view.css, which has a byte budget.
    expect(colors).not.toContain(`${token}:`);
  });

  it('a number cell is block-level, so a Bar or Ring gauge takes its own size and keeps the flex gap', () => {
    expect(css).toMatch(/\[data-type="number"\][^{}]*\) > \[data-blok-database-cell\] \{\s*display:\s*block/);
    for (const gauge of [ '[data-blok-database-number-bar]', '[data-blok-database-number-ring]' ]) {
      expect(ruleBody(gauge)).toMatch(/display:\s*inline-block/);
      expect(ruleBody(`[data-blok-database-table-cell][data-type="number"] > [data-blok-database-cell] > ${gauge}`)).toMatch(/margin-inline-start:\s*var\(--blok-space-1-5\)/);
    }
  });

  it('uses the measured Notion sizes: 36px header, 37px rows, 35px footer, 5px resize handle', () => {
    expect(ruleBody('[data-blok-database-table-header]')).toMatch(/height:\s*36px/);
    expect(ruleBody('[data-blok-database-table-cell]')).toMatch(/min-height:\s*37px/);
    expect(ruleBody('[data-blok-database-table-footer]')).toMatch(/min-height:\s*35px/);
    expect(ruleBody('[data-blok-database-table-resize]')).toMatch(/width:\s*5px/);
  });

  it('paints a selected cell and row gray, never with the focus ring', () => {
    const selected = ruleBody('[data-blok-database-table-cell][aria-selected="true"]');
    const anchor = ruleBody('[data-blok-database-table-cell][data-blok-database-table-cell-anchor]');
    const row = ruleBody('[data-blok-database-table-row][aria-selected="true"]::after');

    expect(selected).toContain('var(--blok-icon-active-bg)');
    expect(anchor).toContain('var(--blok-database-table-cell-ring)');
    expect(row).toContain('var(--blok-icon-active-bg)');
    expect(`${selected}${anchor}${row}`).not.toContain('focus-ring');
  });

  it('marks a checked row checkbox with primary ink on a gray fill', () => {
    const checked = ruleBody('[data-blok-database-table-row-checkbox][aria-checked="true"]');

    expect(checked).toContain('var(--blok-icon-active-bg)');
    expect(checked).not.toMatch(/rgb\(39,\s*131,\s*222\)|#2783de|focus-ring/i);
  });

  it('uses logical properties only, so RTL mirrors the grid', () => {
    expect(tableCss.length).toBeGreaterThan(1000);
    expect(tableCss).not.toMatch(/(?:^|[\s;{])(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/m);
  });

  it('turns every table animation off for reduced motion', () => {
    expect(tableCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('floats the title page icon in a 22px box beside the title, glyph 18px in header-icon ink (research/07:72)', () => {
    const box = ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder]');

    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon]')).toBe(box);
    expect(box).toMatch(/float:\s*inline-start/);
    expect(box).toMatch(/width:\s*22px/);
    expect(box).toMatch(/height:\s*22px/);
    expect(box).toContain('margin-block-start: calc(-1 * var(--blok-space-0-5))');
    expect(box).toContain('margin-inline: calc(-1 * var(--blok-space-0-5)) var(--blok-space-0-75)');
    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder]')).toContain('var(--blok-database-table-header-icon)');
    expect(ruleBody('[data-blok-database-page-icon-placeholder] svg')).toMatch(/width:\s*18px/);
  });

  it('draws the header bottom line on the header cells and no dividers between them (Notion: border-right none)', () => {
    const lines = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      .filter((m) => /border-inline-end/.test(m[2] ?? '') && (m[1] ?? '').includes('[data-vertical-lines="true"]'))
      .map((m) => m[1] ?? '');

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(',')).not.toContain('[data-blok-database-table-column-header]');
    expect(ruleBody('[data-blok-database-table-column-header]')).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--blok-database-table-border\)/);
  });


  it('widens the header "+" to a 28px "Add property" button with 6px sides, label in AA header ink (research/08:260)', () => {
    const labelled = ruleBody('[data-blok-database-table-add-property][data-labelled]');

    expect(labelled).toMatch(/width:\s*auto/);
    expect(labelled).toContain('padding-inline: var(--blok-space-1-5)');
    expect(labelled).toContain('gap: var(--blok-space-1-5)');
    expect(labelled).toContain('color: var(--blok-database-table-header-text)');
    expect(labelled).toMatch(/font-size:\s*14px/);
    expect(labelled).toMatch(/line-height:\s*16.8px/);
  });

  it('draws blank lines 37px tall with the row bottom line and the column dividers (feel T08)', () => {
    expect(ruleBody('[data-blok-database-table-blank-row]')).toMatch(/display:\s*flex/);
    const cell = ruleBody('[data-blok-database-table-blank-cell]');

    expect(cell).toMatch(/min-height:\s*37px/);
    expect(cell).toContain('border-block-end: 1px solid var(--blok-database-table-border)');
    expect(ruleBody('[data-blok-database-table-blank-row] > [data-blok-database-table-filler]')).toContain('border-block-end: 1px solid var(--blok-database-table-border)');
    expect(ruleBody('[data-blok-database-table-grid][data-vertical-lines="true"] [data-blok-database-table-blank-cell]')).toContain('border-inline-end');
  });

  it('sizes the file chip glyph to 20px in the chip ink (feel T23)', () => {
    const icon = ruleBody('[data-blok-database-file-chip-icon]');

    expect(icon).toMatch(/flex:\s*none/);
    expect(ruleBody('[data-blok-database-file-chip-icon] svg')).toMatch(/width:\s*20px/);
  });

  it('floats the sub-item toggle too, so a nested title stays on the toggle\'s line', () => {
    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-subitem-toggle]')).toMatch(/float:\s*inline-start/);
  });
});
