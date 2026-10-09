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

  it('uses the measured tints, rings and accents, light and dark', () => {
    expect(tokenValues('--blok-database-column-bg')).toEqual(['rgba(66, 35, 3, 0.03)', 'rgba(252, 252, 252, 0.03)', 'rgba(252, 252, 252, 0.03)']);
    expect(tokenValues('--blok-database-card-bg')).toEqual(['rgb(32, 32, 32)', 'rgb(32, 32, 32)']);
    expect(tokenValues('--blok-database-column-yellow-bg')).toEqual(['rgba(207, 175, 0, 0.063)', 'rgba(255, 232, 48, 0.043)', 'rgba(255, 232, 48, 0.043)']);
    expect(tokenValues('--blok-database-column-brown-bg')[0]).toBe('rgba(115, 59, 3, 0.035)');
    expect(tokenValues('--blok-database-column-pink-bg').slice(-2)).toEqual(['rgba(255, 78, 149, 0.055)', 'rgba(255, 78, 149, 0.055)']);
    expect(tokenValues('--blok-database-column-yellow-ring')).toEqual(['rgba(211, 168, 0, 0.137)', 'rgba(255, 225, 117, 0.13)', 'rgba(255, 225, 117, 0.13)']);
    expect(tokenValues('--blok-database-column-accent')).toEqual(['rgb(95, 94, 89)', 'rgb(188, 186, 182)', 'rgb(188, 186, 182)']);
    expect(tokenValues('--blok-database-column-yellow-accent')[0]).toBe('rgb(216, 163, 47)');
    expect(tokenValues('--blok-database-column-brown-accent')[0]).toBe('rgb(182, 137, 101)');
  });

  it('uses the measured gray option pill, which keeps the board header pill readable (research/08)', () => {
    expect(tokenValues('--blok-database-option-gray-bg')).toEqual(['rgba(28, 19, 1, 0.11)', 'rgba(255, 252, 235, 0.306)', 'rgba(255, 252, 235, 0.306)']);
    expect(tokenValues('--blok-database-option-gray-text')).toEqual(['rgb(73, 72, 70)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
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

  it('shows the no-value label as plain 14px/500 text, no pill', () => {
    const body = ruleBody(database, '[data-blok-database-no-value-group] [data-blok-database-column-pill]');

    expect(body).toContain('background-color: transparent');
    expect(body).toContain('padding: 0');
    expect(body).toContain('margin-inline-start: var(--blok-space-1)');
  });
});
