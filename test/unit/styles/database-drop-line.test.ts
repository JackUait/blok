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

  // notion-motion.md Round 12 "Board selection" and Round 40 §2: the halo sits 2px inside the card. Notion's is blue; Blok's is the gray token.
  it('draws a selected card as the gray halo 2px in, not a whole-card fill', () => {
    expect(ruleBody(database, '[data-blok-database-card][data-blok-database-row-selected]')).toContain('background-image: none');
    expect(ruleBody(database, '[data-blok-database-card][data-blok-database-row-selected]::after')).toContain('opacity: 1');
    // A redraw re-creates a selected card; only a drop may fade its halo in.
    expect(ruleBody(database, '[data-blok-database-card][data-blok-database-row-selected]::after')).toContain('transition: none');
    expect(ruleBody(database, '[data-blok-database-card]::after')).toContain('inset: var(--blok-space-0-5)');
    expect(ruleBody(database, '[data-blok-database-card]::after')).toContain('background-color: var(--blok-icon-active-bg)');
  });

  // notion-motion.md Round 40 §2–3: the dropped card or event's halo fades 0→1 over 200ms ease.
  it('fades a just-landed halo in over 200ms ease, and not under reduced motion', () => {
    expect(ruleBody(database, '[data-blok-database-row-landed]::after')).toContain('animation: blok-database-landed 200ms ease');
    expect(database).toMatch(/@keyframes blok-database-landed \{ from \{ opacity: 0; \} \}/);
    const off = /@media \(prefers-reduced-motion: reduce\) \{[^@]*\[data-blok-database-row-landed\]::after[^{]*\{ animation: none;/.exec(database);

    // Same specificity: the off switch must come later in the file to win.
    expect(off?.index ?? -1).toBeGreaterThan(database.indexOf('[data-blok-database-row-landed]::after { animation: blok-database-landed'));
    // A card's halo also has its own 200ms transition, which a redraw can start.
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\[data-blok-database-card\]::after[^{]*\{ transition: none;/);
  });

  // notion-motion.md Round 64 §4: a selected database block's halo fades in over 0.2s. Only the
  // database: no plain block's halo has been measured. The tint stays core's one ::after.
  it('fades a selected database block\'s tint in over 200ms ease, and not under reduced motion', () => {
    const selector = '[data-blok-component="database"][data-blok-selected="true"] > [data-blok-element-content]::after';

    expect(ruleBody(database, selector)).toBe(' animation: blok-database-landed 200ms ease; ');
    const off = database.lastIndexOf(`${selector} { animation: none; }`);

    expect(off).toBeGreaterThan(database.indexOf(`${selector} { animation: blok-database-landed`));
    expect(database.lastIndexOf('@media (prefers-reduced-motion: reduce)', off)).toBeGreaterThan(database.indexOf(`${selector} { animation: blok-database-landed`));
  });

  // notion-motion.md Round 64 §1: a List row or Gallery card an undo brings back fades its pick in (~200ms).
  it('fades a landed list row or gallery card tint in over 200ms ease, and not under reduced motion', () => {
    const landed = ':is([data-blok-database-list-row], [data-blok-database-gallery-card])[data-blok-database-row-landed]';
    const body = ruleBody(database, landed);

    expect(database).toMatch(/@property --blok-database-landed-tint \{ syntax: '<color>'; inherits: false; initial-value: transparent; \}/);
    expect(body).toContain('--blok-database-landed-tint: var(--blok-icon-active-bg)');
    expect(body).toContain('background-image: linear-gradient(var(--blok-database-landed-tint), var(--blok-database-landed-tint))');
    expect(body).toContain('animation: blok-database-landed-tint 200ms ease');
    expect(database).toMatch(/@keyframes blok-database-landed-tint \{ from \{ --blok-database-landed-tint: transparent; \} \}/);
    const off = database.lastIndexOf(`${landed} { animation: none; }`);

    expect(off).toBeGreaterThan(database.indexOf(`${landed} {`));
    expect(database.lastIndexOf('@media (prefers-reduced-motion: reduce)', off)).toBeGreaterThan(database.indexOf(`${landed} {`));
  });

  // notion-motion.md Round 40 §2: the cursor while a card is held reads `grabbing`.
  it('shows the grabbing cursor over the board while a card is dragged', () => {
    expect(database).toMatch(/\[data-blok-database-dragging\], \[data-blok-database-dragging\] \* \{ cursor: grabbing; \}/);
  });
});
