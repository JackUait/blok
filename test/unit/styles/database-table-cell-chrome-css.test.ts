/**
 * Table cell chrome against Notion (notion-spec-2 §18.1, §20.1).
 * jsdom has no CSS, so these read the authored source; the computed look is
 * pinned in test/playwright/tests/database/database-table-cell-chrome.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** Every declaration block whose selector list contains `selector`, joined. */
const ruleBody = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

describe('table file chip (§18.1)', () => {
  it('keeps every file name on one line, even in a wrapping cell', () => {
    const body = ruleBody('[data-blok-database-table-cell][data-type="files"] [data-blok-database-file-chip] > [data-blok-database-cell-link]');

    expect(body).toContain('white-space: nowrap');
    expect(body).toContain('text-overflow: ellipsis');
  });
});

// notion-spec-2 §18.1: 8px padding around a 20px line keeps the 37px row (36 + 1).
describe('8px-padded table cells (§18.1)', () => {
  const PILL_LINE = '[data-blok-database-table-cell]:is([data-type="person"]) > [data-blok-database-cell]';

  it('give the value a 20px line, filled or empty', () => {
    expect(ruleBody(PILL_LINE)).toContain('min-height: 20px');
  });

  it('draw a 20px person chip, as Notion\'s 85.9x20 chip box', () => {
    expect(ruleBody(`${PILL_LINE} > [data-blok-database-person-chip]`)).toContain('height: 20px');
  });
});
