/**
 * Cell display and editor styles. jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const database = strip(readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8'));
const colors = strip(readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8'));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every declaration of `name` in top-level rules whose selector list holds exactly `selector`. */
const declared = (selector: string, name: string): string[] =>
  [...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .flatMap((rule) => [...rule[2].matchAll(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`, 'g'))].map((m) => m[1].trim()));

describe('cell editor CSS', () => {
  it('a selected option row has no fill of its own and keeps the unselected ink', () => {
    expect(declared('[data-blok-database-select-option][aria-selected="true"]', 'background-color')).toEqual([]);
    expect(declared('[data-blok-database-select-option][aria-selected="true"]', 'color')).toEqual([]);
    expect(declared('[data-blok-database-select-option]', 'color')).toEqual(['var(--blok-text-primary)']);
    expect(declared('[data-blok-database-select-option-check]', 'color')).toEqual(['var(--blok-icon-active-text)']);
  });

  it('the picked day is a gray fill with primary ink, never blue', () => {
    expect(declared('[data-blok-database-date-day][aria-selected="true"]', 'background-color')).toEqual(['var(--blok-icon-active-bg)']);
    expect(declared('[data-blok-database-date-day][aria-selected="true"]', 'color')).toEqual(['var(--blok-icon-active-text)']);
  });

  it('pills are 20px with the small control radius, as measured in Notion', () => {
    expect(declared('[data-blok-database-option-pill]', 'height')).toEqual(['20px']);
    expect(declared('[data-blok-database-option-pill]', 'padding')).toEqual(['0 var(--blok-space-1-5)']);
    expect(declared('[data-blok-database-option-pill]', 'border-radius')).toEqual(['var(--blok-radius-control-sm)']);
  });

  it.each(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])(
    'defines the %s option tokens in the light and both dark blocks',
    (color) => {
      expect([...database.matchAll(new RegExp(`--blok-database-option-${color}-bg:`, 'g'))]).toHaveLength(3);
      expect([...database.matchAll(new RegExp(`--blok-database-option-${color}-text:`, 'g'))]).toHaveLength(3);
    }
  );

  it.each(['checkbox-border', 'checkbox-check', 'today'])('defines --blok-database-%s in the light and both dark blocks', (token) => {
    expect([...database.matchAll(new RegExp(`--blok-database-${token}:`, 'g'))]).toHaveLength(3);
  });

  it('uses the measured light values for a measured color', () => {
    expect(database).toContain('--blok-database-option-blue-bg: rgba(0, 118, 217, 0.204);');
    expect(database).toContain('--blok-database-option-blue-text: rgb(38, 74, 114);');
  });

  // view.css copies every token in colors.css and has a byte budget. The view
  // renders a database bare, so these stay in database.css, which it skips.
  it('keeps the cell tokens out of colors.css', () => {
    expect(colors).not.toMatch(/--blok-database-(?:option-|checkbox-|today)/);
  });

  it('drops every editor transition under reduced motion', () => {
    const blocks = [...database.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]);
    const reduced = (selector: string): boolean => blocks.some((block) => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .some((rule) => rule[1].split(',').map((s) => s.trim()).includes(selector) && /transition: none/.test(rule[2])));

    ['[data-blok-database-checkbox]', '[data-blok-database-switch-track]', '[data-blok-database-switch-track] > span',
      '[data-blok-database-select-option-handle]', '[data-blok-database-select-option-menu]']
      .forEach((selector) => expect(reduced(selector), selector).toBe(true));
  });
});
