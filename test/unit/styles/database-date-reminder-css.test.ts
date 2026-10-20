/**
 * A date with a reminder (research/21 §6). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const rulesFor = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|\})\s*([^{}@]+)\{([^{}]*)\}/g) ]
    .filter((match) => match[1].split(',').some((part) => part.trim() === selector))
    .map((match) => match[2])
    .join(' ');

describe('database date reminder css', () => {
  // The base cell is a wrapping flex box: in a narrow card or timeline column the alarm
  // would drop to its own line, or the date would split and clip.
  it('keeps the date and its alarm on one inline line in every view', () => {
    const date = rulesFor('[data-blok-database-cell="date"][data-reminder]');

    expect(date).toContain('display: inline');
    expect(date).toContain('white-space: nowrap');
    expect(date).toContain('color: var(--blok-database-reminder-text)');
  });

  // Measured rgb(39, 131, 222) in both themes (research/26 §4f), not the global accent #2383e2.
  it('paints the date in its own database token, not the global accent', () => {
    const values = [ ...database.matchAll(/--blok-database-reminder-text:\s*([^;]+);/g) ].map((m) => m[1].trim());

    expect(values).toEqual(['rgb(39, 131, 222)', 'rgb(39, 131, 222)', 'rgb(39, 131, 222)']);
  });

  // research/23 §1: 342 wide; the search stays put while the list scrolls; two-line rows.
  it('the time zone menu is 342 wide and scrolls its list under a fixed search', () => {
    expect(rulesFor('[data-blok-database-date-zone-menu][data-blok-top-layer][popover]')).toContain('width: 342px');
    expect(rulesFor('[data-blok-database-date-zone-list]')).toContain('overflow-y: auto');
    expect(rulesFor('[data-blok-database-date-setting-menu="timeZone"][data-blok-top-layer][popover]')).not.toContain('overflow-y');
    expect(rulesFor('[data-blok-database-date-zone-search][data-blok-field]')).toContain('font-size: 14px');
    expect(rulesFor('[data-blok-database-date-zone-heading]')).toContain('font-weight: 500');
    expect(rulesFor('[data-blok-database-date-zone-offset]')).toContain('color: var(--blok-text-secondary)');
    expect(rulesFor('[data-blok-database-date-setting-option][data-active]')).toContain('background-color: var(--blok-item-hover-bg)');
  });

  // research/23 §1: a 16px check in primary ink at the row's end; the checked row has no fill.
  it('the checked option shows a 16px primary-ink check and no fill', () => {
    expect(rulesFor('[data-blok-database-date-remind-check] > svg')).toContain('width: 16px');
    expect(rulesFor('[data-blok-database-date-remind-check]')).toContain('color: var(--blok-text-primary)');
    expect(rulesFor('[data-blok-database-date-remind-check]')).toContain('margin-inline-start: auto');
    expect(database).not.toMatch(/\[data-blok-database-date-(setting|remind)-option\]\[aria-(checked|selected)="true"\]/);
  });
});
