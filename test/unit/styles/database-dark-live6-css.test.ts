/**
 * Database properties in dark against Notion's live dark round (notion-spec-2 §23).
 * jsdom has no CSS, so these read the authored source.
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

describe('table cells at rest in dark (§23.1)', () => {
  it('draws the title page icon in Notion\'s dark rgb(125, 122, 117) and keeps light on the header icon ink', () => {
    expect(tokenValues('--blok-database-table-title-icon')).toEqual([
      'var(--blok-database-table-header-icon)',
      'rgb(125, 122, 117)',
      'rgb(125, 122, 117)',
    ]);
    expect(ruleBody('[data-blok-database-table-cell] > [data-blok-database-page-icon-placeholder]'))
      .toContain('color: var(--blok-database-table-title-icon)');
  });

  it('draws the file glyph in rgb(230, 229, 227) in dark and in the text ink in light', () => {
    expect(tokenValues('--blok-database-glyph')).toEqual(['currentColor', 'rgb(230, 229, 227)', 'rgb(230, 229, 227)']);
    expect(ruleBody('[data-blok-database-file-chip-icon]')).toContain('color: var(--blok-database-glyph)');
    expect(ruleBody('[data-blok-database-files-editor][data-layout="table"] [data-blok-database-file-row] > [data-blok-database-file-chip-icon]'))
      .toContain('color: var(--blok-database-glyph)');
  });

  it('fills a letter avatar with rgb(37, 37, 37) and a faint 1px inner ring in dark, as before in light', () => {
    expect(tokenValues('--blok-database-person-initial-bg')).toEqual([
      'var(--blok-database-option-default-bg)',
      'rgb(37, 37, 37)',
      'rgb(37, 37, 37)',
    ]);
    expect(tokenValues('--blok-database-person-initial-shadow')).toEqual([
      'none',
      'inset 0 0 0 1px rgba(255, 255, 243, 0.082)',
      'inset 0 0 0 1px rgba(255, 255, 243, 0.082)',
    ]);
    const initial = ruleBody('[data-blok-database-person-initial]');

    expect(initial).toContain('background-color: var(--blok-database-person-initial-bg)');
    expect(initial).toContain('box-shadow: var(--blok-database-person-initial-shadow)');
  });
});

describe('OPEN button on a hovered title in dark (§23.2)', () => {
  const darkShadow = 'inset 0 0 0 2px rgb(32, 32, 32), rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px';

  it('shows Notion\'s inner 4px-round rgb(37, 37, 37) box inside the rgb(32, 32, 32) frame', () => {
    expect(tokenValues('--blok-database-table-open-button-bg')).toEqual([
      'var(--blok-database-table-open-bg)',
      'rgb(37, 37, 37)',
      'rgb(37, 37, 37)',
    ]);
    expect(tokenValues('--blok-database-table-open-button-shadow')).toEqual([
      'var(--blok-database-table-open-shadow)',
      darkShadow,
      darkShadow,
    ]);
    const open = ruleBody('[data-blok-database-table-open]');

    expect(open).toContain('background-color: var(--blok-database-table-open-button-bg)');
    expect(open).toContain('box-shadow: var(--blok-database-table-open-button-shadow)');
  });

  it('leaves the cell hover buttons\' box on the plain frame, as Notion has no inner box there', () => {
    expect(ruleBody('[data-blok-database-table-cell-actions]')).toContain('box-shadow: var(--blok-database-table-open-shadow)');
  });
});

describe('select and multi-select chips in the editor\'s top field in dark (§23.3)', () => {
  it('draw their × in rgb(173, 169, 163); light keeps the pill ink', () => {
    expect(tokenValues('--blok-database-chip-remove-ink')).toEqual(['currentColor', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
    expect(ruleBody('[data-blok-database-select-chip-remove]')).toContain('color: var(--blok-database-chip-remove-ink)');
  });

  it('leave a person chip\'s × on the ink, as Notion\'s is rgb(240, 239, 237)', () => {
    expect(ruleBody('[data-blok-database-person-remove]')).not.toContain('--blok-database-chip-remove-ink');
  });
});

describe('date picker in dark (§23.3)', () => {
  it('greys other-month days with Notion\'s rgb(139, 152, 152), 5.1:1 on the menu', () => {
    expect(tokenValues('--blok-database-date-outside-text')).toEqual([
      'var(--blok-database-ink-tertiary)',
      'rgb(139, 152, 152)',
      'rgb(139, 152, 152)',
    ]);
    expect(ruleBody('[data-blok-database-date-day][data-outside]')).toContain('color: var(--blok-database-date-outside-text)');
  });

  it('draws the month arrows in rgb(165, 165, 165)', () => {
    expect(tokenValues('--blok-database-date-arrow')).toEqual([
      'var(--blok-database-ink-secondary)',
      'rgb(165, 165, 165)',
      'rgb(165, 165, 165)',
    ]);
    expect(ruleBody('[data-blok-database-date-prev]')).toContain('color: var(--blok-database-date-arrow)');
  });

  it('draws the chevron after a row value in rgb(125, 122, 117), and leaves the Remind check alone', () => {
    expect(tokenValues('--blok-database-value-chevron')).toEqual([
      'var(--blok-database-ink-secondary)',
      'rgb(125, 122, 117)',
      'rgb(125, 122, 117)',
    ]);
    expect(ruleBody('[data-blok-database-date-remind-chevron]')).toContain('color: var(--blok-database-value-chevron)');
    expect(ruleBody('[data-blok-database-date-remind-check]')).toContain('color: var(--blok-database-ink-secondary)');
  });
});

describe('relation picker in dark (§23.3)', () => {
  it('lifts a row\'s "+" / "−" button with Notion\'s small dark shadow; light stays flat', () => {
    const shadow = 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px';

    expect(tokenValues('--blok-database-relation-toggle-shadow')).toEqual(['none', shadow, shadow]);
    expect(ruleBody('[data-blok-database-relation-editor] [data-blok-database-relation-head] ~ [role="listbox"] [data-blok-database-relation-toggle]'))
      .toContain('box-shadow: var(--blok-database-relation-toggle-shadow)');
  });
});
