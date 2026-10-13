/**
 * The AI Autofill setup's Basic tab. jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** Every declaration block whose selector list names `selector`. */
const rulesFor = (selector: string): string[] =>
  // Lookbehind: consuming the `}` would skip every rule that follows a matched one.
  [ ...database.matchAll(/(?<=^|\})\s*([^{}@]+)\{([^{}]*)\}/g) ]
    .filter((match) => match[1].split(',').some((part) => part.trim() === selector))
    .map((match) => match[2]);

describe('AI Autofill setup css', () => {
  it('marks the selected tab with primary ink and no fill (no-blue law)', () => {
    const selected = rulesFor('[data-blok-database-autofill-tab][aria-selected="true"]').join(' ');

    expect(selected).toContain('color: var(--blok-text-primary)');
    expect(selected).not.toMatch(/background/);
    expect(rulesFor('[data-blok-database-autofill-tab]').join(' ')).toContain('background: transparent');
  });

  // The top-layer reset (0,2,0) sets inset: auto, which pinned the dialog at 0,0.
  it('stretches the top-layer backdrop over the viewport so the dialog centres', () => {
    const backdrop = rulesFor('[data-blok-database-confirm][data-blok-top-layer][popover]').join(' ');

    expect(backdrop).toContain('inset: 0');
    // Beats the data-blok-popover reset's transparent background.
    expect(backdrop).toContain('background-color: var(--blok-database-confirm-backdrop)');
  });

  it('wraps the footer row instead of wrapping button labels', () => {
    expect(rulesFor('[data-blok-database-autofill-footer]').join(' ')).toContain('flex-wrap: wrap');
    expect(rulesFor('[data-blok-database-autofill-action]').join(' ')).toContain('white-space: nowrap');
  });

  it('shows the cell Autofill button only while the cell is hovered', () => {
    expect(rulesFor('[data-blok-database-table-autofill]').join(' ')).toContain('display: none');
    expect(rulesFor('[data-blok-database-table-cell]:hover > [data-blok-database-table-autofill]').join(' ')).toContain('display: inline-flex');
  });

  it('shows the cell Autofill button on the keyboard-selected cell too', () => {
    expect(rulesFor('[data-blok-database-table-cell][data-blok-database-table-cell-anchor] > [data-blok-database-table-autofill]').join(' '))
      .toContain('display: inline-flex');
  });

  // Cmd/Ctrl+Enter presses the selected title cell's Open button, so sighted keyboard users must see it.
  it('shows the title cell Open button on the keyboard-selected cell too', () => {
    expect(rulesFor('[data-blok-database-table-cell][data-blok-database-table-cell-anchor] [data-blok-database-table-open]').join(' '))
      .toContain('display: inline-flex');
  });

  // A sibling of the header button now: it must keep its place at the header's end.
  it('keeps the header sparkle at the header\'s inline end, inside its padding', () => {
    const sparkle = rulesFor('[data-blok-database-table-autofill-open]').join(' ');

    expect(sparkle).toContain('flex: none');
    expect(sparkle).toContain('margin-inline-end: var(--blok-space-2)');
  });

  it('paints the Autofill buttons and Thinking… in gray ink, never blue', () => {
    const buttons = [
      ...rulesFor('[data-blok-database-table-autofill]'),
      ...rulesFor('[data-blok-database-table-autofill-open]'),
    ].join(' ');

    expect(buttons).toContain('color: var(--blok-text-secondary)');
    expect(rulesFor('[data-blok-database-table-autofill-thinking]').join(' ')).toContain('color: var(--blok-text-secondary)');
    expect(buttons).not.toMatch(/blue|--blok-link|--blok-focus/);
  });
});
