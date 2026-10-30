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

    // §18.3: the box's bottom sits 12px from the window edge; a window under 764px must not cut its ×.
    it('never runs past the window', () => {
      expect(declared("[data-blok-popover-custom-class~='blok-database-cell-editor'] [data-blok-popover-container]:has([data-blok-database-formula-editor])", 'max-inline-size'))
        .toEqual(['calc(100vw - 2 * var(--blok-space-3))']);
      expect(declared("[data-blok-popover-custom-class~='blok-database-cell-editor'] [data-blok-popover-container]:has([data-blok-database-formula-editor])", 'min-inline-size'))
        .toEqual(['0']);
    });

    // `formula-editor.png` (pixels): list pane 228 wide, rows 28 tall, a rgb(230,229,227) line before the help.
    it('splits the list and its help, 228px for the list', () => {
      expect(declared('[data-blok-database-formula-panes]', 'grid-template-columns')).toEqual(['228px minmax(0, 1fr)']);
      expect(declared('[data-blok-database-formula-help]', 'border-inline-start')).toEqual(['1px solid var(--blok-database-tpl-border)']);
      expect(declared('[data-blok-database-formula-reference-item]', 'min-height')).toEqual(['28px']);
    });

    // `formula-editor.png` (pixels): "Type: number" is a 20-tall chip, the preview sits between two lines.
    it('draws the type as a 20px chip and fences the preview with lines', () => {
      expect(declared('[data-blok-database-formula-type]', 'height')).toEqual(['20px']);
      expect(declared('[data-blok-database-formula-preview-area]', 'border-block')).toEqual(['1px solid var(--blok-database-page-divider)']);
    });

    // `formula-editor.png` (pixels): the "# Number" token is 18 tall on rgb(224,222,218).
    it('draws a property token as an 18px chip', () => {
      expect(declared('[data-blok-database-formula-token]', 'height')).toEqual(['18px']);
      expect(declared('[data-blok-database-formula-token]', 'background-color')).toEqual(['var(--blok-database-formula-token-bg)']);
    });

    it('shows "Your formula" style placeholder text while the box is empty', () => {
      expect(declared('[data-blok-database-formula-input]:empty::before', 'content')).toEqual(['attr(data-placeholder)']);
    });

    // `30-formula-empty.png`: "Your formula" is sans and warm grey; Blok takes the AA step of that grey.
    it('writes the placeholder in the sans font and the warm tertiary ink', () => {
      expect(declared('[data-blok-database-formula-input]:empty::before', 'font-family')).toEqual(['var(--blok-font-family, var(--blok-font-sans))']);
      expect(declared('[data-blok-database-formula-input]:empty::before', 'color')).toEqual(['var(--blok-database-ink-tertiary)']);
      expect(declared('[data-blok-database-formula-input]:empty::before', 'font-size')).toEqual(['14px']);
    });

    // notion-spec-2 §25.1 (`32-formula-typed.png`): an example box holds its code, "= result" under it, and a copy button at the right.
    it('puts an example\'s copy button at the right of its code and result', () => {
      expect(declared('[data-blok-database-formula-help-example]', 'grid-template-columns')).toEqual(['minmax(0, 1fr) auto']);
      expect(declared('[data-blok-database-formula-help-copy]', 'grid-column')).toEqual(['2']);
      expect(declared('[data-blok-database-formula-help-copy]', 'grid-row')).toEqual(['1 / span 2']);
      expect(declared('[data-blok-database-formula-help-copy]:hover', 'background-color')).toEqual(['var(--blok-database-hover-bg)']);
    });

    // `32-formula-typed.png` (pixels): two-line boxes 47 tall, one-line 30.5 (`30-formula-empty.png`), 4 apart,
    // a 1px rgb(241,240,238) border (x 999 and 1489), the code 6px in.
    it('draws example boxes 4px apart with 6px padding, 16.5px lines and a light border', () => {
      expect(declared('[data-blok-database-formula-help-examples]', 'gap')).toEqual(['var(--blok-space-1)']);
      expect(declared('[data-blok-database-formula-help-example]', 'padding')).toEqual(['var(--blok-space-1-5)']);
      expect(declared('[data-blok-database-formula-help-example]', 'line-height')).toEqual(['16.5px']);
      expect(declared('[data-blok-database-formula-help-example]', 'border')).toEqual(['1px solid var(--blok-database-formula-example-border)']);
      expect(declared('[data-blok-database-formula-help-example] [data-blok-database-formula-token]', 'height')).toEqual(['16.5px']);
      expect(declared('[data-blok-database-formula-help-example] [data-blok-database-formula-token]', 'vertical-align')).toEqual(['top']);
      expect(database).toContain('--blok-database-formula-example-border: rgb(240, 239, 237);');
      // Notion's copy button is 22x22 (formula-typed.txt) and does not make a one-line box taller than 30.5.
      expect(declared('[data-blok-database-formula-help-copy]', 'width')).toEqual(['22px']);
      expect(declared('[data-blok-database-formula-help-copy]', 'margin-block')).toEqual(['calc(-1 * var(--blok-space-0-75))']);
    });

    // `32-formula-typed.png` (pixels): number (876,293) rgb(140,26,84), operator (863,290) rgb(147,112,67),
    // function (1017,602) rgb(207,94,113), paren (1062,596) rgb(158,158,158).
    it('paints each syntax kind from its token, in the box and in the examples', () => {
      for (const kind of ['number', 'string', 'operator', 'function', 'punctuation']) {
        expect(declared(`[data-blok-database-formula-input]::highlight(blok-formula-${kind})`, 'color')).toEqual([`var(--blok-database-formula-${kind})`]);
        expect(declared(`[data-blok-database-formula-syntax="${kind}"]`, 'color')).toEqual([`var(--blok-database-formula-${kind})`]);
      }
      expect(database).toContain('--blok-database-formula-number: rgb(140, 26, 84);');
      expect(database).toContain('--blok-database-formula-operator: rgb(147, 112, 67);');
      expect(database).toContain('--blok-database-formula-function: rgb(207, 94, 113);');
      expect(database).toContain('--blok-database-formula-punctuation: rgb(158, 158, 158);');
      // `40-help-Text.png` (pixels, glyph cores of "b" and "red").
      expect(database).toContain('--blok-database-formula-string: rgb(120, 157, 55);');
    });

    /** The token's value in light, then in each of the two dark blocks (system dark, forced dark). */
    const themed = (token: string): string[] =>
      [...database.matchAll(new RegExp(`${escape(token)}: ([^;]+);`, 'g'))].map((m) => m[1].trim());

    // notion-spec-2 §26.5 (`dark-formula.txt`, `dark-help-*.txt`).
    it('takes Notion\'s dark syntax colours, example border, ↩ ink and a pill-less chip', () => {
      expect(themed('--blok-database-formula-operator').slice(1)).toEqual(['rgb(245, 184, 61)', 'rgb(245, 184, 61)']);
      expect(themed('--blok-database-formula-number').slice(1)).toEqual(['rgb(209, 148, 158)', 'rgb(209, 148, 158)']);
      expect(themed('--blok-database-formula-function').slice(1)).toEqual(['rgb(236, 236, 147)', 'rgb(236, 236, 147)']);
      expect(themed('--blok-database-formula-string').slice(1)).toEqual(['rgb(189, 224, 82)', 'rgb(189, 224, 82)']);
      expect(themed('--blok-database-formula-punctuation').slice(1)).toEqual(['rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
      expect(themed('--blok-database-formula-example-border')).toEqual(['rgb(240, 239, 237)', 'rgb(44, 44, 43)', 'rgb(44, 44, 43)']);
      expect(themed('--blok-database-formula-return-ink').slice(1)).toEqual(['var(--blok-database-ink-secondary)', 'var(--blok-database-ink-secondary)']);
      expect(themed('--blok-database-formula-token-bg').slice(1)).toEqual(['transparent', 'transparent']);
    });

    // `40-help-Checkbox.png` (pixels): `not` and `and` keep a plateau of rgb(61,124,170) on their stems.
    // Notion has no dark shot of a keyword, so dark keeps the plain ink until one is measured.
    it('paints keywords blue in light, plain ink in dark', () => {
      expect(declared('[data-blok-database-formula-input]::highlight(blok-formula-keyword)', 'color')).toEqual(['var(--blok-database-formula-keyword)']);
      expect(declared('[data-blok-database-formula-syntax="keyword"]', 'color')).toEqual(['var(--blok-database-formula-keyword)']);
      expect(themed('--blok-database-formula-keyword')).toEqual(['rgb(61, 124, 170)', 'var(--blok-database-ink)', 'var(--blok-database-ink)']);
    });

    // Light: `31-formula-open.png` (pixels) rgb(240,239,237) on the white box. Dark: notion-spec-2 §26.5.
    it('fills the Type tag with Notion\'s tag colour in light and dark', () => {
      expect(declared('[data-blok-database-formula-type]', 'background')).toEqual(['var(--blok-database-formula-type-bg)']);
      expect(themed('--blok-database-formula-type-bg')).toEqual(['rgb(240, 239, 237)', 'rgba(255, 255, 235, 0.1)', 'rgba(255, 255, 235, 0.1)']);
    });

    // `32-formula-typed.png` (pixels): the ↩ ink is 12x8 at x 963-974, darkest rgb(141,139,134) (964,517), only on the highlighted row.
    it('shows the return glyph at the end of the highlighted row only', () => {
      expect(declared('[data-blok-database-formula-reference-return]', 'visibility')).toEqual(['hidden']);
      expect(declared('[data-blok-database-formula-reference-return]', 'margin-inline')).toEqual(['auto calc(-1 * var(--blok-space-0-75))']);
      expect(declared('[data-blok-database-formula-reference-item][aria-selected="true"] > [data-blok-database-formula-reference-return]', 'visibility')).toEqual(['visible']);
      expect(declared('[data-blok-database-formula-reference-return]', 'color')).toEqual(['var(--blok-database-formula-return-ink)']);
      expect(database).toContain('--blok-database-formula-return-ink: rgb(141, 139, 134);');
    });

    it('highlights the active row gray, never blue', () => {
      expect(declared('[data-blok-database-formula-reference-item][aria-selected="true"]', 'background-color'))
        .toEqual(['var(--blok-database-hover-bg)']);
    });

    it('puts the title first and the close × at the row end', () => {
      expect(declared('[data-blok-database-formula-head]', 'display')).toEqual(['flex']);
      expect(declared('[data-blok-database-formula-close]', 'margin-inline-start')).toEqual(['auto']);
    });
  });

  // `C5-rel-ban.png` (pixels): the clear × is a 16px filled circle, 16px before "In <database>".
  describe('table relation picker clear ×', () => {
    it('draws a 16px round glyph and leaves 16px before the scope', () => {
      expect(declared('[data-blok-database-relation-clear] svg', 'width')).toEqual(['16px']);
      expect(declared('[data-blok-database-relation-clear] svg', 'border-radius')).toEqual(['var(--blok-radius-pill)']);
      expect(declared('[data-blok-database-relation-clear]', 'margin-inline-end')).toEqual(['var(--blok-space-3)']);
    });

    it('takes no room while hidden', () => {
      expect(declared('[data-blok-database-relation-clear][hidden]', 'display')).toEqual(['none']);
    });
  });

  // notion-live-8/51-rel-picker.png: the title's line is rgb(230,229,227), the cell chip's rgba(28,19,1,0.11) on white (§24.9).
  it('underlines a page title in the table relation picker like the cell chip', () => {
    const TITLE = '[data-blok-database-relation-editor] [data-blok-database-relation-head] ~ [role="listbox"] [data-blok-database-relation-option-title]';

    expect(declared(TITLE, 'background-image')).toEqual(['linear-gradient(var(--blok-database-cell-link-underline), var(--blok-database-cell-link-underline))']);
    expect(declared(TITLE, 'background-size')).toEqual(['100% 1px']);
    expect(declared(TITLE, 'background-position')).toEqual(['0 100%']);
    expect(declared(TITLE, 'background-repeat')).toEqual(['no-repeat']);
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
  it.each(['[data-blok-database-person-avatar]', '[data-blok-database-person-initial]'])('draws %s as a circle with no outline', (selector) => {
    expect(declared(selector, 'outline')).toEqual([]);
    expect(declared(selector, 'border-radius')).toEqual(['50%']);
  });

  // The photo has no ring. The letter avatar's ring is a token: none in light, Notion's faint inner ring in dark (§23.3).
  it('rings only the letter avatar, through a token', () => {
    expect(declared('[data-blok-database-person-avatar]', 'box-shadow')).toEqual([]);
    expect(declared('[data-blok-database-person-initial]', 'box-shadow')).toEqual(['var(--blok-database-person-initial-shadow)']);
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

  // notion-spec-2 §21.3: a short file name's chip hugs its text; §18.1's long name filled the cell (184 of 200) and ends in "…".
  it('lets a lone file chip in a table cell hug a short name and shrink a long one to an ellipsis', () => {
    const CHIP = '[data-blok-database-table-cell][data-type="files"] [data-blok-database-file-chip]:only-child';

    const LINK = '[data-blok-database-table-cell][data-type="files"] [data-blok-database-file-chip] > [data-blok-database-cell-link]';

    expect(declared(CHIP, 'flex')).toEqual(['0 1 auto']);
    expect(declared(CHIP, 'min-width')).toEqual(['0']);
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

  // notion-live-3 select-editor.png and multi-select-editor.png: the chip × inks 9x9; person-editor.png: about 7x7.
  // IconCross spans 9.25 of its 20 units with the stroke, so 20px draws 9 and 16px draws 7.
  describe('chip × in the pickers', () => {
    it('draws the Select and Multi-select chip × 20px, the person chip × 16px', () => {
      expect(declared('[data-blok-database-select-chip-remove] svg', 'width')).toEqual(['20px']);
      expect(declared('[data-blok-database-select-chip-remove] svg', 'height')).toEqual(['20px']);
      expect(declared('[data-blok-database-person-remove] svg', 'width')).toEqual(['16px']);
      expect(declared('[data-blok-database-person-remove] svg', 'height')).toEqual(['16px']);
    });
  });

  // notion-spec-2 §25.6: option rows 292 wide at box x + 4; ⋮⋮ at row x + 6, the pill at + 36, "›" ends 8 from the right;
  // both show at rest. The "+" ends 10 from the box's right.
  describe('Edit property options list', () => {
    const LIST = '[data-blok-database-options-editor]';

    it('fills the submenu\'s width, its rows 4px in from the box', () => {
      expect(declared(LIST, 'width')).toEqual([]);
      expect(declared(LIST, 'padding')).toEqual(['0 0 var(--blok-space-1)']);
    });

    it('shows the ⋮⋮ and "›" at rest and places the pill and "›" as Notion', () => {
      expect(declared(`${LIST} [data-blok-database-select-option-handle]`, 'opacity')).toEqual(['1']);
      expect(declared(`${LIST} [data-blok-database-select-option-menu]`, 'opacity')).toEqual(['1']);
      expect(declared(`${LIST} [data-blok-database-select-option-label]`, 'margin-inline-start')).toEqual(['var(--blok-space-2)']);
      expect(declared(`${LIST} [data-blok-database-select-option]`, 'padding-inline-end')).toEqual(['var(--blok-space-1-5)']);
      expect(declared(`[dir="rtl"] ${LIST} [data-blok-database-select-option-menu] svg`, 'transform')).toEqual(['scaleX(-1)']);
    });

    it('starts "Options" 8px in and ends its "+" 6px from the list edge', () => {
      expect(declared(`${LIST} [data-blok-database-options-heading]`, 'padding-inline')).toEqual(['var(--blok-space-2) var(--blok-space-1-5)']);
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

    // notion-live-3/relation-editor.png (B linked, 560x218): the first row 40 under the head, "Select more" 34 tall
    // between rows, 12 under the last row. notion-live-5/C5-rel-open.png (none linked) keeps 43 under the head.
    it('packs the linked layout to Notion\'s 218: 40 under the head, a 34px "Select more", 12 at the bottom', () => {
      const LINKED = `${REL}:has([role="listbox"] > [data-blok-database-relation-heading])`;

      expect(declared(`${LINKED} [data-blok-database-relation-head] > [data-blok-database-relation-heading]`, 'padding-bottom')).toEqual(['9.6px']);
      expect(declared(`${REL} [role="listbox"] > [data-blok-database-relation-heading]`, 'padding-block')).toEqual(['10.8px 8.8px']);
      expect(declared(`${LINKED} [data-blok-database-relation-head] ~ [role="listbox"]`, 'padding-bottom')).toEqual(['var(--blok-space-3)']);
    });

    it('lists 32px rows 8px in, 1px apart, titles at weight 500', () => {
      const LIST = `${REL} [data-blok-database-relation-head] ~ [role="listbox"]`;

      expect(declared(LIST, 'padding')).toEqual(['0 var(--blok-space-2) var(--blok-space-2)']);
      expect(declared(LIST, 'gap')).toEqual(['var(--blok-space-0-25)']);
      expect(declared(`${LIST} [data-blok-database-relation-option]`, 'min-height')).toEqual(['32px']);
      expect(declared(`${LIST} [data-blok-database-relation-option]`, 'font-weight')).toEqual(['500']);
    });

    // notion-spec-2 §22.2: a page row highlights rgba(55,53,47,0.06) at radius 4; the create row rgba(33,27,23,0.051) at radius 6.
    it('highlights a page row and the create row with Notion\'s two fills and radii', () => {
      const LIST = `${REL} [data-blok-database-relation-head] ~ [role="listbox"]`;

      expect(declared(`${LIST} [data-blok-database-relation-option][data-active]`, 'background-color')).toEqual(['var(--blok-database-add-hover-bg)']);
      expect(colors).toContain('--blok-database-add-hover-bg: rgba(55, 53, 47, 0.06)');
      expect(declared(`${LIST} [data-blok-database-relation-option]`, 'border-radius')).toEqual(['var(--blok-radius-control-sm)']);
      expect(declared('[data-blok-database-relation-create][data-active]', 'background-color')).toEqual(['var(--blok-database-hover-bg)']);
      expect(declared('[data-blok-database-relation-create]', 'border-radius')).toEqual(['var(--blok-radius-control)']);
    });
  });

  // notion-spec-2 §22.3: a 24x24 "⋯" at radius 6, a 200x94 menu with 28px rows 29px apart, a 364px Rename field.
  describe('table file menu', () => {
    it('rounds the "⋯" 6px and tints it in 0.02s', () => {
      expect(declared('[data-blok-database-file-menu]', 'border-radius')).toEqual(['var(--blok-radius-control)']);
      expect(declared('[data-blok-database-file-menu]', 'transition')).toEqual(['background-color 0.02s ease-in']);
    });

    it('spaces the menu rows 1px apart', () => {
      expect(declared('[data-blok-database-file-actions]', 'gap')).toEqual(['var(--blok-space-0-25)']);
    });

    it('draws the Rename field 364px wide', () => {
      expect(declared('[data-blok-database-file-rename-box] > [data-blok-database-file-rename]', 'width')).toEqual(['364px']);
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

  // notion-spec-2 §19.17, §20.13 (notion-live-3/files-editor.png): with a file the box is 4 + 28 + 9 + 28 + 4 = 73 tall.
  // A 1px line sits 4px under the file rows, inset 12px from the box; the grip is a 20x24 box.
  describe('Files box in a table', () => {
    const BOX = '[data-blok-database-files-editor][data-layout="table"]';

    // §20.13: the empty box is 34 tall (3 + 28 + 3); with a file the padding is 4.
    it('pads the box 4px once it holds a file', () => {
      expect(declared(`${BOX}:has([data-blok-database-file-row])`, 'padding')).toEqual(['var(--blok-space-1)']);
    });

    it('draws a 1px line between the files and "Add a file or image", 4px from each', () => {
      const line = `${BOX} [data-blok-database-files-list]:not(:empty)::after`;

      expect(declared(line, 'height')).toEqual(['1px']);
      expect(declared(line, 'margin')).toEqual(['var(--blok-space-1) var(--blok-space-2)']);
      expect(declared(line, 'background-color')).toEqual(['var(--blok-database-confirm-divider)']);
    });

    it('draws the grip as a 20x24 box with its ⋮⋮ in the add row\'s icon ink', () => {
      const grip = '[data-blok-database-file-grip]';

      expect(declared(grip, 'width')).toEqual(['20px']);
      expect(declared(grip, 'height')).toEqual(['24px']);
      expect(declared(grip, 'color')).toEqual(['var(--blok-database-table-header-icon)']);
      expect(declared(grip, 'cursor')).toEqual(['grab']);
    });
  });
});
