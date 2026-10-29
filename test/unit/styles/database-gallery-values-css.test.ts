/**
 * Gallery card values (notion-spec-2 §19.17; positions read from
 * notion-live-3/gallery-cards-top.png). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(/,(?![^(]*\))/).map((part) => part.trim().replace(/\s+/g, ' ')).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

describe('gallery card values', () => {
  it('draws every option pill 18 tall with 12/18 text, status included', () => {
    const body = ruleBody('[data-blok-database-gallery-property] [data-blok-database-option-pill]');

    expect(body).toMatch(/height:\s*18px/);
    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/line-height:\s*18px/);
  });

  it('sets the checkbox name 6px after the box, 12/14', () => {
    expect(ruleBody('[data-blok-database-gallery-property] > [data-blok-database-cell="checkbox"]')).toMatch(/gap:\s*var\(--blok-space-1-5\)/);
    const name = ruleBody('[data-blok-database-checkbox-name]');

    expect(name).toMatch(/font-size:\s*12px/);
    expect(name).toMatch(/line-height:\s*14px/);
  });
});
