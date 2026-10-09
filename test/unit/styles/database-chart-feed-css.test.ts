/**
 * Chart and feed look: the feed's measured Notion values (research/08), the
 * chart's validated palette, tokens kept out of colors.css, keyboard-only
 * rings and reduced motion. jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');
const chartSource = readFileSync(resolve(__dirname, '../../../src/tools/database/database-chart-view.ts'), 'utf8');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

const HUES = ['blue', 'orange', 'teal', 'yellow', 'pink', 'green', 'purple', 'red', 'gray'];
const TOKENS = [
  ...HUES.map((hue) => `--blok-database-chart-${hue}`),
  '--blok-database-feed-card-bg',
  '--blok-database-feed-card-shadow',
];

describe('database chart and feed styles', () => {
  it.each(TOKENS)('%s is defined for light, system dark and forced dark, and not in colors.css', (token) => {
    expect(css.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBe(3);
    expect(colors).not.toContain(`${token}:`);
  });

  it.each(HUES)('the %s chart fallback in the renderer matches the light token', (hue) => {
    const light = new RegExp(`--blok-database-chart-${hue}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1];
    const fallback = new RegExp(`${hue}: '(#[0-9a-f]{6})'`).exec(chartSource)?.[1];

    expect(fallback).toBe(light);
  });

  it('uses the measured feed card: 692 wide, 16px padding, 12px radius, two-layer shadow, 26px title', () => {
    expect(ruleBody('[data-blok-database-feed-card]')).toMatch(/max-inline-size:\s*692px/);
    expect(ruleBody('[data-blok-database-feed-card]')).toContain('padding: var(--blok-space-4)');
    // Measured 12px: the dialog role is the 12px step of the radius scale.
    expect(ruleBody('[data-blok-database-feed-card]')).toContain('border-radius: var(--blok-radius-dialog)');
    expect(ruleBody('[data-blok-database-feed-card]')).toContain('box-shadow: var(--blok-database-feed-card-shadow)');
    expect(css).toMatch(/--blok-database-feed-card-shadow:\s*rgba\(0, 0, 0, 0\.02\) 0 12px 32px, rgba\(0, 0, 0, 0\.05\) 0 0 0 1px/);
    expect(ruleBody('[data-blok-database-feed-title]')).toMatch(/font-size:\s*26px/);
    expect(ruleBody('[data-blok-database-feed-title]')).toMatch(/font-weight:\s*600/);
    expect(ruleBody('[data-blok-database-feed-author]')).toMatch(/font-weight:\s*500/);
  });

  it('marks a turned-off legend entry with muted ink, never a fill', () => {
    const off = ruleBody('[data-blok-database-chart-legend-entry][aria-pressed="false"]');

    expect(off).toContain('color: var(--blok-database-table-muted-text)');
    expect(off).not.toMatch(/background/);
  });

  it('rings chart, legend, drilldown and feed controls only after keyboard use', () => {
    for (const selector of ['[data-blok-database-chart-hit]', '[data-blok-database-chart-legend-entry]', '[data-blok-database-drilldown-close]', '[data-blok-database-feed-title]']) {
      expect(css).toContain(`${selector}:focus-visible:where(:root:not([data-blok-modality="pointer"]) *)`);
    }
  });

  it('drops the drilldown fade for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\[data-blok-database-drilldown\]\s*\{\s*animation: none;/);
  });
});
