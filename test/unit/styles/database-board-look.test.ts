/**
 * The board matches the measured Notion values (research/08 "Board").
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const database = read('database.css');

/** Every declaration block whose selector list contains `selector`, joined. */
const ruleBody = (css: string, selector: string): string =>
  [ ...css.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

describe('board column header actions', () => {
  it('draws the "+" and "⋯" header buttons 24px square', () => {
    const body = ruleBody(database, '[data-blok-database-column-actions] button');

    expect(body).toContain('width: 24px');
    expect(body).toContain('height: 24px');
    // findings-board B07: radius 6.
    expect(body).toContain('border-radius: var(--blok-radius-control)');
  });

  // research/36 §1.1: a hover anywhere in the column shows them. Sub-grouped heads sit outside the column, so they keep header hover.
  it('shows them while the column or its header is hovered, or holds focus or an open menu', () => {
    expect(ruleBody(database, '[data-blok-database-column-actions]')).toContain('opacity: 0');
    expect(ruleBody(database, '[data-blok-database-column]:hover [data-blok-database-column-actions]')).toContain('opacity: 1');
    expect(ruleBody(database, '[data-blok-database-column-header]:hover [data-blok-database-column-actions]')).toContain('opacity: 1');
    expect(ruleBody(database, '[data-blok-database-column-actions]:has(:focus-visible)')).toContain('opacity: 1');
    expect(ruleBody(database, '[data-blok-database-column-header][data-popover-open] [data-blok-database-column-actions]')).toContain('opacity: 1');
  });

  // motion-carddrag.json: Notion fades visibility with opacity, so a hidden button takes no clicks.
  // Blok keeps opacity so Tab still reaches them, and drops only the pointer while hidden.
  it('takes no pointer while hidden and takes it back whenever shown', () => {
    expect(ruleBody(database, '[data-blok-database-column-actions]')).toContain('pointer-events: none');
    for (const shown of [
      '[data-blok-database-column]:hover [data-blok-database-column-actions]',
      '[data-blok-database-column-header]:hover [data-blok-database-column-actions]',
      '[data-blok-database-column-header][data-popover-open] [data-blok-database-column-actions]',
      '[data-blok-database-column-actions]:has(:focus-visible)',
    ]) {
      expect(ruleBody(database, shown)).toContain('pointer-events: auto');
    }
  });

  // research/36 §1.1, §11: the glyph takes the column's count ink; the hover is the neutral tint in every column.
  it('draws them in the column\'s count ink with the neutral hover', () => {
    expect(ruleBody(database, '[data-blok-database-column-actions] button')).toContain('color: var(--_blok-group-accent, var(--blok-database-column-accent))');
    expect(ruleBody(database, '[data-blok-database-column-actions] button:hover')).toContain('background-color: var(--blok-database-hover-bg)');
  });

  // research/36 §1.1, §11: the column fill never changes on hover.
  it('never repaints the column itself on hover', () => {
    const hovers = [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
      .filter((rule) => rule[1].split(/,(?![^(]*\))/).some((part) => /\[data-blok-database-column\](\[[^\]]*\])*:hover\s*$/.test(part.trim())));

    expect(hovers.map((rule) => rule[2]).join(';')).not.toMatch(/background/);
  });

  it('pushes them to the inline end of the header', () => {
    expect(ruleBody(database, '[data-blok-database-column-actions]')).toContain('margin-inline-start: auto');
  });
});

// Board tokens live at the top of database.css, so view.css (built from colors.css) never carries them.
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

describe('board column, card and header look (research/08)', () => {
  it('tints the column body, rounds it with the block radius and pads it 0 8px 8px', () => {
    const body = ruleBody(database, '[data-blok-database-column]');

    expect(body).toContain('background-color: var(--_blok-group-tint, var(--blok-database-column-bg))');
    expect(body).toContain('border-radius: var(--blok-radius-block)');
    expect(body).toContain('padding: 0 var(--blok-space-2) var(--blok-space-2)');
  });

  // notion-motion.md Round 30 §2: each band cell is its own box, radius 10 on all four corners, apart from the heads.
  it('keeps all four corners on a sub-grouped column body', () => {
    expect(database).not.toMatch(/\[data-blok-database-column\]\[data-sub-group\][^{]*\{[^}]*border-start-(start|end)-radius/);
  });

  it('uses the measured tints, rings and accents, light and dark', () => {
    expect(tokenValues('--blok-database-column-bg')).toEqual(['rgba(66, 35, 3, 0.03)', 'rgba(252, 252, 252, 0.03)', 'rgba(252, 252, 252, 0.03)']);
    expect(tokenValues('--blok-database-card-bg')).toEqual(['rgb(32, 32, 32)', 'rgb(32, 32, 32)']);
    expect(tokenValues('--blok-database-column-yellow-bg')).toEqual(['rgba(207, 175, 0, 0.063)', 'rgba(255, 232, 48, 0.043)', 'rgba(255, 232, 48, 0.043)']);
    expect(tokenValues('--blok-database-column-brown-bg')[0]).toBe('rgba(115, 59, 3, 0.035)');
    expect(tokenValues('--blok-database-column-pink-bg').slice(-2)).toEqual(['rgba(255, 78, 149, 0.055)', 'rgba(255, 78, 149, 0.055)']);
    expect(tokenValues('--blok-database-column-yellow-ring')).toEqual(['rgba(211, 168, 0, 0.137)', 'rgba(255, 225, 117, 0.13)', 'rgba(255, 225, 117, 0.13)']);
    expect(tokenValues('--blok-database-column-accent')).toEqual(['rgb(95, 94, 89)', 'rgb(188, 186, 182)', 'rgb(188, 186, 182)']);
    // Divergence: Notion's light yellow (2.2:1) and brown (2.9:1) accents fail AA on their tint, so they take the measured pill text (7.3:1, 8.6:1).
    expect(tokenValues('--blok-database-column-yellow-accent')[0]).toBe('var(--blok-database-option-yellow-text)');
    expect(tokenValues('--blok-database-column-brown-accent')[0]).toBe('var(--blok-database-option-brown-text)');
  });

  it('uses the measured gray option pill, which keeps the board header pill readable (research/08)', () => {
    expect(tokenValues('--blok-database-option-gray-bg')).toEqual(['rgba(28, 19, 1, 0.11)', 'rgba(255, 252, 235, 0.306)', 'rgba(255, 252, 235, 0.306)']);
    expect(tokenValues('--blok-database-option-gray-text')).toEqual(['rgb(73, 72, 70)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
  });

  // findings-board B12: Notion's header strip is 40px, the pill centred at +20.
  it('makes the column header a 40px strip', () => {
    expect(ruleBody(database, '[data-blok-database-column-header]')).toContain('min-height: 40px');
  });

  it('draws a card with the block radius, a 3-layer shadow whose 1px ring takes the column hue, and 8px below it', () => {
    const body = ruleBody(database, '[data-blok-database-card]');

    expect(body).toContain('border-radius: var(--blok-radius-block)');
    expect(body).toContain('box-shadow: var(--blok-database-card-lift), var(--_blok-group-ring, var(--blok-database-card-ring)) 0 0 0 1px');
    expect(body).toContain('margin-bottom: var(--blok-space-2)');
    expect(tokenValues('--blok-database-card-lift')[0]).toBe('rgba(25, 25, 25, 0.027) 0 4px 12px, rgba(25, 25, 25, 0.02) 0 1px 2px');
    expect(tokenValues('--blok-database-card-ring')[0]).toBe('rgba(42, 28, 0, 0.07)');
  });

  it('sets the card title at 15px/22.5px, weight 500', () => {
    const body = ruleBody(database, '[data-blok-database-card-title]');

    expect(body).toContain('font-size: 15px');
    expect(body).toContain('line-height: 22.5px');
    expect(body).toContain('font-weight: 500');
  });

  // research/36 §1.1, §11: hovered, "+ New page" takes the hovered card's fill. Measured for default, gray and red only.
  it('fills a hovered "+ New page" like a hovered card', () => {
    expect(ruleBody(database, '[data-blok-database-add-card]:hover')).toContain('background-color: var(--_blok-group-add-hover, var(--blok-database-card-bg-hover))');
    expect(tokenValues('--blok-database-column-default-add-hover-bg')).toEqual(['var(--blok-database-card-bg-hover)']);
    expect(tokenValues('--blok-database-column-gray-add-hover-bg')).toEqual(['var(--blok-database-column-gray-card-hover-bg, var(--blok-database-card-bg-hover))']);
    expect(tokenValues('--blok-database-column-red-add-hover-bg')).toEqual(['var(--blok-database-column-red-card-hover-bg)']);
  });

  // findings-board B19: the text is 15px/18px. notion-motion.md, Round 8c: the plus ink is 10.5 wide, and the slot must not squash it.
  it('sets "+ New page" in 15px/18px after a plus as wide as Notion\'s', () => {
    const body = ruleBody(database, '[data-blok-database-add-card]');
    const icon = ruleBody(database, '[data-blok-database-add-card-icon] svg');

    expect(body).toContain('font-size: 15px');
    expect(body).toContain('line-height: 18px');
    expect(icon).toContain('width: 18.67px');
    expect(icon).toContain('flex-shrink: 0');
  });

  // notion-motion.md Round 16 §3: "+ New group" is a 108x30 button with no ring; hover 0.051 and press 0.102 over 20ms ease-in.
  it('makes "+ New group" a plain 30px button that fills in 20ms', () => {
    const body = ruleBody(database, '[data-blok-database-add-column]');

    expect(body).toContain('height: 30px');
    expect(body).toContain('border: none');
    expect(body).not.toContain('border: 1px');
    expect(body).toContain('transition: background-color 20ms ease-in');
    expect(ruleBody(database, '[data-blok-database-add-column]:hover')).toContain('background-color: var(--blok-database-popover-hover)');
    expect(ruleBody(database, '[data-blok-database-add-column]:active')).toContain('background-color: var(--blok-database-pressed-bg)');
  });

  // notion-motion.md Round 23 §5: padding 0 8 0 6, a 16px plus, 8px after it.
  it('lays "+ New group" out as a 16px plus 8px before its words, 6px from the start', () => {
    const body = ruleBody(database, '[data-blok-database-add-column]');
    const icon = ruleBody(database, '[data-blok-database-add-column-icon] svg');

    expect(body).toContain('padding: 0 var(--blok-space-2) 0 var(--blok-space-1-5)');
    expect(icon).toContain('width: 16px');
    expect(icon).toContain('height: 16px');
    expect(ruleBody(database, '[data-blok-database-add-column-icon]')).toContain('margin-inline-end: var(--blok-space-2)');
  });

  it('makes "+ New page" a 40px ring button with group-colored text', () => {
    const body = ruleBody(database, '[data-blok-database-add-card]');

    expect(body).toContain('height: 40px');
    expect(body).toContain('padding: 0 var(--blok-space-2-5)');
    expect(body).toContain('border-radius: var(--blok-radius-block)');
    expect(body).toContain('box-shadow: var(--_blok-group-ring, var(--blok-database-card-ring)) 0 0 0 1px');
    expect(body).toContain('color: var(--_blok-group-accent, var(--blok-database-column-accent))');
  });

  it('draws the header pill 20px tall, 0 6px, 4px radius, 14px/500', () => {
    const body = ruleBody(database, '[data-blok-database-column-pill]');

    expect(body).toContain('height: 20px');
    expect(body).toContain('padding: 0 var(--blok-space-1-5)');
    expect(body).toContain('border-radius: var(--blok-radius-control-sm)');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('font-weight: 500');
  });

  // findings-board B01: a Status board's header is the cell's status pill.
  it('draws a status header pill as the status pill: 0 9px 0 7px, round, 400, with its 8px dot', () => {
    const body = ruleBody(database, '[data-blok-database-column-pill][data-status]');
    const dot = ruleBody(database, '[data-blok-database-column-pill][data-status] [data-blok-database-column-dot]');

    expect(body).toContain('padding-inline: var(--blok-database-status-pill-pad-start) var(--blok-database-status-pill-pad-end)');
    expect(body).toContain('border-radius: var(--blok-radius-pill)');
    expect(body).toContain('font-weight: 400');
    expect(body).toContain('line-height: 20px');
    expect(body).toContain('gap: var(--blok-space-1-25)');
    expect(dot).toContain('display: block');
  });

  it('colors the 14px count by group', () => {
    const body = ruleBody(database, '[data-blok-database-column-count]');

    expect(body).toContain('font-size: 14px');
    expect(body).toContain('color: var(--_blok-group-accent, var(--blok-database-column-accent))');
  });

  it('draws the count button as bare text with a gray hover (research/16 §1)', () => {
    const body = ruleBody(database, 'button[data-blok-database-column-count]');

    expect(body).toContain('border: none');
    expect(body).toContain('background: none');
    expect(body).toContain('font-family: inherit');
    expect(body).toContain('cursor: pointer');
    expect(ruleBody(database, 'button[data-blok-database-column-count]:hover')).toContain('background-color: var(--blok-database-hover-bg)');
  });

  // notion-motion.md Round 31 §3: 24 tall, padding 0 8, radius 6, 14px 500, muted ink (AA), hover 0.051.
  it('draws a sub-group band count as a 24px button with a gray hover', () => {
    const body = ruleBody(database, '[data-blok-database-board-lane-count]');

    expect(body).toContain('height: 24px');
    expect(body).toContain('padding: 0 var(--blok-space-2)');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('font-weight: 500');
    expect(body).toContain('color: var(--blok-database-ink-secondary)');
    expect(ruleBody(database, 'button[data-blok-database-board-lane-count]')).toContain('cursor: pointer');
    expect(ruleBody(database, 'button[data-blok-database-board-lane-count]:hover')).toContain('background-color: var(--blok-database-hover-bg)');
  });

  it('shows the no-value label as plain 14px/500 text, no pill', () => {
    const body = ruleBody(database, '[data-blok-database-no-value-group] [data-blok-database-column-pill]');

    expect(body).toContain('background-color: transparent');
    expect(body).toContain('padding: 0');
    expect(body).toContain('margin-inline-start: var(--blok-space-1)');
  });
});

describe('board column "Load more"', () => {
  it('shares the gallery "Load more" look', () => {
    expect(ruleBody(database, '[data-blok-database-column-load-more]')).toBe(ruleBody(database, '[data-blok-database-gallery-load-more]'));
  });
});

describe('board in dark (research/21 §1f)', () => {
  /** The token's value in the media-query dark block, then the theme-attribute copy. */
  const dark = (name: string): string[] => tokenValues(name).slice(-2);

  it('tints blue and green columns, their card rings, counts and cards as measured', () => {
    expect(dark('--blok-database-column-blue-bg')).toEqual(Array(2).fill('rgba(41, 139, 253, 0.063)'));
    expect(dark('--blok-database-column-green-bg')).toEqual(Array(2).fill('rgba(83, 255, 140, 0.035)'));
    expect(dark('--blok-database-column-blue-ring')).toEqual(Array(2).fill('rgba(71, 157, 255, 0.173)'));
    expect(dark('--blok-database-column-green-ring')).toEqual(Array(2).fill('rgba(119, 255, 179, 0.118)'));
    // Notion's dot inks fail AA on the hovered "+ New" row; these are the nearest passing steps (research/33 §4.4).
    expect(dark('--blok-database-column-blue-accent')).toEqual(Array(2).fill('rgb(62, 154, 245)'));
    expect(dark('--blok-database-column-green-accent')).toEqual(Array(2).fill('rgb(77, 168, 120)'));
    expect(dark('--blok-database-column-blue-card-bg')).toEqual(Array(2).fill('rgb(33, 48, 65)'));
    expect(dark('--blok-database-column-green-card-bg')).toEqual(Array(2).fill('rgb(36, 52, 43)'));
  });

  it('defines the card tints in dark only, so light cards stay white', () => {
    expect(tokenValues('--blok-database-column-blue-card-bg')).toHaveLength(2);
    expect(tokenValues('--blok-database-column-green-card-bg')).toHaveLength(2);
  });

  it('paints a card with its column card tint, else the plain card fill', () => {
    expect(ruleBody(database, '[data-blok-database-card]')).toContain('background-color: var(--_blok-group-card, var(--blok-database-card-bg))');
  });

  it('keeps the gray column, plain card, lift, ring and gray count measured', () => {
    expect(dark('--blok-database-column-bg')).toEqual(Array(2).fill('rgba(252, 252, 252, 0.03)'));
    expect(dark('--blok-database-card-bg')).toEqual(Array(2).fill('rgb(32, 32, 32)'));
    expect(dark('--blok-database-card-lift')).toEqual(Array(2).fill('rgba(25, 25, 25, 0.08) 0 2px 4px'));
    expect(dark('--blok-database-card-ring')).toEqual(Array(2).fill('rgba(255, 255, 243, 0.082)'));
    expect(dark('--blok-database-column-accent')).toEqual(Array(2).fill('rgb(188, 186, 182)'));
  });

  // research/21's "Not started" was a Default column; research/35 §1.1 measured Gray: plain tint and ring, its own count.
  it('draws a gray column with the plain tint and ring but its own count', () => {
    expect(tokenValues('--blok-database-column-gray-bg')).toEqual(['var(--blok-database-column-bg)']);
    expect(tokenValues('--blok-database-column-gray-ring')).toEqual(['var(--blok-database-card-ring)']);
    expect(tokenValues('--blok-database-column-gray-accent')).toEqual(['rgb(110, 107, 102)', 'rgb(156, 153, 148)', 'rgb(156, 153, 148)']);
  });

  it('hovers a card to rgb(38, 38, 38)', () => {
    expect(dark('--blok-database-card-bg-hover')).toEqual(Array(2).fill('rgb(38, 38, 38)'));
  });

  it('gives the hover action pill its own measured shadow, the table OPEN shadow in light', () => {
    expect(ruleBody(database, '[data-blok-database-card-actions]')).toContain('box-shadow: var(--blok-database-card-actions-shadow)');
    expect(tokenValues('--blok-database-card-actions-shadow')).toEqual([
      'var(--blok-database-table-open-shadow)',
      'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px',
      'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px',
    ]);
  });
});

// notion-motion.md, Round 8c "Hidden groups": a hidden group's eye is gray, a shown one keeps the ink.
describe('group eye on the Group page', () => {
  it('grays the eye of a hidden group', () => {
    expect(ruleBody(database, '[data-blok-database-group-visibility-row][data-hidden] > [data-blok-database-property-eye]'))
      .toContain('color: var(--blok-database-table-gutter-icon)');
  });
});

// notion-motion.md Round 24 §1 (r24-pinsec-1.raw): "+ New group" and "Pinned groups" share one strip. The header is
// 28 tall, 4 under New group, padded 0 8 with a gap 8, radius 6. Rows are 28 tall, 24 in, the first 10 under the header,
// pitch 32. A row holds a 20px pill (3px around it) and the count 11 after it; its Unpin (24px) sits right after the row.
// Notion's header ink rgb(161,158,153) fails AA, so it takes Blok's muted text; the count is primary ink.
describe('board pinned groups strip', () => {
  it('stacks the add-group button and the pinned list in one column', () => {
    const body = ruleBody(database, '[data-blok-database-group-strip]');

    expect(body).toContain('flex-direction: column');
    expect(body).toContain('flex-shrink: 0');
  });

  it('draws the header 28px tall, 4px under New group, padded 0 8px with an 8px gap', () => {
    const body = ruleBody(database, '[data-blok-database-pinned-groups-header]');

    expect(body).toContain('height: 28px');
    expect(body).toContain('margin-block-start: var(--blok-space-1)');
    expect(body).toContain('padding: 0 var(--blok-space-2)');
    expect(body).toContain('gap: var(--blok-space-2)');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('color: var(--blok-database-table-muted-text)');
    expect(body).toContain('transition: background-color 0.1s ease-in-out');
  });

  it('indents rows 24px, the first 10px under the header, 32px apart', () => {
    const body = ruleBody(database, '[data-blok-database-pinned-group]');

    expect(body).toContain('margin-inline-start: var(--blok-space-6)');
    expect(body).toContain('margin-block-start: var(--blok-space-1)');
    expect(ruleBody(database, '[data-blok-database-pinned-groups-header] + [data-blok-database-pinned-group]')).toContain('margin-block-start: var(--blok-space-2-5)');
  });

  it('draws a row 28px tall with the count 11px after a 3px-framed pill', () => {
    const row = ruleBody(database, '[data-blok-database-pinned-group-open]');

    expect(row).toContain('height: 28px');
    expect(row).toContain('padding: 0 var(--blok-space-2)');
    expect(row).toContain('gap: var(--blok-space-2-75)');
    expect(row).toContain('transition: background-color 0.1s ease-in-out');
    expect(ruleBody(database, '[data-blok-database-pinned-group-pill]')).toContain('margin-inline: var(--blok-space-0-75)');
    expect(ruleBody(database, '[data-blok-database-pinned-group-pill]')).toContain('height: 20px');
    expect(ruleBody(database, '[data-blok-database-pinned-group-count]')).toContain('color: var(--blok-database-table-cell-text)');
  });

  // notion-motion.md Round 25 §2: the header sits 4 under "+ New group", and at the column top when it is first.
  it('drops the header gap when the header is the strip\'s first item', () => {
    expect(ruleBody(database, '[data-blok-database-group-strip] > [data-blok-database-pinned-groups]:first-child > [data-blok-database-pinned-groups-header]')).toContain('margin-block-start: 0');
  });

  it('draws Unpin 24px square', () => {
    const body = ruleBody(database, '[data-blok-database-pinned-group-unpin]');

    expect(body).toContain('width: 24px');
    expect(body).toContain('height: 24px');
  });
});

// notion-motion.md Round 24 §1 (r24-grp.raw): in Settings › Group the pin (x 1440) touches the eye (x 1464).
describe('Settings › Group pin button', () => {
  it('sits right against the eye', () => {
    expect(ruleBody(database, '[data-blok-database-group-pin] + [data-blok-database-property-eye]')).toContain('margin-inline-start: calc(-1 * var(--blok-space-2))');
  });

  // notion-motion.md Round 25 §2 (r25-grp-pinbtn-rest.raw, -hover.raw): a 16×16 pin in rgb(142,139,134), fill over 0.1s
  // ease-in-out, and the glyph swaps to the filled pin on hover.
  it('draws a 16px pin in the header icon gray that fills on hover', () => {
    const pin = ruleBody(database, '[data-blok-database-group-pin]');

    expect(pin).toContain('color: var(--blok-database-table-header-icon)');
    expect(pin).toContain('transition: background-color 0.1s ease-in-out');
    expect(ruleBody(database, '[data-blok-database-group-pin] svg')).toContain('width: 16px');
    expect(ruleBody(database, '[data-blok-database-group-pin] svg')).toContain('height: 16px');
    expect(ruleBody(database, '[data-blok-database-property-eye] svg')).toContain('width: 20px');
    expect(ruleBody(database, '[data-blok-database-group-pin-glyph="hover"]')).toContain('display: none');
    expect(ruleBody(database, '[data-blok-database-group-pin]:hover:not(:disabled) > [data-blok-database-group-pin-glyph="rest"]')).toContain('display: none');
    expect(ruleBody(database, '[data-blok-database-group-pin]:hover:not(:disabled) > [data-blok-database-group-pin-glyph="hover"]')).toContain('display: flex');
  });
});

// notion-motion.md Round 25 §1 (r25-pinmodal.raw, motion-r25-pinrow-open.json): an 800×496 dialog, radius 12, over a
// rgba(15,15,15,0.6) overlay; the overlay fades in and the dialog scales 0.97 → 1, both 200ms ease. Closing is instant.
describe('pinned group modal', () => {
  it('fades the overlay in and scales the dialog up over 200ms', () => {
    const backdrop = ruleBody(database, '[data-blok-database-group-modal]');
    const panel = ruleBody(database, '[data-blok-database-group-modal-panel]');

    expect(backdrop).toContain('background-color: var(--blok-database-confirm-backdrop)');
    expect(backdrop).toContain('animation: blok-database-confirm-fade 200ms ease both');
    expect(panel).toContain('animation: blok-database-confirm-in 200ms ease both');
    expect(database).not.toContain('[data-blok-database-group-modal][data-blok-closing]');
    expect(database).toMatch(/\[data-blok-database-group-modal\],\s*\[data-blok-database-group-modal-panel\]\s*\{\s*animation: none;/);
  });

  it('draws an 800×496 dialog with radius 12 and the dialog shadow', () => {
    const panel = ruleBody(database, '[data-blok-database-group-modal-panel]');

    expect(panel).toContain('width: 800px');
    expect(panel).toContain('height: 496px');
    expect(panel).toContain('border-radius: var(--blok-radius-dialog)');
    expect(panel).toContain('box-shadow: var(--blok-database-confirm-shadow)');
  });

  // r25-pinmodal.raw: header 48 tall, padding 12 24 0; Search 28×28 radius 6; Dismiss a 22×22 circle, fill 0.06,
  // hover 0.16 over 0.1s, ending 32 from the dialog's right edge. The × takes Blok's 3:1 step of 142,139,134.
  it('lays the header out as Notion does', () => {
    const header = ruleBody(database, '[data-blok-database-group-modal-header]');
    const search = ruleBody(database, '[data-blok-database-group-modal-search]');
    const close = ruleBody(database, '[data-blok-database-group-modal-close]');

    expect(header).toContain('height: 48px');
    expect(header).toContain('padding: var(--blok-space-3) var(--blok-space-6) 0');
    expect(search).toContain('width: 28px');
    expect(search).toContain('height: 28px');
    expect(search).toContain('border-radius: var(--blok-radius-control)');
    expect(close).toContain('width: 22px');
    expect(close).toContain('height: 22px');
    expect(close).toContain('border-radius: 50%');
    expect(close).toContain('background-color: var(--blok-database-confirm-small-close-bg)');
    expect(close).toContain('color: var(--blok-database-confirm-small-close-icon)');
    expect(close).toContain('margin-inline-end: var(--blok-space-2)');
    expect(close).toContain('transition: background-color 0.1s ease-in-out');
    expect(ruleBody(database, '[data-blok-database-group-modal-close]:hover')).toContain('background-color: var(--blok-database-confirm-small-close-hover-bg)');
  });

  // r25-pinmodal-row.raw: one 800-wide scroller that scrolls both ways, content 24 in.
  it('scrolls the table both ways in one body', () => {
    expect(ruleBody(database, '[data-blok-database-group-modal-body]')).toContain('overflow: auto');
    expect(ruleBody(database, '[data-blok-database-group-modal-body] [data-blok-database-table-scroller]')).toContain('overflow: visible');
  });

  // notion-motion.md Round 27 §2 "Chip row layout": the sort and filter groups sit 25 apart, chips 6 apart.
  // 6 gap + 6 margin + the 1px divider + 6 margin + 6 gap = 25.
  it('sets the divider 6px clear of the 6px chip gap on each side', () => {
    expect(ruleBody(database, '[data-blok-database-group-modal-chips]')).toContain('gap: var(--blok-space-1-5)');
    expect(ruleBody(database, '[data-blok-database-group-modal-chips] > [data-blok-database-chip-divider]')).toContain('margin-inline: var(--blok-space-1-5)');
  });
});
