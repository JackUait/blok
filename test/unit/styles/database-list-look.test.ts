/**
 * The list view matches the measured Notion values (research/07 "List").
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const database = read('database.css');

/** Every declaration block whose selector list contains `selector`, joined. */
const ruleBody = (css: string, selector: string): string =>
  [ ...css.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

describe('list rows (research/07)', () => {
  it('draws each row 30px tall with a 1px margin (space-0-25), so rows sit on a 32px pitch with no divider', () => {
    const body = ruleBody(database, '[data-blok-database-list-row]');

    expect(body).toContain('height: 30px');
    expect(body).toContain('margin: var(--blok-space-0-25) 0');
    expect(body).toContain('padding-inline-start: var(--blok-space-1)');
    expect(body).not.toContain('border-bottom');
    expect(ruleBody(database, '[data-blok-database-list-row]:not(:last-child)')).toBe('');
  });

  it('sets the title 14px/21px at weight 500 in ink', () => {
    const body = ruleBody(database, '[data-blok-database-list-row-title]');

    expect(body).toContain('font-size: 14px');
    expect(body).toContain('line-height: 21px');
    expect(body).toContain('font-weight: 500');
    expect(body).toContain('color: var(--blok-database-ink)');
  });

  it('gives each property a 30px slot padded 0 8px, with no fill of its own', () => {
    const body = ruleBody(database, '[data-blok-database-list-row-property]');

    expect(body).toContain('height: 30px');
    expect(body).toContain('padding: 0 var(--blok-space-2)');
    expect(body).not.toContain('background');
  });

  it('shrinks option pills in a list row to 18px, 0 8px, 13px/18px', () => {
    const body = ruleBody(database, '[data-blok-database-list-row-property] [data-blok-database-option-pill]');

    expect(body).toContain('height: 18px');
    expect(body).toContain('padding: 0 var(--blok-space-2)');
    expect(body).toContain('font-size: 13px');
    expect(body).toContain('line-height: 18px');
  });

  // findings-listgallery L17: a status pill takes the list size too, padded 0 11px 0 9px.
  it('draws a status pill in a list row 18px tall, 13px/18px, padded 0 11px 0 9px', () => {
    const body = ruleBody(database, '[data-blok-database-list-row-property] [data-blok-database-option-pill][data-status-group]');

    expect(body).toContain('padding-inline: 9px 11px');
    expect(ruleBody(database, '[data-blok-database-list-row-property] [data-blok-database-option-pill]:not([data-status-group])')).toBe('');
  });

  it('rings a focused row or property only after keyboard use', () => {
    expect(ruleBody(database, '[data-blok-database-list-row]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *)'))
      .toContain('var(--blok-focus-ring)');
    expect(ruleBody(database, '[data-blok-database-list-row-property][data-editable]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *)'))
      .toContain('var(--blok-focus-ring)');
    expect(ruleBody(database, '[data-blok-database-list-row]:focus')).toBe('');
  });

  // findings-listgallery L19: only the row fills on hover; a property has no fill of its own.
  it('gives a hovered property no fill of its own', () => {
    expect(ruleBody(database, '[data-blok-database-list-row-property][data-editable]:hover')).toBe('');
  });
});

describe('list row widths (findings-listgallery L01)', () => {
  // The title box holds the title and the Edit pencil right after its text (L04).
  it('keeps the title box at least 120px wide and lets it grow; the title hugs its text', () => {
    const box = ruleBody(database, '[data-blok-database-list-row-main]');

    expect(box).toContain('flex: 1 1 auto');
    expect(box).toContain('min-width: 120px');
    expect(ruleBody(database, '[data-blok-database-list-row-title]')).toContain('flex: 0 1 auto');
    expect(ruleBody(database, '[data-blok-database-list-row-title]')).toContain('min-width: 0');
  });

  it('lets the properties shrink and clip inside the row', () => {
    const body = ruleBody(database, '[data-blok-database-list-row-properties]');

    expect(body).toContain('flex: 0 1 auto');
    expect(body).toContain('min-width: 0');
    expect(body).toContain('overflow: hidden');
    expect(body).not.toContain('flex-shrink: 0');
  });

  it('lets each slot shrink, clipped, with Notion\'s caps per type', () => {
    const slot = ruleBody(database, '[data-blok-database-list-row-property]');

    expect(slot).toContain('flex: 0 1 auto');
    expect(slot).toContain('min-width: 0');
    expect(slot).toContain('overflow: hidden');
    expect(ruleBody(database, '[data-blok-database-list-row-property] [data-blok-database-cell]')).toContain('flex-wrap: nowrap');
    expect(ruleBody(database, '[data-blok-database-list-row-property] [data-blok-database-cell] > *')).toContain('flex-shrink: 0');
    for (const type of ['multiSelect', 'select', 'files']) {
      expect(ruleBody(database, `[data-blok-database-list-row-property][data-type="${type}"]`)).toContain('max-width: max(200px, 14%)');
    }
    for (const type of ['date', 'number']) {
      expect(ruleBody(database, `[data-blok-database-list-row-property][data-type="${type}"]`)).toContain('max-width: max(150px, 14%)');
    }
  });
});

describe('list row hover chrome (findings-listgallery L03, L04)', () => {
  it('draws the gutter "+" 24px square beside the 18x24 ⋮⋮', () => {
    expect(ruleBody(database, '[data-blok-database-list-row-add]')).toContain('width: 24px');
    expect(ruleBody(database, '[data-blok-database-list-row-add]')).toContain('height: 24px');
  });

  it('shows the white 26x20 Edit pencil only while the row is hovered', () => {
    const body = ruleBody(database, '[data-blok-database-list-row-edit]');

    expect(body).toContain('display: none');
    expect(body).toContain('width: 26px');
    expect(body).toContain('height: 20px');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('background: var(--blok-database-card-actions-bg)');
    expect(body).toContain('box-shadow: var(--blok-database-card-actions-shadow)');
    expect(ruleBody(database, '[data-blok-database-list-row]:hover [data-blok-database-list-row-edit]')).toContain('display: inline-flex');
  });

  it('keeps no open or delete button styles for the list', () => {
    expect(database).not.toContain('[data-blok-database-list-row-open]');
    expect(database).not.toContain('[data-blok-database-list-row-properties] [data-blok-database-delete-row]');
  });
});

describe('list title edit (findings-listgallery L05)', () => {
  it('edits the title in place at its own type, with a gray placeholder', () => {
    const body = ruleBody(database, '[data-blok-database-list-title-input]');

    expect(body).toContain('flex: 1 1 auto');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('line-height: 21px');
    expect(body).toContain('font-weight: 500');
    expect(body).toContain('border: none');
    expect(ruleBody(database, '[data-blok-database-list-title-input]::placeholder')).toContain('color: var(--blok-database-add-text)');
  });

  it('keeps Open in side peek and the page glyph showing while the title is edited', () => {
    expect(ruleBody(database, '[data-blok-database-list-row][data-editing] [data-blok-database-list-row-edit]')).toContain('display: inline-flex');
    expect(ruleBody(database, '[data-blok-database-list-row] > [data-blok-database-page-icon-placeholder]')).toContain('width: 18px');
  });
});

describe('grouped list (findings-listgallery L08, L10)', () => {
  it('draws the caret as a 24px ink button and the "…" and "+" as 24px buttons shown on header hover', () => {
    const toggle = ruleBody(database, '[data-blok-database-list-group-toggle]');

    expect(toggle).toContain('width: 24px');
    expect(toggle).toContain('height: 24px');
    expect(toggle).toContain('color: var(--blok-database-ink)');
    expect(ruleBody(database, '[data-blok-database-list-group-actions] button')).toContain('width: 24px');
    expect(ruleBody(database, '[data-blok-database-list-group-actions] button')).toContain('height: 24px');
    expect(ruleBody(database, '[data-blok-database-list-group-actions]')).toContain('opacity: 0');
    expect(ruleBody(database, '[data-blok-database-list-group-header]:hover [data-blok-database-list-group-actions]')).toContain('opacity: 1');
  });

  it('puts the first row 37px below the header top and 28px between groups, with no indent', () => {
    const header = ruleBody(database, '[data-blok-database-list-group-header]');

    expect(header).toContain('height: 24px');
    expect(header).toContain('margin-bottom: 12px');
    expect(ruleBody(database, '[data-blok-database-list-group]')).toContain('margin-bottom: 28px');
    expect(ruleBody(database, '[data-blok-database-list-rows]')).not.toContain('padding-inline-start');
  });
});

describe('list "+ New page" (findings-listgallery L18)', () => {
  const rule = (suffix = ''): string => ruleBody(database, `[data-blok-database-list] > [data-blok-database-add-row]${suffix}`);

  it('is a 30px row padded 0 8px 0 6px in 14px/21px muted ink, right under the last row', () => {
    const body = rule();

    expect(body).toContain('height: 30px');
    expect(body).toContain('padding: 0 var(--blok-space-2) 0 6px');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('line-height: 21px');
    expect(body).toContain('color: var(--blok-database-table-muted-text)');
    expect(body).not.toContain('margin-top');
  });

  it('draws a 16px gray plus with a 1px 8px margin', () => {
    expect(ruleBody(database, '[data-blok-database-add-row] > span[aria-hidden="true"]')).toContain('margin: 1px var(--blok-space-2)');
    expect(ruleBody(database, '[data-blok-database-add-row] > span[aria-hidden="true"]')).toContain('color: var(--blok-database-table-gutter-icon)');
    expect(ruleBody(database, '[data-blok-database-add-row] > span[aria-hidden="true"] svg')).toContain('width: 16px');
  });

  it('fills on hover and keeps its muted ink', () => {
    const hover = rule(':hover');

    expect(hover).toContain('background-color: var(--blok-database-hover-bg)');
    expect(hover).not.toMatch(/(^|[;\s])color:/);
  });
});

describe('list file thumbnail (findings-listgallery L02)', () => {
  it('draws an image file 30x20, rounded 4px, cropped to fill', () => {
    const body = ruleBody(database, '[data-blok-database-list-file-thumb]');

    expect(body).toContain('width: 30px');
    expect(body).toContain('height: 20px');
    expect(body).toContain('border-radius: var(--blok-radius-control-sm)');
    expect(body).toContain('object-fit: cover');
  });
});

describe('conditional color on calendar, timeline and feed (research/05 §6.2)', () => {
  const PAINTED = ':is([data-blok-database-calendar-event], [data-blok-database-timeline-bar], [data-blok-database-feed-card])[data-blok-database-color]';

  it('lets the rule color beat the item\'s own fill, which these rules declare after the color rules', () => {
    expect(ruleBody(database, PAINTED)).toContain('background-color: var(--_blok-database-rule-bg)');
    expect(database.lastIndexOf(PAINTED)).toBeGreaterThan(database.indexOf('[data-blok-database-feed-card] {'));
    expect(ruleBody(database, '[data-blok-database-color="green"]')).toContain('--_blok-database-rule-bg: var(--blok-database-option-green-bg)');
  });
});
