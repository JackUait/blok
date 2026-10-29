/**
 * Cell display and editor styles. jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const database = strip(readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8'));
const colors = strip(readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8'));

/** Table cell and form pickers; the row page's value editor keeps its own measurements. */
const TABLE = "[data-blok-popover-custom-class~='blok-database-cell-editor']:not([data-blok-popover-custom-class~='blok-database-value-editor'])";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every declaration of `name` in top-level rules whose selector list holds exactly `selector`. */
const declared = (selector: string, name: string): string[] =>
  [...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .flatMap((rule) => [...rule[2].matchAll(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`, 'g'))].map((m) => m[1].trim()));

describe('cell editor CSS', () => {
  // notion-spec-2 §18.3: the Edit formula box is radius 12px, its title row has the close × at the end.
  describe('Edit formula box', () => {
    it('rounds the box 12px', () => {
      expect(declared("[data-blok-popover-custom-class~='blok-database-cell-editor'] [data-blok-popover-container]:has([data-blok-database-formula-editor])", 'border-radius'))
        .toEqual(['var(--blok-radius-dialog)']);
      expect(colors).toContain('--blok-radius-dialog: var(--blok-radius-12)');
    });

    it('puts the title first and the close × at the row end', () => {
      expect(declared('[data-blok-database-formula-head]', 'display')).toEqual(['flex']);
      expect(declared('[data-blok-database-formula-close]', 'margin-inline-start')).toEqual(['auto']);
    });
  });

  // notion-spec-2 §19.15: table relation rows are radius 4px; a 24x24 white button, radius 4px, 6px from the row's right.
  describe('table relation picker row', () => {
    const PICKER = '[data-blok-database-relation-editor] [data-blok-database-relation-head] ~ [role="listbox"]';
    const TOGGLE = `${PICKER} [data-blok-database-relation-toggle]`;

    it('rounds the row 4px and drops the check mark', () => {
      expect(declared(`${PICKER} [data-blok-database-relation-option]`, 'border-radius')).toEqual(['var(--blok-radius-control-sm)']);
      expect(declared(`${PICKER} [data-blok-database-relation-option][aria-selected="true"]::after`, 'content')).toEqual(['none']);
    });

    it('draws the +/− button 24x24, white, radius 4px, at the row end, shown on the highlighted or hovered row', () => {
      expect(declared(TOGGLE, 'width')).toEqual(['24px']);
      expect(declared(TOGGLE, 'height')).toEqual(['24px']);
      expect(declared(TOGGLE, 'margin-inline-start')).toEqual(['auto']);
      expect(declared(TOGGLE, 'border-radius')).toEqual(['var(--blok-radius-control-sm)']);
      expect(declared(TOGGLE, 'background-color')).toEqual(['var(--blok-database-popover-bg)']);
      expect(declared(TOGGLE, 'visibility')).toEqual(['hidden']);
      expect(declared(`${PICKER} [data-blok-database-relation-option][data-active] > [data-blok-database-relation-toggle]`, 'visibility')).toEqual(['visible']);
      expect(declared(`${TOGGLE} svg`, 'width')).toEqual(['16px']);
    });
  });

  // notion-spec-2 §18.1: icon box 20x20 holding an 18px glyph in rgb(142,139,134); the title 4px
  // after it, 14/16.8 weight 500, with a 1px underline line. No pill. §19.17: on a gallery card,
  // a 14.4px glyph and 12/14.4 weight 500.
  describe('relation chip', () => {
    const CHIP = '[data-blok-database-relation-chip]';
    const ICON = '[data-blok-database-relation-chip-icon]';
    const TITLE = '[data-blok-database-relation-chip-title]';

    it('has no text-decoration underline and a 4px gap', () => {
      expect(declared(CHIP, 'text-decoration')).toEqual([]);
      expect(declared(CHIP, 'gap')).toEqual(['var(--blok-space-1)']);
    });

    it('draws the icon box 20x20 with an 18px grey glyph', () => {
      expect(declared(ICON, 'width')).toEqual(['20px']);
      expect(declared(ICON, 'height')).toEqual(['20px']);
      expect(declared(ICON, 'color')).toEqual(['var(--blok-database-table-header-icon)']);
      expect(declared(`${ICON} svg`, 'width')).toEqual(['18px']);
      expect(declared(`${ICON} svg`, 'height')).toEqual(['18px']);
    });

    it('sets the title 500 with a 1px underline line', () => {
      expect(declared(TITLE, 'font-weight')).toEqual(['500']);
      expect(declared(TITLE, 'line-height')).toEqual(['16.8px']);
      expect(declared(TITLE, 'background-image')).toEqual(['linear-gradient(var(--blok-database-cell-link-underline), var(--blok-database-cell-link-underline))']);
      expect(declared(TITLE, 'background-size')).toEqual(['100% 1px']);
    });

    it('shrinks to a 14.4px glyph and 14.4px line on a gallery card', () => {
      const GALLERY = '[data-blok-database-gallery-property]';

      expect(declared(`${GALLERY} ${ICON}`, 'width')).toEqual(['14.4px']);
      expect(declared(`${GALLERY} ${ICON} svg`, 'width')).toEqual(['14.4px']);
      expect(declared(`${GALLERY} ${TITLE}`, 'line-height')).toEqual(['14.4px']);
    });
  });

  // notion-spec-2 §19.1: the option picker is 300 wide with chips in it. A search input's natural
  // width (about 155px) went into the box's max-content measure and pushed it to 305.
  it('gives the option search no natural width, so chips never widen the picker', () => {
    expect(declared('[data-blok-database-select-search]', 'width')).toEqual(['0']);
  });

  // notion-live-3/relation-editor.png: the database glyph is 15px tall, 8px after "In" and 6px before the name.
  it('sizes the relation head database icon 21px with 3px before the name', () => {
    const ICON = '[data-blok-database-relation-scope-icon]';

    expect(declared(`${ICON} svg`, 'width')).toEqual(['21px']);
    expect(declared(`${ICON} svg`, 'height')).toEqual(['21px']);
    expect(declared(ICON, 'margin-inline-end')).toEqual(['var(--blok-space-0-75)']);
  });

  // notion-spec-2 §19.16: a person's avatar is a plain circle with no ring or shadow. Notion's 100% draws
  // the same circle on a square box; the radius law spells a circle 50%.
  it.each(['[data-blok-database-person-avatar]', '[data-blok-database-person-initial]'])('draws %s as a circle with no ring', (selector) => {
    expect(declared(selector, 'outline')).toEqual([]);
    expect(declared(selector, 'box-shadow')).toEqual([]);
    expect(declared(selector, 'border-radius')).toEqual(['50%']);
  });

  it('a selected option row has no fill of its own and keeps the unselected ink', () => {
    expect(declared('[data-blok-database-select-option][aria-selected="true"]', 'background-color')).toEqual([]);
    expect(declared('[data-blok-database-select-option][aria-selected="true"]', 'color')).toEqual([]);
    expect(declared('[data-blok-database-select-option]', 'color')).toEqual(['var(--blok-database-ink)']);
    expect(declared('[data-blok-database-select-option-check]', 'color')).toEqual(['var(--blok-icon-active-text)']);
  });

  it('a related row picked in the relation editor has no fill and keeps the unselected ink', () => {
    expect(declared('[data-blok-database-relation-option][aria-selected="true"]', 'background-color')).toEqual([]);
    expect(declared('[data-blok-database-relation-option][aria-selected="true"]', 'color')).toEqual(['var(--blok-database-ink)']);
    expect(declared('[data-blok-database-relation-option]', 'color')).toEqual(['var(--blok-database-ink)']);
    expect(declared('[data-blok-database-relation-option][aria-selected="true"]::after', 'color')).toEqual(['var(--blok-database-ink)']);
  });

  it('the picked day is a gray fill with primary ink, never blue', () => {
    expect(declared('[data-blok-database-date-day][aria-selected="true"]', 'background-color')).toEqual(['var(--blok-icon-active-bg)']);
    expect(declared('[data-blok-database-date-day][aria-selected="true"]', 'color')).toEqual(['var(--blok-icon-active-text)']);
  });

  it('pills are 20px with the small control radius, as measured in Notion', () => {
    expect(declared('[data-blok-database-option-pill]', 'height')).toEqual(['20px']);
    expect(declared('[data-blok-database-option-pill]', 'padding')).toEqual(['0 var(--blok-space-1-5)']);
    expect(declared('[data-blok-database-option-pill]', 'border-radius')).toEqual(['var(--blok-radius-control-sm)']);
  });

  it.each(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])(
    'defines the %s option tokens in the light and both dark blocks',
    (color) => {
      expect([...database.matchAll(new RegExp(`--blok-database-option-${color}-bg:`, 'g'))]).toHaveLength(3);
      expect([...database.matchAll(new RegExp(`--blok-database-option-${color}-text:`, 'g'))]).toHaveLength(3);
    }
  );

  it.each(['checkbox-border', 'checkbox-check', 'today'])('defines --blok-database-%s in the light and both dark blocks', (token) => {
    expect([...database.matchAll(new RegExp(`--blok-database-${token}:`, 'g'))]).toHaveLength(3);
  });

  it('uses the measured light values for a measured color', () => {
    expect(database).toContain('--blok-database-option-blue-bg: rgba(0, 118, 217, 0.204);');
    expect(database).toContain('--blok-database-option-blue-text: rgb(38, 74, 114);');
  });

  // view.css copies every token in colors.css and has a byte budget. The view
  // renders a database bare, so these stay in database.css, which it skips.
  it('keeps the cell tokens out of colors.css', () => {
    expect(colors).not.toMatch(/--blok-database-(?:option-|checkbox-|today)/);
  });

  it('drops every editor transition under reduced motion', () => {
    const blocks = [...database.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]);
    const reduced = (selector: string): boolean => blocks.some((block) => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .some((rule) => rule[1].split(',').map((s) => s.trim()).includes(selector) && /transition: none/.test(rule[2])));

    ['[data-blok-database-checkbox]', '[data-blok-database-switch-track]', '[data-blok-database-switch-track] > span',
      '[data-blok-database-select-option-handle]', '[data-blok-database-select-option-menu]']
      .forEach((selector) => expect(reduced(selector), selector).toBe(true));
  });
  describe('editor box (research/22 §4)', () => {
    // research/08 Motion: Notion's table cell editors mount at their final size and opacity.
    it('a table cell editor opens with no fade or scale, opened or not yet', () => {
      const TABLE = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-table-cell-editor']";

      [`${TABLE} > [data-blok-popover-container]`, `${TABLE}:not([data-blok-popover-opened='true']) > [data-blok-popover-container]`].forEach((selector) => {
        expect(declared(selector, 'transition'), selector).toEqual(['none']);
        expect(declared(selector, 'transform'), selector).toEqual(['none']);
      });
    });

    // notion-spec-2 §19.22: Notion's peek value editors have no open motion either.
    it('a row page value editor opens with no fade or scale, opened or not yet', () => {
      const VALUE = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-value-editor']";

      [`${VALUE} > [data-blok-popover-container]`, `${VALUE}:not([data-blok-popover-opened='true']) > [data-blok-popover-container]`].forEach((selector) => {
        expect(declared(selector, 'transition'), selector).toEqual(['none']);
        expect(declared(selector, 'transform'), selector).toEqual(['none']);
      });
    });

    const BOX = "[data-blok-popover-custom-class~='blok-database-cell-editor'] [data-blok-popover-container]";
    const ITEMS = "[data-blok-popover-custom-class~='blok-database-cell-editor'] [data-blok-popover-items]";

    it('is a 6px box with the menu shadow and no padding of its own', () => {
      expect(declared(BOX, 'border-radius')).toEqual(['var(--blok-radius-control)']);
      expect(declared(BOX, '--blok-popover-box-shadow')).toEqual(['var(--blok-database-cell-editor-shadow)']);
      expect(declared(BOX, 'padding')).toEqual(['0']);
      expect(declared(ITEMS, 'padding')).toEqual(['0']);
    });

    it('is never capped below the viewport, so the date picker does not scroll', () => {
      expect(declared(BOX, '--max-height')).toEqual(['calc(100dvh - 2 * var(--blok-space-3))']);
    });

    it('takes the light menu shadow, and the dark database menu shadow in both dark blocks', () => {
      const values = [...database.matchAll(/--blok-database-cell-editor-shadow: ?([^;]+);/g)].map((m) => m[1].trim());

      expect(values).toEqual([
        'var(--blok-inline-toolbar-shadow)',
        'var(--blok-database-popover-shadow)',
        'var(--blok-database-popover-shadow)',
      ]);
    });

    it('pads every input 8px 9px on a 21px line, 39px tall at least', () => {
      expect(declared('[data-blok-database-cell-input]', 'padding')).toEqual(['var(--blok-space-2) var(--blok-space-2-25)']);
      expect(declared('[data-blok-database-cell-input]', 'line-height')).toEqual(['21px']);
      expect(declared('[data-blok-database-cell-input]', 'min-height')).toEqual(['39px']);
    });

    it('draws a number 38px tall and right-aligned', () => {
      expect(declared('[data-blok-database-cell-input="number"]', 'min-height')).toEqual(['38px']);
      expect(declared('[data-blok-database-cell-input="number"]', 'text-align')).toEqual(['end']);
    });

    it('keeps typed spaces in a text editor', () => {
      expect(declared('textarea[data-blok-database-cell-input]', 'white-space')).toEqual(['break-spaces']);
    });

    it('is 38px tall over a row page value, text and number alike (notion-spec §7)', () => {
      expect(declared("[data-blok-popover-custom-class~='blok-database-value-editor'] [data-blok-database-cell-input]", 'min-height'))
        .toEqual(['38px']);
    });
  });

  // Notion's picker, measured 2026-10-25 from its top-left: field 12/12, header 52, grid 74 (224 tall), first row 307.
  describe('date picker geometry', () => {
    it('pads the picker 12px, so the field box starts at 12/12', () => {
      expect(declared('[data-blok-database-date-editor]', 'padding')).toEqual(['var(--blok-space-3) var(--blok-space-3) var(--blok-space-1)']);
      expect(declared('[data-blok-database-date-editor]', 'gap')).toEqual(['0']);
    });

    it('draws the field with the shared look on a 14px/16.8px line', () => {
      expect(declared('[data-blok-database-date-field]', 'border')).toEqual([]);
      expect(declared('[data-blok-database-date-field][data-blok-field]', 'font-size')).toEqual(['14px']);
      expect(declared('[data-blok-database-date-field][data-blok-field]', 'line-height')).toEqual(['16.8px']);
    });

    it('puts a 20px header 12px under the field and 2px over the grid', () => {
      expect(declared('[data-blok-database-date-header]', 'height')).toEqual(['20px']);
      expect(declared('[data-blok-database-date-header]', 'margin')).toEqual(['var(--blok-space-3) 0 var(--blok-space-0-5)']);
      expect(declared('[data-blok-database-date-header]', 'gap')).toEqual(['var(--blok-space-2)']);
    });

    it('labels the month 14px/21px at weight 500', () => {
      expect(declared('[data-blok-database-date-month]', 'font-weight')).toEqual(['500']);
      expect(declared('[data-blok-database-date-month]', 'line-height')).toEqual(['21px']);
    });

    it('draws the month arrows 20x20', () => {
      expect(declared('[data-blok-database-date-prev]', 'width')).toEqual(['20px']);
      expect(declared('[data-blok-database-date-prev]', 'height')).toEqual(['20px']);
    });

    it('lays the grid in 32px cells: weekday row 12px/18px, 28px day buttons centred', () => {
      expect(declared('[data-blok-database-date-grid] [role="row"]', 'grid-template-columns')).toEqual(['repeat(7, 32px)']);
      expect(declared('[data-blok-database-date-grid] [role="row"]', 'grid-auto-rows')).toEqual(['32px']);
      expect(declared('[data-blok-database-date-grid] [role="row"]', 'place-items')).toEqual(['center']);
      expect(declared('[data-blok-database-date-weekday]', 'line-height')).toEqual(['18px']);
      expect(declared('[data-blok-database-date-day]', 'width')).toEqual(['28px']);
      expect(declared('[data-blok-database-date-day]', 'height')).toEqual(['28px']);
    });

    it('starts the rows 4px under a 224px divider, one pixel apart, their text 12px in', () => {
      expect(declared('[data-blok-database-date-options]', 'margin-top')).toEqual(['var(--blok-space-1)']);
      expect(declared('[data-blok-database-date-options]', 'padding-top')).toEqual(['var(--blok-space-1)']);
      expect(declared('[data-blok-database-date-options]', 'gap')).toEqual(['var(--blok-space-0-25)']);
      expect(declared('[data-blok-database-date-options] > :not([data-blok-database-date-help-footer])', 'margin-inline')).toEqual(['calc(-1 * var(--blok-space-2))']);
    });

    it('puts Clear 9px under Remind, its line 5px above it', () => {
      const clear = '[data-blok-database-date-remind] + [data-blok-database-date-clear]';

      expect(declared(clear, 'margin-top')).toEqual(['var(--blok-space-2)']);
      expect(declared(`${clear}::before`, 'top')).toEqual(['calc(-1 * (var(--blok-space-1) + var(--blok-space-0-25)))']);
      expect(declared(`${clear}::before`, 'inset-inline')).toEqual(['var(--blok-space-2)']);
    });

    it('draws the help row line 4px under Clear, the row as wide as the others', () => {
      expect(declared('[data-blok-database-date-help-footer]', 'margin-top')).toEqual(['calc(var(--blok-space-1) - var(--blok-space-0-25))']);
      expect(declared('[data-blok-database-date-help-footer] > *', 'margin-inline')).toEqual(['calc(-1 * var(--blok-space-2))']);
      expect(declared('[data-blok-database-date-help]', 'gap')).toEqual(['var(--blok-space-2)']);
    });
  });

  // notion-spec-2 §18.1: a table cell's one file chip fills the cell (184 of 200) and its name ends in "…".
  it('stretches a lone file chip across a table cell and cuts its name with an ellipsis', () => {
    const CHIP = '[data-blok-database-table-cell][data-type="files"] [data-blok-database-file-chip]:only-child';

    const LINK = '[data-blok-database-table-cell][data-type="files"] [data-blok-database-file-chip] > [data-blok-database-cell-link]';

    expect(declared(CHIP, 'flex')).toEqual(['1 1 auto']);
    expect(declared(LINK, 'text-overflow')).toEqual(['ellipsis']);
    expect(declared(LINK, 'min-width')).toEqual(['0']);
  });

  // research/08 (cell editor popovers) and research/22 §4: the select head is 39 tall, its hint 12/14.4 weight 500,
  // the option "⋯" 24x24. The status head (notion-spec-2 §18.3) is the same 38.5px field.
  describe('select, multi-select and status pickers', () => {
    it('give the head a 38.5px row, its content 12px in', () => {
      expect(declared(`${TABLE} [data-blok-database-select-editor] [data-blok-database-select-chips]`, 'padding')).toEqual(['var(--blok-database-picker-head-padding-block) var(--blok-space-3)']);
    });

    it('draw the hint at 12/14.4 weight 500', () => {
      expect(declared(`${TABLE} [data-blok-database-select-editor] [data-blok-database-select-hint]`, 'font-weight')).toEqual(['500']);
      expect(declared(`${TABLE} [data-blok-database-select-editor] [data-blok-database-select-hint]`, 'line-height')).toEqual(['14.4px']);
    });

    it('draw the option "⋯" 24x24', () => {
      expect(declared(`${TABLE} [data-blok-database-select-option-menu]`, 'width')).toEqual(['24px']);
      expect(declared(`${TABLE} [data-blok-database-select-option-menu]`, 'height')).toEqual(['24px']);
    });
  });

  // notion-spec-2 §18.3 (b1-status-dlg.txt): the table status picker is 240x289 with three groups.
  describe('status picker in a table cell', () => {
    const STATUS = `${TABLE} [data-blok-database-select-editor="status"]`;
    const HEADING = `${STATUS} [data-blok-database-select-list] > [data-blok-database-status-group-heading]`;
    const FOOTER = `${STATUS} [data-blok-database-select-edit-property]`;


    // notion-spec-2 §19.14: a hovered status row shows only its fill: no handle, no "⋯".
    it('puts each pill 8px into its row, under its group label, with no handle and no "⋯"', () => {
      expect(declared('[data-blok-database-select-editor="status"] [data-blok-database-select-option-menu]', 'display')).toEqual(['none']);
      expect(declared(`${STATUS} [data-blok-database-select-option]`, 'padding-inline')).toEqual(['var(--blok-space-2)']);
      expect(declared('[data-blok-database-select-editor="status"] [data-blok-database-select-option-handle]', 'display')).toEqual(['none']);
    });

    // notion-spec-2 §19.14: the handle's 16px glyph at row x + 10 (row padding 8 + the 20px box's 2), "⋯" at row right − 2.
    it.each(['select', 'multiSelect'])('puts the %s handle glyph 10px into the row and "⋯" 2px from its end', (type) => {
      expect(declared(`${TABLE} [data-blok-database-select-editor="${type}"] [data-blok-database-select-option]`, 'padding-inline')).toEqual(['var(--blok-space-2) 2px']);
    });

    // notion-spec-2 §19.14: every Select row shows its drag handle at rest, as Multi-select's do.
    it('shows the Select and Multi-select drag handles at rest', () => {
      expect(declared('[data-blok-database-select-editor="select"] [data-blok-database-select-option-handle]', 'opacity')).toEqual(['1']);
      expect(declared('[data-blok-database-select-editor="multiSelect"] [data-blok-database-select-option-handle]', 'opacity')).toEqual(['1']);
    });

    it('spaces the groups 74px apart with 216px dividers 12px in', () => {
      expect(declared(HEADING, 'padding')).toEqual(['var(--blok-space-2-5) 0 9.5px']);
      expect(declared(HEADING, 'margin-inline')).toEqual(['var(--blok-space-2)']);
      expect(declared(HEADING, 'font-weight')).toEqual(['500']);
      expect(declared(HEADING, 'line-height')).toEqual(['14.4px']);
      expect(declared(`${HEADING}:not(:first-child)`, 'margin-top')).toEqual(['var(--blok-space-2-25)']);
      expect(declared(`${HEADING}:not(:first-child)`, 'padding-top')).toEqual(['var(--blok-space-3)']);
      expect(declared(`${HEADING}:not(:first-child)`, 'border-top')).toEqual(['1px solid var(--blok-database-table-border)']);
    });

    it('ends with an "Edit property" row like the options: 28px, 4px in, primary ink, its own inset divider', () => {
      expect(declared(FOOTER, 'width')).toEqual(['calc(100% - var(--blok-space-2))']);
      expect(declared(FOOTER, 'margin')).toEqual(['var(--blok-space-1-25) var(--blok-space-1) var(--blok-space-1)']);
      expect(declared(FOOTER, 'border-radius')).toEqual(['var(--blok-radius-control)']);
      expect(declared(FOOTER, 'color')).toEqual(['var(--blok-database-ink)']);
      expect(declared(`${FOOTER}::before`, 'inset-inline')).toEqual(['var(--blok-space-2)']);
      // The label starts 40px into the box: 4 + 8 + a 20px icon + 8.
      expect(declared(`${FOOTER} svg`, 'width')).toEqual(['20px']);
    });
  });

  // notion-spec-2 §18.3 (b2-person-dlg.txt): 240x162 with three people.
  describe('person picker', () => {
    const PERSON = `${TABLE} [data-blok-database-person-editor]`;

    it('keeps to 240 wide: the search input does not push the box wider', () => {
      expect(declared('[data-blok-database-person-search]', 'width')).toEqual(['0']);
    });

    it('gives the head a 38.5px row with the search 12px in', () => {
      expect(declared(`${PERSON} [data-blok-database-select-chips]`, 'padding')).toEqual(['var(--blok-database-picker-head-padding-block) var(--blok-space-3)']);
    });

    it('puts the hint 12px in, its rows 24px under it', () => {
      expect(declared(`${PERSON} [data-blok-database-select-hint]`, 'padding')).toEqual(['var(--blok-space-2-5) var(--blok-space-3) 9.5px']);
      expect(declared(`${PERSON} [data-blok-database-select-hint]`, 'font-weight')).toEqual(['500']);
      expect(declared(`${PERSON} [data-blok-database-select-hint]`, 'line-height')).toEqual(['14.4px']);
    });

    it('lists 232px rows 4px in, 1px apart, avatar then name 8px after', () => {
      expect(declared(`${PERSON} [role="listbox"]`, 'padding')).toEqual(['0 var(--blok-space-1) var(--blok-space-1)']);
      expect(declared(`${PERSON} [role="listbox"]`, 'gap')).toEqual(['var(--blok-space-0-25)']);
      expect(declared(`${PERSON} [data-blok-database-person-option]`, 'padding')).toEqual(['0 var(--blok-space-2)']);
      expect(declared(`${PERSON} [data-blok-database-person-option]`, 'gap')).toEqual(['var(--blok-space-2)']);
    });
  });

  // notion-spec-2 §18.3 (b4-rel-dlg.txt): head 33 tall, "Select a page" 16px in, rows 544x32 one pixel apart.
  describe('relation picker in a table cell', () => {
    const REL = '[data-blok-database-relation-editor]';

    it('draws the head as a 33px tinted bar with a line under it', () => {
      expect(declared('[data-blok-database-relation-search-bar]', 'padding')).toEqual(['var(--blok-space-1-5) 10px']);
      expect(declared('[data-blok-database-relation-search-bar]', 'background-color')).toEqual(['var(--blok-database-panel-input-bg)']);
      expect(declared('[data-blok-database-relation-search-bar]', 'box-shadow')).toEqual(['var(--blok-database-table-control-border) 0 1px 0 0']);
      expect(declared(`${REL} [data-blok-database-relation-search-bar] [data-blok-database-relation-search]`, 'padding')).toEqual(['0']);
    });

    it('puts "Select a page" 16px in, the first row 43px under the head', () => {
      expect(declared('[data-blok-database-relation-heading]', 'padding')).toEqual(['var(--blok-space-4) var(--blok-space-4) 12.6px']);
      expect(declared('[data-blok-database-relation-heading]', 'line-height')).toEqual(['14.4px']);
    });

    it('lists 32px rows 8px in, 1px apart, titles at weight 500', () => {
      const LIST = `${REL} [data-blok-database-relation-head] ~ [role="listbox"]`;

      expect(declared(LIST, 'padding')).toEqual(['0 var(--blok-space-2) var(--blok-space-2)']);
      expect(declared(LIST, 'gap')).toEqual(['var(--blok-space-0-25)']);
      expect(declared(`${LIST} [data-blok-database-relation-option]`, 'min-height')).toEqual(['32px']);
      expect(declared(`${LIST} [data-blok-database-relation-option]`, 'font-weight')).toEqual(['500']);
    });
  });

  // notion-spec §7, scratchpad n/11-status.png and n/12-select.png: text, pills and headings start 12px into the box.
  describe('select and status pickers over a row page value', () => {
    const VALUE = "[data-blok-popover-custom-class~='blok-database-value-editor']";

    it('gives the search head a 39px row with its text 12px in', () => {
      expect(declared(`${VALUE} [data-blok-database-select-chips]`, 'min-height')).toEqual(['39px']);
      expect(declared(`${VALUE} [data-blok-database-select-chips]`, 'padding')).toEqual(['var(--blok-space-1) var(--blok-space-3)']);
    });

    it('starts the hint 12px in, level with the group headings', () => {
      expect(declared(`${VALUE} [data-blok-database-select-hint]`, 'padding-inline')).toEqual(['var(--blok-space-3)']);
    });

    it('starts each option row 8px in, so a status pill sits under its heading', () => {
      expect(declared(`${VALUE} [data-blok-database-select-option]`, 'padding-inline-start')).toEqual(['var(--blok-space-2)']);
    });

    it('shows a select option\'s handle at rest, 8px before its pill', () => {
      expect(declared(`${VALUE} [data-blok-database-select-option-handle]`, 'opacity')).toEqual(['1']);
      expect(declared(`${VALUE} [data-blok-database-select-option-handle]`, 'margin-inline-end')).toEqual(['var(--blok-space-1)']);
    });

    // n/11-status.png: groups 73px apart, each divider 12px short of both sides.
    it('spaces the status groups like Notion, with inset dividers', () => {
      const LIST = `${VALUE} [data-blok-database-select-editor="status"] [data-blok-database-select-list]`;
      const HEADING = `${LIST} > [data-blok-database-status-group-heading]`;
      const DIVIDED = `${HEADING}:not(:first-child)`;

      expect(declared(HEADING, 'padding-block')).toEqual(['var(--blok-space-2-25) var(--blok-space-2)']);
      expect(declared(HEADING, 'padding-inline')).toEqual(['0']);
      expect(declared(HEADING, 'margin-inline')).toEqual(['var(--blok-space-2)']);
      expect(declared(DIVIDED, 'padding-block-start')).toEqual(['var(--blok-space-2-75)']);
      expect(declared(DIVIDED, 'margin-block-start')).toEqual(['var(--blok-space-2-25)']);
    });

    // n/18-status-hover.png: a hovered status row shows only its fill. Options are edited in Edit property.
    it('gives a status row no edit button', () => {
      expect(declared('[data-blok-database-select-editor="status"] [data-blok-database-select-option-menu]', 'display')).toEqual(['none']);
    });
  });

  it('keeps the title weight (500) in the title editor, in a 38px one-line box (feel T19)', () => {
    expect(declared('[data-blok-database-cell-input="title"]', 'font-weight')).toEqual(['500']);
    expect(declared('[data-blok-database-cell-input="title"]', 'min-height')).toEqual(['38px']);
  });
});
