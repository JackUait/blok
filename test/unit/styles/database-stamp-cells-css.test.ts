/**
 * Created time, Last edited time, Created by, Last edited by look
 * (notion-spec-2 §20.1, §20.2). jsdom has no layout, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => ({
  selectors: (match[1] ?? '').split(/,(?![^(]*\))/).map((part) => part.trim().replace(/\s+/g, ' ')),
  body: match[2] ?? '',
}));

/** Body of every rule whose selector list holds `selector`, joined. */
const ruleBody = (selector: string): string =>
  rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(';');

/** Index of the last rule holding `selector`: a later rule of equal weight wins. */
const lastIndex = (selector: string): number =>
  rules.reduce((found, rule, index) => (rule.selectors.includes(selector) ? index : found), -1);

const TIME = ':is([data-blok-database-cell="createdTime"], [data-blok-database-cell="lastEditedTime"])';
const BY = ':is([data-blok-database-cell="createdBy"], [data-blok-database-cell="lastEditedBy"])';

describe('time and "by" cells', () => {
  it('cuts a long time in a table cell without wrapping, even in a wrapped column', () => {
    const selector = `[data-blok-database-table-cell] > [data-blok-database-cell]${TIME}`;

    expect(ruleBody(selector)).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody(selector)).toMatch(/flex-wrap:\s*nowrap/);
    // Same weight as the wrap rule, so it must come after it.
    expect(lastIndex(selector)).toBeGreaterThan(lastIndex('[data-blok-database-table-cell][data-wrap] > [data-blok-database-cell]'));
  });

  it('keeps a time on one line on a gallery card', () => {
    expect(ruleBody(`[data-blok-database-gallery-property] > [data-blok-database-cell]${TIME}`)).toMatch(/white-space:\s*nowrap/);
  });

  it('ends a long "by" name in an ellipsis', () => {
    const chip = ruleBody(`${BY} > [data-blok-database-person-chip]`);

    expect(chip).toMatch(/display:\s*block/);
    expect(chip).toMatch(/overflow:\s*hidden/);
    expect(chip).toMatch(/text-overflow:\s*ellipsis/);
    expect(chip).toMatch(/max-width:\s*100%/);
    expect(ruleBody(BY)).toMatch(/max-width:\s*100%/);
  });

  it('keeps the 6px gap after the avatar once the chip is a block', () => {
    const avatar = ruleBody(`${BY} > [data-blok-database-person-chip] > :is([data-blok-database-person-avatar], [data-blok-database-person-initial])`);

    expect(avatar).toMatch(/margin-inline-end:\s*var\(--blok-space-1-5\)/);
    expect(avatar).toMatch(/display:\s*inline-flex/);
  });

  it('draws an 18px avatar on a gallery card', () => {
    const avatar = ruleBody(`[data-blok-database-gallery-property] ${BY} :is([data-blok-database-person-avatar], [data-blok-database-person-initial])`);

    expect(avatar).toMatch(/width:\s*18px/);
    expect(avatar).toMatch(/height:\s*18px/);
  });
});
