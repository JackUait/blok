/**
 * A big table's cells must not all be styled and laid out at once. jsdom has
 * no CSS cascade, so this reads the stylesheet.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/tables.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const bodiesOf = (selector: string): string[] => Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
  .filter(match => (match[1] ?? '').replace(/\s+/g, ' ').trim() === selector)
  .map(match => (match[2] ?? '').replace(/\s+/g, ' '));

describe('table cells off screen', () => {
  it('skips rendering a cell\'s blocks until the cell nears the screen', () => {
    const body = bodiesOf('[data-blok-table-cell-blocks]').join(' ');

    expect(body).toMatch(/content-visibility:\s*auto/);
    // `auto` keeps the size the cell last rendered at; 1.6em is an empty paragraph's
    // height, so a never-shown empty row is as tall as a shown one.
    expect(body).toMatch(/contain-intrinsic-size:\s*auto\s+1\.6em/);
  });
});
