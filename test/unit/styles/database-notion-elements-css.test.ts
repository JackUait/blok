/**
 * The controls research/26 §3 and §1b measured that Blok lacked, light and
 * dark (§4a). jsdom has no CSS, so these read the authored source; the
 * computed look is pinned in test/playwright/tests/database/database-notion-elements.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const ruleBody = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

/** A token's values in source order: light, system dark, forced dark. */
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

const SORT_BUTTON = '[data-blok-database-sort-row] > [data-blok-database-panel-row]:not([data-blok-database-sort-remove])';
const SORT_BUTTON_HOVER = '[data-blok-database-sort-row] > [data-blok-database-panel-row]:not([data-blok-database-sort-remove]):hover:not(:disabled)';

describe('sort panel buttons (research/26 §3a, §4a)', () => {
  it('are 32px tall, radius 6px, bordered with the measured control border', () => {
    const body = ruleBody(SORT_BUTTON);

    expect(body).toContain('height: 32px');
    expect(body).toContain('border: 1px solid var(--blok-database-table-control-border)');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('font-weight: 500');
    expect(tokenValues('--blok-database-table-control-border')).toEqual([ 'rgba(28, 19, 1, 0.11)', 'rgba(255, 255, 235, 0.1)', 'rgba(255, 255, 235, 0.1)' ]);
  });

  it('sit on the measured rest fill and hover to the measured fill', () => {
    expect(ruleBody(SORT_BUTTON)).toContain('background-color: var(--blok-database-sort-button-bg)');
    expect(ruleBody(SORT_BUTTON_HOVER)).toContain('background-color: var(--blok-database-sort-button-hover-bg)');
    expect(tokenValues('--blok-database-sort-button-bg')).toEqual([ 'rgb(255, 255, 255)', 'rgb(25, 25, 25)', 'rgb(25, 25, 25)' ]);
    expect(tokenValues('--blok-database-sort-button-hover-bg')).toEqual([ 'rgb(244, 243, 243)', 'rgb(38, 38, 38)', 'rgb(38, 38, 38)' ]);
  });
});

describe('selection bar dividers (research/26 §3b, §4a)', () => {
  it('draw a 1px shadow on the end side of every segment but the last, 1px apart', () => {
    expect(ruleBody('[data-blok-database-table-selection-bar]')).toContain('gap: var(--blok-space-0-25)');
    expect(ruleBody('[data-blok-database-table-selection-bar] > :not(:last-child)')).toContain('box-shadow: var(--blok-database-table-border) 1px 0 0 0');
    expect(ruleBody('[dir="rtl"] [data-blok-database-table-selection-bar] > :not(:last-child)')).toContain('box-shadow: var(--blok-database-table-border) -1px 0 0 0');
    expect(tokenValues('--blok-database-table-border')).toEqual([ 'rgba(42, 28, 0, 0.07)', 'rgba(255, 255, 243, 0.082)', 'rgba(255, 255, 243, 0.082)' ]);
  });
});

describe('table selection bar fade (notion-motion.md Round 14, row checkbox)', () => {
  const TABLE_BARS = [
    '[data-blok-database-selecting="table"] > [data-blok-database-table-selection-bar]',
    '[data-blok-database-table] > [data-blok-database-table-selection-bar]',
  ];

  it('fades in over 200ms ease when the first row is picked', () => {
    for (const selector of TABLE_BARS) {
      expect(ruleBody(selector)).toContain('animation: blok-database-confirm-fade 200ms ease both');
    }
  });

  it('appears at once under reduced motion', () => {
    const reduced = [ ...database.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g) ]
      .map((m) => m[1])
      .filter((block) => TABLE_BARS.every((selector) => block.includes(selector)));

    expect(reduced.join(' ')).toContain('animation: none');
  });
});

describe('table selection bar fade-out (notion-motion.md Round 16 §2)', () => {
  const LEAVING = '[data-blok-database-table-selection-bar-leaving]';

  it('fades the leaving bar 1 to 0 over 200ms ease, with no slide or scale', () => {
    const body = ruleBody(LEAVING);

    expect(body).toContain('animation: blok-database-confirm-fade-out 200ms ease forwards');
    expect(body).toContain('pointer-events: none');
    expect(body).not.toContain('transform');
  });

  it('keeps the leaving bar looking and sitting like the bar', () => {
    for (const selector of [
      '[data-blok-database-table-selection-bar]',
      '[data-blok-database-view-bar] > [data-blok-database-table-selection-bar]',
      '[data-blok-database-title-row] > [data-blok-database-table-selection-bar]',
      '[data-blok-database-table-selection-bar] > :not(:last-child)',
      '[data-blok-database-table-selection-bar] button',
      '[data-blok-database-table-selection-bar] svg',
    ]) {
      expect(ruleBody(selector.replace('[data-blok-database-table-selection-bar]', LEAVING))).toContain(ruleBody(selector));
    }
    expect(ruleBody('[data-blok-database-view-bar]:has(> [data-blok-database-table-selection-bar-leaving])')).toContain('position: relative');
    expect(ruleBody('[data-blok-database-title-row]:has(> [data-blok-database-table-selection-bar-leaving])')).toContain('position: relative');
  });

  it('fades the row halo out with the bar: only its opacity changes', () => {
    expect(ruleBody('[data-blok-database-table-row]::after')).toContain('background-color: var(--blok-icon-active-bg)');
    expect(ruleBody('[data-blok-database-table-row]::after')).toContain('transition: opacity 200ms ease');
    expect(ruleBody('[data-blok-database-table-row][aria-selected="true"]::after')).not.toContain('background-color');
  });
});

describe('property menu "Change icon" button (research/26 §3c, §4a)', () => {
  it('is bordered with no fill and hovers to the measured fill', () => {
    const body = ruleBody('[data-blok-database-property-menu-icon]');

    expect(body).toContain('border: 1px solid var(--blok-database-table-control-border)');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('color: var(--blok-database-property-icon-button-ink)');
    expect(ruleBody('[data-blok-database-property-menu-icon]:hover')).toContain('background-color: var(--blok-database-property-icon-button-hover-bg)');
    expect(tokenValues('--blok-database-property-icon-button-ink')).toEqual([ 'rgb(85, 83, 78)', 'rgb(211, 211, 211)', 'rgb(211, 211, 211)' ]);
    expect(tokenValues('--blok-database-property-icon-button-hover-bg')).toEqual([ 'rgb(249, 248, 247)', 'rgb(32, 32, 32)', 'rgb(32, 32, 32)' ]);
  });
});

describe('property menu "Add property description" (i) button (research/26 §3c)', () => {
  it('is 15x20 with no fill and draws its glyph in the measured ink', () => {
    const body = ruleBody('[data-blok-database-property-menu-description-button]');

    expect(body).toContain('width: 15px');
    expect(body).toContain('height: 20px');
    expect(body).toContain('background: transparent');
    expect(body).toContain('color: var(--blok-database-table-header-icon)');
    // Light is measured; dark borrows the View settings × glyph ink (r26:174).
    expect(tokenValues('--blok-database-table-header-icon')).toEqual([ 'rgb(142, 139, 134)', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)' ]);
  });
});

// research/35 §5: 1 line 20px, 2 lines 40px, then 60px and it scrolls.
describe('property description field growth (research/35 §5)', () => {
  it('grows with its text up to three lines, then scrolls', () => {
    const body = ruleBody('textarea[data-blok-database-property-description][data-blok-field]');

    expect(body).toContain('field-sizing: content');
    // 60px of text plus 3px padding and a 1px border on each side (border-box).
    expect(body).toContain('max-height: 68px');
    expect(body).toContain('overflow-y: auto');
  });
});

describe('view settings Close × (research/26 §1b, §4a)', () => {
  it('is a 20px round button on the measured fills', () => {
    const body = ruleBody('[data-blok-database-panel-close]');

    expect(body).toContain('width: 20px');
    expect(body).toContain('height: 20px');
    expect(body).toContain('border-radius: 50%');
    expect(body).toContain('background-color: var(--blok-database-panel-close-bg)');
    expect(body).toContain('margin-inline-start: auto');
    expect(ruleBody('[data-blok-database-panel-close]:hover')).toContain('background-color: var(--blok-database-panel-close-hover-bg)');
    expect(tokenValues('--blok-database-panel-close-bg')).toEqual([ 'rgba(42, 28, 0, 0.07)', 'rgba(255, 255, 235, 0.1)', 'rgba(255, 255, 235, 0.1)' ]);
    expect(tokenValues('--blok-database-panel-close-hover-bg')).toEqual([ 'rgba(42, 28, 0, 0.106)', 'rgba(255, 255, 235, 0.153)', 'rgba(255, 255, 235, 0.153)' ]);
  });
});

describe('pressed and hover fills, light and dark (research/27 §6)', () => {
  const ROW_ACTIVE = '[data-blok-database-panel-row]:active:not(:disabled):not([data-blok-database-layout-locked])';

  it('a View settings row presses to the measured fills: light is the hover ink at double alpha (research/30 B5)', () => {
    expect(tokenValues('--blok-database-panel-row-active-bg')).toEqual([ 'rgba(33, 27, 23, 0.102)', 'rgba(255, 255, 255, 0.11)', 'rgba(255, 255, 255, 0.11)' ]);
    expect(tokenValues('--blok-database-table-header-hover-bg')[0]).toBe('var(--blok-database-hover-bg)');
    expect(tokenValues('--blok-database-hover-bg')[0]).toBe('rgba(33, 27, 23, 0.051)');
    expect(ruleBody(ROW_ACTIVE)).toContain('background-color: var(--blok-database-panel-row-active-bg)');
    expect(tokenValues('--blok-database-table-header-hover-bg').slice(1)).toEqual([ 'rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)' ]);
    // The press rule must come after the hover rule, which it ties on specificity while both match.
    expect(database.indexOf(ROW_ACTIVE)).toBeGreaterThan(database.indexOf('[data-blok-database-panel-row]:hover:not(:disabled)'));
  });

  it('the panel × presses to the measured fills', () => {
    expect(ruleBody('[data-blok-database-panel-close]:active')).toContain('background-color: var(--blok-database-panel-close-active-bg)');
    expect(tokenValues('--blok-database-panel-close-active-bg')).toEqual([ 'rgba(33, 27, 23, 0.102)', 'rgba(255, 255, 255, 0.11)', 'rgba(255, 255, 255, 0.11)' ]);
    expect(database.indexOf('[data-blok-database-panel-close]:active')).toBeGreaterThan(database.indexOf('[data-blok-database-panel-close]:hover'));
  });

  it('Today and Now hover to the measured fills', () => {
    expect(ruleBody('[data-blok-database-date-today]:hover')).toContain('background-color: var(--blok-database-date-today-hover-bg)');
    expect(ruleBody('[data-blok-database-date-today]:hover')).not.toContain('--blok-item-hover-bg');
    expect(tokenValues('--blok-database-date-today-hover-bg')).toEqual([ 'rgba(33, 27, 23, 0.051)', 'rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)' ]);
  });
});

describe('"Manage in Calendar" row arrow (research/26 §3d light, research/30 B4 dark)', () => {
  it('is the gutter ink: rgb(173, 169, 163) light, rgb(125, 122, 117) dark', () => {
    expect(ruleBody('[data-blok-database-panel-external]')).toContain('color: var(--blok-database-table-gutter-icon)');
    expect(tokenValues('--blok-database-table-gutter-icon')).toEqual([ 'rgb(173, 169, 163)', 'rgb(125, 122, 117)', 'rgb(125, 122, 117)' ]);
  });
});

describe('delete-last-view dialog × (research/26 §5a, research/30 B3)', () => {
  it('is a 24px round button at the top right on the measured fill (light: research/35 §10)', () => {
    const body = ruleBody('[data-blok-database-confirm-close]');

    expect(ruleBody('[data-blok-database-confirm-dialog]')).toContain('position: relative');
    expect(body).toContain('position: absolute');
    expect(body).toContain('inset-inline-end: var(--blok-space-3)');
    expect(body).toContain('width: 24px');
    expect(body).toContain('height: 24px');
    expect(body).toContain('border-radius: 50%');
    expect(body).toContain('background-color: var(--blok-database-confirm-close-bg)');
    expect(tokenValues('--blok-database-confirm-close-bg')).toEqual([ 'rgba(42, 28, 0, 0.07)', 'rgba(255, 255, 243, 0.082)', 'rgba(255, 255, 243, 0.082)' ]);
  });

  it('draws no ring on a pointer focus: its ring is an outline, which the preflight pointer guard hides', () => {
    expect(ruleBody('[data-blok-database-confirm-close]')).not.toContain('box-shadow');
    expect(ruleBody('[data-blok-database-confirm-close]:focus-visible')).toContain('outline: 2px solid var(--blok-focus-ring)');
  });
});

// notion-spec-2 §24.8: Notion's ink rgb(125,122,117) fails AA at 12px, so the heading keeps Blok's secondary ink.
describe('Edit property "Options" heading and status group names (notion-spec-2 §24.8)', () => {
  it('read 12/14.4, weight 500, in the secondary ink', () => {
    const body = ruleBody('[data-blok-database-options-heading]');

    expect(body).toContain('font-size: 12px');
    expect(body).toContain('line-height: 14.4px');
    expect(body).toContain('font-weight: 500');
    expect(body).toContain('color: var(--blok-database-ink-secondary)');
  });
});

// research/33 §3.2 (cardlay.sh reads `outline` on a 109x82 button beside its label): 1px gray, 2px when picked.
describe('board Card layout tiles (research/33 §3.2)', () => {
  const DRAWING = '[data-blok-database-card-layout-drawing]';
  const PICKED = '[data-blok-database-card-layout-tile][aria-pressed="true"] [data-blok-database-card-layout-drawing]';

  it('are 109x82 with a 10px radius and a 1px outline outside the box', () => {
    const body = ruleBody(DRAWING);

    expect(body).toContain('inline-size: 109px');
    expect(body).toContain('block-size: 82px');
    expect(body).toContain('border-radius: var(--blok-radius-surface)');
    expect(body).toContain('outline: 1px solid var(--blok-database-tpl-border)');
    expect(body).not.toContain('border:');
  });

  it('draw the picked tile with a 2px outline in ink', () => {
    const body = ruleBody(PICKED);

    expect(body).toContain('outline: 2px solid var(--blok-database-ink)');
    expect(body).not.toContain('box-shadow');
  });
});

// notion-motion.md Round 9 (r9-vs-layout.raw): Layout rows are 274x28 at x+8, 29 apart; the switch ends 8px in.
describe('View settings Layout page rows (notion-motion Round 9)', () => {
  const ROW = '[data-blok-database-panel-page="layout"] [data-blok-database-panel-row]';
  const NEXT = '[data-blok-database-panel-page="layout"] [data-blok-database-panel-row] + [data-blok-database-panel-row]';

  it('inset rows 8px each side, so they are 274 wide in the 290 panel', () => {
    const body = ruleBody(ROW);

    expect(body).toContain('inline-size: auto');
    expect(body).toContain('margin-inline: var(--blok-space-1)');
  });

  it('put 1px between rows, a 29px pitch', () => {
    expect(ruleBody(NEXT)).toContain('margin-block-start: var(--blok-space-0-25)');
  });
});

// r35:497-509 (two rules 32 tall at y 133 and 173) and r10-sort-popover.png (box top 305, rule 313, Add sort 351, bottom 412).
describe('sort panel rule list (r35:497-509, r10-sort-popover.png)', () => {
  it('puts rules 40px apart: a 32px row and an 8px gap', () => {
    expect(ruleBody('[data-blok-database-panel-page="sort"] > [data-blok-database-panel-list]')).toContain('gap: var(--blok-space-2)');
  });

  it('starts the first rule 8px down and Add sort 6px under the last rule, 107 tall with one rule', () => {
    expect(ruleBody('[data-blok-database-panel-page="sort"] > [data-blok-database-panel-list]')).toContain('margin-block: var(--blok-space-1) var(--blok-space-1-5)');
    expect(ruleBody('[data-blok-database-panel-page="sort"]')).toContain('padding-block-end: var(--blok-space-1-25)');
  });
});
