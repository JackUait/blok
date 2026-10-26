/**
 * A formula cell with no value because of an error. jsdom has no CSS, so these read the source.
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

describe('database formula error css', () => {
  it('the warning mark is small and gray, never red or blue', () => {
    const mark = rulesFor('[data-blok-database-formula-error]');

    expect(mark).toContain('color: var(--blok-database-ink-secondary)');
    expect(mark).toContain('display: inline-flex');
    expect(rulesFor('[data-blok-database-formula-error] > svg')).toContain('width: 16px');
    expect(rulesFor('[data-blok-database-formula-error] > svg')).toContain('height: 16px');
  });
});
