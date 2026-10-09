/**
 * Board card parity and the calendar "No date" look: measured values
 * (research/07, research/08), logical properties and reduced motion. jsdom
 * has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

describe('database board card and calendar "No date" styles', () => {
  it('draws card properties as the measured 12px rows', () => {
    const body = ruleBody('[data-blok-database-card-property]');

    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/line-height:\s*18px/);
    expect(body).toMatch(/min-block-size:\s*28px/);
  });

  it('wraps a property only when its wrap setting is on', () => {
    expect(ruleBody('[data-blok-database-card-property][data-wrap="false"]')).toMatch(/white-space:\s*nowrap/);
  });

  it('pads a card like Notion\'s title row, 8px 10px 6px (research/07)', () => {
    expect(ruleBody('[data-blok-database-card]')).toContain('padding: var(--blok-space-2) var(--blok-space-2-5) var(--blok-space-1-5)');
  });

  it('keeps property rows 6px from the card edge and 8px from its bottom (research/07)', () => {
    const body = ruleBody('[data-blok-database-card-properties]');

    expect(body).toContain('margin-inline: calc(-1 * var(--blok-space-1))');
    expect(body).toContain('margin-block-end: var(--blok-space-0-5)');
  });

  it('bleeds the preview to the card edges and crops unless Fit image is on', () => {
    expect(ruleBody('[data-blok-database-card-preview]')).toContain('margin: calc(-1 * var(--blok-space-2)) calc(-1 * var(--blok-space-2-5)) var(--blok-space-2)');
    expect(ruleBody('[data-blok-database-card-image]')).toMatch(/object-fit:\s*cover/);
    expect(ruleBody('[data-blok-database-board][data-fit-image] [data-blok-database-card-image]')).toMatch(/object-fit:\s*contain/);
  });

  it('sizes the preview by card size', () => {
    expect(ruleBody('[data-blok-database-board][data-card-size="medium"]')).toMatch(/--blok-database-card-preview-height:\s*146px/);
  });

  it('rings a card only for keyboard focus', () => {
    expect(ruleBody('[data-blok-database-card]:focus-visible')).toContain('outline: 2px solid var(--blok-focus-ring)');
    expect(css).not.toMatch(/\[data-blok-database-card\]:focus\s*\{/);
  });

  it('keeps the one row of column headers on top of sub-group lanes', () => {
    const body = ruleBody('[data-blok-database-board-heads]');

    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/inset-block-start:\s*0/);
  });

  it('labels each sub-group lane', () => {
    expect(ruleBody('[data-blok-database-board-lane-header]')).toMatch(/display:\s*flex/);
    expect(ruleBody('[data-blok-database-board-lane-columns]')).toMatch(/display:\s*flex/);
  });

  it('draws the measured "No date" button', () => {
    const body = ruleBody('[data-blok-database-calendar-nav] [data-blok-database-calendar-no-date]');

    expect(body).toMatch(/block-size:\s*28px/);
    expect(body).toContain('color: var(--blok-database-calendar-nav-icon)');
  });
});
