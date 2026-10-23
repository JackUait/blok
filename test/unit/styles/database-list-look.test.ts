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

  it('shrinks option pills in a list row to 18px, 0 8px, 13px/18px; status pills keep their size', () => {
    const body = ruleBody(database, '[data-blok-database-list-row-property] [data-blok-database-option-pill]:not([data-status-group])');

    expect(body).toContain('height: 18px');
    expect(body).toContain('padding: 0 var(--blok-space-2)');
    expect(body).toContain('font-size: 13px');
    expect(body).toContain('line-height: 18px');
  });

  it('rings a focused row or property only after keyboard use', () => {
    expect(ruleBody(database, '[data-blok-database-list-row]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *)'))
      .toContain('var(--blok-focus-ring)');
    expect(ruleBody(database, '[data-blok-database-list-row-property][data-editable]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *)'))
      .toContain('var(--blok-focus-ring)');
    expect(ruleBody(database, '[data-blok-database-list-row]:focus')).toBe('');
  });

  it('highlights an editable property on hover', () => {
    expect(ruleBody(database, '[data-blok-database-list-row-property][data-editable]:hover'))
      .toContain('background-color: var(--blok-database-add-hover-bg)');
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
