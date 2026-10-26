/**
 * Cell display and editor styles. jsdom has no CSS, so these read the source.
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

describe('cell editor CSS', () => {
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

    it('draws a status option without a handle or a check mark', () => {
      const STATUS = `${VALUE} [data-blok-database-select-editor="status"]`;

      expect(declared(`${STATUS} [data-blok-database-select-option-handle]`, 'display')).toEqual(['none']);
      expect(declared(`${STATUS} [data-blok-database-select-option-check]`, 'display')).toEqual(['none']);
    });
  });

  it('keeps the title weight (500) in the title editor, in a 38px one-line box (feel T19)', () => {
    expect(declared('[data-blok-database-cell-input="title"]', 'font-weight')).toEqual(['500']);
    expect(declared('[data-blok-database-cell-input="title"]', 'min-height')).toEqual(['38px']);
  });
});
