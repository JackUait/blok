/**
 * Light glyph inks measured on Notion (notion-motion.md, cited per test).
 * Icons are not on the AA text list, so they take Notion's value; dark keeps the ink it had.
 * jsdom has no CSS, so these read the source.
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

describe('board and table group actions', () => {
  // L3102, L4154: ⋯ and + on a band are rgb(142, 139, 134).
  it('draws the ⋯ and + glyphs in Notion\'s gray, dark unchanged', () => {
    for (const selector of [
      '[data-blok-database-table-group-actions] button',
      '[data-blok-database-board-lane-actions] button',
    ]) {
      expect(ruleBody(selector)).toContain('color: var(--blok-database-group-action-icon)');
    }
    expect(tokenValues('--blok-database-group-action-icon')).toEqual([
      'rgb(142, 139, 134)',
      'var(--blok-database-add-text)',
      'var(--blok-database-add-text)',
    ]);
  });

  // L2283: the plus is rgb(173, 169, 163); the text keeps Blok's AA add ink.
  it('"+ New group" draws its plus in Notion\'s light gray and keeps its AA text ink', () => {
    expect(ruleBody('[data-blok-database-add-column-icon]')).toContain('color: var(--blok-database-add-group-icon)');
    expect(ruleBody('[data-blok-database-add-column]')).toContain('color: var(--blok-database-add-text)');
    expect(tokenValues('--blok-database-add-group-icon')).toEqual([
      'rgb(173, 169, 163)',
      'var(--blok-database-add-text)',
      'var(--blok-database-add-text)',
    ]);
  });

  // L2365: "Unpin group" pinFill is rgb(161, 158, 153).
  it('"Unpin group" draws its pin in Notion\'s gray, dark unchanged', () => {
    expect(ruleBody('[data-blok-database-pinned-group-unpin]')).toContain('color: var(--blok-database-pinned-unpin-icon)');
    expect(tokenValues('--blok-database-pinned-unpin-icon')).toEqual([
      'rgb(161, 158, 153)',
      'var(--blok-database-table-muted-text)',
      'var(--blok-database-table-muted-text)',
    ]);
  });
});

describe('card page glyph', () => {
  // L350, L4644: the pageEmpty and page glyphs are rgb(142, 139, 134).
  it('draws the card page glyph in Notion\'s gray, dark unchanged', () => {
    for (const selector of [
      '[data-blok-database-card-edit-glyph]',
      '[data-blok-database-card] > [data-blok-database-page-icon-placeholder]',
      '[data-blok-database-gallery-card] > [data-blok-database-page-icon-placeholder]',
    ]) {
      expect(ruleBody(selector)).toContain('color: var(--blok-database-card-glyph)');
    }
    expect(tokenValues('--blok-database-card-glyph')).toEqual([
      'rgb(142, 139, 134)',
      'var(--blok-database-card-actions-icon)',
      'var(--blok-database-card-actions-icon)',
    ]);
  });
});
