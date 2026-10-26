/**
 * Table menu sizes (feel/findings-table T11-T27). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const database = strip(readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8'));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every declaration of `name` in top-level rules whose selector list holds exactly `selector`. */
const declared = (selector: string, name: string): string[] =>
  [...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .flatMap((rule) => [...rule[2].matchAll(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`, 'g'))].map((m) => m[1].trim()));

const HEADER = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-header-menu']";

describe('column header menu (T11)', () => {
  it('has 28px rows, as Notion', () => {
    expect(declared(`${HEADER} [data-blok-popover-item]`, 'height')).toEqual(['28px']);
    expect(declared(`${HEADER} [data-blok-popover-item]`, 'padding-block')).toEqual(['0']);
  });

  it('is not capped at 400px: it grows to the viewport like Notion\'s 498px menu', () => {
    expect(declared(`${HEADER} [data-blok-popover-container]`, '--max-height')).toEqual(['calc(100dvh - 2 * var(--blok-space-3))']);
  });
});

describe('add property menu (T12)', () => {
  // Notion 2026-10-25: 290 wide, one column of types.
  it('is 290 wide with one column of types', () => {
    expect(declared('[data-blok-database-property-type-popover]', 'width')).toEqual(['290px']);
    expect(declared('[data-blok-database-property-type-popover]', 'box-sizing')).toEqual(['border-box']);
    expect(declared('[data-blok-database-property-type-grid]', 'grid-template-columns')).toEqual(['minmax(0, 1fr)']);
  });

  it('grows to the viewport and scrolls the types inside, so it never runs off screen', () => {
    expect(declared('[data-blok-database-property-type-popover]', 'max-height')).toEqual(['calc(100dvh - 2 * var(--blok-space-3))']);
    expect(declared('[data-blok-database-property-type-body]', 'overflow-y')).toEqual(['auto']);
  });

  it('has 28px rows of 14px text with 20px glyphs and a sentence-case label', () => {
    expect(declared('[data-blok-database-property-type-option]', 'min-height')).toEqual(['28px']);
    expect(declared('[data-blok-database-property-type-option]', 'font-size')).toEqual(['14px']);
    expect(declared('[data-blok-database-property-type-option-icon] svg', 'width')).toEqual(['20px']);
    expect(declared('[data-blok-database-property-type-heading]', 'text-transform')).toEqual([]);
    expect(declared('[data-blok-database-property-type-heading]', 'font-size')).toEqual(['12px']);
  });

  // Notion keeps the gray glyph on hover; only the row gets a fill. No blue (selected/hover law).
  it('keeps the type glyph ink on hover', () => {
    expect(declared('[data-blok-database-property-type-option]:hover [data-blok-database-property-type-option-icon]', 'color')).toEqual([]);
  });

  it('heads the menu with the type glyph beside the name field', () => {
    expect(declared('[data-blok-database-property-type-header]', 'align-items')).toEqual(['center']);
    expect(declared('[data-blok-database-property-type-glyph]', 'width')).toEqual(['28px']);
    expect(declared('[data-blok-database-property-type-glyph]', 'height')).toEqual(['28px']);
  });
});

describe('row menu (T15)', () => {
  const ROW = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-row-menu']";

  it('has 29px rows, as Notion', () => {
    expect(declared(`${ROW} [data-blok-popover-item]`, 'height')).toEqual(['29px']);
  });

  it('ends with a 12px gray "Last edited" footer', () => {
    expect(declared('[data-blok-database-row-menu-footer]', 'font-size')).toEqual(['12px']);
    expect(declared('[data-blok-database-row-menu-footer]', 'color')).toEqual(['var(--blok-database-ink-secondary)']);
  });
});

describe('status cell popover (T17)', () => {
  it('lets its search field shrink, so the input\'s default size does not push it past 240', () => {
    expect(declared('[data-blok-database-select-editor="status"] [data-blok-database-select-search]', 'width')).toEqual(['0']);
  });

  it('separates its groups with a divider line', () => {
    const rule = '[data-blok-database-select-list] > [data-blok-database-status-group-heading]:not(:first-child)';

    expect(declared(rule, 'border-top')).toEqual(['1px solid var(--blok-database-drawer-border)']);
  });
});

describe('multi-select popover (T18)', () => {
  it('shows each option\'s ⋮⋮ handle at rest; its "…" still waits for hover', () => {
    expect(declared('[data-blok-database-select-editor="multiSelect"] [data-blok-database-select-option-handle]', 'opacity')).toEqual(['1']);
    expect(declared('[data-blok-database-select-option-menu]', 'opacity')).toEqual(['0']);
  });
});

describe('selection bar (T13)', () => {
  it('hides only the view tabs while rows are selected: the toolbar and New stay', () => {
    const rule = '[data-blok-database-view-bar][data-blok-database-selecting] > [data-blok-database-tab-bar]';

    expect(declared(rule, 'visibility')).toEqual(['hidden']);
    expect(declared('[data-blok-database-view-bar][data-blok-database-selecting] > :not([data-blok-database-table-selection-bar])', 'visibility')).toEqual([]);
  });

  it('still hides the whole toolbar under the uncapped board and list bar', () => {
    const rule = '[data-blok-database-view-bar][data-blok-database-selecting]:not([data-blok-database-selecting="table"]) > :not([data-blok-database-table-selection-bar])';

    expect(declared(rule, 'visibility')).toEqual(['hidden']);
  });
});

describe('filter property list (T27)', () => {
  it('paints the highlighted option with the row hover fill', () => {
    expect(declared('[data-blok-database-panel-row][data-active]', 'background-color')).toEqual(['var(--blok-database-table-header-hover-bg)']);
  });
});

describe('row page property menu (research parity row 9)', () => {
  const ROW_PAGE = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-row-page-menu']";

  it('reads 14px regular, as Notion', () => {
    expect(declared(`${ROW_PAGE} [data-blok-popover-item-title]`, 'font-size')).toEqual(['14px']);
    expect(declared(`${ROW_PAGE} [data-blok-popover-item-title]`, 'font-weight')).toEqual(['400']);
  });

  it('has 8px separators and no gap under the last row: Notion\'s 197px menu', () => {
    expect(declared(`${ROW_PAGE} [data-blok-popover-item-separator]`, 'padding-block')).toEqual(['var(--blok-space-0-75) var(--blok-space-1)']);
    expect(declared(`${ROW_PAGE} [data-blok-popover-item]:last-child`, 'margin-bottom')).toEqual(['0']);
  });
});
