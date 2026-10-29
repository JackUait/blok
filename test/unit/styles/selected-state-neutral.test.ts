import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

/**
 * Selected states are gray, never blue (CLAUDE.md "No blue selected states").
 * These tokens paint every selected popover item, active inline tool button
 * and the find bar's options button, so their defaults decide the whole editor.
 */

const css = readMainCss();

/** The keyboard cursor fill counts as selected too: Notion paints it gray. */
const SELECTED_FILLS = ['--blok-icon-active-bg', '--blok-popover-icon-active-bg', '--blok-item-focus-bg', '--blok-item-focus-shadow', '--blok-database-card-border-active', '--blok-database-table-cell-ring', '--blok-selection-inactive'];

const declarations = (token: string, source = css): string[] =>
  [...source.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map(match => match[1].trim());

const hasNeutralFills = (token: string, source = css): boolean => {
  const values = declarations(token, source);

  return values.length > 0 && values.every(value => {
    const alias = value.match(/^var\((--[\w-]+)\)$/)?.[1];
    const paints = alias === undefined ? [value] : declarations(alias, source);

    return paints.length > 0 && paints.every(paint => {
      if (paint === 'transparent') return true;
      const channels = paint.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/);

      if (channels === null) return false;
      const [r, g, b] = channels.slice(1).map(Number);

      return Math.max(r, g, b) - Math.min(r, g, b) <= 10;
    });
  });
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('selected-state fill parser', () => {
  it.each([
    { name: 'a blue literal', source: ':root { --selected: rgb(0, 0, 255); }' },
    { name: 'a direct alias whose neutral fallback hides a blue target', source: ':root { --selected: var(--blue, rgb(55, 53, 47)); --blue: rgb(0, 0, 255); }' },
    { name: 'a blue alias target in one theme', source: ':root { --selected: var(--target); --target: rgba(55, 53, 47, 0.08); } [data-theme="dark"] { --target: rgb(0, 0, 255); }' },
    { name: 'a missing alias target', source: ':root { --selected: var(--missing); }' },
    { name: 'a nested alias', source: ':root { --selected: var(--first); --first: var(--second); --second: rgb(55, 53, 47); }' },
    { name: 'a nested alias whose neutral fallback hides a blue target', source: ':root { --selected: var(--first); --first: var(--blue, rgb(55, 53, 47)); --blue: rgb(0, 0, 255); }' },
    { name: 'a cyclic alias', source: ':root { --selected: var(--first); --first: var(--second); --second: var(--first); }' },
  ])('rejects $name', ({ source }) => {
    expect(hasNeutralFills('--selected', source)).toBe(false);
  });

  it.each([
    { name: 'neutral literals in light and dark themes', source: ':root { --selected: rgba(55, 53, 47, 0.08); } [data-theme="dark"] { --selected: rgba(255, 255, 255, 0.055); }' },
    { name: 'neutral alias targets in light and dark themes', source: ':root { --selected: var(--target); --target: rgba(55, 53, 47, 0.08); } [data-theme="dark"] { --target: rgba(255, 255, 255, 0.055); }' },
    { name: 'transparent', source: ':root { --selected: transparent; }' },
  ])('accepts $name', ({ source }) => {
    expect(hasNeutralFills('--selected', source)).toBe(true);
  });
});

describe('selected-state tokens are neutral', () => {
  it.each(SELECTED_FILLS)('%s is a gray fill in every theme', (token) => {
    const values = declarations(token);

    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(hasNeutralFills(token), `${token}: ${values.join(', ')}`).toBe(true);
  });

  it('--blok-icon-active-text is the primary ink in every theme', () => {
    const values = declarations('--blok-icon-active-text');

    expect(values.length).toBeGreaterThanOrEqual(3);
    // Database surfaces re-set it to their own primary ink (Notion's 44,44,43), never a colour.
    values.forEach(value => expect(['var(--blok-text-primary)', 'var(--blok-database-ink)']).toContain(value));
  });

  it('the public settingsButtonActive class paints primary ink on a gray fill', () => {
    const rule = css.match(/@utility blok-settings-button--active\s*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('text-icon-active-text');
    expect(rule?.[1]).toContain('bg-icon-active-bg');
    expect(rule?.[1]).not.toContain('active-icon;');
  });

  it('the text Ask AI works on keeps a gray selection tint', () => {
    const rule = css.match(/::highlight\(blok-assistant-selection\)\s*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('background-color: var(--blok-selection-inactive)');
  });

  it('the find options button marks an active option with the gray tokens', () => {
    const rule = css.match(/\[data-blok-find-options\]\[data-blok-find-options-active\][^{]*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('background: var(--blok-popover-icon-active-bg)');
    expect(rule?.[1]).toContain('color: var(--blok-icon-active-text)');
  });

  it('a feed card marks your own reaction with the gray tokens, not Notion\'s blue', () => {
    const rule = css.match(/\[data-blok-database-feed-reaction\]\[data-mine\]\s*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('background-color: var(--blok-icon-active-bg)');
    expect(rule?.[1]).toContain('color: var(--blok-icon-active-text)');
    // The same ink as someone else's pill: the database primary ink.
    expect(css.match(/\[data-blok-database-feed-reaction\]\s*\{([^}]*)\}/)?.[1]).toContain('color: var(--blok-database-ink)');
  });

  it('the row open in the side peek is ringed in primary ink, not Notion\'s blue', () => {
    const rule = css.match(/\[data-blok-database-table-row\]:has\([^{]*\[data-peeked\]\)::before\s*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('box-shadow: inset 0 0 0 1px var(--blok-icon-active-text)');
    expect(rule?.[1]).not.toMatch(/rgb|#[0-9a-f]{3,6}/i);
  });

  it('an on day chip in Edit cadence is gray with primary ink, not Notion\'s blue', () => {
    const rule = css.match(/\[data-blok-database-template-cadence-days\] button\[aria-pressed="true"\]\s*\{([^}]*)\}/);

    expect(rule?.[1]).toContain('background-color: var(--blok-icon-active-bg)');
    expect(rule?.[1]).toContain('color: var(--blok-icon-active-text)');
  });
});
