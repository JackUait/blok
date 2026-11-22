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

  // notion-motion.md Round 11 (r11-gap-withcalc.raw): the footer row is 36 tall with its 1px top border.
  it('uses the measured Notion sizes: 36px header, 37px rows, 36px footer, 5px resize handle', () => {
    expect(ruleBody('[data-blok-database-table-header]')).toMatch(/height:\s*36px/);
    expect(ruleBody('[data-blok-database-table-cell]')).toMatch(/min-height:\s*37px/);
    expect(ruleBody('[data-blok-database-table-footer]')).toMatch(/min-height:\s*36px/);
    expect(ruleBody('[data-blok-database-table-resize]')).toMatch(/width:\s*5px/);
  });

  it('paints a selected cell and row gray, never with the focus ring', () => {
    const selected = ruleBody('[data-blok-database-table-cell][aria-selected="true"]');
    const anchor = ruleBody('[data-blok-database-table-cell][data-blok-database-table-cell-anchor]');
    // The halo's fill sits on the base rule, so it can fade out too (notion-motion.md Round 16 §2).
    const row = ruleBody('[data-blok-database-table-row]::after');

    expect(selected).toContain('var(--blok-icon-active-bg)');
    expect(anchor).toContain('var(--blok-database-table-cell-ring)');
    expect(row).toContain('var(--blok-icon-active-bg)');
    expect(ruleBody('[data-blok-database-table-row][aria-selected="true"]::after')).toContain('opacity: 1');
    expect(`${selected}${anchor}${row}`).not.toContain('focus-ring');
  });

  // notion-motion.md "Table row drag": the ghost has no background, and the source row stays painted as normal.
  it('draws the row drag ghost with no background, and fades the pressed row\'s selection fill out while it drags', () => {
    expect(exactRule('[data-blok-database-table-row-ghost]')).toContain('background-color: transparent');
    expect(exactRule('[data-blok-database-table-row][data-dragging]::after')).toContain('opacity: 0');
  });

  // notion-motion.md Round 40 §1: on a drop the bar stays still and the dropped row's tint fades in, 200ms ease.
  it('runs no bar entrance on a drop\'s redraw and fades the dropped row\'s tint in, both off for reduced motion', () => {
    const landed = '[data-blok-database-table-row][data-landed][aria-selected="true"]::after';
    const reduce = Array.from(tableCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*)\s*\}/g))
      .flatMap((block) => Array.from((block[1] ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)))
      .filter((rule) => /animation:\s*none/.test(rule[2] ?? ''))
      .flatMap((rule) => (rule[1] ?? '').split(',').map((part) => part.trim()));

    // Comes after the entrance rule, so it wins at the same specificity; the leaving bar loses the attribute it matches on.
    expect(exactRule('[data-blok-database-table-selection-bar][data-still]')).toContain('animation: none');
    expect(css.indexOf('[data-blok-database-table-selection-bar][data-still]')).toBeGreaterThan(css.indexOf('[data-blok-database-table] > [data-blok-database-table-selection-bar] {'));
    expect(exactRule(landed)).toContain('animation: blok-database-confirm-fade 200ms ease');
    expect(exactRule(landed)).not.toMatch(/forwards|both/);
    expect(reduce).toContain(landed);
  });

  // notion-motion.md "Column header drag": coldrag-mid.png samples rgb(232,232,231), the pressed fill on white,
  // and the next header's icon and "S" show through the ghost.
  it('draws the column ghost as the header in its see-through pressed fill, unshadowed, and slides the other headers over 200ms ease', () => {
    const ghost = exactRule('[data-blok-database-table-column-ghost]');

    expect(ghost).toContain('opacity: 1');
    expect(ghost).toContain('background-color: transparent');
    expect(ghost).toContain('background-image: linear-gradient(var(--blok-database-pressed-bg), var(--blok-database-pressed-bg))');
    expect(ghost).toContain('box-shadow: none');
    expect(exactRule('[data-blok-database-table-column-header][data-dragging]')).toContain('visibility: hidden');
    expect(exactRule('[data-blok-database-table-grid][data-column-dragging] [data-blok-database-table-column-header]')).toContain('transform 200ms ease');
  });

  // notion-motion.md Round 69 §4: Notion's "+" svg is 20. In rowhover.png its ink is 12x12 strong, 14x14 with the
  // soft edge; Blok's 12-unit plus inks that at 20 (at 24 it inked 14x14 / 16x16).
  it('draws the table and list gutter "+" at 20px, Notion\'s size and ink', () => {
    expect(ruleBody('[data-blok-database-table-row-add] svg')).toMatch(/width: 20px;\s*height: 20px/);
    expect(ruleBody('[data-blok-database-list-row-add] svg')).toMatch(/width: 20px;\s*height: 20px/);
  });

  // Notion's ⠿ inks 8x16 (rowhover.png, listhover.png); IconRowGrip draws that at 20px, one unit per pixel.
  it('draws the table and list row grip at 20px', () => {
    expect(ruleBody('[data-blok-database-table-row-handle] svg')).toMatch(/width: 20px;\s*height: 20px/);
    expect(ruleBody('[data-blok-database-list-row-handle] svg')).toMatch(/width: 20px;\s*height: 20px/);
  });

  // r9-header-offsets.raw: every column's glyph is 19.2px at x+6.4, y+8.4 in an 18x24 slot at x+8; the name starts at x+32.
  it('draws every header type glyph at 19.2px, 1.6px past the start of an 18x24 slot', () => {
    const slot = ruleBody('[data-blok-database-table-column-icon][data-type]');
    const glyph = ruleBody('[data-blok-database-table-column-icon][data-type] svg');

    expect(slot).toMatch(/width: 18px;\s*height: 24px;/);
    expect(slot).toMatch(/align-items: center/);
    expect(glyph).toMatch(/width: 19\.2px;\s*height: 19\.2px;/);
    expect(glyph).toMatch(/margin-inline-start: -1\.6px/);
    expect(ruleBody('[data-blok-database-table-column-icon][data-type="title"] svg')).toBe('');
  });

  // research/31 §1: the description (i) after the name is a small 12x16 icon, so it stays at 16px with the button warning.
  it('keeps the (i) and warning icons after the name at 16px', () => {
    expect(ruleBody('[data-blok-database-table-column-icon]')).toMatch(/width: 16px;\s*height: 16px;/);
    expect(ruleBody('[data-blok-database-table-column-icon] svg')).toMatch(/width: 16px;\s*height: 16px;/);
  });

  it('marks a checked row checkbox with primary ink on a gray fill', () => {
    const checked = ruleBody('[data-blok-database-table-row-checkbox][aria-checked="true"]');

    expect(checked).toContain('var(--blok-icon-active-bg)');
    expect(checked).not.toMatch(/rgb\(39,\s*131,\s*222\)|#2783de|focus-ring/i);
  });

  // notion-spec-2 §24.3 (cb-hover.txt, cb-onbox.txt, cb-selected.txt, 30-select-rest.png).
  describe('row checkbox gutter', () => {
    const BOX = '[data-blok-database-table-row-checkbox]';
    const ROW_HOVER = '[data-blok-database-table-row]:hover > [data-blok-database-table-gutter] > [data-blok-database-table-row-checkbox]:not(:hover, [aria-checked="true"])';

    it('keeps the gutter itself drawn, so each control fades on its own', () => {
      expect(ruleBody('[data-blok-database-table-gutter]')).not.toMatch(/opacity/);
    });

    it('hides the checkbox at rest, shows it at 0.7 on row hover and 1 on the box, fading 200ms', () => {
      const box = ruleBody(BOX);

      expect(box).toMatch(/opacity:\s*0;/);
      expect(box).toMatch(/transition:[^;]*opacity 200ms/);
      expect(box).toMatch(/transition:[^;]*background-color 200ms ease-out/);
      expect(exactRule(ROW_HOVER)).toMatch(/opacity:\s*0\.7/);
      expect(ruleBody(`${BOX}:hover`)).toMatch(/opacity:\s*1/);
      expect(ruleBody(`${BOX}:hover`)).toContain('background-color: var(--blok-database-checkbox-hover-bg)');
    });

    // notion-motion.md Round 69 §4: Notion's row checkbox is r3. Round 70 §2: the header box too.
    it('rounds the row and header checkboxes 3px, the checkbox radius role', () => {
      const radii = (selector: string): Array<string | undefined> => Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
        .flatMap((match) => Array.from((match[2] ?? '').matchAll(/border-radius:\s*([^;]+);/g), (decl) => decl[1]));

      expect(radii(BOX)).toEqual(['var(--blok-radius-checkbox)']);
      expect(colors).toMatch(/--blok-radius-checkbox:\s*0\.1875rem;/);
      expect(radii('[data-blok-database-table-select-all]')).toEqual(['var(--blok-radius-checkbox)']);
    });

    it('keeps a checked box, and the header box while some rows are picked, fully shown', () => {
      const shown = ruleBody(`${BOX}[aria-checked="true"]`);

      expect(shown).toMatch(/opacity:\s*1/);
      expect(ruleBody('[data-blok-database-table-select-all][aria-checked="mixed"]')).toMatch(/opacity:\s*1/);
    });

    it('shows + and ⋮⋮ on row hover only: a selected row keeps just its checkbox', () => {
      expect(ruleBody('[data-blok-database-table-row-add]')).toMatch(/opacity:\s*0;/);
      expect(ruleBody('[data-blok-database-table-row]:hover > [data-blok-database-table-gutter] > [data-blok-database-table-row-add]')).toMatch(/opacity:\s*1/);
      expect(css).not.toContain('[data-blok-database-table-row][aria-selected="true"] > [data-blok-database-table-gutter]');
    });

    // notion-motion.md "Row hover" and "Cell editors": the 0→1 gutter element fades 200ms ease-out both ways (origin 0 0);
    // the 0→0.7 one (origin 18px 18px, the 36px checkbox slot) keeps ease.
    it('fades + and ⋮⋮ with ease-out, the checkbox with ease', () => {
      expect(ruleBody('[data-blok-database-table-row-add]')).toContain('transition: opacity 200ms ease-out');
      expect(ruleBody(BOX)).toContain('opacity 200ms ease;');
    });

    // side-by-side-v2 "Gutter glyphs": Notion's "+" centre is 75px and the grip's 53px before the table; Blok's sat 8px closer.
    it('keeps 8px between ⋮⋮ and the checkbox slot', () => {
      expect(exactRule('[data-blok-database-table-row-handle]')).toContain('margin-inline-end: var(--blok-space-2)');
    });

    it('sits the 16px box 10px in from the table edge, in a 36px tall gutter', () => {
      expect(ruleBody(BOX)).toContain('margin-inline: var(--blok-space-2-5)');
      expect(ruleBody('[data-blok-database-table-gutter]')).not.toMatch(/padding-inline-end/);
      expect(ruleBody('[data-blok-database-table-gutter]')).toMatch(/height:\s*36px/);
    });
  });

  // notion-spec-2 §24.7 (open-light.txt): gap 6, 0.5px tracking, a 15.25 wide icon slot, so the box is 68.6 wide.
  it('spaces the Open button: 6px gap, normal case with no extra letter-spacing, 15.25px icon slot', () => {
    const open = ruleBody('[data-blok-database-table-open]');

    expect(open).toContain('gap: var(--blok-space-1-5)');
    expect(open).not.toMatch(/letter-spacing|text-transform/);
    expect(ruleBody('[data-blok-database-table-open] > span[aria-hidden="true"]')).toMatch(/width:\s*15\.25px/);
  });

  // `notion-live-7/33-open-hover.png` and `notion-live-8/62-close-hover.png` (pixels): the glyph's ink is about 15x12.
  // notion-motion.md Round 46 §A: the 68.6x24 pill sits 4 in from the title cell's end (x 745.4); hover fills only the
  // inner 64.6x20, radius 4, `background 0.02s ease-in`, and the 2px frame stays white.
  it('sets the OPEN pill 4 in from the cell end and fills only its inner box on hover', () => {
    const inner = exactRule('[data-blok-database-table-open]:not([data-compact])::before');

    expect(ruleBody('[data-blok-database-table-open]')).toContain('inset-inline-end: var(--blok-space-1)');
    expect(inner).toContain('inset: var(--blok-space-0-5)');
    expect(inner).toContain('z-index: -1');
    expect(inner).toContain('border-radius: var(--blok-radius-control-sm)');
    expect(inner).toContain('transition: background-color 20ms ease-in');
    expect(exactRule('[data-blok-database-table-open]:not([data-compact]):hover::before')).toContain('background-color: var(--blok-database-table-open-hover-bg)');
    expect(exactRule('[data-blok-database-table-open]:not([data-compact]):hover')).toBe('');
  });

  // notion-motion.md Round 105 §1 #3 (r105-n-opill-dark-hover.png): dark hover paints the inner box 41.
  it('paints the dark OPEN pill hover 41, not the menu tint over its 37 box', () => {
    expect(css.match(/--blok-database-table-open-hover-bg: rgb\(41, 41, 41\);/g)).toHaveLength(2);
  });

  // notion-motion.md Round 105 §1 #3 (r105-n-opill-light-hover.png): light hover paints the inner box 245.
  it('paints the light OPEN pill hover 245', () => {
    expect(css.match(/--blok-database-table-open-hover-bg: rgb\(245, 245, 245\);/g)).toHaveLength(1);
    expect(css).not.toContain('--blok-database-table-open-hover-bg: var(--blok-database-table-header-hover-bg);');
  });

  it('draws the OPEN and CLOSE glyph at 18px, over its 15.25px slot', () => {
    const svg = ruleBody('[data-blok-database-table-open] svg');

    expect(svg).toMatch(/width:\s*18px/);
    expect(svg).toMatch(/height:\s*18px/);
    expect(svg).toMatch(/flex:\s*none/);
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
    expect(box).toContain('margin-inline: calc(-1 * var(--blok-space-0-5)) var(--blok-space-0-75)');
    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder]')).toContain('var(--blok-database-table-title-icon)');
    expect(ruleBody('[data-blok-database-page-icon-placeholder] svg')).toMatch(/width:\s*18px/);
  });

  // notion-motion.md Round 59 §8: Notion's row page glyph inks 14x18; the 12.25x15.25 sheet (stroke in) of a 20 grid inks that at 23px.
  // The 22 box stays, so the name text does not move.
  it('draws the table name cell page glyph at 23px in its 22px box', () => {
    const svg = ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder] svg');

    expect(svg).toMatch(/width:\s*23px/);
    expect(svg).toMatch(/height:\s*23px/);
    expect(svg).toMatch(/flex:\s*none/);
  });

  // notion-motion.md Round 46 §A: Notion's name glyph sits 9.5 under the row top, 2 lower than the -2 box puts it.
  // Round 47 §B8: an own emoji icon's 22 box sits at row + 7.5 too. The 2px comes off the bottom, so the row stays 37 tall.
  it.each([
    '[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder]',
    '[data-blok-database-table-cell] > [data-blok-database-page-icon]',
  ])('sets %s 2px lower without growing the row', (selector) => {
    const box = ruleBody(selector);

    expect(box).toContain('margin-block: 0 calc(-1 * var(--blok-space-0-5))');
    expect(box).not.toContain('margin-block-start');
  });

  // notion-motion.md Round 47 §B8: Notion's emoji is `font-size: 18px; line-height: 1`.
  it('draws an emoji page icon at 18px', () => {
    const icon = exactRule('[data-blok-database-table-cell] > [data-blok-database-page-icon]');

    expect(icon).toMatch(/font-size:\s*18px/);
    expect(icon).toMatch(/line-height:\s*1;/);
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

  // feel T23, side-by-side-2 #13: Notion's 20px box draws a 12x15 glyph; the page glyph at 17.5px draws 12x16 with the same ink.
  it('draws the file chip glyph at 17.5px, centred in a 20px box', () => {
    const icon = ruleBody('[data-blok-database-file-chip-icon]');
    const svg = ruleBody('[data-blok-database-file-chip-icon] svg');

    expect(icon).toMatch(/flex:\s*none/);
    expect(icon).toMatch(/width:\s*20px/);
    expect(icon).toMatch(/height:\s*20px/);
    expect(icon).toMatch(/justify-content:\s*center/);
    expect(svg).toMatch(/width:\s*17\.5px/);
    expect(svg).toMatch(/height:\s*17\.5px/);
  });

  // notion-spec-2 §21.3, §22.6: the name starts at glyph + 24, a 4px gap, wherever a file chip shows.
  it('leaves 4px between every file chip\'s glyph and its name', () => {
    expect(ruleBody('[data-blok-database-file-chip]')).toMatch(/gap:\s*var\(--blok-space-1\)/);
  });

  // side-by-side-2 #14 (files-rest.png, files-peek.png): Notion draws no underline under a file name.
  it('draws no link underline under a file chip\'s name', () => {
    expect(ruleBody('[data-blok-database-file-chip] > [data-blok-database-cell-link]')).toMatch(/background-image:\s*none/);
  });

  it('floats the sub-item toggle too, so a nested title stays on the toggle\'s line', () => {
    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-subitem-toggle]')).toMatch(/float:\s*inline-start/);
  });
});

describe('database table number figures', () => {
  // notion-motion.md Round 46 §A: Notion sets lining, tabular figures on every table cell, dates included.
  it('every table cell draws lining, tabular figures', () => {
    expect(ruleBody('[data-blok-database-table-cell]')).toContain('font-variant-numeric: lining-nums tabular-nums');
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

// research/21 §1d: a 1px top line over the calculation row; the hover fills a 70x21 box with 6px corners.
// research/08 (shot 66): that box is padded 0 6px and fades its fill over 0.2s.
describe('database table calculation footer', () => {
  // notion-motion.md Round 11 (r11-gap-withcalc.raw): a real 1px border-top, so the cells keep 35px under it.
  it('rules a 1px border over the row in the table border colour', () => {
    expect(ruleBody('[data-blok-database-table-footer]')).toMatch(/border-top:\s*1px solid var\(--blok-database-table-border\)/);
    expect(ruleBody('[data-blok-database-table-footer]')).not.toMatch(/box-shadow/);
  });

  // notion-motion.md Round 11 "Footer labels": label and value use lining tabular numbers.
  it('sets the label and value in lining tabular numbers', () => {
    expect(ruleBody('[data-blok-database-table-calc-box]')).toMatch(/font-variant-numeric:\s*lining-nums tabular-nums/);
  });

  // notion-motion.md Round 11 "Read-only database": a locked table's value gets no fill and a normal cursor.
  // A read-only footer cell is a div, so the pointer and the fill belong to the button only.
  it('gives the pointer and the hover fill to an editable footer button only', () => {
    expect(ruleBody('[data-blok-database-table-calc]')).toMatch(/cursor:\s*default/);
    expect(ruleBody('button[data-blok-database-table-calc]')).toMatch(/cursor:\s*pointer/);
    expect(ruleBody('[data-blok-database-table-calc-box]:hover')).toBe('');
    expect(ruleBody('button[data-blok-database-table-calc] > [data-blok-database-table-calc-box]:hover')).toMatch(/background-color:\s*var\(--blok-database-table-header-hover-bg\)/);
  });

  // notion-motion.md Round 11 "Gap below New page": the next block starts 12px under the table's last row.
  it('ends the table 12px under its last row', () => {
    expect(ruleBody('[data-blok-database-table-scroller]')).toMatch(/padding-block-end:\s*var\(--blok-space-3\)/);
  });

  it('fills a 21px box around the value on hover, not the whole cell', () => {
    const box = ruleBody('[data-blok-database-table-calc-box]');

    expect(box).toMatch(/padding:\s*0 var\(--blok-space-1-5\)/);
    expect(box).toMatch(/line-height:\s*21px/);
    expect(box).toMatch(/border-radius:\s*var\(--blok-radius-control\)/);
    expect(box).toMatch(/transition:\s*background-color 200ms/);
    expect(ruleBody('[data-blok-database-table-calc]:hover')).toBe('');
  });

  // notion-motion.md Round 10 (r10-calc-hover-numcell.raw, r10-calc-hover-numbtn.raw, r10-calc-hover-textbtn.raw):
  // the pointer in the cell but off the button leaves it clear; only the pointer on the button fills it.
  it('fills the button only while the pointer is on it, not anywhere in its cell', () => {
    expect(ruleBody('button[data-blok-database-table-calc] > [data-blok-database-table-calc-box]:hover')).toMatch(/background-color:\s*var\(--blok-database-table-header-hover-bg\)/);
    expect(ruleBody('[data-blok-database-table-calc]:hover > [data-blok-database-table-calc-box]')).toBe('');
  });

  // r9-calc-footer.raw: the Text column's footer cell is justify-content: flex-end, the same as Number's.
  it('right-aligns every column\'s calculation, not only numbers', () => {
    expect(ruleBody('[data-blok-database-table-calc]')).toMatch(/justify-content:\s*flex-end/);
    expect(ruleBody('[data-blok-database-table-calc][data-type="number"]')).toBe('');
  });

  // r9-calc-numhover.raw: "Calculate" is a 26px button, shown only in the hovered cell.
  // notion-motion.md Round 110 §1 #4 (r110-n-footer-calc-hover-light.raw): opacity 1 at the first frame, no fade.
  it('shows "Calculate" in a 26px box at once, only on its own cell', () => {
    expect(ruleBody('[data-blok-database-table-calc][data-empty] > [data-blok-database-table-calc-box]')).toMatch(/height:\s*26px/);
    expect(ruleBody('[data-blok-database-table-calc-placeholder]')).not.toMatch(/transition/);
    expect(ruleBody('[data-blok-database-table-calc]:hover [data-blok-database-table-calc-placeholder]')).toMatch(/opacity:\s*1/);
    expect(ruleBody('[data-blok-database-table-footer]:hover [data-blok-database-table-calc-placeholder]')).toBe('');
    // r10-timeline-calc-hovercell.raw: the timeline footer reveals it per cell too, not on the whole row.
    expect(ruleBody('[data-blok-database-timeline-table-footer]:hover [data-blok-database-table-calc-placeholder]')).toBe('');
  });

  // notion-motion.md Round 110 §1 #5 (r110-n-filtered-empty-light.raw): "Edit filters" fills 0.051 on hover, background 0.02s ease-in.
  // The bordered rule's transparent background must not win over it.
  it('fills "Edit filters" with the hover tint', () => {
    const hover = exactRule('[data-blok-database-table-edit-filters]:hover');
    const bordered = css.indexOf('[data-blok-database-table-empty] [data-blok-database-table-add-row] {\n  display: inline-flex');

    expect(hover).toMatch(/background-color:\s*var\(--blok-database-hover-bg\)/);
    expect(css.indexOf('[data-blok-database-table-edit-filters]:hover')).toBeGreaterThan(bordered);
    expect(ruleBody('[data-blok-database-table-edit-filters]')).toMatch(/transition:\s*background-color 20ms ease-in/);
  });

  // notion-motion.md Round 111 §1 #7 (r111-n-filtered-empty-newpage-hover.raw): "New page" fills 0.051 too, by 49 ms.
  it('fills the filtered-empty "New page" with the hover tint', () => {
    const selector = '[data-blok-database-table-empty] [data-blok-database-table-add-row]:hover';
    const bordered = css.indexOf('[data-blok-database-table-empty] [data-blok-database-table-add-row] {\n  display: inline-flex');

    expect(exactRule(selector)).toMatch(/background-color:\s*var\(--blok-database-hover-bg\)/);
    expect(css.indexOf(selector)).toBeGreaterThan(bordered);
  });

  // Shot 66: the value ends 11px short of the column edge; the box's 6px plus the cell's 4px.
  it('pads the cell 4px so the box keeps the value 10px from the column edge', () => {
    expect(ruleBody('[data-blok-database-table-calc]')).toMatch(/padding:\s*0 var\(--blok-space-1\)/);
  });

  // r10-timeline-calc-edge.raw: the timeline footer cell is the panel's full width, so its top-left corner reveals
  // "Calculate" and the button ends 4px from the panel edge, like the table's Name footer cell.
  // notion-motion.md Round 51 §3: the header and row cells hold the side padding, so footer cells on the same tracks reach the column edges.
  it('runs the timeline footer cells to their column edges, on the header columns', () => {
    const footer = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes('[data-blok-database-timeline-table-footer]'))
      .map((match) => match[2] ?? '')
      .join(';');

    expect(footer).toMatch(/padding-inline:\s*0[;\s]/);
    expect(ruleBody('[data-blok-database-timeline-table-footer] > *')).not.toMatch(/padding-inline/);
    expect(exactRule('[data-blok-database-timeline-table-footer] > :first-child')).toBe('');
    expect(exactRule('[data-blok-database-timeline-table-footer] > :last-child')).toBe('');
  });

  // notion-motion.md Round 9 "Collapsed group header" (r9-group-header-open.raw, r9-grouped-after.png pixel rows):
  // header 26 tall, the caret box at x+0, the pill 3px into its slot (x+27); the column header row 8px under it,
  // the next header 20px under the footer, and 16px under a collapsed header.
  describe('grouped table header', () => {
    it('is 26px tall with its pill at x+27', () => {
      expect(ruleBody('[data-blok-database-table-group-header]')).toMatch(/height:\s*26px/);
      expect(ruleBody('[data-blok-database-table-group-header]')).toMatch(/gap:\s*0[;\s]/);
      expect(ruleBody('[data-blok-database-table-group-label]')).toMatch(/padding-inline:\s*var\(--blok-space-0-75\)/);
    });

    it('spaces an open group 8px under its header and 20px over the next one', () => {
      expect(ruleBody('[data-blok-database-table-group]')).toMatch(/margin-block-end:\s*var\(--blok-space-4\)/);
      expect(ruleBody('[data-blok-database-table-group]:not([data-collapsed]) > [data-blok-database-table-group-content]')).toMatch(/padding-block:\s*var\(--blok-space-2\) var\(--blok-space-1\)/);
    });

    // notion-motion.md Round 10 "Group header ⋯ menu" (r10-group-header-hover.raw): only the hovered header shows
    // its ⋯ and +, 24×24 radius 6, 6px after the pill; Round 9: opacity 0.1s ease-in-out.
    it('shows the ⋯ and + only on its own header, 24px, right after the pill', () => {
      const actions = ruleBody('[data-blok-database-table-group-actions]');

      expect(actions).toMatch(/opacity:\s*0;/);
      expect(actions).toMatch(/pointer-events:\s*none/);
      expect(actions).toMatch(/transition:\s*opacity 100ms ease-in-out/);
      expect(actions).toMatch(/margin-inline-start:\s*var\(--blok-space-0-75\)/);
      expect(ruleBody('[data-blok-database-table-group-header]:hover > [data-blok-database-table-group-actions]')).toMatch(/opacity:\s*1/);
      expect(ruleBody('[data-blok-database-table-group-header][data-popover-open] > [data-blok-database-table-group-actions]')).toMatch(/opacity:\s*1/);
      expect(ruleBody('[data-blok-database-table-group]:hover [data-blok-database-table-group-actions]')).toBe('');
      const button = ruleBody('[data-blok-database-table-group-actions] button');

      expect(button).toMatch(/width:\s*24px/);
      expect(button).toMatch(/height:\s*24px/);
      expect(button).toMatch(/border-radius:\s*var\(--blok-radius-control\)/);
    });

    // notion-motion.md Round 11 "Group header with Show aggregation" (r11-group-hdr-aggon.raw): a 24-tall count,
    // padding 0 8px, radius 6, 14px/16.8px 500, 3px after the pill, the ⋯ and + right after it; hover fill
    // rgba(33,27,23,0.051) over 0.1s ease-in-out. Notion's ink rgb(161,158,153) is below AA: Blok keeps its muted ink.
    it('draws the "Show aggregation" count as a 24px button with the ⋯ and + right after it', () => {
      const count = ruleBody('[data-blok-database-table-group-count]');

      expect(count).toMatch(/height:\s*24px/);
      expect(count).toMatch(/padding:\s*0 var\(--blok-space-2\)/);
      expect(count).toMatch(/border-radius:\s*var\(--blok-radius-control\)/);
      expect(count).toMatch(/font-size:\s*14px/);
      expect(count).toMatch(/line-height:\s*16\.8px/);
      expect(count).toMatch(/font-weight:\s*500/);
      expect(count).toMatch(/color:\s*var\(--blok-database-table-muted-text\)/);
      expect(count).toMatch(/transition:\s*background 100ms ease-in-out/);
      expect(count).not.toMatch(/margin/);
      expect(ruleBody('button[data-blok-database-table-group-count]:hover')).toMatch(/background-color:\s*var\(--blok-database-hover-bg\)/);
      expect(ruleBody('button[data-blok-database-table-group-count]')).toMatch(/cursor:\s*pointer/);
      expect(ruleBody('[data-blok-database-table-group-count] + [data-blok-database-table-group-actions]')).toMatch(/margin-inline-start:\s*0/);
    });
  });
});

// notion-motion.md Round 28 §5: the frozen columns' edge and their scroll shadow.
describe('database table frozen edge', () => {
  it('draws a 1px line after the last frozen column in the control border, rgb(230,229,227) on white', () => {
    const edge = ruleBody('[data-blok-database-table-grid] [data-frozen][data-frozen-edge]');

    expect(edge).toMatch(/border-inline-end:\s*1px solid var\(--blok-database-table-control-border\)/);
    expect(css).toMatch(/--blok-database-table-control-border:\s*rgba\(28, 19, 1, 0\.11\)/);
  });

  // notion-motion.md Round 29 §5: the shadow fades in and out, opacity 0↔1 over 200ms ease.
  // Only its strength moves, so the anchor ring and the header line still snap.
  it('casts a 3px shadow while scrolled, fading its strength in and out over 200ms ease', () => {
    const shadow = ruleBody('[data-blok-database-table-scroller] [data-frozen-edge]');
    const steps = /--blok-database-frozen-shadow:\s*1px 0 0 [^;]*?calc\(30% \* var\(--blok-database-frozen-shadow-on\)\)[^;]*?2px 0 0 [^;]*?calc\(50% \* var\(--blok-database-frozen-shadow-on\)\)[^;]*?3px 0 0 [^;]*?calc\(30% \* var\(--blok-database-frozen-shadow-on\)\)/;

    expect(css).toMatch(/@property --blok-database-frozen-shadow-on\s*\{\s*syntax: '<number>';\s*inherits: false;\s*initial-value: 0;/);
    expect(shadow).toMatch(steps);
    expect(shadow).toMatch(/box-shadow:\s*var\(--blok-database-frozen-shadow\)/);
    expect(shadow).toMatch(/transition:\s*--blok-database-frozen-shadow-on 200ms ease(;|$)/);
    expect(ruleBody('[data-blok-database-table-scroller][data-frozen-shadow] [data-frozen-edge]')).toMatch(/--blok-database-frozen-shadow-on:\s*1(;|$)/);
    expect(ruleBody('[data-blok-database-table-scroller][data-scrolled] [data-frozen-edge]')).toBe('');
    expect(ruleBody('[data-blok-database-table-grid] [data-frozen][data-frozen-edge]')).not.toMatch(/box-shadow|transition|animation/);
  });

  it('keeps the header line, its hover tint and the anchor ring under the shadow', () => {
    const header = ruleBody('[data-blok-database-table-scroller] [data-blok-database-table-column-header][data-frozen-edge]');

    expect(header).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--blok-database-table-border\),\s*var\(--blok-database-frozen-shadow\)/);
    expect(header).toMatch(/transition:\s*background-color 20ms ease-in, --blok-database-header-tint 20ms ease-in, --blok-database-frozen-shadow-on 200ms ease/);
    expect(ruleBody('[data-blok-database-table-scroller] [data-blok-database-table-cell-anchor][data-frozen-edge]'))
      .toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--blok-database-table-cell-ring\),\s*var\(--blok-database-frozen-shadow\)/);
  });

  // notion-motion.md Round 46 §A: Notion's frozen block sticks 30px in from the scroller (x 300), and nothing
  // scrolled past it shows in those 30px. 30 matches FROZEN_STICK_INSET in database-table-view.ts.
  it('hides scrolled cells in the 30px strip left of the stuck frozen block', () => {
    expect(ruleBody('[data-blok-database-table-scroller][data-scrolled]')).toMatch(/clip-path:\s*inset\(0 0 0 30px\)/);
    expect(ruleBody('[dir="rtl"] [data-blok-database-table-scroller][data-scrolled]')).toMatch(/clip-path:\s*inset\(0 30px 0 0\)/);
  });

  it('turns the shadow to face the other way in right-to-left text', () => {
    expect(ruleBody('[dir="rtl"] [data-blok-database-table-scroller] [data-frozen-edge]')).toMatch(/-1px 0 0[\s\S]*-2px 0 0[\s\S]*-3px 0 0/);
  });
  // notion-motion.md Round 46 §A: Notion's "+ New page" row is sticky and stays at the text column on a sideways scroll.
  // The scroller's padding edge is the text column, so 0 is Notion's 267px in Blok's frame.
  it('keeps "+ New page" at the text column on a sideways scroll', () => {
    const add = ruleBody('[data-blok-database-table-add-row]');

    expect(add).toMatch(/position:\s*sticky/);
    expect(add).toMatch(/inset-inline-start:\s*0(;|$)/);
  });

  // notion-motion.md Round 29 §1: a full-width 37px row; the whole row fills 0.024 on hover; ↓ 16, label at +24, ⋯ 24x24 12 after.
  it('draws Load more as a full-width 37px row that fills as a whole on hover', () => {
    const line = ruleBody('[data-blok-database-table-load-more-row]');
    const more = ruleBody('[data-blok-database-table-load-more]');
    const dots = ruleBody('[data-blok-database-table-load-limit-menu]');

    expect(css.match(/--blok-database-table-load-more-hover-bg:/g)?.length).toBe(3);
    expect(css).toMatch(/--blok-database-table-load-more-hover-bg:\s*rgba\(55, 53, 47, 0\.024\)/);
    expect(colors).not.toContain('--blok-database-table-load-more-hover-bg:');
    expect(line).toMatch(/display:\s*flex/);
    expect(line).toMatch(/align-self:\s*stretch/);
    expect(line).toMatch(/min-height:\s*37px/);
    expect(line).toMatch(/position:\s*relative/);
    expect(line).toMatch(/transition:\s*background-color 20ms ease-in/);
    expect(ruleBody('[data-blok-database-table-load-more-row]:hover')).toMatch(/background-color:\s*var\(--blok-database-table-load-more-hover-bg\)/);
    expect(more).not.toMatch(/align-self:\s*flex-start/);
    expect(more).toMatch(/gap:\s*var\(--blok-space-2\)/);
    expect(more).toMatch(/background:\s*transparent/);
    expect(more).toMatch(/color:\s*var\(--blok-database-table-muted-text\)/);
    // The whole row is the button: its overlay covers the row, under the ⋯.
    expect(ruleBody('[data-blok-database-table-load-more]::after')).toMatch(/inset:\s*0/);
    expect(ruleBody('[data-blok-database-table-load-more] > span')).toMatch(/color:\s*var\(--blok-database-table-gutter-icon\)/);
    expect(ruleBody('[data-blok-database-table-load-more] svg')).toMatch(/width:\s*16px/);
    expect(dots).toMatch(/width:\s*24px/);
    expect(dots).toMatch(/height:\s*24px/);
    expect(dots).toMatch(/margin-inline-start:\s*var\(--blok-space-3\)/);
    expect(dots).toMatch(/z-index:\s*1/);
    expect(dots).toMatch(/color:\s*var\(--blok-database-table-header-icon\)/);
    expect(ruleBody('[data-blok-database-table-load-limit-menu]:hover')).toMatch(/background-color:\s*var\(--blok-database-table-header-hover-bg\)/);
    expect(ruleBody('[data-blok-database-table-load-more-row]:hover')).not.toBe('');
  });
});
