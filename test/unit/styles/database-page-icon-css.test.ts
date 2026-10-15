/**
 * Page icon sizes in the calendar, timeline and feed, measured in Notion
 * (research/16 §2). jsdom has no CSS, so these read the source.
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

const ICON = '[data-blok-database-page-icon]';

describe('database page icon sizes', () => {
  it.each([
    { name: 'calendar', parent: '[data-blok-database-calendar-event]', box: '14px', glyph: '12.6px', gap: 'calc(var(--blok-space-0-75) - var(--blok-space-1-5))' },
    { name: 'timeline', parent: '[data-blok-database-timeline-bar]', box: '20px', glyph: '18px', gap: '0' },
    { name: 'feed', parent: '[data-blok-database-feed-head]', box: '26px', glyph: '23.4px', gap: '0' },
  ])('$name: $box box, $glyph glyph, measured gap to the title', ({ parent, box, glyph, gap }) => {
    const body = ruleBody(`${parent} > ${ICON}`);

    expect(body).toMatch(new RegExp(`inline-size:\\s*${box.replace('.', '\\.')}`));
    expect(body).toMatch(new RegExp(`block-size:\\s*${box.replace('.', '\\.')}`));
    expect(body).toMatch(new RegExp(`font-size:\\s*${glyph.replace('.', '\\.')}`));
    expect(body).toMatch(new RegExp(`line-height:\\s*${glyph.replace('.', '\\.')}`));
    expect(body).toContain(`margin-inline-end: ${gap}`);
    expect(body).toMatch(/flex:\s*none/);
  });

  it('the parents keep the gaps the icon margins assume', () => {
    expect(ruleBody('[data-blok-database-calendar-event]')).toContain('gap: var(--blok-space-1-5)');
    expect(ruleBody('[data-blok-database-timeline-bar]')).toContain('gap: var(--blok-space-1-5)');
    expect(ruleBody('[data-blok-database-feed-head]')).toMatch(/gap:\s*var\(--blok-space-1\)/);
  });
});
