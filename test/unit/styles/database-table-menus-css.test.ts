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

  // notion-spec-2 §18.5: the full list is 290x573.6 and scrolls inside, wherever it sits.
  it('stops at Notion\'s 573.6px, or the viewport when that is shorter, and scrolls the types inside', () => {
    expect(declared('[data-blok-database-property-type-popover]', 'max-height')).toEqual(['min(573.6px, calc(100dvh - 2 * var(--blok-space-3)))']);
    expect(declared('[data-blok-database-property-type-body]', 'overflow-y')).toEqual(['auto']);
  });

  it('has 28px rows of 14px text with 20px glyphs and a sentence-case label', () => {
    expect(declared('[data-blok-database-property-type-option]', 'min-height')).toEqual(['28px']);
    expect(declared('[data-blok-database-property-type-option]', 'font-size')).toEqual(['14px']);
    expect(declared('[data-blok-database-property-type-option-icon] svg', 'width')).toEqual(['20px']);
    expect(declared('[data-blok-database-property-type-heading]', 'text-transform')).toEqual([]);
    expect(declared('[data-blok-database-property-type-heading]', 'font-size')).toEqual(['12px']);
  });

  // notion-spec-2 §18.5, research/08 Motion: opacity and scale 0.96 → 1 over 200ms ease, from the top-left corner.
  it('opens like Notion\'s menus', () => {
    // The second is the reduced-motion `none`.
    expect(declared('[data-blok-database-property-type-popover]', 'animation')).toEqual(['blok-prop-popover-in 200ms ease both', 'none']);
    expect(declared('[data-blok-database-property-type-popover]', 'transform-origin')).toEqual(['top left']);
  });

  // notion-spec-2 §17.9: Notion's section label is its gray rgb(125,122,117), not a blue-gray. It fails AA, so it takes Blok's passing gray.
  it('draws the section labels in the database gray', () => {
    expect(declared('[data-blok-database-property-type-heading]', 'color')).toEqual(['var(--blok-database-ink-secondary)']);
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

  // Its class carries the header class, whose 14px regular rule it reads (notion-spec-2 §12).
  it('reads 14px regular through the header class, with no rule of its own', () => {
    expect(declared(`${ROW_PAGE} [data-blok-popover-item-title]`, 'font-size')).toEqual([]);
    expect(declared(`${HEADER} [data-blok-popover-item-title]`, 'font-size')).toEqual(['14px']);
  });

  it('has 8px separators and no gap under the last row: Notion\'s 197px menu', () => {
    expect(declared(`${ROW_PAGE} [data-blok-popover-item-separator]`, 'padding-block')).toEqual(['var(--blok-space-0-75) var(--blok-space-1)']);
    expect(declared(`${ROW_PAGE} [data-blok-popover-item]:last-child`, 'margin-block-end')).toEqual(['0']);
  });

  // notion-spec-2 §1: "Type › Number": 14/16.8 value, 6px to the chevron, chevron 8px from the row end.
  // Notion's value ink rgb(161,158,153) fails AA, so the value keeps Blok's secondary ink.
  it('shows a row\'s value at 14px, 6px before its chevron, with the chevron 8px from the row end', () => {
    expect(declared(`${HEADER} [data-blok-popover-item-value]`, 'font-size')).toEqual(['14px']);
    expect(declared(`${HEADER} [data-blok-popover-item-value]`, 'line-height')).toEqual(['1.2']);
    expect(declared(`${ROW_PAGE} [data-blok-popover-item-value] + [data-blok-popover-item-icon-chevron-right]`, 'margin-inline-start')).toEqual(['var(--blok-space-1-5)']);
    expect(declared(`${ROW_PAGE} [data-blok-popover-item]:has(> [data-blok-popover-item-value])`, 'padding-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  // notion-spec-2 §9: the Edit formula row has no value, but its chevron also ends 8px from the row end.
  it('ends the Edit formula chevron 8px from the row end, as the value rows', () => {
    expect(declared(`${ROW_PAGE} [data-blok-popover-item][data-blok-item-name="editFormula"]`, 'padding-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  // notion-spec-2 §2: the note wraps inside Notion's 290 panel instead of widening it (Blok drew 303).
  it('never widens the menu with the all-views note', () => {
    expect(declared('[data-blok-database-property-menu-note]', 'contain')).toEqual(['inline-size']);
  });

  const PANEL = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-property-panel']";
  // The column header's Edit property submenu: a nested popover carries no class of its own.
  const SUB = `${HEADER} [data-blok-popover][data-blok-nested]`;

  // notion-spec-2 §1: the Edit property panel's rows sit 8px in from its edge (body padding 8px); other menus keep 4.
  it('pads the Edit property panel 8px, as Notion', () => {
    expect(declared(`${PANEL} [data-blok-popover-container]`, 'padding-inline')).toEqual(['var(--blok-space-2)']);
    expect(declared(`${PANEL} [data-blok-popover-items]`, 'padding-block')).toEqual(['var(--blok-space-2)']);
    // Keeps Show as at the panel's x + 20 and the tiles at x + 28 (§2).
    expect(declared(`${PANEL} [data-blok-database-show-as]`, 'padding-inline')).toEqual(['var(--blok-space-3)']);
  });

  // notion-spec-2 §2: the note sits 30px in from the panel (items start 8px in), 12px under the tiles, 12/18.
  // §9: in the header submenu it sits 18px in (items start 4px in).
  it('insets the all-views note as Notion, on the panel and in the header submenu', () => {
    const note = (menu: string): string => `${menu} [data-blok-database-property-menu-note]`;

    expect(declared(note(ROW_PAGE), 'padding')).toEqual(['var(--blok-space-3) calc(var(--blok-space-5) + var(--blok-space-0-5)) 0']);
    expect(declared(note(SUB), 'padding')).toEqual(['var(--blok-space-3) calc(var(--blok-space-3) + var(--blok-space-0-5)) 0']);
    expect(declared(note(ROW_PAGE), 'line-height')).toEqual(['18px']);
    expect(declared(note(SUB), 'line-height')).toEqual(['18px']);
  });

  // notion-spec-2 §2, §9: Color and Divide by sit in one box at the tiles' x, 12px under them, padding 12px 0,
  // rows 8px apart and 16px in, on rgba(84,72,49,0.04): 234 wide on the 290 panel, 268 in the 300 header submenu.
  it('boxes Color and Divide by, as Notion, on the panel and in the header submenu', () => {
    for (const [menu, inset] of [[ROW_PAGE, 'var(--blok-space-5)'], [SUB, 'var(--blok-space-3)']]) {
      const color = `${menu} [data-blok-popover-item][data-blok-item-name="color"]`;
      const divide = `${menu} [data-blok-popover-item-html][data-blok-item-name="divideBy"]`;

      // No 1px item gap under it: the box would show a seam.
      expect(declared(color, 'margin-block')).toEqual(['var(--blok-space-4) 0']);
      expect(declared(color, 'margin-inline')).toEqual([inset]);
      // Notion's value is a button 8px in from the row's 16px padding: the chevron ends 24 in.
      expect(declared(color, 'padding-inline')).toEqual(['var(--blok-space-4) var(--blok-space-6)']);
      expect(declared(color, 'background-color')).toEqual(['var(--blok-database-gauge-box-bg)']);
      // Popover rows clip their overflow, which hid the ::before (the box's top 12px and its radius).
      expect(declared(color, 'overflow')).toEqual(['visible']);
      expect(declared(`${color}::before`, 'block-size')).toEqual(['var(--blok-space-3)']);
      expect(declared(`${color}::before`, 'background-color')).toEqual(['var(--blok-database-gauge-box-bg)']);
      expect(declared(divide, 'margin-inline')).toEqual([inset]);
      expect(declared(divide, 'padding-block')).toEqual(['var(--blok-space-2) 0']);
      expect(declared(divide, 'background-color')).toEqual(['var(--blok-database-gauge-box-bg)']);
      expect(declared(divide, 'contain')).toEqual(['inline-size']);
      expect(declared(`${divide} > [data-blok-database-property-menu-field]`, 'padding')).toEqual(['0 var(--blok-space-4)']);
      expect(declared(`${divide} > [data-blok-database-property-menu-field]`, 'gap')).toEqual(['var(--blok-space-4)']);
    }
    expect(database).toContain('--blok-database-gauge-box-bg: rgba(84, 72, 49, 0.04);');
  });

  // notion-spec-2 §2, §9, §10: Show number closes the box: 8px under Divide by, 12px above the box's end,
  // a 28px row 16px in, label at the start, Blok's 30x18 database switch at the end.
  it('closes the gauge box with the Show number row, on the panel and in the header submenu', () => {
    const row = '[data-blok-database-property-menu-switch]';

    for (const [menu, inset] of [[ROW_PAGE, 'var(--blok-space-5)'], [SUB, 'var(--blok-space-3)']]) {
      const show = `${menu} [data-blok-popover-item-html][data-blok-item-name="showNumber"]`;

      expect(declared(show, 'margin-inline')).toEqual([inset]);
      expect(declared(show, 'padding-block')).toEqual(['var(--blok-space-2) var(--blok-space-3)']);
      expect(declared(show, 'border-end-start-radius')).toEqual(['var(--blok-radius-control)']);
      expect(declared(show, 'border-end-end-radius')).toEqual(['var(--blok-radius-control)']);
      expect(declared(show, 'background-color')).toEqual(['var(--blok-database-gauge-box-bg)']);
      expect(declared(`${menu} [data-blok-popover-item-html][data-blok-item-name="divideBy"]`, 'border-end-start-radius')).toEqual([]);
      expect(declared(`${show} > ${row}`, 'padding')).toEqual(['0 var(--blok-space-4)']);
    }
    expect(declared(row, 'block-size')).toEqual(['28px']);
    expect(declared(row, 'justify-content')).toEqual(['space-between']);
    expect(declared(row, 'inline-size')).toEqual(['100%']);
  });

  // notion-spec-2 §9: the header submenu's tiles fill a row 16px in from the panel, 6px apart (about 85 wide each).
  it('stretches the header submenu tiles across the row, as Notion', () => {
    expect(declared(`${SUB} [data-blok-database-show-as]`, 'padding-inline')).toEqual(['var(--blok-space-3)']);
    expect(declared(`${SUB} [data-blok-database-show-as-tiles]`, 'padding-inline')).toEqual(['0']);
    expect(declared(`${SUB} [data-blok-database-show-as-tiles]`, 'gap')).toEqual(['var(--blok-space-1-5)']);
    expect(declared(`${SUB} [data-blok-database-show-as-tile]`, 'flex')).toEqual(['1']);
  });

  // notion-spec-2 §9: Notion's Color value is swatch, name, then a down chevron 8px after the name.
  // The turn sits on the svg, so it also replaces the RTL mirror (a down chevron needs none).
  it('draws the Color row\'s chevron pointing down, 8px after the name', () => {
    for (const menu of [ROW_PAGE, SUB]) {
      const chevron = `${menu} [data-blok-popover-item][data-blok-item-name="color"] [data-blok-popover-item-icon-chevron-right]`;

      expect(declared(`${chevron} svg`, 'transform')).toEqual(['rotate(90deg)']);
      expect(declared(chevron, 'margin-inline-start')).toEqual(['var(--blok-space-2)']);
    }
  });
});

describe('database submenus (notion-spec-2 §11)', () => {
  const MENU = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu']";
  const NESTED = `${MENU} [data-blok-popover]`;
  const SUB = `${HEADER} [data-blok-popover][data-blok-nested]`;

  // A submenu is its own top-layer root, and colors.css resets --blok-text-primary to black there.
  it('keeps the database inks and hover fill in a submenu', () => {
    expect(declared(NESTED, '--blok-text-primary')).toEqual(['var(--blok-database-ink)']);
    expect(declared(NESTED, '--blok-text-secondary')).toEqual(['var(--blok-database-ink-secondary)']);
    expect(declared(NESTED, '--blok-icon-active-text')).toEqual(['var(--blok-database-ink)']);
    expect(declared(NESTED, '--blok-item-hover-bg')).toEqual(['rgba(33, 27, 23, 0.051)']);
    expect(declared(`[data-blok-theme="dark"] ${NESTED}`, '--blok-item-hover-bg')).toEqual(['rgba(255, 255, 255, 0.055)']);
  });

  // notion-spec-2 §11, §12: the column header menu, its submenus, the peek's "•••" and peek mode menus
  // all read 14px regular. They share the header class, so one rule covers them.
  it('reads 14px regular in every menu with the header look, as Notion', () => {
    expect(declared(`${HEADER} [data-blok-popover-item-title]`, 'font-size')).toEqual(['14px']);
    expect(declared(`${HEADER} [data-blok-popover-item-title]`, 'font-weight')).toEqual(['400']);
    expect(declared(`${HEADER} [data-blok-popover-item-value]`, 'font-size')).toEqual(['14px']);
    expect(declared(`${HEADER} [data-blok-popover-item-value]`, 'line-height')).toEqual(['1.2']);
    expect(declared(`${SUB} [data-blok-popover-item-title]`, 'font-size')).toEqual([]);
  });
});

// notion-spec-2 §11: Notion's reset menu is 56 tall. Its row: the u-turn glyph at x+8 and 1px down,
// the title and sub-line 14/20 regular at x+36 from y+8. Notion's sub-line ink fails AA; Blok keeps its own.
describe('layout reset row (notion-spec-2 §11)', () => {
  const RESET = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-layout-reset-menu']";

  it('top-aligns the glyph and pads the row to 48', () => {
    expect(declared(`${RESET} [data-blok-popover-item]`, 'align-items')).toEqual(['flex-start']);
    expect(declared(`${RESET} [data-blok-popover-item]`, 'padding')).toEqual(['var(--blok-space-0-25) var(--blok-space-1) var(--blok-space-1)']);
    expect(declared(`${RESET} [data-blok-popover-item-title]`, 'margin-block-start')).toEqual(['var(--blok-space-0-75)']);
    // No row gap under it: the menu is 4 + 48 + 4.
    expect(declared(`${RESET} [data-blok-popover-item]`, 'margin-block-end')).toEqual(['0']);
  });

  it('draws the glyph in a 20px slot, 8px before the text', () => {
    expect(declared(`${RESET} [data-blok-popover-item-icon]`, 'inline-size')).toEqual(['20px']);
    expect(declared(`${RESET} [data-blok-popover-item-icon]`, 'block-size')).toEqual(['20px']);
    expect(declared(`${RESET} [data-blok-popover-item-icon]`, 'margin-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  // Notion's glyph ink is its strong glyph grey, rgb(56,56,54).
  it('inks the glyph in the strong glyph grey', () => {
    expect(declared(`${RESET} [data-blok-popover-item-icon]`, 'color')).toEqual(['var(--blok-database-peek-glyph-strong)']);
  });

  it('reads 14/20 regular on both lines', () => {
    for (const line of ['[data-blok-popover-item-title]', '[data-blok-popover-item-description]']) {
      expect(declared(`${RESET} ${line}`, 'font-size')).toEqual(['14px']);
      expect(declared(`${RESET} ${line}`, 'font-weight')).toEqual(['400']);
    }
  });
});

// notion-spec-2 §12: Notion's Color list is 296 tall: padding 8px 0 and ten full-width 28px rows, no gap.
// A row pads 8px, a 20px swatch slot, then the name 8px on: the swatches line up with the button's.
describe('Color list (notion-spec-2 §12)', () => {
  const LIST = `${HEADER} [data-blok-popover][data-blok-nested]:has(> [data-blok-popover-container] [data-blok-item-name='color-default'])`;
  const COLOR = `${HEADER} [data-blok-popover-item][data-blok-item-name="color"]`;

  it('has Notion\'s 296px box: full-width rows, 8px above and below', () => {
    expect(declared(`${LIST} [data-blok-popover-container]`, 'padding-inline')).toEqual(['0']);
    expect(declared(`${LIST} [data-blok-popover-items]`, 'padding-block')).toEqual(['var(--blok-space-2)']);
    expect(declared(`${LIST} [data-blok-popover-item]`, 'margin-block-end')).toEqual(['0']);
    expect(declared(`${LIST} [data-blok-popover-item]`, 'padding-inline')).toEqual(['var(--blok-space-2)']);
  });

  it('draws each swatch in a 20px slot, 8px before the name', () => {
    expect(declared(`${LIST} [data-blok-popover-item-icon]`, 'inline-size')).toEqual(['20px']);
    expect(declared(`${LIST} [data-blok-popover-item-icon]`, 'block-size')).toEqual(['20px']);
    expect(declared(`${LIST} [data-blok-popover-item-icon]`, 'margin-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  // The button's swatch sits in a 20px slot too, so the list's swatches line up with it.
  it('gives the button\'s swatch the same 20px slot', () => {
    expect(declared(`${COLOR} [data-blok-popover-item-value] > [data-blok-database-option-swatch]`, 'margin-inline')).toEqual(['var(--blok-space-0-25)']);
  });
});
