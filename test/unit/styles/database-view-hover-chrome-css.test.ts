/**
 * Hover chrome Notion has and Blok lacked, measured in light and dark
 * (research/21 §1f, §1i, §1j, §1k). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');

/** Every declaration block whose selector list contains `selector`, joined. */
const ruleBody = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

/** Light, system dark and forced dark values of a token, in source order. */
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

describe('view hover chrome tokens', () => {
  it.each([
    ['--blok-database-feed-card-hover-shadow', 'rgba(0, 0, 0, 0.03) 0 12px 32px, rgba(0, 0, 0, 0.086) 0 0 0 1px', 'rgba(255, 255, 255, 0.1) 0 0 0 1px inset'],
    ['--blok-database-feed-actions-bg', '#ffffff', 'rgb(47, 47, 47)'],
    ['--blok-database-feed-actions-border', 'rgb(240, 239, 237)', 'rgb(44, 44, 43)'],
    ['--blok-database-timeline-arrow-border', '#ffffff', 'rgb(25, 25, 25)'],
    ['--blok-database-form-question-bg', '#ffffff', 'rgb(25, 25, 25)'],
    ['--blok-database-form-question-ring', 'rgb(182, 212, 243)', 'rgb(53, 95, 139)'],
  ])('%s takes the measured light and dark values, outside colors.css', (token, light, dark) => {
    expect(tokenValues(token)).toEqual([light, dark, dark]);
    expect(colors).not.toContain(`${token}:`);
  });

  it('the feed pill shadow is the same in both themes, so it is set once', () => {
    expect(tokenValues('--blok-database-feed-actions-shadow')).toEqual(['rgba(29, 27, 22, 0.06) 0 2px 12px']);
  });
});

describe('feed card hover (research/21 §1j)', () => {
  it('rings the hovered card', () => {
    expect(ruleBody('[data-blok-database-feed-card]:hover')).toContain('box-shadow: var(--blok-database-feed-card-hover-shadow)');
  });

  it('draws React and More actions in one 55x30 pill: 1px border, 2px padding, 1px gap, 6px radius', () => {
    const pill = ruleBody('[data-blok-database-feed-card-actions]');

    expect(pill).toContain('border: 1px solid var(--blok-database-feed-actions-border)');
    expect(pill).toContain('padding: var(--blok-space-0-5)');
    expect(pill).toContain('gap: var(--blok-space-0-25)');
    expect(pill).toContain('border-radius: var(--blok-radius-control)');
    expect(pill).toContain('background-color: var(--blok-database-feed-actions-bg)');
    expect(pill).toContain('box-shadow: var(--blok-database-feed-actions-shadow)');
  });

  it('hides the whole pill at rest and shows it on hover, an open menu or keyboard focus', () => {
    expect(ruleBody('[data-blok-database-feed-card-actions]')).toContain('opacity: 0');
    expect(ruleBody('[data-blok-database-feed-card-actions]')).toContain('pointer-events: none');
    for (const shown of [
      '[data-blok-database-feed-card]:hover > [data-blok-database-feed-card-actions]',
      '[data-blok-database-feed-card][data-popover-open] > [data-blok-database-feed-card-actions]',
      '[data-blok-database-feed-card-actions]:has(:focus-visible)',
    ]) {
      expect(ruleBody(shown)).toContain('opacity: 1');
      expect(ruleBody(shown)).toContain('pointer-events: auto');
    }
    expect(ruleBody('[data-blok-database-feed-card-actions] > button')).not.toContain('opacity');
  });
});

describe('board and gallery card action pill divider (research/21 §1f)', () => {
  it('splits Edit from ••• with a 1px divider in the cell border colour, keeping the 29 + 28 = 57px pill', () => {
    const edit = ruleBody('[data-blok-database-edit-card]');

    expect(edit).toContain('border-inline-end: 1px solid var(--blok-database-table-border)');
    expect(edit).toContain('width: 29px');
    expect(edit).toContain('box-sizing: border-box');
  });
});

// notion-motion.md Round 23 §4 "Hover fades".
describe('card and feed hover timings (notion-motion.md Round 23 §4)', () => {
  it('fills the card ✎ and ⋯ buttons over 20ms ease-in', () => {
    expect(ruleBody('[data-blok-database-edit-card]')).toMatch(/transition: background-color 20ms ease-in(;|$)/);
    expect(ruleBody('[data-blok-database-card-menu]')).toMatch(/transition: background-color 20ms ease-in(;|$)/);
  });

  it('fades the feed pill over 100ms ease-out, in and out', () => {
    expect(ruleBody('[data-blok-database-feed-card-actions]')).toContain('transition: opacity 100ms ease-out');
  });
});

// notion-motion.md Round 23 §3: Notion lays rgba(35,131,226,0.14) 2px inside the card while its ⋯ menu is open.
describe('board card while its ⋯ menu is open (notion-motion.md Round 23 §3)', () => {
  it('lays a gray overlay 2px inside the picked card, never blue', () => {
    const overlay = ruleBody('[data-blok-database-card]::after');
    const shown = ruleBody('[data-blok-database-card][data-blok-database-card-picked]::after');

    expect(overlay).toContain('inset: var(--blok-space-0-5)');
    expect(overlay).toContain('background-color: var(--blok-icon-active-bg)');
    expect(overlay).toContain('pointer-events: none');
    expect(overlay).toContain('opacity: 0');
    expect(overlay).toContain('transition: opacity 200ms');
    expect(shown).toContain('opacity: 1');
    expect(`${overlay};${shown}`).not.toMatch(/blue|focus-ring|#2383e2|35, 131, 226/i);
  });

  it('drops the hover fill while the menu is open', () => {
    expect(ruleBody('[data-blok-database-card][data-popover-open]')).toContain('background-color: var(--_blok-group-card, var(--blok-database-card-bg))');
  });
});

describe('timeline (research/21 §1i)', () => {
  it('lays the hover overlay over the bar fill, so a conditional colour stays under it', () => {
    expect(ruleBody('[data-blok-database-timeline-bar]::before')).toContain('z-index: -1');
    expect(ruleBody('[data-blok-database-timeline-bar]:hover::before')).toContain('background-color: var(--blok-database-table-header-hover-bg)');
    expect(ruleBody('[data-blok-database-timeline-bar]:hover')).not.toContain('background-color');
  });

  it('borders the 16px off-screen chip in the page colour without growing it', () => {
    const chip = ruleBody('[data-blok-database-timeline-offscreen]');

    expect(chip).toContain('border: 1px solid var(--blok-database-timeline-arrow-border)');
    expect(chip).toContain('box-sizing: border-box');
    expect(chip).toMatch(/inline-size:\s*16px/);
  });
});

describe('form builder question card (research/21 §1k)', () => {
  const card = '[data-blok-database-form-question]:has(> [data-blok-database-form-question-header])';

  it('draws an editable question as a 12px card with a 0.5px inset ring, builder only', () => {
    const body = ruleBody(card);

    expect(body).toContain('background-color: var(--blok-database-form-question-bg)');
    expect(body).toContain('box-shadow: var(--blok-database-form-question-ring) 0 0 0 0, var(--blok-database-form-question-ring) 0 0 0 0.5px inset');
    expect(body).toContain('border-radius: var(--blok-radius-dialog)');
    expect(body).toContain('padding: var(--blok-space-3)');
  });

  // notion-motion.md Round 31 §1: hover grows the ring to 1.25 out + 1.25 in over 0.3s.
  it('on hover grows the ring to 1.25px outside and inside in 0.3s, in gray', () => {
    const hover = ruleBody(`${card}:hover:not(:has([data-blok-database-form-gap]:hover))`);

    expect(ruleBody(card)).toContain('transition: box-shadow 0.3s');
    expect(hover).toContain('box-shadow: var(--blok-border-strong) 0 0 0 1.25px, var(--blok-border-strong) 0 0 0 1.25px inset');
    expect(hover).not.toMatch(/35, 131, 226|39, 131, 222|182, 212, 243/);
  });

  // Round 31 §1: the builder's name is a 24px 700 / 30 textbox; the preview's an H2 24px 700.
  it('draws the question name 24px bold, as a bare textbox in the builder', () => {
    const name = ruleBody('[data-blok-database-form-question-name]');
    const label = ruleBody('[data-blok-database-form-label]');

    expect(name).toContain('font-size: 24px');
    expect(name).toContain('font-weight: 700');
    expect(name).toContain('line-height: 30px');
    expect(name).toContain('border: none');
    expect(name).toContain('background: transparent');
    expect(label).toContain('font-size: 24px');
    expect(label).toContain('font-weight: 700');
  });

  // Round 31 §1: the "+" is a 32px teardrop centred on the gap, 8 left of the card; neutral, not blue.
  it('draws the gap "+" as a 32px teardrop left of the card', () => {
    const gap = ruleBody('[data-blok-database-form-gap]');
    const add = ruleBody('[data-blok-database-form-insert]');
    const box = ruleBody('[data-blok-database-form-insert-box]');

    expect(gap).toContain('position: absolute');
    expect(gap).toContain('block-size: 24px');
    expect(gap).toContain('inset-block-start: -24px');
    expect(add).toContain('inline-size: 32px');
    expect(add).toContain('block-size: 32px');
    expect(box).toContain('inline-size: 32px');
    expect(box).toContain('block-size: 32px');
    expect(`${gap}${add}${box}`).not.toMatch(/35, 131, 226/);
  });

  // notion-motion.md Round 32 §1 (r32-a-gapplus-*.raw): Notion's box is rotate(-45deg) with radius 100% 100% 6px,
  // so its sharp corner points right, at the card; the plus inside turns +45deg and stands upright.
  it('points the teardrop at the card, the plus upright', () => {
    const box = ruleBody('[data-blok-database-form-insert-box]');

    expect(box).toContain('rotate: -45deg');
    expect(box).toContain('border-radius: 50%');
    expect(box).toContain('border-bottom-right-radius: var(--blok-radius-checkbox)');
    expect(ruleBody('[data-blok-database-form-insert-box] svg')).toContain('rotate: 45deg');
  });

  // Round 32 §1: the wrapper scales 0.3 → 1 and fades in over 200ms ease from its right-middle (32px 16px).
  // The exit is unread: it keeps Blok's fade at full size, the scale dropping back only once the fade ends.
  it('scales in from its right-middle and fades over 200ms ease; fades out at full size', () => {
    const add = ruleBody('[data-blok-database-form-insert]');
    const shown = ruleBody('[data-blok-database-form-gap]:hover > [data-blok-database-form-insert]');

    expect(add).toContain('opacity: 0');
    expect(add).toContain('transform: scale(0.3)');
    expect(add).toContain('transform-origin: 32px 16px');
    expect(add).toContain('transition: opacity 0.2s, transform 0s 0.2s');
    expect(shown).toContain('opacity: 1');
    expect(shown).toContain('transform: none');
    expect(shown).toContain('transition: opacity 0.2s ease, transform 0.2s ease');
    expect(ruleBody('[data-blok-database-form-insert]:focus-visible')).toContain('opacity: 1');
  });

  it('draws the insert slot 36 tall and 12 round, and Select type rows 44 tall with a framed 32px icon', () => {
    const slot = ruleBody('[data-blok-database-form-slot]');
    const icon = ruleBody('[data-blok-database-form-type-row] > [data-blok-database-panel-icon]');

    expect(slot).toContain('block-size: 36px');
    expect(slot).toContain('border-radius: var(--blok-radius-dialog)');
    expect(slot).not.toMatch(/35, 131, 226/);
    expect(ruleBody('[data-blok-database-form-type-row]')).toContain('min-height: 44px');
    expect(icon).toContain('inline-size: 32px');
    expect(icon).toContain('block-size: 32px');
    expect(icon).toContain('border-radius: var(--blok-radius-control-sm)');
    expect(icon).toContain('border: 1px solid var(--blok-database-form-type-frame)');
    expect(tokenValues('--blok-database-form-type-frame')[0]).toBe('rgba(84, 72, 49, 0.15)');
  });

  // The view box clips; the "+" sits left of the column, so the form bleeds into the gutter as the table does.
  it('the view box bleeds into the gutter for a form, so the "+" is not clipped', () => {
    expect(ruleBody('[data-blok-database-board-container]:has(> [data-blok-database-table], > [data-blok-database-list], > [data-blok-database-form])'))
      .toContain('padding-inline-start');
  });

  it('a card does not light up while the pointer is on the "+" above it', () => {
    expect(database).toContain(`${card}:hover:not(:has([data-blok-database-form-gap]:hover))`);
  });

  // Round 31 §1: "Form title" H1 40px 700 / 48 and "Description (optional)" 16px / 24, 600 wide.
  it('draws the form title 40px bold and the description 16px, as bare boxes', () => {
    const title = ruleBody('[data-blok-database-form-header] [data-blok-database-form-header-title]');
    const description = ruleBody('[data-blok-database-form-header] [data-blok-database-form-header-description]');

    expect(title).toContain('font-size: 40px');
    expect(title).toContain('font-weight: 700');
    expect(title).toContain('line-height: 48px');
    expect(description).toContain('font-size: 16px');
    expect(description).toContain('line-height: 24px');
    expect(ruleBody('[data-blok-database-form-header]')).toContain('max-inline-size: 600px');
    expect(ruleBody('[data-blok-database-form-header] :is(h1, p, input)')).toContain('border: none');
  });

  // Round 31 §1: the column is 600 wide and builder cards sit 24 apart.
  it('lays the form out 600 wide, with builder cards 24 apart', () => {
    expect(ruleBody('[data-blok-database-form] form')).toContain('max-inline-size: 600px');
    expect(ruleBody('[data-blok-database-form] form:has([data-blok-database-form-question-header])')).toContain('gap: var(--blok-space-6)');
  });

  it('draws the Edit question chip 24px square with a 16px icon and a neutral hover', () => {
    const chip = ruleBody('[data-blok-database-form-question-menu]');

    expect(chip).toContain('inline-size: 24px');
    expect(chip).toContain('block-size: 24px');
    expect(chip).toContain('border-radius: var(--blok-radius-control)');
    expect(ruleBody('[data-blok-database-form-question-menu] svg')).toContain('inline-size: 16px');
    expect(ruleBody('[data-blok-database-form-question-menu]:hover')).toContain('background: var(--blok-database-hover-bg)');
    expect(ruleBody('[data-blok-database-form-question-menu]:hover')).not.toMatch(/35, 131, 226/);
  });
});
