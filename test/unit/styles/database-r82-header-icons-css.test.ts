/**
 * notion-motion.md Round 41 (icons and empty states). jsdom has no CSS, so these read the source.
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

describe('database Round 41 small chevrons', () => {
  // Keyline's chevron is 8.25 x 4.75 units of ink; 28px draws it 11.55 x 6.65 (Notion 12 x 6.5).
  it('draws the peek row steps at Notion size', () => {
    const body = ruleBody('[data-blok-database-peek-prev] svg, [data-blok-database-peek-next] svg');

    expect(body).toContain('width: 28px');
    expect(body).toContain('height: 28px');
    expect(body).toContain('flex: none');
    // The 24px button caps an svg at max-height 100%, which would shrink the drawing back.
    expect(body).toContain('max-height: none');
  });

  it('draws the calendar month arrows at Notion size', () => {
    const body = ruleBody('[data-blok-database-calendar-nav] [data-blok-database-calendar-prev] svg, [data-blok-database-calendar-nav] [data-blok-database-calendar-next] svg');

    expect(body).toContain('inline-size: 28px');
    expect(body).toContain('block-size: 28px');
    expect(body).toContain('flex: none');
    expect(body).toContain('max-block-size: none');
  });

  // 24px draws it 9.9 x 5.7 (Notion 10 x 6).
  it('draws the New menu chevron at Notion size', () => {
    const body = ruleBody('[data-blok-database-new] svg');

    expect(body).toContain('width: 24px');
    expect(body).toContain('height: 24px');
    expect(body).toContain('flex: none');
  });
});
