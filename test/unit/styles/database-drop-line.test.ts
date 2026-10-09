/**
 * The database drop line uses the measured Notion values (research/08):
 * a 4px line in rgba(35,131,226,0.43) that fades over 200ms.
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const database = read('database.css');

const ruleBody = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`));

  return match?.[1] ?? '';
};

describe('database drop line css', () => {
  it('shares the table view measured drop-line token, light and dark', () => {
    expect(database).toContain('--blok-database-drop-line: var(--blok-database-table-drop-line);');
    expect([ ...database.matchAll(/--blok-database-table-drop-line: ([^;]+);/g) ].map((m) => m[1].trim()))
      .toEqual(['rgba(35, 131, 226, 0.43)', 'rgba(35, 131, 226, 0.43)', 'rgba(35, 131, 226, 0.43)']);
  });

  it('paints the line with the token and fades its opacity over 200ms', () => {
    const body = ruleBody(database, '[data-blok-database-drop-line]');

    expect(body).toContain('background-color: var(--blok-database-drop-line, rgba(35, 131, 226, 0.43))');
    expect(body).toContain('transition: opacity 200ms');
  });

  it('tints the card being dragged like a hovered card', () => {
    expect(ruleBody(database, '[data-blok-database-card][data-blok-database-drag-source]'))
      .toContain('background-color: var(--blok-database-card-bg-hover)');
  });
});
