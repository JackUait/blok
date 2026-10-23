/**
 * The row comment badge (research/12 §3). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** Every declaration block whose selector list names `selector`. */
const rulesFor = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|\})\s*([^{}@]+)\{([^{}]*)\}/g) ]
    .filter((match) => match[1].split(',').some((part) => part.trim() === selector))
    .map((match) => match[2])
    .join(' ');

describe('database comment badge css', () => {
  it('has no fill and primary ink at 12px/400, like Notion\'s badge', () => {
    const badge = rulesFor('[data-blok-database-comment-badge]');

    expect(badge).toContain('background: transparent');
    expect(badge).toContain('color: var(--blok-database-comment-badge-text)');
    expect(badge).toContain('font-size: 12px');
    expect(badge).toContain('font-weight: 400');
  });

  it('draws the glyph at 16px', () => {
    const glyph = rulesFor('[data-blok-database-comment-badge] svg');

    expect(glyph).toContain('width: 16px');
    expect(glyph).toContain('height: 16px');
  });

  // research/21 §1o: count and icon ink, light then the two dark blocks.
  it('inks the count and the icon as measured in light and dark', () => {
    const tokenValues = (name: string): string[] =>
      [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

    expect(rulesFor('[data-blok-database-comment-badge] svg')).toContain('color: var(--blok-database-comment-badge-icon)');
    expect(tokenValues('--blok-database-comment-badge-text')).toEqual(['rgb(44, 44, 43)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
    expect(tokenValues('--blok-database-comment-badge-icon')).toEqual(['rgb(142, 139, 134)', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
  });

  it('hovers with the neutral item fill, never blue', () => {
    expect(rulesFor('[data-blok-database-comment-badge]:hover')).toContain('background-color: var(--blok-database-hover-bg)');
  });

  // The list title hugs its text inside the growing title box, so the badge follows the text.
  it('sits right after a list row title', () => {
    expect(rulesFor('[data-blok-database-list-row-title]')).toContain('flex: 0 1 auto');
    expect(rulesFor('[data-blok-database-list-row-title] + [data-blok-database-comment-badge]')).toBe('');
  });
});
