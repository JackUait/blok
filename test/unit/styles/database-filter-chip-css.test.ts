/**
 * The filter rule popover's header buttons. jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const database = strip(readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8'));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every declaration of `name` in top-level rules whose selector list holds exactly `selector`. */
const declared = (selector: string, name: string): string[] =>
  [...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .flatMap((rule) => [...rule[2].matchAll(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`, 'g'))].map((m) => m[1].trim()));

describe('filter rule popover header', () => {
  // notion-motion.md Round 18 §2, r18-filter-one.raw: the "contains" button is 69.3×18, the ⋯ 20×20.
  it('makes the operator button 18px tall and keeps the ⋯ button at 20px', () => {
    expect(declared('[data-blok-database-chip-operator]', 'height').at(-1)).toBe('18px');
    expect(declared('[data-blok-database-chip-more]', 'height').at(-1)).toBe('20px');
  });
});
