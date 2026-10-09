/**
 * Database motion must stand down under prefers-reduced-motion.
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** The inner text of every reduced-motion block. Its rules hold no nested braces. */
const reducedMotionBlocks = (): string[] =>
  [ ...source.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ]
    .map((match) => match[1]);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The last value of `name` across rules whose selector list contains `selector`. */
const reducedProp = (selector: string, name: string): string | null => {
  const values = reducedMotionBlocks()
    .flatMap((block) => [ ...block.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ])
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2].match(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`)))
    .filter((match) => match !== null)
    .map((match) => match[1].trim());

  return values.at(-1) ?? null;
};

describe('database.css under prefers-reduced-motion', () => {
  it('drops the drawer width slide', () => {
    expect(reducedProp('[data-blok-database-drawer]', 'transition')).toBe('none');
  });

  it.each([
    '[data-blok-database-dragging] [data-blok-database-card]',
    '[data-blok-database-dragging] [data-blok-database-cards]',
    '[data-blok-database-column-reordering] [data-blok-database-column]',
    '[data-blok-database-column-reordering] [data-blok-database-board]',
  ])('drops the drag displacement glide on %s', (selector) => {
    expect(reducedProp(selector, 'transition')).toBe('none');
  });

  it('drops the property popover entrance animation', () => {
    expect(reducedProp('[data-blok-database-property-type-popover]', 'animation')).toBe('none');
  });
});
