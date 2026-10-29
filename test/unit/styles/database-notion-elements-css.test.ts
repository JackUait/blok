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
