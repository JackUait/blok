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

  // notion-motion.md "Board column (group) drag" and the pixels of colgroupdrag-mid.png.
  it('draws the dragged group header opaque, on its column tint over the page, with its buttons shown', () => {
    const ghost = ruleBody(database, '[data-blok-database-column-ghost]');

    expect(ghost).toContain('box-sizing: border-box');
    expect(ghost).toContain('background: linear-gradient(var(--_blok-group-tint, var(--blok-database-column-bg)), var(--_blok-group-tint, var(--blok-database-column-bg))), var(--blok-bg-primary)');
    expect(ghost).not.toMatch(/opacity|box-shadow/);
    expect(ruleBody(database, '[data-blok-database-column-ghost] [data-blok-database-column-actions]')).toContain('opacity: 1');
  });

  it('hides the dragged header in its slot and slides the others over 200ms ease, each on its own tint', () => {
    expect(ruleBody(database, '[data-blok-database-drag-source] > [data-blok-database-column-header]')).toContain('visibility: hidden');
    expect(ruleBody(database, '[data-blok-database-column-reordering] [data-blok-database-column-header]')).toContain('transition: transform 200ms ease');
    expect(ruleBody(database, '[data-blok-database-column-sliding]')).toContain('background-color: var(--_blok-group-tint, var(--blok-database-column-bg))');
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\[data-blok-database-column-reordering\] \[data-blok-database-column-header\][^{]*\{ transition: none;/);
  });

  it('drops the card-image rule the old whole-column ghost needed', () => {
    expect(database).not.toContain('[data-blok-database-column-ghost][data-fit-image]');
  });

  // notion-motion.md "Board": the dragged card turns rgba(55,53,47,0.06) in light. Dark is unmeasured, so it keeps the hover.
  it('fills the card being dragged with the neutral drag fill in light, the hover fill in dark', () => {
    expect(ruleBody(database, '[data-blok-database-card][data-blok-database-drag-source]'))
      .toContain('background-color: var(--blok-database-card-drag-source-bg, var(--_blok-group-card-hover, var(--blok-database-card-bg-hover)))');
    expect([ ...database.matchAll(/--blok-database-card-drag-source-bg: ([^;]+);/g) ].map((m) => m[1].trim()))
      .toEqual(['rgba(55, 53, 47, 0.06)', 'initial', 'initial']);
  });
});
