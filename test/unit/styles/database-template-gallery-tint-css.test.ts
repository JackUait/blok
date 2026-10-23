/**
 * Template gallery cards take their tint as Notion's do (findings-creation
 * N06, N07). jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

const TINTS = ['green', 'blue', 'gray', 'red', 'orange', 'yellow', 'purple', 'pink'];

describe('template gallery card tints', () => {
  it('names each card tint once, as a variable', () => {
    for (const tint of TINTS) {
      expect(ruleBody(`[data-blok-database-tpl-gallery-card][data-tint="${tint}"]`), tint)
        .toContain(`--blok-database-tpl-card-tint: var(--blok-database-starter-tile-${tint}-ink)`);
    }
  });

  it('draws a tinted border, a light tinted fill and dark tinted ink', () => {
    const card = ruleBody('[data-blok-database-tpl-gallery-card][data-tint]');

    expect(card).toMatch(/border-color: color-mix\(in srgb, var\(--blok-database-tpl-card-tint\)/);
    expect(card).toMatch(/background-color: color-mix\(in srgb, var\(--blok-database-tpl-card-tint\)/);
    expect(card).toMatch(/color: color-mix\(in srgb, var\(--blok-database-tpl-card-tint\)/);
  });

  it('keeps the tinted border on hover and deepens the fill', () => {
    const hover = ruleBody('[data-blok-database-tpl-gallery-card][data-tint]:hover');

    expect(hover).toMatch(/border-color: color-mix\(in srgb, var\(--blok-database-tpl-card-tint\)/);
    expect(hover).toMatch(/background-color: color-mix\(in srgb, var\(--blok-database-tpl-card-tint\)/);
  });

  it('writes the description in the card ink, not gray', () => {
    expect(ruleBody('[data-blok-database-tpl-gallery-card][data-tint] [data-blok-database-tpl-gallery-card-text]')).toContain('color: inherit');
  });

  it('colours the preview title glyph with the tint (N07)', () => {
    expect(ruleBody('[data-blok-database-tpl-gallery-thumb-title] [data-blok-database-tpl-gallery-glyph]'))
      .toContain('color: var(--blok-database-tpl-card-tint');
  });
});
