/**
 * Table menu sizes (feel/findings-table T11-T27). jsdom has no CSS, so these read the source.
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

const HEADER = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-header-menu']";

describe('column header menu (T11)', () => {
  it('has 28px rows, as Notion', () => {
    expect(declared(`${HEADER} [data-blok-popover-item]`, 'height')).toEqual(['28px']);
    expect(declared(`${HEADER} [data-blok-popover-item]`, 'padding-block')).toEqual(['0']);
  });

  it('is not capped at 400px: it grows to the viewport like Notion\'s 498px menu', () => {
    expect(declared(`${HEADER} [data-blok-popover-container]`, '--max-height')).toEqual(['calc(100dvh - 2 * var(--blok-space-3))']);
  });
});
