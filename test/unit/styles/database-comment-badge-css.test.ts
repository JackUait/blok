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
    expect(badge).toContain('color: var(--blok-text-primary)');
    expect(badge).toContain('font-size: 12px');
    expect(badge).toContain('font-weight: 400');
  });

  it('draws the glyph at 16px', () => {
    const glyph = rulesFor('[data-blok-database-comment-badge] svg');

    expect(glyph).toContain('width: 16px');
    expect(glyph).toContain('height: 16px');
  });

  it('hovers with the neutral item fill, never blue', () => {
    expect(rulesFor('[data-blok-database-comment-badge]:hover')).toContain('background-color: var(--blok-item-hover-bg)');
  });

  // The list title grows to fill the row, which would push the badge to the properties.
  it('sits right after a list row title', () => {
    expect(rulesFor('[data-blok-database-list-row-title]:has(+ [data-blok-database-comment-badge])')).toContain('flex: 0 1 auto');
    expect(rulesFor('[data-blok-database-list-row-title] + [data-blok-database-comment-badge]')).toContain('margin-inline-end: auto');
  });
});
