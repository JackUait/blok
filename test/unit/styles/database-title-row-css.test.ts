/**
 * The database title row and view tabs, as measured in feel/findings-toolbar.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** The rule whose whole selector is `selector`, not one that ends with it. */
const rule = (selector: string): string => {
  const at = database.indexOf(`} ${selector} {`);

  if (at < 0) throw new Error(`no rule ${selector}`);

  return database.slice(at + 2, database.indexOf('}', at + 2));
};

describe('one view: the toolbar shares the title row (V01)', () => {
  it('the emptied view bar takes no room', () => {
    expect(rule('[data-blok-database-view-bar][data-single-view]')).toMatch(/display: none/);
  });

  it('the title row is 40px and the header starts right under it', () => {
    const body = rule('[data-blok-database-title-row][data-single-view]');

    expect(body).toMatch(/min-height: 40px/);
    expect(body).toMatch(/margin-bottom: 0/);
  });

  it('the selection bar can take the title row', () => {
    expect(rule('[data-blok-database-title-row][data-blok-database-selecting]')).toMatch(/position: relative/);
  });
});

describe('the empty title keeps its placeholder width (V02)', () => {
  it('a hidden copy of the placeholder holds the title open', () => {
    const body = rule('[data-blok-database-title-row][data-single-view] [data-blok-database-title]:is(:empty, [data-blok-empty="true"])::after');

    expect(body).toMatch(/content: attr\(data-placeholder\)/);
    expect(body).toMatch(/visibility: hidden/);
    expect(body).toMatch(/height: 0/);
    expect(body).toMatch(/white-space: nowrap/);
  });
});

describe("Add view is Notion's tile grid (V04)", () => {
  it('lays the tiles out in 4 columns', () => {
    expect(rule("[data-blok-popover-custom-class~='blok-database-add-view-menu'] [data-blok-popover-items]")).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  });

  it('a tile is 62px tall, radius 8, a 22px glyph above a 14/20 label', () => {
    const tile = rule('[data-blok-database-view-option]');

    expect(tile).toMatch(/flex-direction: column/);
    expect(tile).toMatch(/height: 62px/);
    expect(tile).toMatch(/border-radius: var\(--blok-radius-control-lg\)/);
    expect(rule('[data-blok-database-view-option-icon] svg')).toMatch(/width: 22px/);
    expect(rule('[data-blok-database-view-option-label]')).toMatch(/font-size: 14px; line-height: 20px/);
  });

  it('the heading is 12/14.4 500 in sentence case', () => {
    const heading = rule('[data-blok-database-view-popover-heading]');

    expect(heading).toMatch(/font-size: 12px; line-height: 14\.4px; font-weight: 500/);
    expect(heading).not.toMatch(/text-transform/);
  });
});

describe('title row "+" and "…" (V02, V03)', () => {
  it('both are 24px buttons with 16px glyphs, shown on row hover', () => {
    const plus = rule('[data-blok-database-title-row][data-single-view] [data-blok-database-add-view]');

    expect(plus).toMatch(/width: 24px; height: 24px/);
    const more = rule('[data-blok-database-title-more]');

    expect(more).toMatch(/width: 24px/);
    expect(more).toMatch(/height: 24px/);
    expect(more).toMatch(/opacity: 0/);
    expect(rule('[data-blok-database-title-more] svg')).toMatch(/width: 16px/);
    expect(database).toMatch(/\[data-blok-database-title-row\]:hover \[data-blok-database-title-more\]/);
  });
});

describe('tab row sizes (V26, V32, V33)', () => {
  it('the tab-bar "+" is 28px with a 16px glyph, 1px after the last tab', () => {
    const plus = rule('[data-blok-database-add-view]');

    expect(plus).toMatch(/width: 28px/);
    expect(plus).toMatch(/height: 28px/);
    expect(plus).toMatch(/margin-inline-start: var\(--blok-border-width-hairline\)/);
    expect(rule('[data-blok-database-add-view] svg')).toMatch(/width: 16px; height: 16px/);
  });

  it('"N more…" is 14px', () => {
    expect(rule('[data-blok-database-tab-more]')).toMatch(/font-size: 14px/);
  });

  it('tabs sit 1px apart', () => {
    expect(rule('[data-blok-database-tab-bar]')).toMatch(/gap: var\(--blok-border-width-hairline\)/);
  });
});

describe('dragging a tab (V27)', () => {
  it('the source tab leaves the row, so the others reflow live', () => {
    expect(rule('[data-blok-database-tab][data-blok-database-tab-drag-source]')).toMatch(/display: none/);
  });

  it('the ghost has no black shadow', () => {
    expect(rule('[data-blok-database-tab-ghost]')).toMatch(/box-shadow: none/);
  });
});
