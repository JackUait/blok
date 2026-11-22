/**
 * Table menu sizes (feel/findings-table T11-T27). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const database = strip(readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8'));
const colors = strip(readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8'));

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

  // notion-spec-2 §24.10: 220 wide. The name input's own width (about 160) made the field row 231 wide.
  it('keeps the name field from widening the menu past 220', () => {
    expect(declared('[data-blok-database-property-menu-name] > [data-blok-database-property-menu-name-input]', 'width').at(-1)).toBe('0');
  });
});

// notion-live-8/80-menu-number.png, 83-menu-name.png: the column header menu's own list, not its submenus
// and not the row page, peek, card or rollup menus that share the header class.
describe('column header menu dividers and name row', () => {
  const LIST = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-column-menu'] > [data-blok-popover-container] > [data-blok-popover-items]";

  // Notion: x 390-585 in a 378-597 box, 12px in from each side; the list pads 4, the divider 8.
  it('insets each divider 12px from the box sides', () => {
    expect(declared(`${LIST} > [data-blok-popover-item-separator]`, 'padding-inline')).toEqual(['var(--blok-space-2)']);
  });

  // Notion: AI Autofill 347 to Filter 384 and Wrap content 558 to Insert left 595, one 29px row plus 8.
  it('takes 8px for a divider: 3 above, the 1px line, 4 below', () => {
    expect(declared(`${LIST} > [data-blok-popover-item-separator]`, 'padding-block')).toEqual(['var(--blok-space-0-75) var(--blok-space-1)']);
  });

  // Notion: the first row's cap top sits at box top + 55; with no divider Blok's sat at + 50.
  it('keeps 4px under the name field before the first row', () => {
    expect(declared(`${LIST} > [data-blok-item-name='name']`, 'margin-block-end')).toEqual(['var(--blok-space-1)']);
  });
});

// notion-motion.md Round 35 (r35-colmenu-top.raw): the icon box at x 1021 in a menu whose rows start at 1017,
// the field 1057-1225 (168 wide), and the (i) inside the field, 6px from its end.
describe('column header menu name row (Round 35)', () => {
  const ROW = '[data-blok-database-property-menu-name]';
  const INFO = '[data-blok-database-property-menu-description-button]';

  it('puts the icon box 4px in and the field 8px after it', () => {
    expect(declared(ROW, 'padding-inline').at(-1)).toBe('var(--blok-space-1)');
    expect(declared(ROW, 'gap').at(-1)).toBe('var(--blok-space-2)');
  });

  it('draws the (i) inside the field end, so the field runs to the row end', () => {
    expect(declared(INFO, 'margin-inline').at(-1)).toBe('-29px var(--blok-space-1-5)');
    expect(declared(INFO, 'position').at(-1)).toBe('relative');
    expect(declared(`${ROW} > [data-blok-database-property-menu-name-input]:has(+ ${INFO})`, 'padding-inline-end')).toEqual(['27px']);
  });

  it('keeps the taken-name error under the field', () => {
    expect(declared('[data-blok-database-property-menu-name-error]', 'padding-inline-start')).toEqual(['calc(28px + var(--blok-space-2))']);
  });
});

// notion-motion.md Round 35 (r35-tabmenu.raw): "Source" ends at 624.9, "New database" starts at 632.9 and ends at 725,
// a 16 chevron at 731-747, the row ending at 755: the row fits the 220 menu.
describe('view tab menu Source row (Round 35)', () => {
  const ROW = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-column-menu'] [data-blok-item-name='database-view-source']";

  it('sets the source name 8px after "Source", then a 16px chevron 6px after it, 8px from the row end', () => {
    expect(declared(ROW, 'padding-inline-end')).toEqual(['var(--blok-space-2)']);
    expect(declared(`${ROW} [data-blok-popover-item-value]`, 'padding-inline-start')).toEqual(['var(--blok-space-2)']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right]`, 'margin-inline')).toEqual(['var(--blok-space-1-5) 0']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right]`, 'width')).toEqual(['16px']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right] svg`, 'width')).toEqual(['16px']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right] svg`, 'height')).toEqual(['16px']);
  });
});

// notion-motion.md Round 35 (r35-tabmenu.raw): Display as ends in a 16x16 chevron at 731-747, the row ending at 755.
describe('view tab menu Display as row (Round 35)', () => {
  const ROW = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-column-menu'] [data-blok-item-name='database-tab-display']";

  it('ends in a 16px chevron 8px from the row end', () => {
    expect(declared(ROW, 'padding-inline-end')).toEqual(['var(--blok-space-2)']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right]`, 'width')).toEqual(['16px']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right]`, 'margin-inline-end')).toEqual(['0']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right] svg`, 'width')).toEqual(['16px']);
    expect(declared(`${ROW} [data-blok-popover-item-icon-chevron-right] svg`, 'height')).toEqual(['16px']);
  });
});

describe('add property menu (T12)', () => {
  // Notion 2026-10-25: 290 wide, one column of types.
  it('is 290 wide with one column of types', () => {
    expect(declared('[data-blok-database-property-type-popover]', 'width')).toEqual(['290px']);
    expect(declared('[data-blok-database-property-type-popover]', 'box-sizing')).toEqual(['border-box']);
    expect(declared('[data-blok-database-property-type-grid]', 'grid-template-columns')).toEqual(['minmax(0, 1fr)']);
  });

  // notion-spec-2 §19.10: 573.6 tall in a 717 window and 800 in a 1000 one; the types scroll inside.
  it('stops at 80% of the window height and scrolls the types inside', () => {
    expect(declared('[data-blok-database-property-type-popover]', 'max-height')).toEqual(['80dvh']);
    expect(declared('[data-blok-database-property-type-body]', 'overflow-y')).toEqual(['auto']);
  });

  // notion-motion.md Round 26 §5: a 14px "?" in rgb(142, 139, 134) at the row's end, hidden until the row is hovered,
  // then fading in over 200ms ease-in-out.
  it('shows a type row\'s "?" at its end only on row hover', () => {
    const help = '[data-blok-database-property-type-help]';

    expect(declared(help, 'margin-inline-start')).toEqual(['auto']);
    expect(declared(help, 'opacity')).toEqual(['0']);
    expect(declared(help, 'transition')).toEqual(['opacity 200ms ease-in-out']);
    expect(declared(help, 'color')).toEqual(['var(--blok-database-peek-label-icon)']);
    expect(declared(`${help} svg`, 'width')).toEqual(['14px']);
    expect(declared(`[data-blok-database-property-type-option]:hover > ${help}`, 'opacity')).toEqual(['1']);
  });

  // notion-motion.md Round 28 §3 (r28-addprop.raw, r28-idtip.png): across a rule the cell pitch is 48, not 34. The line is
  // rgb(240,239,237) on white, 4 in from the cells, 7 under the row above and 8 over the next. The 2px row gap counts twice.
  // notion-motion.md Round 28 §3: the box is 808–1207 (its ring at 807 and 1208, r28-idtip.png), the cells start at 816 and
  // the "?" of both columns sit at 986 and 1178 (r28-addprop.raw): 8 in and 192-wide cells. The AI rows line up with them.
  it('insets the grid\'s body 8 from the box, so its cells are 192 wide', () => {
    expect(declared("[data-blok-database-property-type-layout='grid'] [data-blok-database-property-type-body]", 'padding-inline'))
      .toEqual(['var(--blok-space-1)']);
  });

  it('draws the grid\'s rules full width, 1px, with the 16px break Notion has', () => {
    const rule = '[data-blok-database-property-type-rule]';

    expect(declared(rule, 'grid-column')).toEqual(['1 / -1']);
    expect(declared(rule, 'height')).toEqual(['1px']);
    expect(declared(rule, 'margin')).toEqual(['var(--blok-space-1-25) var(--blok-space-1) var(--blok-space-1-5)']);
    expect(declared(rule, 'background-color')).toEqual(['var(--blok-database-table-border)']);
  });

  it('has 28px rows of 14px text with 20px glyphs and a sentence-case label', () => {
    expect(declared('[data-blok-database-property-type-option]', 'min-height')).toEqual(['28px']);
    expect(declared('[data-blok-database-property-type-option]', 'font-size')).toEqual(['14px']);
    expect(declared('[data-blok-database-property-type-option-icon] svg', 'width')).toEqual(['20px']);
    expect(declared('[data-blok-database-property-type-heading]', 'text-transform')).toEqual([]);
    expect(declared('[data-blok-database-property-type-heading]', 'font-size')).toEqual(['12px']);
  });

  // notion-motion.md Round 102 §2 Row 44 (r102-n-row44-picker.raw, r44-tp-add-head.raw): the AI rows are 28 tall at a 30 pitch,
  // and the "Basic" tag is 11/500 on a 14.3 line with 2px 4px padding (36.9x18.3). Its ink stays Blok's AA gray.
  it('spaces the AI Autofill rows 30 apart and sets the Basic tag 11/500', () => {
    expect(declared('[data-blok-database-property-autofill-option] + [data-blok-database-property-autofill-option]', 'margin-block-start'))
      .toEqual(['var(--blok-space-0-5)']);
    expect(declared('[data-blok-database-property-autofill-tag]', 'font-size')).toEqual(['11px']);
    expect(declared('[data-blok-database-property-autofill-tag]', 'font-weight')).toEqual(['500']);
    expect(declared('[data-blok-database-property-autofill-tag]', 'line-height')).toEqual(['1.3']);
    expect(declared('[data-blok-database-property-autofill-tag]', 'padding')).toEqual(['var(--blok-space-0-5) var(--blok-space-1)']);
  });

  // research/08 line 203, 267: the table header "+" menu is 400 wide, a two-column grid of 32px items.
  it('draws the header "+" grid 400 wide in two columns of 32px items', () => {
    const GRID = "[data-blok-database-property-type-layout='grid']";

    expect(declared(GRID, 'width')).toEqual(['400px']);
    expect(declared(`${GRID} [data-blok-database-property-type-grid]`, 'grid-template-columns')).toEqual(['repeat(2, minmax(0, 1fr))']);
    expect(declared(`${GRID} [data-blok-database-property-type-option]`, 'min-height')).toEqual(['32px']);
  });

  // notion-motion.md Round 86 §1 #10: Insert left/right opens the same 389x362.5 dialog as the "+", whose painted
  // card is 400x358.5 at a 717 window (Round 34 §6, r34-typemenu-plus-midscreen.png), so both grids show half the window.
  it('caps every type grid at half the window, Insert left/right too', () => {
    expect(declared("[data-blok-database-property-type-layout='grid']", 'max-height')).toEqual(['50dvh']);
  });

  // notion-spec-2 §25.6 (editprop-select.txt): the line under Sort is 4px below it, at box x + 12, 276 wide; the first option 42 below it.
  it('insets the Edit property line under Sort as Notion does', () => {
    expect(declared('[data-blok-item-name="optionSort"] + [data-blok-popover-item-separator]', 'padding'))
      .toEqual(['var(--blok-space-1) var(--blok-space-2) var(--blok-space-2-5)']);
  });

  // notion-spec-2 §19.11: the type cells are 32 tall at a 34px pitch, so 2px apart.
  it('sets the header "+" type cells 2px apart', () => {
    expect(declared("[data-blok-database-property-type-layout='grid'] [data-blok-database-property-type-grid]", 'row-gap')).toEqual(['var(--blok-space-0-5)']);
  });

  // notion-spec-2 §19.11: the header "+" name box is a white 378x28 box over the "+"; its last 34px fade.
  it('draws the header "+" name box in the header cell and fades the grid', () => {
    const OVER = '[data-blok-database-property-type-name-over-anchor]';

    expect(declared(`${OVER} > [data-blok-database-property-type-header]`, 'position')).toEqual(['absolute']);
    expect(declared(`${OVER} > [data-blok-database-property-type-header]`, 'width')).toEqual(['378px']);
    expect(declared(`${OVER} > [data-blok-database-property-type-header]`, 'height')).toEqual(['28px']);
    expect(declared(`${OVER} > [data-blok-database-property-type-header]`, 'border-radius')).toEqual(['var(--blok-radius-control)']);
    expect(declared(`${OVER} > [data-blok-database-property-type-header]`, 'box-shadow')).toEqual(['none']);
    expect(declared(OVER, 'max-height')).toEqual([]);
    expect(declared(`${OVER} [data-blok-database-property-type-body]`, 'mask-image')).toEqual(['linear-gradient(black 0%, black calc(100% - 34px), transparent 100%)']);
  });

  // notion-spec-2 §18.5: the row the arrows are on takes the hover fill, never blue.
  it('fills the arrow-highlighted type like a hovered one', () => {
    expect(declared('[data-blok-database-property-type-option-active]', 'background-color')).toEqual(['var(--blok-database-popover-hover)']);
  });

  // notion-spec-2 §18.5, research/08 Motion: opacity and scale 0.96 → 1 over 200ms ease, from the top-left corner.
  it('opens like Notion\'s menus', () => {
    // The second is the reduced-motion `none`.
    expect(declared('[data-blok-database-property-type-popover]', 'animation')).toEqual(['blok-prop-popover-in 200ms ease both', 'none']);
    expect(declared('[data-blok-database-property-type-popover]', 'transform-origin')).toEqual(['top left']);
  });

  // notion-spec-2 §19.22: the close is the open in reverse, opacity 1 → 0 and scale 1 → 0.96 over ~200ms.
  it('closes as the reverse of its open', () => {
    // The second is the reduced-motion `none`.
    expect(declared('[data-blok-database-property-type-popover][data-blok-closing]', 'animation')).toEqual(['blok-prop-popover-out 200ms ease both', 'none']);
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

// notion-motion.md Round 35 (r35-rowmenu.raw, r35-cardmenu.raw, r35-peekmenu.raw): the row and card menus and the
// peek's ⋯ menu share one inner layout. Only their own list: a submenu is a popover of its own.
describe('row, card and peek ⋯ menus (Round 35)', () => {
  // notion-motion.md Round 36 §6 (r36-peekmenu-x.raw): every peek ⋯ row has its icon at +12 and its text at +40,
  // as the card menu: a 20px icon box and 8 to the text, from the row at +4 and its 8px padding.
  it('puts the peek ⋯ menu icon at +12 and its text at +40, as the card menu', () => {
    const icon = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-page-actions-menu'] [data-blok-popover-item-icon]";

    expect(declared(icon, 'width')).toEqual(['20px']);
    expect(declared(icon, 'margin-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  const MENUS = ['blok-database-card-menu', 'blok-database-page-actions-menu'].map((name) => `[data-blok-popover][data-blok-popover-custom-class~='${name}'] > [data-blok-popover-container]`);

  // Notion: the field 241 wide in a 265 box, 12 from its top and sides; the first row (peek) 12 under it.
  // Blok's list pads 4 on each side and on top.
  it('keeps 12px around the search field', () => {
    for (const menu of MENUS) {
      expect(declared(`${menu} > [data-blok-field='search']`, 'margin')).toEqual(['var(--blok-space-3) var(--blok-space-2) var(--blok-space-2)']);
    }
  });

  // Notion: Edit property 275.3 to Open in 312.3, one 29px row plus 8; the line 4 under the row, 12 in from the sides.
  it('takes 8px for a divider: 3 above, the 1px line, 4 below, inset 12 from the box', () => {
    for (const menu of MENUS) {
      expect(declared(`${menu} > [data-blok-popover-items] > [data-blok-popover-item-separator]`, 'padding-block')).toEqual(['var(--blok-space-0-75) var(--blok-space-1)']);
      expect(declared(`${menu} > [data-blok-popover-items] > [data-blok-popover-item-separator]`, 'padding-inline')).toEqual(['var(--blok-space-2)']);
    }
  });

  // Notion: "Page" (12px/14.4) starts 18.2 under the field, and the first row 41.9 under it.
  it('sets the "Page" label 18px under the field and its first row 41px under it', () => {
    const heading = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-card-menu'] [data-blok-database-row-menu-heading]";

    expect(declared(heading, 'padding-block')).toEqual(['var(--blok-space-1-5) var(--blok-space-2-25)']);
    expect(declared(heading, 'line-height')).toEqual(['14.4px']);
  });

  // Notion: "Last edited" 12 under the line in 500, then the 16px avatar and name 4 under it, then the time and
  // the count 2 apart; the box ends 12 under the last line.
  it('lays out the footer as Notion: "Last edited", the person, the time, the count', () => {
    expect(declared('[data-blok-database-row-menu-footer]', 'padding')).toEqual(['var(--blok-space-2)']);
    expect(declared('[data-blok-database-row-menu-footer-label]', 'font-weight')).toEqual(['500']);
    expect(declared('[data-blok-database-row-menu-footer-person]', 'margin-block-start')).toEqual(['var(--blok-space-1)']);
    expect(declared('[data-blok-database-row-menu-footer-person]', 'gap')).toEqual(['var(--blok-space-1)']);
    expect(declared('[data-blok-database-row-menu-footer-person] > :is([data-blok-database-person-avatar], [data-blok-database-person-initial])', 'width')).toEqual(['16px']);
    expect(declared('[data-blok-database-row-menu-footer-time]', 'margin-block-start')).toEqual(['var(--blok-space-0-5)']);
    expect(declared('[data-blok-database-row-menu-footer-counts]', 'margin-block-start')).toEqual(['var(--blok-space-0-5)']);
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

  // notion-motion.md Round 27 §3 "Row gutter and selection": gap 0, radius 5, Trash 28x32 with a 20 glyph, ⋯ 30x32.
  it('draws the bar with abutting segments, a 5px radius, a 28-wide Trash with a 20px glyph and a 30-wide ⋯', () => {
    for (const bar of ['[data-blok-database-table-selection-bar]', '[data-blok-database-table-selection-bar-leaving]']) {
      expect(declared(bar, 'gap')).toEqual(['0']);
      expect(declared(bar, 'border-radius')).toEqual(['var(--blok-radius-selection-bar)']);
      expect(declared(`${bar} [data-blok-database-table-selection-delete]`, 'width')).toEqual(['28px']);
      expect(declared(`${bar} [data-blok-database-table-selection-delete] svg`, 'width')).toEqual(['20px']);
      expect(declared(`${bar} [data-blok-database-table-selection-delete] svg`, 'height')).toEqual(['20px']);
      expect(declared(`${bar} [data-blok-database-table-selection-more]`, 'width')).toEqual(['30px']);
      expect(declared(`${bar} [data-blok-database-table-selection-more]`, 'border-start-end-radius')).toEqual(['var(--blok-radius-selection-bar)']);
      expect(declared(`${bar} [data-blok-database-table-selection-more]`, 'border-end-end-radius')).toEqual(['var(--blok-radius-selection-bar)']);
    }
    expect(colors).toMatch(/--blok-radius-selection-bar: 0\.3125rem;/);
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
    // notion-motion.md Round 113 §1 #9: Notion's 12 above is a margin, and 6 + 4 + 4 sit under the text.
    // Box 264 wide at the text's x; the menu's own 4 is the last of the three.
    expect(declared(note(SUB), 'margin')).toEqual(['var(--blok-space-3) var(--blok-space-3-5) var(--blok-space-1)']);
    expect(declared(note(SUB), 'padding')).toEqual(['0 0 var(--blok-space-1-5)']);
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
      // R112 (notion-motion.md §1 #3): Notion's Divide by value sits in a 110px box at the row's end.
      expect(declared(`${divide} [data-blok-field]`, 'inline-size')).toEqual(['110px']);
      expect(declared(`${divide} [data-blok-field]`, 'margin-inline-start')).toEqual(['auto']);
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

  // notion-spec-2 §9: the header submenu's tiles fill a row 16px in from the panel; 8px apart (notion-motion.md Round 83 §4).
  it('stretches the header submenu tiles across the row, as Notion', () => {
    expect(declared(`${SUB} [data-blok-database-show-as]`, 'padding-inline')).toEqual(['var(--blok-space-3)']);
    expect(declared(`${SUB} [data-blok-database-show-as-tiles]`, 'padding-inline')).toEqual(['0']);
    expect(declared(`${SUB} [data-blok-database-show-as-tiles]`, 'gap')).toEqual(['var(--blok-space-2)']);
    expect(declared(`${SUB} [data-blok-database-show-as-tile]`, 'flex')).toEqual(['1']);
  });

  // notion-motion.md Round 92 §1 #7 (r92-n-dark-editprop-number.raw): the line over Show as is 268 wide at x 16 of
  // the 300 flyout, and the Bar tile's track is 59.3 of its 83.3 tile, so it spans the tile inside the 12px padding.
  it('insets the Show as divider 16 and stretches the Bar tile track, as Notion', () => {
    expect(declared(`${SUB} [data-blok-popover-item-separator]:has(+ [data-blok-item-name='showAs'])`, 'padding-inline')).toEqual(['var(--blok-space-3)']);
    expect(declared(`${SUB} [data-blok-database-show-as-tile="bar"] > [data-blok-database-show-as-glyph]`, 'align-self')).toEqual(['stretch']);
    expect(declared(`${SUB} [data-blok-database-show-as-tile="bar"] > [data-blok-database-show-as-glyph]`, 'inline-size')).toEqual(['auto']);
    expect(declared(`${SUB} [data-blok-database-show-as-tile="bar"] [data-blok-database-number-bar]`, 'inline-size')).toEqual(['100%']);
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

// notion-motion.md Round 9 "Edit property from a column header" (r9-header-menu-select.raw, r9-editprop-flyout.raw):
// in the column menu and its Edit property flyout the 20px icon sits 8px into the row, the text 36px in.
describe('column menu row icon', () => {
  it('draws the icon 20px wide with 8px after it', () => {
    const COLUMN = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-column-menu'] [data-blok-popover-item-icon]";

    expect(declared(COLUMN, 'width')).toEqual(['20px']);
    expect(declared(COLUMN, 'margin-inline-end')).toEqual(['var(--blok-space-2)']);
  });
});

// notion-motion.md Round 11: every calculation menu is 200x123: four 28px rows on a 29 pitch, 4px padding.
describe('calculation menu', () => {
  it('drops the last row\'s 1px gap, so four rows make 123', () => {
    expect(declared("[data-blok-popover][data-blok-popover-custom-class~='blok-database-calc-menu'] [data-blok-popover-item]:last-child", 'margin-block-end')).toEqual(['0']);
  });
});

// r11-gap-nocalc.raw: the New page row is 37 tall, its 28px button 4.5 from the top.
describe('"+ New page" row', () => {
  it('keeps 4.5px above and below the 28px button', () => {
    expect(declared('[data-blok-database-table-add-row]', 'height')).toEqual(['28px']);
    expect(declared('[data-blok-database-table-add-row]', 'margin-block')).toEqual(['calc(var(--blok-space-2-25) / 2)']);
  });
});

// research/22 §5: the board's 99+ row holds a hint line, so the calc menu's 28px row height must not clip it.
describe('board count menu 99+ row', () => {
  it('grows to fit its hint', () => {
    expect(declared("[data-blok-popover][data-blok-popover-custom-class~='blok-database-calc-menu'] [data-blok-item-name='database-group-calc-cap-counts']", 'height')).toEqual(['auto']);
  });
});

// notion-motion.md Round 12: the table's Count list has the board's 99+ row, 72.4 tall,
// and Count all starts 9px under it (1px row gap + an 8px divider).
describe('calculation Count list 99+ row', () => {
  const CALC = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-calc-menu']";

  it('grows the table\'s 99+ row to 72.4 and drops the one-line cap', () => {
    expect(declared(`${CALC} [data-blok-item-name='database-calc-cap-counts']`, 'height')).toEqual(['auto']);
    expect(declared('[data-blok-item-name="database-calc-cap-counts"]', 'max-height')).toEqual(['none']);
  });

  // notion-motion.md Round 16 §9: 8px in on every side; title 14/16.8, the 12/16.8 hint 6px under it,
  // and the 30x18 switch 8px from the row's right, top-aligned with the title.
  it('lays the 99+ row out as Notion\'s: title, switch on its line, hint under', () => {
    for (const name of ['database-calc-cap-counts', 'database-group-calc-cap-counts']) {
      expect(declared(`${CALC} [data-blok-item-name='${name}']`, 'padding')).toEqual(['var(--blok-space-2)']);
    }
    expect(declared('[data-blok-database-calc-cap]', 'display')).toEqual(['grid']);
    expect(declared('[data-blok-database-calc-cap]', 'grid-template-columns')).toEqual(['188px 30px']);
    expect(declared('[data-blok-database-calc-cap]', 'column-gap')).toEqual(['var(--blok-space-2)']);
    expect(declared('[data-blok-database-calc-cap]', 'row-gap')).toEqual(['var(--blok-space-1-5)']);
    expect(declared('[data-blok-database-calc-cap-title]', 'line-height')).toEqual(['16.8px']);
    expect(declared('[data-blok-database-calc-cap-title]', 'font-size')).toEqual(['14px']);
    expect(declared('[data-blok-database-calc-hint]', 'grid-column')).toEqual(['1']);
    expect(declared('[data-blok-database-calc-cap] > [data-blok-database-switch-track]', 'grid-row')).toEqual(['1 / span 2']);
    expect(declared('[data-blok-database-calc-hint]', 'line-height')).toEqual(['16.8px']);
    expect(declared('[data-blok-database-calc-cap] > [data-blok-database-switch-track]', 'align-self')).toEqual(['start']);
  });

  // The switch carries the state; the row keeps only its hover fill. On stays blue (user decision).
  it('shows the on state on the switch, not as a fill', () => {
    const ON = "[data-blok-item-name$='calc-cap-counts'][aria-checked='true']";

    expect(declared(`${CALC} [data-blok-item-name$='calc-cap-counts'][data-blok-popover-item-active]:not(:hover, [data-blok-focused='true'])`, 'background-color')).toEqual(['transparent']);
    // notion-motion.md Round 29 §1: the load limit's current row shows only its check, no fill.
    expect(declared(`${CALC} [data-blok-item-name^='database-load-limit-'][data-blok-popover-item-active]:not(:hover, [data-blok-focused='true'])`, 'background-color')).toEqual(['transparent']);
    expect(declared(`${ON} [data-blok-database-switch-track]`, 'background-color')).toEqual(['var(--blok-database-switch-on-bg)']);
    expect(declared(`${ON} [data-blok-database-switch-track] > span`, 'transform')).toEqual(['translateX(12px)']);
  });

  it('makes the divider under it 8 tall, 12px in from the box sides', () => {
    expect(declared(`${CALC} [data-blok-popover-item-separator]`, 'padding-block')).toEqual(['var(--blok-space-0-75) var(--blok-space-1)']);
    expect(declared(`${CALC} [data-blok-popover-item-separator]`, 'padding-inline')).toEqual(['var(--blok-space-2)']);
  });
});

// The empty grid's blank line is 37 with its border, so the button keeps 4px margins there.
describe('"+ New page" in the empty grid', () => {
  it('keeps the blank line 37 tall', () => {
    expect(declared('[data-blok-database-table-blank-cell] > [data-blok-database-table-add-row]', 'margin-block')).toEqual(['var(--blok-space-1)']);
  });
});

// research/08 "New row in a filtered view", shots-08/69-filter-pills.png: on a wide table Notion centres
// "Edit filters" and "New page" in the visible column, not across the whole grid.
describe('filtered-empty table', () => {
  const SCROLLER = '[data-blok-database-table-scroller]:has(> [data-blok-database-table-grid] > [data-blok-database-table-empty])';
  const EMPTY = '[data-blok-database-table-empty]';

  it('makes the scroller a container only while the empty state shows', () => {
    expect(declared(SCROLLER, 'container-type')).toEqual(['inline-size']);
    expect(declared('[data-blok-database-table-scroller]', 'container-type')).toEqual([]);
  });

  it('keeps the pair in the visible column: as wide as the scroller content, stuck to its start', () => {
    expect(declared(EMPTY, 'position')).toEqual(['sticky']);
    expect(declared(EMPTY, 'inset-inline-start')).toEqual(['0']);
    expect(declared(EMPTY, 'width')).toEqual(['100cqi']);
    expect(declared(EMPTY, 'justify-content')).toEqual(['center']);
  });

  // notion-motion.md Round 102 §2 Row 68 (r102-n-row68-empty.raw, r86-n-noresults.png): "New page" is 100.38 wide, pads 8 with
  // a 6 gap, and its plus ink (10.5 wide) sits 9 in from the outer edge. Blok's 16px plus draws 10.6 of ink, so its box hugs that.
  it('draws "New page" as Notion does: 8 in, the box round the plus ink, 6 to the text', () => {
    const NEW = `${EMPTY} [data-blok-database-table-add-row]`;

    expect(declared(NEW, 'gap').at(-1)).toBe('var(--blok-space-1-5)');
    expect(declared(NEW, 'padding-inline-start')).toEqual([]);
    expect(declared(`${NEW} > span`, 'width')).toEqual(['10.6px']);
    expect(declared(`${NEW} > span`, 'justify-content')).toEqual(['center']);
    expect(declared(`${NEW} svg`, 'flex')).toEqual(['none']);
  });
});

// notion-motion.md Round 16 §3: the "+ New group" popover is 300x36 with a 6px inset, a 21px field and a 24px Done.
// Round 98 §1 #1: the column pill's rename popup has the same field and Done, so both share the rule.
describe('"+ New group" and group rename name popover', () => {
  const MENU = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-new-group-menu']";

  it('drops the menu padding so the row sets the 36px height', () => {
    expect(declared(`${MENU} [data-blok-popover-container]`, 'padding')).toEqual(['0']);
    expect(declared(`${MENU} [data-blok-popover-items]`, 'padding')).toEqual(['0']);
    expect(declared('[data-blok-database-layout-section-rename][data-blok-database-group-name-field]', 'padding')).toEqual(['var(--blok-space-1-5)']);
    expect(declared('[data-blok-database-layout-section-rename][data-blok-database-group-name-field]', 'gap')).toEqual(['0']);
  });

  it('draws Done 24px tall, 6px in, with a 12x16 return mark', () => {
    const done = '[data-blok-database-layout-section-done][data-blok-database-new-group-done]';

    expect(declared(done, 'block-size')).toEqual(['24px']);
    expect(declared(done, 'padding-inline')).toEqual(['var(--blok-space-1-5)']);
    expect(declared('[data-blok-database-new-group-enter] svg', 'width')).toEqual(['12px']);
    expect(declared('[data-blok-database-new-group-enter] svg', 'height')).toEqual(['16px']);
    expect(declared('[data-blok-database-group-name-field] input', 'line-height')).toEqual(['21px']);
  });
});

// notion-motion.md Round 27 §2 "Narrow title column", Round 28 §1: the icon-only OPEN is a 30x24 frame with 2px padding
// around a 26x20 button, and keeps its label as its name.
describe('icon-only OPEN', () => {
  it('is 30 wide with a 2px frame, and hides the label without removing it', () => {
    const open = '[data-blok-database-table-open][data-compact]';

    expect(declared(open, 'width')).toEqual(['30px']);
    expect(declared(open, 'padding')).toEqual(['var(--blok-space-0-5)']);
    // notion-motion.md Round 47 §B8: the frame sits 4 in from the cell end, as the wide pill does (Notion x 604).
    expect(declared(open, 'inset-inline-end')).toEqual(['var(--blok-space-1)']);
    expect(declared(`${open} > span[aria-hidden="true"]`, 'width')).toEqual(['26px']);
    expect(declared(`${open} > span[aria-hidden="true"]`, 'height')).toEqual(['20px']);
    expect(declared(`${open} > span:last-child`, 'clip-path')).toEqual(['inset(50%)']);
    expect(declared(`${open} > span:last-child`, 'display')).toEqual([]);
  });
});

// notion-motion.md Round 36 §4 (r36-rowmenu-*.raw, r36-cardmenu-*.raw).
describe('row ⋮⋮ and card ⋯ menu motion (Round 36)', () => {
  // Notion's card ⋯ menu fades in with transform none. The not-yet-opened selector must beat the
  // database menus' 0.96 scale, which also carries :not([data-blok-popover-opened]).
  it('fades the card ⋯ menu in with no scale', () => {
    expect(declared("[data-blok-popover][data-blok-popover-custom-class~='blok-database-fade-menu']:not([data-blok-popover-opened='true']) > [data-blok-popover-container]", 'transform')).toEqual(['none']);
  });
});

// notion-motion.md Round 44 §3 (r44-tp-add-head.raw, r44-tp-search.raw): the header "+" picker's labels and search.
describe('header "+" type picker (Round 44)', () => {
  const GRID = "[data-blok-database-property-type-layout='grid']";

  // "AI Autofill" and "Select type" text at popover x + 19: the box pads 4, the body 4, the label 11.
  it('starts its section labels 19 in from the box', () => {
    expect(declared(`${GRID} [data-blok-database-property-type-heading]`, 'padding-inline')).toEqual(['var(--blok-space-2-75)']);
  });

  // The 20px search button ends at 130.9 and the first cell starts at 138.9.
  it('leaves 8 under the "Select type" line before the first type', () => {
    expect(declared(`${GRID} [data-blok-database-property-type-list-heading]`, 'padding-bottom')).toEqual(['var(--blok-space-2)']);
  });

  // magnifyingGlassSmall fill rgb(142, 139, 134), not the label's ink.
  it('draws the search glyph in the type icon gray', () => {
    expect(declared('[data-blok-database-property-type-search]', 'color')).toEqual(['var(--blok-database-type-icon)']);
  });

  // The field goes 2 under where the first cell was (138.9 → 140.9), and the cells 4 under it: a 34px shift.
  it('puts the search field 2 under the label line', () => {
    expect(declared(`${GRID} [data-blok-database-property-type-body] > [data-blok-database-property-type-search-input]`, 'margin-top')).toEqual(['var(--blok-space-0-5)']);
  });
});

// notion-motion.md Round 44 §3 (r44-tp-change.raw, r44-tp-propmenu-head.raw).
describe('Change type list and the property menu glyph (Round 44)', () => {
  // The list's type masks are rgb(56, 56, 54).
  it('draws the Change type glyphs in the strong glyph ink', () => {
    expect(declared("[data-blok-popover][data-blok-popover-custom-class~='blok-database-change-type'] [data-blok-popover-item-icon]", 'color'))
      .toEqual(['var(--blok-database-peek-glyph-strong)']);
  });

  // "Change icon" 28×28 holds a 16.8 type glyph.
  it('draws the type glyph in the name row\'s icon box at 16.8', () => {
    expect(declared('[data-blok-database-property-menu-icon] svg', 'width')).toEqual(['16.8px']);
    expect(declared('[data-blok-database-property-menu-icon] svg', 'height')).toEqual(['16.8px']);
  });
});

// notion-motion.md Round 44 §3 (r44-tp-add-head.raw): the header "+" name box is 378×28, padding 2/4; "Select icon" is a
// 24 box at +4 holding a 19.2 gray emoji glyph, and the field starts at +32.
describe('header "+" Select icon (Round 44)', () => {
  const HEAD = '[data-blok-database-property-type-name-over-anchor] > [data-blok-database-property-type-header]';
  const ICON = '[data-blok-database-property-type-icon-button]';

  it('pads the name box 2/4 with 4 between the icon and the field', () => {
    expect(declared(HEAD, 'padding')).toEqual(['var(--blok-space-0-5) var(--blok-space-1)']);
    expect(declared(HEAD, 'gap')).toEqual(['var(--blok-space-1)']);
  });

  // The "+" is 378×28 with the hover fill while open, so the header ⋯ moves to the name box's right (x 1486).
  it('widens the "+" into the new column\'s slot while its menu is open', () => {
    const SLOT = '[data-blok-database-table-add-property][data-blok-database-property-type-slot]';

    expect(declared(SLOT, 'width')).toEqual(['378px']);
    expect(declared(SLOT, 'background-color')).toEqual(['var(--blok-database-table-header-hover-bg)']);
  });

  it('draws Select icon as a 24 borderless box with a 19.2 glyph in the type icon gray', () => {
    expect(declared(ICON, 'width')).toEqual(['24px']);
    expect(declared(ICON, 'height')).toEqual(['24px']);
    expect(declared(ICON, 'border')).toEqual(['none']);
    expect(declared(ICON, 'color')).toEqual(['var(--blok-database-type-icon)']);
    expect(declared(`${ICON} svg`, 'width')).toEqual(['19.2px']);
  });
});

// notion-motion.md Round 47 §D: the divider after the sort chip sits 12 from each chip (621.3 | 633.3 | 646.3):
// the bar's 6 gap plus a 6 margin on each side.
describe('toolbar chip divider', () => {
  it('sits 12px clear of the chips on each side', () => {
    expect(declared('[data-blok-database-filter-pills]', 'gap')).toEqual(['var(--blok-space-1-5)']);
    expect(declared('[data-blok-database-filter-pills] > [data-blok-database-chip-divider]', 'margin-inline')).toEqual(['var(--blok-space-1-5)']);
  });
});

// notion-motion.md Round 65 §1: the database block's ⋮⋮ menu has 28px rows, on a desktop only.
describe('database block menu', () => {
  const ITEMS = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-block-menu'][data-blok-testid='block-tunes-popover'] > [data-blok-popover-container] > [data-blok-popover-items]:not([data-blok-hidden])";
  const ROW = `${ITEMS} > [data-blok-popover-item]:not([data-blok-hidden])`;
  const desktop = database.match(/@media \(min-width: 651px\) \{((?:[^{}]*\{[^{}]*\})*?[^{}]*?\[data-blok-popover-custom-class~='blok-database-block-menu'\](?:[^{}]*\{[^{}]*\})*?)\s*\}/)?.[1] ?? '';
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return desktop.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`))?.[1] ?? '';
  };

  it('has 28px rows 29 apart, as Notion', () => {
    expect(rule(ROW)).toContain('min-height: 28px');
    expect(rule(ROW)).toContain('padding-block: 0');
    expect(rule(ROW)).toContain('margin-block-end: var(--blok-space-0-25)');
  });

  it('adds no gap before a separator, so a group starts 37 after the last row, as Notion', () => {
    expect(rule(`${ROW}:has(+ [data-blok-popover-item-separator])`)).toContain('margin-block-end: 0');
  });

  it('leaves a phone its 44px touch rows: every block-menu rule sits in the desktop query', () => {
    const count = (css: string): number => css.split("[data-blok-popover-custom-class~='blok-database-block-menu']").length - 1;

    expect(count(desktop)).toBe(7);
    expect(count(database)).toBe(count(desktop));
  });

  // notion-motion.md Round 67 §1: Duplicate's submenu is 275 wide with 28px rows, and fades in over 200ms with no scale.
  const SUB = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-block-menu'][data-blok-testid='block-tunes-popover'] > [data-blok-popover][data-blok-nested='true'] > [data-blok-popover-container]";

  it('gives Duplicate\'s submenu Notion\'s 275px width', () => {
    expect(rule(SUB)).toContain('width: 275px');
  });

  it('fades Duplicate\'s submenu in over 200ms ease, with no scale', () => {
    expect(rule(SUB)).toContain('transition: opacity 200ms ease');
    expect(rule(SUB)).toContain('transform: none');
  });

  it('gives Duplicate\'s submenu 28px rows 29 apart', () => {
    const subRow = `${SUB} > [data-blok-popover-items] > [data-blok-popover-item]`;

    expect(rule(subRow)).toContain('min-height: 28px');
    expect(rule(subRow)).toContain('padding-block: 0');
    // 4 + 28 + 1 + 28 + 4 = Notion's 65.
    expect(rule(`${subRow}:last-child`)).toContain('margin-block-end: 0');
  });

  // notion-motion.md Round 67 §1: Notion's Move to Trash row shows no shortcut, and its hover fill is the neutral one.
  const TRASH = `${ITEMS} > [data-blok-item-name='delete']`;

  it('hides the Move to Trash row\'s Del label', () => {
    expect(rule(`${TRASH} [data-blok-popover-item-secondary-title]`)).toContain('display: none');
  });

  it('fills a hovered Move to Trash row with the neutral hover token, never red', () => {
    expect(rule(TRASH)).toContain('--blok-item-destructive-hover-bg: var(--blok-database-popover-hover)');
  });
});

// notion-motion.md Round 69 §1 (r69-n-lockpop.raw): the Unlock menu is 181.5x65. Rows pad 0 8, a 20px icon
// at +8 and the text 8 after it at +36; the box pads 4, rows 1 apart, no gap under the last one.
describe('the Unlock menu (Round 69)', () => {
  const LOCK = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-lock-menu']";

  it('has a 20px icon and 8 to the text, as the card menu', () => {
    expect(declared(`${LOCK} [data-blok-popover-item-icon]`, 'width')).toEqual(['20px']);
    expect(declared(`${LOCK} [data-blok-popover-item-icon]`, 'margin-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  it('pads its rows 0 8, with no gap under the last row', () => {
    expect(declared(`${LOCK} [data-blok-popover-item]`, 'padding-inline')).toEqual(['var(--blok-space-2)']);
    expect(declared(`${LOCK} [data-blok-popover-item]:last-child`, 'margin-block-end')).toEqual(['0']);
  });

  // Round 70 §2 (r70-n-lockpop.raw): its first row is filled color(srgb .129 .106 .090 / .051). Dark is unmeasured.
  it('fills the keyboard row with Notion\'s lighter tint, and keeps the dark default', () => {
    expect(declared(LOCK, '--blok-item-focus-bg')).toEqual(['rgba(33, 27, 23, 0.051)']);
    expect(declared(`[data-blok-theme="dark"] ${LOCK}`, '--blok-item-focus-bg')).toEqual(['rgba(255, 255, 255, 0.055)']);
  });
});

// notion-motion.md Round 81 §2 "Card ⋯, board" (r81-n-bd-cardmenu.raw; r35-cardmenu.raw: field 241x28, pad 3 6, no glyph).
describe('card menu search field (Round 81)', () => {
  const FIELD = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-card-menu'] > [data-blok-popover-container] > [data-blok-field='search']";

  it('puts the 14px text 18 in: no search glyph, 5px padding inside the 1px border', () => {
    expect(declared(`${FIELD}::before`, 'display')).toEqual(['none']);
    expect(declared(FIELD, 'padding-inline')).toEqual(['var(--blok-space-1-25)']);
    expect(declared(FIELD, 'font-size')).toEqual(['14px']);
  });

  it('draws the input 20 tall, so its text sits 16 under the menu top', () => {
    expect(declared(`${FIELD} > input`, 'height')).toEqual(['20px']);
    expect(declared(`${FIELD} > input`, 'line-height')).toEqual(['20px']);
  });
});

// notion-motion.md Round 81 §1 "Header menu name field at rest" (r81-n-hdrmenu.raw): the input text is 14px.
describe('header menu name field text (Round 81)', () => {
  it('sets the name 14px, not the shared field\'s 13', () => {
    expect(declared('[data-blok-database-property-menu-name] > [data-blok-database-property-menu-name-input]', 'font-size')).toEqual(['14px']);
  });
});

// notion-motion.md Round 81 §1 "Calculate menu …chevrons" (r81-n-calc-menu.raw; dark r81-n-calc-sumset-dark.raw):
// 16x16 at +168,+6 of a 192 row, ink rgb(142, 139, 134) (173 in dark), from the header and the footer alike.
describe('Calculate menu chevrons (Round 81)', () => {
  const CALC = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-calc-menu']";

  it('ends a group row 8px after its chevron', () => {
    expect(declared(`${CALC} [data-blok-popover-item][data-blok-has-children]`, 'padding-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  it('draws the chevron 16px in a 16px slot, in the header icon grey', () => {
    expect(declared(`${CALC} [data-blok-popover-item-icon-chevron-right]`, 'width')).toEqual(['16px']);
    expect(declared(`${CALC} [data-blok-popover-item-icon-chevron-right]`, 'margin-inline-end')).toEqual(['0']);
    expect(declared(`${CALC} [data-blok-popover-item-icon-chevron-right]`, 'color')).toEqual(['var(--blok-database-table-header-icon)']);
    expect(declared(`${CALC} [data-blok-popover-item-icon-chevron-right] svg`, 'width')).toEqual(['16px']);
    expect(declared(`${CALC} [data-blok-popover-item-icon-chevron-right] svg`, 'height')).toEqual(['16px']);
  });
});

// notion-motion.md Round 81 §2 "Card ⋯, board" (r81-n-bd-cardmenu.raw): the row glyphs paint rgb(56, 56, 54).
// Only the menu's own rows: chevrons and submenus keep their inks.
describe('card menu glyph ink (Round 81)', () => {
  it('paints the card menu\'s own row glyphs in the strong glyph grey', () => {
    const OWN = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-card-menu'] > [data-blok-popover-container] > [data-blok-popover-items] > [data-blok-popover-item]:not([data-blok-popover-item-destructive]) > [data-blok-popover-item-icon]:not([data-blok-popover-item-icon-chevron-right])";

    expect(declared(OWN, 'color')).toEqual(['var(--blok-database-peek-glyph-strong)']);
  });
});

// notion-motion.md Round 82 §1 "Card ⋯ › chevron ink" (r82-n-a4-bd-cardmenu-chev.raw, r82-n-b-ga-cardmenu.raw):
// Edit property / Open in chevrons are 16x16 at +233 of a 257 row, ink rgb(142, 139, 134), on board and gallery.
describe('card menu chevrons (Round 82)', () => {
  const CARD = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-card-menu']";

  it('ends a group row 8px after its chevron', () => {
    expect(declared(`${CARD} [data-blok-popover-item][data-blok-has-children]`, 'padding-inline-end')).toEqual(['var(--blok-space-2)']);
  });

  it('draws the chevron 16px in a 16px slot, in the header icon grey', () => {
    expect(declared(`${CARD} [data-blok-popover-item-icon-chevron-right]`, 'width')).toEqual(['16px']);
    expect(declared(`${CARD} [data-blok-popover-item-icon-chevron-right]`, 'margin-inline-end')).toEqual(['0']);
    expect(declared(`${CARD} [data-blok-popover-item-icon-chevron-right]`, 'color')).toEqual(['var(--blok-database-table-header-icon)']);
    expect(declared(`${CARD} [data-blok-popover-item-icon-chevron-right] svg`, 'width')).toEqual(['16px']);
    expect(declared(`${CARD} [data-blok-popover-item-icon-chevron-right] svg`, 'height')).toEqual(['16px']);
  });
});

// notion-motion.md Round 82 §1 "…Escape on the confirm" (r82-n-a1-prop-confirm-escape.raw): focus goes back to the
// header menu list with outline none. The keyboard cursor stays on the Edit property row, so the list needs no ring.
describe('header menu list after the option confirm (Round 82)', () => {
  const LIST = `${HEADER} > [data-blok-popover-container] > [data-blok-popover-items]:focus-visible`;

  it('paints no ring round the focused list', () => {
    expect(declared(LIST, 'outline')).toEqual(['none']);
  });
});

// notion-motion.md Round 94 §1 #6: Escape on Number format leaves the keyboard cursor on the Number format row.
// The focused list then needs no ring. A list with no cursor row (reached by Tab) keeps its ring.
describe('Edit property list after Escape on a submenu (Round 94)', () => {
  const LIST = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-edit-property'] > [data-blok-popover-container] > [data-blok-popover-items]:focus-visible:has([data-blok-focused='true'])";

  it('paints no ring round the focused list while a row holds the cursor', () => {
    expect(declared(LIST, 'outline')).toEqual(['none']);
  });
});

// notion-motion.md Round 113 §1 #1: Escape from Decimal places, Date format or Color puts focus on that row,
// :focus-visible with a solid 2px outline. Change type (header menu) shows none, so it is left out.
describe('Edit property rows after Escape on their submenu (Round 113)', () => {
  const ROWS = ['decimals', 'dateFormat', 'color'];

  it.each(ROWS)('paints the keyboard ring on the %s row', (name) => {
    const row = `[data-blok-popover][data-blok-popover-custom-class~='blok-database-edit-property'] [data-blok-item-name="${name}"]:focus-visible`;

    expect(declared(row, 'outline')).toEqual(['2px solid var(--blok-focus-ring)']);
  });
});

// notion-motion.md Round 111 §1 #4: the kept row takes the hover fill, never a blue selected fill.
describe('database menu kept highlight', () => {
  it('tints the kept row with the hover fill', () => {
    expect(declared("[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu'] [data-blok-database-menu-lit]", 'background-color')).toEqual(['var(--blok-database-hover-bg)']);
  });
});

// notion-motion.md L322, L489, L9789: Notion's menu separators are 1px rgba(42,28,0,0.07) in every database menu.
// Dark is unmeasured, so it keeps the shared line: popover-border (0.14 white) at 60%.
describe('database menu separators', () => {
  const LINE = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu'] [data-blok-popover-item-separator-line]";
  const token = (): string[] => [...database.matchAll(/--blok-database-menu-separator: ([^;]+);/g)].map((m) => m[1]);

  it('draws the line in Notion\'s rule colour', () => {
    expect(declared(LINE, 'background-color')).toEqual(['var(--blok-database-menu-separator)']);
    expect(token()[0]).toBe('rgba(42, 28, 0, 0.07)');
  });

  it('keeps the shared line under both dark switches', () => {
    expect(token().slice(1)).toEqual([
      'color-mix(in oklab, rgba(255, 255, 255, 0.14) 60%, transparent)',
      'color-mix(in oklab, rgba(255, 255, 255, 0.14) 60%, transparent)',
    ]);
    expect(colors).toContain('--blok-popover-border: rgba(255, 255, 255, 0.14)');
  });
});
