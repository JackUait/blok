/**
 * Notion's light values and dark leftovers (research/26 §1, §4). jsdom has no CSS,
 * so these read the source; the computed look is in
 * test/playwright/tests/database/database-light-values.spec.ts.
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

/** A token's value in the light block, then the two dark blocks. */
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

describe('view settings titles (research/26 §1a)', () => {
  it('the root title is a 12px/16px 500 label in the panel secondary ink', () => {
    const body = ruleBody('[data-blok-database-panel-header="label"]');

    expect(body).toContain('font-size: 12px');
    expect(body).toContain('line-height: 16px');
    expect(body).toContain('font-weight: 500');
    // Light 125,122,117 is 4.27:1 on white; the token keeps Blok's AA secondary there, 173,169,163 in dark.
    expect(body).toContain('color: var(--blok-database-panel-muted-text)');
  });

  it('sub-page and creation panel titles stay 14px/21px 600', () => {
    const body = ruleBody('[data-blok-database-panel-header]');

    expect(body).toContain('font-weight: 600');
    expect(body).toContain('line-height: 21px');
    expect(ruleBody('[data-blok-database-panel]')).toContain('font-size: 14px');
  });
});

describe('date picker (research/26 §1c, §1d, §1f)', () => {
  it('today is a white digit on a 24px red circle behind it', () => {
    const day = ruleBody('[data-blok-database-date-day][data-today]');
    const circle = ruleBody('[data-blok-database-date-day][data-today]::after');

    expect(day).toContain('color: var(--blok-database-calendar-today-text)');
    expect(day).toContain('isolation: isolate');
    expect(day).not.toContain('font-weight: 600');
    expect(circle).toContain('width: 24px');
    expect(circle).toContain('height: 24px');
    expect(circle).toContain('border-radius: var(--blok-radius-pill)');
    expect(circle).toContain('background-color: var(--blok-database-today)');
    expect(circle).toContain('z-index: -1');
  });

  it('a selected today keeps its white digit on the circle', () => {
    expect(ruleBody('[data-blok-database-date-day][data-today][aria-selected="true"]'))
      .toContain('color: var(--blok-database-calendar-today-text)');
  });

  // Notion's 3px radius has no role; the small-control role stands in (like the checkbox).
  it('"Today" / "Now" is a 20px box, padding 0 8px, small-control radius, no rest fill', () => {
    const body = ruleBody('[data-blok-database-date-today]');

    expect(body).toContain('height: 20px');
    expect(body).toContain('min-height: 20px');
    expect(body).toContain('padding: 0 var(--blok-space-2)');
    expect(body).toContain('border-radius: var(--blok-radius-control-sm)');
    expect(body).toContain('line-height: 14.4px');
    expect(body).toContain('background: transparent');
  });

  it('Date format and Time format submenus are 180 wide; Remind stays 250', () => {
    for (const kind of ['dateFormat', 'timeFormat']) {
      expect(ruleBody(`[data-blok-database-date-setting-menu="${kind}"][data-blok-top-layer][popover]`)).toContain('width: 180px');
    }
    expect(ruleBody('[data-blok-database-date-remind-menu][data-blok-top-layer][popover]')).toContain('width: 250px');
  });
});

describe('peek (research/26 §1e, §5f)', () => {
  it('the center peek title is 40px/48px 700', () => {
    const body = ruleBody('[data-blok-database-drawer][data-peek-mode="center"] [data-blok-database-drawer-title]');

    expect(body).toContain('font-size: 40px');
    expect(body).toContain('line-height: 48px');
    expect(ruleBody('[data-blok-database-drawer-title]')).toContain('font-weight: 700');
  });

  it('label cells and "Add a property" hover with the measured light fill; values have none', () => {
    expect(tokenValues('--blok-database-peek-hover-bg'))
      .toEqual(['rgba(33, 27, 23, 0.051)', 'var(--blok-database-hover-bg)', 'var(--blok-database-hover-bg)']);
    expect(ruleBody('[data-blok-database-drawer-prop-row]:not([data-blok-database-drawer-pin]) > [data-blok-database-drawer-prop-head]:has(> [data-blok-database-drawer-prop-label][role="button"]:hover)'))
      .toContain('background-color: var(--blok-database-peek-hover-bg)');
    expect(ruleBody('[data-blok-database-drawer-add-prop]:hover')).toContain('background-color: var(--blok-database-peek-hover-bg)');
    expect(tokenValues('--blok-database-peek-value-hover-bg')).toEqual(['transparent', 'transparent', 'transparent']);
  });
});

describe('dark leftovers (research/26 §4c, §4e, §4f)', () => {
  it('a reminder is the AA step of the measured blue rgb(39, 131, 222) in each theme', () => {
    expect(tokenValues('--blok-database-reminder-text')).toEqual(['rgb(35, 119, 211)', 'rgb(41, 137, 232)', 'rgb(41, 137, 232)']);
  });

  it('gallery property text is primary ink', () => {
    expect(ruleBody('[data-blok-database-gallery-properties]')).toContain('color: var(--blok-database-gallery-title-text)');
    expect(tokenValues('--blok-database-gallery-title-text')).toEqual(['rgb(44, 44, 43)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
  });

  it('dark brown columns take the measured tint, ring, count, card and card hover', () => {
    const dark = (name: string): string[] => tokenValues(name).slice(-2);

    expect(dark('--blok-database-column-brown-bg')).toEqual(Array(2).fill('rgba(253, 158, 101, 0.05)'));
    expect(tokenValues('--blok-database-column-brown-ring')).toEqual(Array(2).fill('rgba(255, 174, 122, 0.133)'));
    expect(dark('--blok-database-column-brown-accent')).toEqual(Array(2).fill('rgb(182, 137, 101)'));
    expect(tokenValues('--blok-database-column-brown-card-bg')).toEqual(Array(2).fill('rgb(56, 45, 38)'));
    expect(tokenValues('--blok-database-column-brown-card-hover-bg')).toEqual(Array(2).fill('rgb(64, 51, 43)'));
  });

  it('dark blue cards hover to the measured blue', () => {
    expect(tokenValues('--blok-database-column-blue-card-hover-bg')).toEqual(Array(2).fill('rgb(37, 54, 73)'));
  });

  it('a card hovers through its column channel, falling back to the plain hover', () => {
    expect(ruleBody('[data-blok-database-card]:hover'))
      .toContain('background-color: var(--_blok-group-card-hover, var(--blok-database-card-bg-hover))');
  });

  // Matches since 4212d984: same colour drawn 1px at the bottom; Notion's repeat-x and "to right" draw the same pixels.
  it('a link underline is a 1px gradient line in the measured light and dark colours', () => {
    const body = ruleBody('[data-blok-database-cell] [data-blok-database-cell-link]');

    expect(body).toContain('text-decoration: none');
    expect(body).toContain('background-size: 100% 1px');
    expect(body).toContain('background-position: 0 100%');
    expect(tokenValues('--blok-database-cell-link-underline'))
      .toEqual(['rgba(28, 19, 1, 0.11)', 'rgba(255, 255, 235, 0.1)', 'rgba(255, 255, 235, 0.1)']);
  });
});
