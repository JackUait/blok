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

describe('timeline (research/21 §1i)', () => {
  it('lays the hover overlay over the bar fill, so a conditional colour stays under it', () => {
    const hover = ruleBody('[data-blok-database-timeline-bar]:hover');

    expect(hover).toContain('background-image: linear-gradient(var(--blok-database-table-header-hover-bg), var(--blok-database-table-header-hover-bg))');
    expect(hover).not.toContain('background-color');
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
    expect(body).toContain('box-shadow: var(--blok-database-form-question-ring) 0 0 0 0.5px inset');
    expect(body).toContain('border-radius: var(--blok-radius-dialog)');
    expect(body).toContain('padding: var(--blok-space-3)');
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
