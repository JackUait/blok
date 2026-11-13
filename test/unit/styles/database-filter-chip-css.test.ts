/**
 * The filter rule popover's header buttons. jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const database = strip(readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8'));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every declaration of `name` in top-level rules whose selector list holds exactly `selector`. */
const declared = (selector: string, name: string): string[] =>
  [...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .flatMap((rule) => [...rule[2].matchAll(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`, 'g'))].map((m) => m[1].trim()));

describe('filter rule popover header', () => {
  // notion-motion.md Round 18 §2, r18-filter-one.raw: the "contains" button is 69.3×18, the ⋯ 20×20.
  it('makes the operator button 18px tall and keeps the ⋯ button at 20px', () => {
    expect(declared('[data-blok-database-chip-operator]', 'height').at(-1)).toBe('18px');
    expect(declared('[data-blok-database-chip-more]', 'height').at(-1)).toBe('20px');
  });
});

// notion-motion.md Round 20 §1 (r20-st-rows.raw): group rows 14px 500 in the group's ink, options 8px further in.
describe('status filter rows', () => {
  it('draws a group row in weight 500 and its group colour, at AA', () => {
    expect(declared('[data-blok-database-filter-status-group]', 'font-weight')).toEqual(['500']);
    expect(declared('[data-blok-database-filter-status-group][data-color="green"]', 'color')).toEqual(['var(--blok-database-option-green-text)']);
    expect(declared('[data-blok-database-filter-status-group][data-color="gray"]', 'color')).toEqual(['var(--blok-database-option-gray-text)']);
  });

  it('sets an option row 8px in from its group', () => {
    expect(declared('[data-blok-database-filter-status-option]', 'padding-inline-start')).toEqual(['var(--blok-space-4)']);
  });
});

describe('advanced filter popover', () => {
  // Without it the box keeps its open-time width and clips a rule that a new operator widened.
  it('lets the popover box follow a panel sized to its rows', () => {
    const box = "[data-blok-popover-custom-class~='blok-database-panel'] [data-blok-popover-container]:has([data-blok-database-panel][data-fit-content])";

    expect(declared(box, 'inline-size')).toEqual(['max-content']);
    expect(declared(box, 'min-inline-size')).toEqual(['0']);
  });

  // r18-adv-open.raw: every rule's property button starts 76 from the popover's left, so the And/Or button is a 60 column too.
  it('gives the And/Or button the same 60px column as "Where"', () => {
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-panel-row]:not([data-blok-database-filter-rule-button])', 'flex')).toEqual(['0 0 60px']);
  });

  // r19-adv-andor.raw and Round 20 §2 (r20-g-inner2-parts.raw): the property, operator and value buttons are 14px 500, placeholder included.
  it('sets every rule button in weight 500', () => {
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-button]', 'font-weight')).toEqual(['500']);
  });

  // notion-motion.md Round 20 §2: an empty value reads in secondary ink. AA rule: Blok's token, not Notion's lighter rgb(125,122,117).
  it('paints an empty rule value in secondary ink', () => {
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-button][data-blok-database-filter-placeholder]', 'color')).toEqual(['var(--blok-database-ink-secondary)']);
  });

  // notion-motion.md Round 19 §1 (r19-adv-group.raw): no border, fill rgba(66,35,3,0.03), radius 6, padding 8px 8px 0, gap 8.
  it('draws a filter group as a borderless faint box', () => {
    const group = '[data-blok-database-filter-group]';

    expect(declared(group, 'border')).toEqual(['none']);
    expect(declared(group, 'background-color')).toEqual(['var(--blok-database-column-bg)']);
    expect(declared(group, 'border-radius')).toEqual(['var(--blok-radius-control)']);
    expect(declared(group, 'padding')).toEqual(['var(--blok-space-2) var(--blok-space-2) 0']);
    expect(declared(group, 'gap')).toEqual(['var(--blok-space-2)']);
  });

  // r18-adv-addrule.raw, r19-adv-groupmore.raw, r19-adv-andor.raw: a flyout row with a hint line is 45 tall.
  it('makes a flyout row with a hint 45px tall', () => {
    expect(declared('[data-blok-database-panel-page="sort-flyout"] > [data-blok-database-panel-row]:has(> [data-blok-database-panel-text])', 'min-height')).toEqual(['45px']);
  });

  // r19-adv-groupmore.raw: with a group present the outer Value field grew 164 → 215.5, so every ⋯ shares one column.
  it('lets a rule\'s value field grow so the ⋯ buttons line up', () => {
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-value]', 'flex')).toEqual(['1 0 auto']);
  });
});
