/**
 * The database title placeholder ("New database") takes a warm gray from
 * Notion's ink, not Blok's slate secondary text. Notion's own value,
 * rgba(55, 53, 47, 0.15), fails AA, so the light value is the nearest step on
 * that ink that passes AA for large text (the title is 24px/600: 3:1).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const tokenValues = (name: string): string[] =>
  [...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))].map((m) => m[1].trim());

const channel = (v: number): number => {
  const s = v / 255;

  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (rgb: number[]): number => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
const contrast = (a: number[], b: number[]): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (value: string): number[] => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);

describe('database title placeholder ink', () => {
  it('paints the placeholder with its own token', () => {
    expect(database).toMatch(/\[data-blok-database-title\]\[data-placeholder\]::before \{[^}]*color: var\(--blok-database-title-placeholder\)/);
  });

  it('is a warm gray that passes large-text AA on the light page and the dark pages', () => {
    const [light, ...dark] = tokenValues('--blok-database-title-placeholder');

    expect(dark).toHaveLength(2);
    // Notion's value fails; the light step must not.
    expect(contrast([225, 225, 224], [255, 255, 255])).toBeLessThan(3);
    expect(contrast(rgb(light), [255, 255, 255])).toBeGreaterThanOrEqual(3);
    // Warm: more red than blue, like Notion's rgb(55, 53, 47) ink.
    expect(rgb(light)[0]).toBeGreaterThan(rgb(light)[2]);
    for (const value of dark) {
      expect(rgb(value)[0]).toBeGreaterThan(rgb(value)[2]);
      expect(contrast(rgb(value), [29, 29, 28])).toBeGreaterThanOrEqual(3);
      expect(contrast(rgb(value), [25, 25, 25])).toBeGreaterThanOrEqual(3);
    }
  });
});
