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
