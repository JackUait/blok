/**
 * notion-motion.md Round 41 Part A: the side peek's » is 12 x 12 of ink in Notion.
 * jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = database.match(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`));

  return match?.[1] ?? '';
};

describe('side peek close glyph size', () => {
  // Keyline's » is 8.75 x 8.25 units of ink; 28px draws it 12.25 x 11.55.
  it('draws the side peek » at 28px', () => {
    const body = ruleBody('[data-peek-mode="side"] [data-blok-database-drawer-close] svg');

    expect(body).toContain('width: 28px');
    expect(body).toContain('height: 28px');
    expect(body).toContain('flex: none');
    expect(body).toContain('max-height: none');
  });

  // The full page's ‹ shares the button and was not measured.
  it('keeps the button glyph at 20px outside the side peek', () => {
    const body = ruleBody('[data-blok-database-drawer-close] svg');

    expect(body).toContain('width: 20px');
    expect(body).toContain('height: 20px');
  });
});

// notion-motion.md Round 56 §1 and r66-n-headers.raw: each 1x14 rule sits 8 from the buttons beside it
// (side: Open 794, rule 826, Switch 835, Previous 876), so a button step across a rule is 41.
describe('peek header rules', () => {
  it('spaces each rule 6px inside the toolbar\'s 2px gap', () => {
    expect(ruleBody('[data-blok-database-drawer-toolbar]')).toContain('gap: var(--blok-space-0-5)');
    expect(ruleBody('[data-blok-database-peek-separator]')).toContain('margin-inline: var(--blok-space-1-5)');
  });
});
