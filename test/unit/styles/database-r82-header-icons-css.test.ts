/**
 * notion-motion.md Round 41 (icons and empty states). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const tokenValues = (name: string): string[] =>
  [...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))].map((m) => m[1].trim());

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = database.match(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`));

  return match?.[1] ?? '';
};

describe('database Round 41 small chevrons', () => {
  // Keyline's chevron is 8.25 x 4.75 units of ink; 28px draws it 11.55 x 6.65 (Notion 12 x 6.5).
  it('draws the peek row steps at Notion size', () => {
    const body = ruleBody('[data-blok-database-peek-prev] svg, [data-blok-database-peek-next] svg');

    expect(body).toContain('width: 28px');
    expect(body).toContain('height: 28px');
    expect(body).toContain('flex: none');
    // The 24px button caps an svg at max-height 100%, which would shrink the drawing back.
    expect(body).toContain('max-height: none');
  });

  it('draws the calendar month arrows at Notion size', () => {
    const body = ruleBody('[data-blok-database-calendar-nav] [data-blok-database-calendar-prev] svg, [data-blok-database-calendar-nav] [data-blok-database-calendar-next] svg');

    expect(body).toContain('inline-size: 28px');
    expect(body).toContain('block-size: 28px');
    expect(body).toContain('flex: none');
    expect(body).toContain('max-block-size: none');
  });

  // 24px draws it 9.9 x 5.7 (Notion 10 x 6).
  it('draws the New menu chevron at Notion size', () => {
    const body = ruleBody('[data-blok-database-new] svg');

    expect(body).toContain('width: 24px');
    expect(body).toContain('height: 24px');
    expect(body).toContain('flex: none');
  });
});

describe('database Round 41 menu icon inks', () => {
  // Light: Notion's type picker icons are rgb(142, 139, 134). Dark keeps the measured rgb(230, 229, 227) (recon r21 §1m).
  it('draws the type picker icons gray in light and keeps the bright dark ink', () => {
    expect(ruleBody('[data-blok-database-property-type-option-icon]')).toContain('color: var(--blok-database-type-icon)');
    expect(tokenValues('--blok-database-type-icon')).toEqual([
      'var(--blok-database-table-header-icon)',
      'var(--blok-database-glyph)',
      'var(--blok-database-glyph)',
    ]);
  });

  // Notion's filter picker icons are rgb(56, 56, 54). The sort picker's ink is unmeasured, so it keeps the gray.
  it('draws the filter picker icons in the strong ink, and only there', () => {
    expect(ruleBody('[data-blok-database-picker-list="filter"] [data-blok-database-panel-icon]')).toContain('color: var(--blok-database-peek-glyph-strong)');
    expect(tokenValues('--blok-database-peek-glyph-strong')[0]).toBe('rgb(56, 56, 54)');
  });
});

describe('database Round 41 header ⋯', () => {
  const plusAndMore = '[data-blok-database-table-add-property], [data-blok-database-table-property-visibility]';

  // Notion: "+" and "⋯" are both 28x28 in rgb(142, 139, 134), the ⋯ flush after the "+".
  it('draws the ⋯ as the "+" button, flush after it', () => {
    const body = ruleBody(plusAndMore);

    expect(body).toContain('width: 28px');
    expect(body).toContain('height: 28px');
    expect(body).toContain('color: var(--blok-database-table-header-icon)');
    expect(ruleBody('[data-blok-database-table-property-visibility]')).toContain('margin-inline-start: 0');
    expect(ruleBody('[data-blok-database-table-add-property]:hover, [data-blok-database-table-property-visibility]:hover'))
      .toContain('background-color: var(--blok-database-table-header-hover-bg)');
  });

  // Notion's dots read 12 x 3 of ink, area 15.1; IconDotsHorizontal at 20px reads 13 x 3, area 15.0.
  it('draws the ⋯ dots at Notion size', () => {
    expect(ruleBody('[data-blok-database-table-property-visibility] svg')).toContain('width: 20px');
  });
});

describe('database Round 41 type picker AI line', () => {
  // Notion: 1px in the table border ink, 12 in from the popover's sides, its top 7.5 under the Translate row
  // and "Select type"'s text 20 under it. The grid body pads 4 and its section 4 more.
  it('draws a 1px line between the AI rows and the types', () => {
    const body = ruleBody('[data-blok-database-property-autofill-rule]');

    expect(body).toContain('height: 1px');
    expect(body).toContain('margin: var(--blok-space-2) var(--blok-space-1)');
    expect(body).toContain('background-color: var(--blok-database-table-border)');
  });
});

describe('database Round 41 Add view first tile', () => {
  // The fill is the tile hover tint, never a focus ring.
  it('paints the first tile with the hover tint', () => {
    expect(ruleBody('[data-blok-database-view-option]:hover, [data-blok-database-view-option][data-active], [data-blok-focused=\'true\'] > [data-blok-database-view-option], [data-blok-database-view-option][data-blok-focused=\'true\']'))
      .toBe(' background-color: var(--blok-database-popover-hover); ');
  });
});
