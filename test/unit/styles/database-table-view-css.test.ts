import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');

/** Body of the first rule whose selector list holds `selector`. */
const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .find((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))?.[2] ?? '';

/** Body of the last rule whose whole selector is `selector`; for selectors with commas inside `:has()`. */
const exactRule = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter((match) => (match[1] ?? '').trim() === selector).at(-1)?.[2] ?? '';

/** Everything from the table view's first rule on. */
const tableCss = css.slice(css.indexOf('[data-blok-database-table] {'));

const TOKENS = [
  '--blok-database-number-track',
  '--blok-database-number-default',
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

  // notion-spec-2 §7: the cell holding a gauge is a flex row, number first, the gauge 8px after, at the cell's end.
  it('a number cell with a Bar or Ring gauge is a flex row with an 8px gap, at the cell\'s end', () => {
    const gaugeCell = '[data-blok-database-table-cell] > [data-blok-database-cell]:has(> [data-blok-database-number-bar], > [data-blok-database-number-ring])';
    const blockCell = css.indexOf('[data-type="number"], [data-type="url"], [data-type="date"]) > [data-blok-database-cell] {');

    expect(exactRule(gaugeCell)).toMatch(/display:\s*flex/);
    expect(exactRule(gaugeCell)).toMatch(/justify-content:\s*flex-end/);
    // Ties the block-level and wrapped cell rules, so it must come after both.
    expect(css.indexOf(`${gaugeCell} {`)).toBeGreaterThan(blockCell);
    expect(css.indexOf(`${gaugeCell} {`)).toBeGreaterThan(css.indexOf('[data-blok-database-table-cell][data-wrap] > [data-blok-database-cell] {'));
    expect(exactRule(gaugeCell)).toMatch(/flex-wrap:\s*nowrap/);
    expect(exactRule(gaugeCell)).toMatch(/gap:\s*var\(--blok-space-2\)/);
    expect(exactRule('[data-blok-database-cell]:has(> [data-blok-database-number-bar], > [data-blok-database-number-ring])')).toMatch(/gap:\s*var\(--blok-space-2\)/);
  });

  it('draws the gauges at Notion\'s size and colours (notion-spec-2 §7)', () => {
    const bar = exactRule('[data-blok-database-number-bar]');

    expect(bar).toMatch(/flex:\s*0 1 160px/);
    expect(bar).toMatch(/min-inline-size:\s*48px/);
    expect(bar).toMatch(/block-size:\s*4px/);
    expect(bar).toMatch(/background:\s*var\(--blok-database-number-track\)/);
    expect(ruleBody('[data-blok-database-number-bar]::before')).toMatch(/background:\s*var\(--blok-database-number-ink\)/);
    expect(exactRule('[data-blok-database-number-ring]')).toMatch(/inline-size:\s*21px/);
    expect(ruleBody('[data-blok-database-number-ring-track]')).toMatch(/stroke:\s*var\(--blok-database-number-track\)/);
    expect(ruleBody('[data-blok-database-number-ring-arc]')).toMatch(/stroke:\s*var\(--blok-database-number-ink\)/);
  });

  // notion-spec-2 §21.1, §22.4: in an unwrapped table only the Title ends in "…"; Text, Number, Date and URL are cut at the edge.
  it('cuts an unwrapped Text, Number, Date and URL cell at its edge, and keeps the Title ellipsis', () => {
    const clip = '[data-blok-database-table-cell]:is([data-type="text"], [data-type="richText"], [data-type="number"], [data-type="url"], [data-type="date"]) > [data-blok-database-cell]';
    const block = '[data-blok-database-table-cell]:is([data-type="title"], [data-type="text"], [data-type="richText"], [data-type="number"], [data-type="url"], [data-type="date"]) > [data-blok-database-cell]';

    expect(exactRule(clip)).toMatch(/text-overflow:\s*clip/);
    expect(exactRule(block)).toMatch(/text-overflow:\s*ellipsis/);
    // Same weight as the block rule that sets the ellipsis, so it comes after it.
    expect(css.lastIndexOf(`${clip} {`)).toBeGreaterThan(css.lastIndexOf(`${block} {`));
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

  it('floats the title page icon in a 22px box beside the title, glyph 18px in the title icon ink (research/07:72)', () => {
    const box = ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder]');

    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon]')).toBe(box);
    expect(box).toMatch(/float:\s*inline-start/);
    expect(box).toMatch(/width:\s*22px/);
    expect(box).toMatch(/height:\s*22px/);
    expect(box).toContain('margin-block-start: calc(-1 * var(--blok-space-0-5))');
    expect(box).toContain('margin-inline: calc(-1 * var(--blok-space-0-5)) var(--blok-space-0-75)');
    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder]')).toContain('var(--blok-database-table-title-icon)');
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

describe('database table number figures', () => {
  // research/35 §17: Notion's table Number and Formula cells use lining, tabular figures.
  it.each(['number', 'formula'])('a %s table cell draws lining, tabular figures', (type) => {
    expect(ruleBody(`[data-blok-database-table-cell][data-type="${type}"]`)).toContain('font-variant-numeric: lining-nums tabular-nums');
  });
});

describe('database table formula alignment', () => {
  // notion-spec-2 §19.13, §18.1: a formula that returns a number sits at the cell's end, like a Number.
  it('a number formula sits at the end of its table cell', () => {
    const body = ruleBody('[data-blok-database-table-cell][data-type="formula"] > [data-blok-database-cell][data-result-type="number"]');

    expect(body).toMatch(/justify-content:\s*flex-end/);
    expect(body).toMatch(/text-align:\s*end/);
  });
});

describe('database table hover pill side', () => {
  // notion-spec-2 §18.2, §19.20: on a right-aligned value the Comment + Copy box hugs the cell's left edge, 4px in.
  it.each([
    '[data-blok-database-table-cell][data-type="number"] > [data-blok-database-table-cell-actions=""]',
    '[data-blok-database-table-cell][data-type="formula"]:has(> [data-result-type="number"]) > [data-blok-database-table-cell-actions=""]',
  ])('%s sits at the start edge', (selector) => {
    const body = ruleBody(selector);

    expect(body).toMatch(/inset-inline-start:\s*4px/);
    expect(body).toMatch(/inset-inline-end:\s*auto/);
  });
});

describe('database table hover pill at the end edge', () => {
  // notion-spec-2 §19.6: x 843-895 in a cell 700-900. Blok's cell rect holds its 1px end border, so 4px in lands 5px from the rect's edge.
  it('sits 4px in from the end border', () => {
    expect(ruleBody('[data-blok-database-table-cell-actions]')).toMatch(/inset-inline-end:\s*4px/);
  });
});

describe('database table rollup hover box', () => {
  // notion-spec-2 §18.2: a numeric rollup's Configure + Copy box sits on the left, like Number.
  it('a number rollup box sits at the start edge', () => {
    const body = ruleBody('[data-blok-database-table-cell][data-type="rollup"]:has(> [data-result-type="number"]) > [data-blok-database-table-cell-actions=""]');

    expect(body).toMatch(/inset-inline-start:\s*4px/);
    expect(body).toMatch(/inset-inline-end:\s*auto/);
  });

  // notion-spec-2 §18.2: Configure rollup is 20x20 with radius 6px, so the box is 48 wide.
  it('Configure rollup is a 20px square with 6px corners', () => {
    const body = ruleBody('[data-blok-database-table-cell-action="configure"]');

    expect(body).toMatch(/width:\s*20px/);
    expect(body).toMatch(/border-radius:\s*var\(--blok-radius-control\)/);
  });
});

describe('database table checkbox hover', () => {
  // notion-spec-2 §18.2, §19.5: an unchecked box fills on hover, the border stays; a checked box does not change.
  it('an unchecked box in a hovered cell takes the measured fill', () => {
    const body = ruleBody('[data-blok-database-table-cell][data-type="checkbox"]:hover [data-blok-database-checkbox]:not([data-state="checked"])');

    expect(body).toMatch(/background-color:\s*var\(--blok-database-checkbox-hover-bg\)/);
    expect(body).not.toMatch(/border/);
    expect(css).toMatch(/--blok-database-checkbox-hover-bg:\s*rgba\(66, 35, 3, 0\.047\)/);
  });
});
