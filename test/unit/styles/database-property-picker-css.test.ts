/**
 * The Filter and Sort property pickers (notion-motion.md Round 5, filter-field.png).
 * jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const rulesFor = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|\})\s*([^{}@]+)\{([^{}]*)\}/g) ]
    .filter((match) => match[1].split(',').some((part) => part.trim() === selector))
    .map((match) => match[2])
    .join(' ');

describe('database property picker css', () => {
  it('a panel field never shrinks below its 28px when a long list fills the panel', () => {
    expect(rulesFor('[data-blok-database-panel-input]')).toContain('flex-shrink: 0');
  });

  it('only the property list scrolls, so the search and the footer stay in view', () => {
    const list = rulesFor('[data-blok-database-picker-list]');

    expect(list).toContain('min-height: 0');
    expect(list).toContain('overflow-y: auto');
    expect(list).toContain('flex: 1 1 auto');
  });

  it('the picker search keeps 28px and its text inset, and takes the shared field look on focus', () => {
    const rest = rulesFor('[data-blok-database-picker-search]');
    const focused = rulesFor('input[data-blok-database-picker-search]:focus');

    expect(rest).toContain('border: var(--blok-border-width-hairline) solid transparent');
    expect(rest).toContain('padding-block: calc(var(--blok-space-0-75) - var(--blok-border-width-hairline))');
    expect(rest).toContain('padding-inline: calc(var(--blok-space-1-5) - var(--blok-border-width-hairline))');
    expect(focused).toContain('border-color: var(--blok-database-table-control-border)');
    expect(focused).toContain('background-color: transparent');
    expect(focused).not.toMatch(/box-shadow|outline: [^n]/);
  });
});
