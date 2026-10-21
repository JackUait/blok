/**
 * Up/down chevron in select-like fields: Notion's glyph is about 9x13 px
 * (research/31 §5a, research/12 §4), and IconChevronUpDown is drawn 1:1 for
 * a 20px box. jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of every rule whose selector list holds `selector`, joined. */
const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

describe('database up/down chevron styles', () => {
  it('draws the CSV Import Location chevron in a 20px box', () => {
    const body = ruleBody('[data-blok-database-csv-location] > [data-blok-database-csv-select-chevron] svg');

    expect(body).toMatch(/width:\s*20px/);
    expect(body).toMatch(/height:\s*20px/);
  });

  it('puts the form Dropdown chevron at the end of the box, 20px, in faint ink', () => {
    expect(ruleBody('[data-blok-database-form-dropdown]')).toMatch(/display:\s*flex/);
    expect(ruleBody('[data-blok-database-form-dropdown-chevron]')).toMatch(/margin-inline-start:\s*auto/);
    expect(ruleBody('[data-blok-database-form-dropdown-chevron]')).toMatch(/color:\s*var\(--blok-text-tertiary\)/);
    expect(ruleBody('[data-blok-database-form-dropdown-chevron] svg')).toMatch(/width:\s*20px/);
    expect(ruleBody('[data-blok-database-form-dropdown-chevron] svg')).toMatch(/height:\s*20px/);
  });
});
