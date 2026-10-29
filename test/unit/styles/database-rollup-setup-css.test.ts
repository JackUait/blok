/**
 * The rollup setup menu (notion-spec-2 §20.11, §18.3; positions read from
 * notion-live-3/rollup-editor.png). jsdom has no CSS, so these read the source.
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

const MENU = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-rollup-setup'] > [data-blok-popover-container]";

describe('rollup setup menu look', () => {
  it('is at least 180 wide', () => {
    expect(ruleBody(MENU)).toMatch(/min-width:\s*180px/);
  });

  it('labels each section 12/14.4, weight 500, in secondary ink, 12px in', () => {
    const body = ruleBody(`${MENU} [data-blok-database-rollup-setup-label]`);

    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/line-height:\s*14\.4px/);
    expect(body).toMatch(/font-weight:\s*500/);
    expect(body).toMatch(/color:\s*var\(--blok-database-ink-secondary\)/);
    expect(body).toMatch(/padding:\s*var\(--blok-space-1-5\) var\(--blok-space-2\) 10px/);
  });

  it('insets the rule between sections 12px from each side, 8px under the row', () => {
    const body = ruleBody(`${MENU} > [data-blok-popover-items] > [data-blok-popover-item-separator]`);

    expect(body).toMatch(/padding:\s*var\(--blok-space-2\) var\(--blok-space-2\) var\(--blok-space-1-5\)/);
  });
});
