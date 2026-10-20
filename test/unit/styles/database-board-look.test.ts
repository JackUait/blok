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
  });

  it('shows them only while the header is hovered, or holds focus or an open menu', () => {
    expect(ruleBody(database, '[data-blok-database-column-actions]')).toContain('opacity: 0');
    expect(ruleBody(database, '[data-blok-database-column-header]:hover [data-blok-database-column-actions]')).toContain('opacity: 1');
    expect(ruleBody(database, '[data-blok-database-column-actions]:has(:focus-visible)')).toContain('opacity: 1');
    expect(ruleBody(database, '[data-blok-database-column-header][data-popover-open] [data-blok-database-column-actions]')).toContain('opacity: 1');
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

  it('rounds only the bottom of a column body below the shared heads, as Notion measured 0 0 10px 10px', () => {
    const body = ruleBody(database, '[data-blok-database-column][data-sub-group]');

    expect(body).toContain('border-start-start-radius: 0');
    expect(body).toContain('border-start-end-radius: 0');
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

  it('gives the column header room so the pill does not touch the tint edge (height unmeasured; Notion table headers are 36px)', () => {
    expect(ruleBody(database, '[data-blok-database-column-header]')).toContain('min-height: 36px');
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
    expect(ruleBody(database, 'button[data-blok-database-column-count]:hover')).toContain('background-color: var(--blok-item-hover-bg)');
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
    expect(dark('--blok-database-column-blue-accent')).toEqual(Array(2).fill('rgb(39, 131, 222)'));
    expect(dark('--blok-database-column-green-accent')).toEqual(Array(2).fill('rgb(70, 161, 113)'));
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

  // Notion's gray ("Not started") column measured the plain column tint, card ring and count in both themes.
  it('draws a gray column like an uncolored one, in light and dark', () => {
    expect(tokenValues('--blok-database-column-gray-bg')).toEqual(['var(--blok-database-column-bg)']);
    expect(tokenValues('--blok-database-column-gray-ring')).toEqual(['var(--blok-database-card-ring)']);
    expect(tokenValues('--blok-database-column-gray-accent')).toEqual(['var(--blok-database-column-accent)']);
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
