/**
 * Dark database chrome from feel/findings-darkkeys (K04, K06, K11, K12).
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const ruleBody = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

/** A token's values in source order: light, system dark, forced dark. */
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

describe('OPEN pill in dark (findings K06, live)', () => {
  it('fills with Notion\'s rgb(32, 32, 32)', () => {
    expect(tokenValues('--blok-database-table-open-bg')).toEqual(['#ffffff', 'rgb(32, 32, 32)', 'rgb(32, 32, 32)']);
  });

  it('leaves the card hover pill and the selection bar on the menu fill, rgb(37, 37, 37) in dark, as measured', () => {
    expect(tokenValues('--blok-database-card-actions-bg')).toEqual(Array(3).fill('var(--blok-database-popover-bg)'));
    expect(ruleBody('[data-blok-database-table-selection-bar]')).toContain('background-color: var(--blok-database-popover-bg)');
  });
});

describe('database switches in dark (findings K11, live)', () => {
  it('draw the off track at Notion\'s gray and keep the knob white in both states', () => {
    expect(tokenValues('--blok-database-switch-off-bg')).toEqual(['var(--blok-toggle-off-bg)', 'rgba(202, 204, 206, 0.3)', 'rgba(202, 204, 206, 0.3)']);
    expect(tokenValues('--blok-database-switch-knob-bg')).toEqual(['var(--blok-toggle-thumb-on-bg)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)']);
    expect(ruleBody('[data-blok-database-switch-track]')).toContain('background-color: var(--blok-database-switch-off-bg)');
    expect(ruleBody('[data-blok-database-switch-track] > span')).toContain('background-color: var(--blok-database-switch-knob-bg)');
  });

  it('keeps the on track blue (user decision: the switch stays blue)', () => {
    expect(ruleBody('[aria-checked="true"] > [data-blok-database-switch-track]')).toContain('background-color: var(--blok-database-switch-on-bg)');
  });
});

describe('date picker dividers (findings K12, research/33 §4.1)', () => {
  it.each([
    '[data-blok-database-date-options]',
    '[data-blok-database-date-remind] + [data-blok-database-date-clear]',
    '[data-blok-database-date-help-footer]',
  ])('%s draws Notion\'s menu divider, the table border', (selector) => {
    expect(ruleBody(selector)).toContain('border-top: 1px solid var(--blok-database-table-border)');
  });
});

describe('property menu name field (findings K04)', () => {
  const field = '[data-blok-database-property-menu-name] > [data-blok-database-property-menu-name-input]';

  it('takes Notion\'s box: 28px tall, radius 6px, padding 3px 6px, beside the icon', () => {
    const body = ruleBody(field);

    expect(body).toContain('height: 28px');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('padding-block: var(--blok-space-0-75)');
    expect(body).toContain('padding-inline: var(--blok-space-1-5)');
    expect(body).toContain('flex: 1 1 auto');
  });

  it('fills and rings at rest with Notion\'s dark values; light keeps the shared field look', () => {
    const rest = ruleBody(field);

    expect(rest).toContain('background-color: var(--blok-database-name-field-bg)');
    expect(rest).toContain('border-color: var(--blok-database-name-field-ring)');
    expect(tokenValues('--blok-database-name-field-bg')).toEqual(['var(--blok-item-hover-bg)', 'rgba(252, 252, 252, 0.03)', 'rgba(252, 252, 252, 0.03)']);
    expect(tokenValues('--blok-database-name-field-ring')).toEqual(['transparent', 'rgba(255, 255, 235, 0.1)', 'rgba(255, 255, 235, 0.1)']);
  });

  it('is no longer reset to a bare input', () => {
    expect(ruleBody('[data-blok-database-property-menu-name-input]')).not.toContain('background: transparent');
  });
});
