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

  // notion-motion.md Round 23 §2 (r23-adv-btns.raw): gaps 4 after the property, 8 between the rest, 16 before ⋯.
  it('spaces a rule\'s buttons 4, then 8, then 16 before the ⋯', () => {
    expect(declared('[data-blok-database-filter-rule]', 'gap')).toEqual(['var(--blok-space-2)']);
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-side]', 'margin-inline-start')).toEqual(['calc(-1 * var(--blok-space-1))']);
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-button] + [data-blok-database-filter-rule-more]', 'margin-inline-start')).toEqual(['var(--blok-space-2)']);
  });

  // notion-motion.md Round 23 §2 (r23-adv-btns.raw): "Select a date" is a fixed 165, its text left and its chevron right.
  it('makes the Select a date button 165 wide', () => {
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-day]', 'width')).toEqual(['165px']);
  });

  // notion-motion.md Round 22 §2 (r22-adv-cal.raw): the last day row ends 22 above the "Select a date" flyout's bottom.
  it('leaves room under the calendar in a rule\'s day flyout', () => {
    expect(declared('[data-blok-database-chip-date-rule] + [data-blok-database-chip-month]', 'padding-block-end')).toEqual(['var(--blok-space-4)']);
  });

  // r19-adv-groupmore.raw: with a group present the outer Value field grew 164 → 215.5, so every ⋯ shares one column.
  it('lets a rule\'s value field grow so the ⋯ buttons line up', () => {
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-value]', 'flex')).toEqual(['1 0 auto']);
  });
});

// notion-motion.md Round 24 §2 (r24-chev-path.raw): Notion's chip and rule chevron is an 8.64×4.86 glyph in an 8.6×14 box,
// arms about 1.1px. Blok draws its shared stroked chevron (ink 9.25×5.25 units on a 20-unit canvas) at 18.69px, so its
// ink is 8.64×4.91 with 1.17px arms. The box stays 8.6×14 and the drawing overflows it evenly.
describe('database chip chevron', () => {
  it('sits in an 8.6×14 box with its drawing centred', () => {
    expect(declared('[data-blok-database-chip-chevron]', 'width')).toEqual(['8.6px']);
    expect(declared('[data-blok-database-chip-chevron]', 'height')).toEqual(['14px']);
    expect(declared('[data-blok-database-chip-chevron]', 'justify-content')).toEqual(['center']);
    expect(declared('[data-blok-database-chip-chevron]', 'align-items')).toEqual(['center']);
  });

  it('draws the shared chevron at 18.69px so its ink is 8.64 wide', () => {
    expect(declared('[data-blok-database-chip-chevron] svg', 'width')).toEqual(['18.69px']);
    expect(declared('[data-blok-database-chip-chevron] svg', 'height')).toEqual(['18.69px']);
    expect(declared('[data-blok-database-chip-chevron] svg', 'flex')).toEqual(['none']);
    // A chip's [&_svg]:max-h-full would squash it back to the 14px box.
    expect(declared('[data-blok-database-chip-chevron] svg', 'max-height')).toEqual(['none']);
  });

  // Round 24 §2: a chip is padded 0 8 with a 6px gap.
  it('pads a filter chip 0 8px with a 6px gap', () => {
    expect(declared('[data-blok-database-filter-pill]', 'padding-inline')).toEqual(['var(--blok-space-2)']);
    expect(declared('[data-blok-database-filter-pill]', 'gap')).toEqual(['var(--blok-space-1-5)']);
  });

  // Round 24 §2: on a rule button the chevron is rgb(173,169,163) under rgb(44,44,43) text. It is aria-hidden beside its
  // label, so the lighter icon tone (the gutter icon token) is used, not the AA text ink.
  it('paints a rule button chevron in the light icon tone', () => {
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-filter-rule-button] > [data-blok-database-chip-chevron]', 'color'))
      .toEqual(['var(--blok-database-table-gutter-icon)']);
  });
});

// notion-motion.md Round 25 §3 (r25-sortbtns.raw, r25-andor-btn.raw, r25-or-btn.raw, r25-addrule-btn.raw).
describe('sort and rule control chevrons', () => {
  it('paints the sort row chevrons in the light icon tone', () => {
    expect(declared('[data-blok-database-sort-row] > [data-blok-database-panel-row] > [data-blok-database-chip-chevron]', 'color'))
      .toEqual(['var(--blok-database-table-gutter-icon)']);
  });

  it('gives And/Or an 8px gap, its own width and the light chevron', () => {
    expect(declared('[data-blok-database-filter-conjunction]', 'gap')).toEqual(['var(--blok-space-2)']);
    expect(declared('[data-blok-database-filter-conjunction] > [data-blok-database-chip-chevron]', 'color'))
      .toEqual(['var(--blok-database-table-gutter-icon)']);
    expect(database).not.toContain('min-width: 61px');
  });

  // "Where" text, And and Or all end 8 before the property button.
  it('ends "Where" and And/Or at the column end', () => {
    expect(declared('[data-blok-database-filter-conjunction-cell]', 'flex')).toEqual(['0 0 60px']);
    expect(declared('[data-blok-database-filter-conjunction-cell]', 'justify-content')).toEqual(['flex-end']);
    expect(declared('[data-blok-database-filter-rule] > [data-blok-database-panel-note]', 'text-align')).toEqual(['end']);
  });

  // Text 125,122,117 fails AA (4.27:1), so it takes Blok's AA step of that ink.
  it('draws Add filter rule with a 14px chevron box 6 after its text', () => {
    const chevron = '[data-blok-database-filter-add-rule] > [data-blok-database-chip-chevron]';

    expect(declared(chevron, 'width')).toEqual(['14px']);
    expect(declared(chevron, 'height')).toEqual(['14px']);
    expect(declared(chevron, 'color')).toEqual(['var(--blok-database-table-header-icon)']);
    expect(declared(chevron, 'margin-inline-start')).toEqual(['calc(-1 * var(--blok-space-0-5))']);
    expect(declared('[data-blok-database-filter-add-rule]', 'color')).toEqual(['var(--blok-database-ink-secondary)']);
    // The label stops at its text, so the chevron follows it rather than the row's end.
    expect(declared('[data-blok-database-filter-add-rule] > [data-blok-database-panel-label]', 'flex')).toEqual(['0 1 auto']);
  });

  // r25-sortbtns.raw: arrowStraightUpFillSmall is 8×14. Its ink is unread, so Blok's arrow keeps its drawing.
  it('puts the one-sort arrow in an 8×14 box', () => {
    const glyph = '[data-blok-database-filter-pill][data-blok-database-sort-arrow] > [data-blok-database-chip-glyph]';

    expect(declared(glyph, 'width')).toEqual(['8px']);
    expect(declared(glyph, 'height')).toEqual(['14px']);
  });
});
