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

// notion-motion.md, Round 7 "Long database title" and Round 8b "Long title while editing".
describe('a long title stays one line', () => {
  const rest = (): string => rule('[data-blok-database-title-row] > [data-blok-database-title]:not([hidden])');
  const editing = (): string => rule('[data-blok-database-title-row] > [data-blok-database-title]:focus:not([hidden])');

  it('clamps to one line with an ellipsis, with one view or several', () => {
    expect(rest()).toMatch(/display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1;/);
    expect(rest()).toMatch(/overflow: hidden/);
    expect(rest()).toMatch(/text-overflow: ellipsis/);
    expect(rest()).toMatch(/white-space: break-spaces/);
  });

  it('stays one line while edited and scrolls sideways with no scrollbar', () => {
    expect(editing()).toMatch(/display: block/);
    expect(editing()).toMatch(/-webkit-line-clamp: none/);
    expect(editing()).toMatch(/white-space: nowrap/);
    expect(editing()).toMatch(/overflow-x: auto/);
    expect(editing()).toMatch(/text-overflow: clip/);
    expect(editing()).toMatch(/scrollbar-width: none/);
  });

  it('with several views the title spans its own row', () => {
    expect(rule('[data-blok-database-title-row]:not([data-single-view]) > [data-blok-database-title]')).toMatch(/flex: 1 1 0%; min-width: 0/);
  });

  it('"+" and "…" keep their 24px while the title gives way', () => {
    expect(rule('[data-blok-database-title-row][data-single-view] [data-blok-database-add-view]')).toMatch(/flex-shrink: 0/);
    expect(rule('[data-blok-database-title-more]')).toMatch(/flex-shrink: 0/);
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
    // The bar's 1px gap is the whole space after the last tab (notion-motion.md Round 9: x 831.6 after 830.6).
    expect(plus).not.toMatch(/margin-inline-start/);
    expect(rule('[data-blok-database-add-view] svg')).toMatch(/width: 16px; height: 16px/);
  });

  // notion-motion.md Round 9 "View tab bar +": round, 142,139,134 glyph, fades in over 200ms ease.
  it('the tab-bar "+" is round with the header icon ink and fades in over 200ms ease', () => {
    const plus = rule('[data-blok-database-tab-bar] > [data-blok-database-add-view]');

    expect(plus).toMatch(/border-radius: var\(--blok-radius-pill\)/);
    expect(plus).toMatch(/color: var\(--blok-database-table-header-icon\)/);
    expect(plus).toMatch(/transition: background-color 100ms ease-in-out, opacity 200ms ease/);
  });

  it('a keyboard user tabbing to the "+" sees it', () => {
    expect(rule('[data-blok-database-tab-bar] > [data-blok-database-add-view]:focus-visible')).toMatch(/opacity: 1/);
  });

  // motion-addview.json: the "+" hover fill is Notion's icon-button 100ms ease-in-out.
  it('the "+" hover fill eases in-out over 100ms', () => {
    expect(rule('[data-blok-database-add-view]')).toMatch(/transition: background-color 100ms ease-in-out,/);
  });

  it('"N more…" is 14px', () => {
    expect(rule('[data-blok-database-tab-more]')).toMatch(/font-size: 14px/);
  });

  it('tabs sit 1px apart', () => {
    expect(rule('[data-blok-database-tab-bar]')).toMatch(/gap: var\(--blok-border-width-hairline\)/);
  });
});

// side-by-side-v1 X2 and Board: pixels of listview.png, listgallery.png, caltimeline.png, board.png.
describe('vertical offsets match Notion', () => {
  it('keeps the title row 40px with tabs too, so the title does not move up', () => {
    const body = rule('[data-blok-database-title-row]');

    expect(body).toMatch(/min-height: 40px/);
    // With the tab bar's 4px top padding, tab pills start 9px under the title row (Notion: pill drawn at 270, title baseline 248).
    expect(body).toMatch(/margin-bottom: var\(--blok-space-1-25\)/);
  });

  it('leaves 4px under the tab pills; the list adds Notion\'s 4px inner padding (research/07 "List")', () => {
    expect(rule('[data-blok-database-tab-bar]')).toMatch(/padding: var\(--blok-space-1\) 0 var\(--blok-space-1\);/);
    expect(rule('[data-blok-database-list]')).toMatch(/padding-block-start: var\(--blok-space-1\)/);
  });

  it('starts the board 8px under the title row (Notion columns at 269, title baseline 248)', () => {
    expect(rule('[data-blok-database-board]')).toMatch(/padding-top: var\(--blok-space-2\)/);
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

describe('a narrow view bar folds like Notion (notion-spec-2 §26.1)', () => {
  it('"+" leaves once a tab folds', () => {
    expect(rule('[data-blok-database-tab-bar][data-blok-database-tab-folded] > [data-blok-database-add-view]')).toMatch(/display: none/);
  });

  it('the icon group hides together, and New hides on its own, in the view bar and in a one-view title row', () => {
    expect(rule('[data-blok-database-view-bar][data-blok-database-fold-icons] > [data-blok-database-view-toolbar] > [data-blok-database-toolbar-foldable], [data-blok-database-title-row][data-single-view] > [data-blok-database-view-toolbar][data-blok-database-fold-icons] > [data-blok-database-toolbar-foldable]')).toMatch(/display: none/);
    expect(rule('[data-blok-database-view-bar][data-blok-database-fold-new] > [data-blok-database-view-toolbar] > [data-blok-database-new], [data-blok-database-title-row][data-single-view] > [data-blok-database-view-toolbar][data-blok-database-fold-new] > [data-blok-database-new]')).toMatch(/display: none/);
  });

  // notion-motion.md, Round 7 "⤢ fold point": » goes with New ⌄.
  it('a one-view title row folds » with New', () => {
    expect(rule('[data-blok-database-title-row][data-single-view] > [data-blok-database-view-toolbar][data-blok-database-fold-new] > [data-blok-database-toolbar-minimize]')).toMatch(/display: none/);
  });

  // notion-spec-2 §26.1 (`tb-1000-closed.txt`): "4 more…" is 76.7x32, as tall as a tab.
  it('"N more…" in the view bar is as tall as a tab', () => {
    const body = rule('[data-blok-database-view-bar] [data-blok-database-tab-more]');

    expect(body).toMatch(/height: 32px/);
    expect(body).toMatch(/align-items: center/);
  });

  // §26.1 (`tb-1000-closed.txt`): Filter 652.7, Sort 680.7: 28x28 icons back to back, New 6px after Settings.
  it('puts the toolbar icons back to back and New 6px after them', () => {
    expect(rule('[data-blok-database-view-toolbar]')).toMatch(/gap: 0/);
    expect(rule('[data-blok-database-new]')).toMatch(/margin-inline-start: var\(--blok-space-1-5\)/);
  });

  // `20-tb-800-closed.png` (pixels): "Table ⌄" is 101.4 wide; its chevron's ink is 9x5, 12px from the end.
  it('draws the "Table ⌄" chevron at 20px with its empty edges pulled in', () => {
    const chevron = rule('[data-blok-database-tab-compact-chevron] svg');

    expect(chevron).toMatch(/width: 20px/);
    expect(chevron).toMatch(/height: 20px/);
    expect(rule('[data-blok-database-tab-compact-chevron]')).toMatch(/margin-inline: calc\(-1 \* var\(--blok-space-0-75\)\) calc\(-1 \* var\(--blok-space-1-75\)\)/);
  });

  it('"Table ⌄" wears the current tab\'s fill and ink', () => {
    const body = rule('[data-blok-database-tab-compact]');

    expect(body).toMatch(/background-color: var\(--blok-database-tab-bg-active\)/);
    expect(body).toMatch(/color: var\(--blok-database-tab-text-active\)/);
    expect(body).toMatch(/border-radius: var\(--blok-radius-pill\)/);
  });
});

// notion-live/rowdrag-mid.png, research/08:28-31: the table bar replaces Filter, Sort and Automations,
// in the view bar and in the title row of a one-view database.
describe('the table selection bar hides Filter, Sort and Automations', () => {
  it('hides them while rows are picked, and only then', () => {
    expect(rule('[data-blok-database-selecting="table"] > [data-blok-database-view-toolbar] > [data-blok-database-toolbar-selection-hides]'))
      .toMatch(/visibility: hidden/);
  });
});

// replica-db-pages/research-live-notion.md:31: on a full-page database the toolbar shows only Settings and New
// until the pointer is over the view. Keyboard focus and an open menu keep an icon shown.
describe('full-page database: the toolbar icons show on hover', () => {
  const hover = database.slice(database.indexOf('@media (hover: hover) { [data-blok-database-page]'));
  const HIDE = '[data-blok-database-page]:not(:hover) > :is([data-blok-database-view-bar], [data-blok-database-title-row]) > [data-blok-database-view-toolbar]:not(:has(:focus-visible)) > [data-blok-database-toolbar-foldable]:not([data-popover-open])';

  it('hides Filter, Sort, Automations, AI Autofill and search while the pointer is away, on pointer devices only', () => {
    expect(hover.startsWith('@media (hover: hover)')).toBe(true);
    expect(hover).toContain(`${HIDE} { opacity: 0; }`);
  });

  it('leaves inline databases alone', () => {
    expect(database.match(/\[data-blok-database-toolbar-foldable\]:not\(\[data-popover-open\]\) \{ opacity: 0; \}/g)).toHaveLength(1);
  });
});
