/**
 * A date with a reminder (research/21 §6). jsdom has no CSS, so these read the source.
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

describe('database date reminder css', () => {
  // The base cell is a wrapping flex box: in a narrow card or timeline column the alarm
  // would drop to its own line, or the date would split and clip.
  it('keeps the date and its alarm on one inline line in every view', () => {
    const date = rulesFor('[data-blok-database-cell="date"][data-reminder]');

    expect(date).toContain('display: inline');
    expect(date).toContain('white-space: nowrap');
    expect(date).toContain('color: var(--blok-color-accent)');
  });
});
