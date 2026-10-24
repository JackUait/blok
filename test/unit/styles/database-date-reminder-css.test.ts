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

const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

describe('database date reminder css', () => {
  // The base cell is a wrapping flex box: in a narrow card or timeline column the alarm
  // would drop to its own line, or the date would split and clip.
  it('keeps the date and its alarm on one inline line in every view', () => {
    const date = rulesFor('[data-blok-database-cell="date"][data-reminder]');

    expect(date).toContain('display: inline');
    expect(date).toContain('white-space: nowrap');
    expect(date).toContain('color: var(--blok-database-reminder-text)');
  });

  // Notion measured rgb(39, 131, 222) in both themes (research/26 §4f); Blok uses its AA steps,
  // light rgb(35, 119, 211) and dark rgb(41, 137, 232), not the global accent #2383e2.
  it('paints the date in its own database token, not the global accent', () => {
    const values = [ ...database.matchAll(/--blok-database-reminder-text:\s*([^;]+);/g) ].map((m) => m[1].trim());

    expect(values).toEqual(['rgb(35, 119, 211)', 'rgb(41, 137, 232)', 'rgb(41, 137, 232)']);
  });

  // research/23 §1: 342 wide; the search stays put while the list scrolls; two-line rows.
  it('the time zone menu is 342 wide and scrolls its list under a fixed search', () => {
    expect(rulesFor('[data-blok-database-date-zone-menu][data-blok-top-layer][popover]')).toContain('width: 342px');
    expect(rulesFor('[data-blok-database-date-zone-list]')).toContain('overflow-y: auto');
    expect(rulesFor('[data-blok-database-date-setting-menu="timeZone"][data-blok-top-layer][popover]')).not.toContain('overflow-y');
    expect(rulesFor('[data-blok-database-date-zone-search][data-blok-field]')).toContain('font-size: 14px');
    expect(rulesFor('[data-blok-database-date-zone-heading]')).toContain('font-weight: 500');
    expect(rulesFor('[data-blok-database-date-zone-offset]')).toContain('color: var(--blok-database-ink-secondary)');
    expect(rulesFor('[data-blok-database-date-setting-option][data-active]')).toContain('background-color: var(--blok-database-hover-bg)');
  });

  // research/30 B25: rows are 45 tall and 46 apart.
  it('the time zone rows sit 1px apart', () => {
    expect(rulesFor('[data-blok-database-date-zone-list]')).toContain('gap: var(--blok-space-0-25)');
  });

  // research/23 §1: a 16px check in primary ink at the row's end; the checked row has no fill.
  it('the checked option shows a 16px primary-ink check and no fill', () => {
    expect(rulesFor('[data-blok-database-date-remind-check] > svg')).toContain('width: 16px');
    expect(rulesFor('[data-blok-database-date-remind-check]')).toContain('color: var(--blok-database-ink)');
    expect(rulesFor('[data-blok-database-date-remind-check]')).toContain('margin-inline-start: auto');
    expect(database).not.toMatch(/\[data-blok-database-date-(setting|remind)-option\]\[aria-(checked|selected)="true"\]/);
  });

  // research/23 §1: a 36-tall footer under a line, holding a 28-tall link; 20px (?) icon in rgb(142, 139, 134).
  // The label reads rgb(125, 122, 117) in Notion's shot (14-timezone.png pixels), not the anchor's rgb(44, 44, 43).
  it('"Learn about reminders" is a 28px row in a footer under a line, gray icon and label, measured hover', () => {
    const footer = rulesFor('[data-blok-database-date-help-footer]');
    const link = rulesFor('[data-blok-database-date-help]');

    expect(footer).toContain('border-top: 1px solid var(--blok-database-table-border)');
    expect(footer).toContain('padding-top: var(--blok-space-1)');
    expect(link).toContain('min-height: 28px');
    expect(link).toContain('color: var(--blok-database-date-help-text)');
    expect(link).toContain('text-decoration: none');
    expect(rulesFor('[data-blok-database-date-help] svg')).toContain('color: var(--blok-database-calendar-nav-icon)');
    // research/35 §8 dark: Notion's rgb(125, 122, 117) is 3.59:1 on the 37,37,37 picker.
    // rgb(155, 152, 147) is the nearest warm grey that passes 4.5:1 on the hovered row too (4.53:1).
    expect(tokenValues('--blok-database-date-help-text'))
      .toEqual(['var(--blok-database-table-header-text)', 'rgb(155, 152, 147)', 'rgb(155, 152, 147)']);
    expect(rulesFor('[data-blok-database-date-help]:hover')).toContain('background-color: var(--blok-database-date-today-hover-bg)');
  });

  // research/26 §2: 322x32, centred, 8px under Map CSV headers, 14px, rgb(142, 139, 134), gap 6px.
  it('"Learn about imports" is a centred gray 32px link under the primary button', () => {
    const link = rulesFor('[data-blok-database-csv-help]');

    expect(link).toContain('justify-content: center');
    expect(link).toContain('height: 32px');
    expect(link).toContain('margin-top: var(--blok-space-2)');
    expect(link).toContain('gap: var(--blok-space-1-5)');
    expect(link).toContain('color: var(--blok-database-csv-help-text)');
    expect(link).toContain('text-decoration: none');
    expect(rulesFor('[data-blok-database-csv-help] svg')).toContain('color: var(--blok-database-csv-help-icon)');
  });

  // research/35 §8 dark: text and glyph rgb(142, 139, 134), 4.80:1 on the 32,32,32 dialog but 4.10:1 on
  // the hovered row. The text steps to rgb(150, 147, 142) (4.55:1 hovered); the glyph needs only 3:1.
  it('"Learn about imports" keeps Notion\'s gray glyph in both themes and an AA label in dark', () => {
    expect(tokenValues('--blok-database-csv-help-text'))
      .toEqual(['rgb(142, 139, 134)', 'rgb(150, 147, 142)', 'rgb(150, 147, 142)']);
    expect(tokenValues('--blok-database-csv-help-icon')).toEqual(['rgb(142, 139, 134)']);
  });
});
