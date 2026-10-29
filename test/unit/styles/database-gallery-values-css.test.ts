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

  // notion-spec-2 §21.4 (E8-gallery.png): 14x14, and no border once checked.
  it('draws the card checkbox 14x14 with no border once checked', () => {
    const box = ruleBody('[data-blok-database-gallery-property] [data-blok-database-checkbox]');

    expect(box).toMatch(/width:\s*14px/);
    expect(box).toMatch(/height:\s*14px/);
    expect(ruleBody('[data-blok-database-gallery-property] [data-blok-database-checkbox][data-state="checked"]')).toMatch(/border-width:\s*0/);
  });

  // notion-spec-2 §21.4 (E8-peek-A.png): the side peek's checked box has no border either.
  it('draws the side peek checkbox with no border once checked', () => {
    expect(ruleBody('[data-blok-database-drawer-prop-value] [data-blok-database-checkbox][data-state="checked"]')).toMatch(/border-width:\s*0/);
  });

  // notion-spec-2 §22.1 (A-gallery.png): an unwrapped card URL stays on one line; the card clips a long host.
  // notion-spec-2 §19.16, §19.17, §20.2: every person avatar on a gallery card is 18x18, Person included.
  it('draws every card person avatar 18x18', () => {
    const body = ruleBody('[data-blok-database-gallery-property] :is([data-blok-database-person-avatar], [data-blok-database-person-initial])');

    expect(body).toMatch(/width:\s*18px/);
    expect(body).toMatch(/height:\s*18px/);
  });

  // notion-spec-2 §21.1 (E8-gallery.png): "Wrap all content" is OFF on a new gallery, so a long value stays on one line, cut at the card edge.
  it('keeps every unwrapped card value on one line, links included', () => {
    expect(ruleBody('[data-blok-database-gallery-property]:not([data-wrap="true"]) > [data-blok-database-cell]')).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody('[data-blok-database-gallery-property]:not([data-wrap="true"]) > [data-blok-database-cell] [data-blok-database-cell-link]')).toMatch(/white-space:\s*nowrap/);
  });
});
