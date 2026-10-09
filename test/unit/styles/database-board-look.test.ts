/**
 * The board matches the measured Notion values (research/08 "Board").
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

describe('board column header actions', () => {
  it('draws the "+" and "⋯" header buttons 24px square', () => {
    const body = ruleBody(database, '[data-blok-database-column-actions] button');

    expect(body).toContain('width: 24px');
    expect(body).toContain('height: 24px');
  });

  it('shows them only while the header is hovered, or holds focus or an open menu', () => {
    expect(ruleBody(database, '[data-blok-database-column-actions]')).toContain('opacity: 0');
    expect(ruleBody(database, '[data-blok-database-column-header]:hover [data-blok-database-column-actions]')).toContain('opacity: 1');
    expect(ruleBody(database, '[data-blok-database-column-actions]:focus-within')).toContain('opacity: 1');
  });

  it('pushes them to the inline end of the header', () => {
    expect(ruleBody(database, '[data-blok-database-column-actions]')).toContain('margin-inline-start: auto');
  });
});
