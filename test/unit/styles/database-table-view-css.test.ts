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
  it.each(TOKENS)('%s is defined for light, system dark and forced dark', (token) => {
    expect(colors.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(3);
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
});
