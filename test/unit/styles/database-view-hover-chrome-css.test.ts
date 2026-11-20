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

// notion-motion.md Round 34 §4 (r34-form-preview-icon.raw): in the 960 preview the cover is 960 wide and
// 30vh (max 280) tall from the modal's top-left; the 600 column is centred, the 78 icon 8 into it and 42 over the cover.
describe('form preview cover and icon', () => {
  const preview = '[data-blok-database-form-preview]';
  const cover = `${preview} [data-blok-database-form-header] > [data-blok-page-cover]`;

  it('centres a 600 column in the preview', () => {
    expect(ruleBody(preview)).toContain('container-type: inline-size');
    expect(ruleBody(preview)).toContain('--_blok-form-preview-column: 600px');
    expect(ruleBody(`${preview} > [data-blok-database-form]`)).toContain('max-inline-size: var(--_blok-form-preview-column)');
    expect(ruleBody(`${preview} > [data-blok-database-form]`)).toContain('margin-inline: auto');
  });

  it('spans the cover edge to edge, 30vh tall up to 280', () => {
    const body = ruleBody(cover);

    expect(body).toContain('inline-size: calc(100cqi + 2 * var(--blok-space-10))');
    expect(body).toContain('block-size: 30vh');
    expect(body).toContain('max-block-size: 280px');
    expect(body).toContain('margin-block-start: calc((var(--blok-space-10) + var(--blok-space-3)) * -1)');
    expect(body).toContain('margin-inline-start: calc(min(0px, (var(--_blok-form-preview-column) - 100cqi) / 2) - var(--blok-space-10))');
  });

  it('lays the icon 42 over the cover, 8 into the column', () => {
    // The cover is positioned: without this the icon paints under it.
    expect(ruleBody(`${preview} [data-blok-database-form-header-row]`)).toContain('position: relative');
    expect(ruleBody(`${cover}:has(~ [data-blok-database-form-header-row] > [data-blok-page-icon])`)).toContain('margin-block-end: -42px');
    expect(ruleBody(`${preview} [data-blok-database-form-header-row] > [data-blok-page-icon]`))
      .toContain('margin-inline-start: calc(var(--blok-space-2) - var(--blok-space-1-25))');
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
    // notion-motion.md Round 65 §4: the title sits 22 under the card top (Round 31's 144 pitch: 120-tall cards).
    expect(body).toContain('padding-block-start: 22px');
  });

  // notion-motion.md Round 31 §1: hover grows the ring to 1.25 out + 1.25 in over 0.3s.
  it('on hover grows the ring to 1.25px outside and inside in 0.3s, in gray', () => {
    const hover = ruleBody(`${card}:hover:not(:has([data-blok-database-form-gap]:hover))`);

    expect(ruleBody(card)).toContain('transition: box-shadow 0.3s');
    expect(hover).toContain('box-shadow: var(--blok-border-strong) 0 0 0 1.25px, var(--blok-border-strong) 0 0 0 1.25px inset');
    expect(hover).not.toMatch(/35, 131, 226|39, 131, 222|182, 212, 243/);
  });

  // notion-motion.md Round 34 §6: the "Edit question" ⋯ fades in and out over 0.2s ease, no delay.
  it('fades the "Edit question" chip in and out over 0.2s ease', () => {
    expect(ruleBody('[data-blok-database-form-question-menu]')).toContain('transition: opacity 0.2s ease');
  });

  // notion-motion.md Round 52 §3, Round 65 §4: the ⋯ sits 34 in from the card's right and 10 under its top (22 padding − 12).
  it('places the "Edit question" chip 10 under the card top and 34 in from its right', () => {
    const chip = ruleBody('[data-blok-database-form-question-menu]');

    expect(chip).toContain('align-self: flex-start');
    expect(chip).toContain('margin-block-start: calc(var(--blok-space-3) * -1)');
    expect(chip).toContain('margin-inline-end: calc(var(--blok-space-0-5) * -1)');
  });

  // Round 31 §1: the builder's name is a 24px 700 / 30 textbox; the preview's an H2 24px 700.
  it('draws the question name 24px bold, as a bare textbox in the builder', () => {
    const name = ruleBody('[data-blok-database-form-question-name]');
    const label = ruleBody('[data-blok-database-form-label]');

    expect(name).toContain('font-size: 24px');
    expect(name).toContain('font-weight: 700');
    expect(name).toContain('line-height: 30px');
    expect(name).toContain('border: none');
    // notion-motion.md Round 65 §4: Notion's title is a pill padded 0 10, so its ink starts 10 in.
    expect(name).toContain('padding: 0 var(--blok-space-2-5)');
    expect(name).toContain('background: transparent');
    expect(label).toContain('font-size: 24px');
    expect(label).toContain('font-weight: 700');
  });

  // notion-motion.md Round 52 §3: while a card drags, each gap shows a 4px pill in the drop-line blue at 0.28; none beside the card.
  it('draws the drag gap lines faint, hides the ones beside the card and the gap "+"', () => {
    const zone = ruleBody('[data-blok-database-form-drop-zone]');

    expect(zone).toContain('background-color: var(--blok-database-drop-line, rgba(35, 131, 226, 0.43))');
    expect(zone).toContain('border-radius: var(--blok-radius-pill)');
    expect(zone).toContain('opacity: 0.28');
    expect(ruleBody('[data-blok-database-form-drop-zone][data-adjacent]')).toContain('opacity: 0');
    expect(ruleBody('[data-blok-database-form-drop-zone][data-target]')).toContain('opacity: 1');
    expect(ruleBody('[data-blok-database-form]:has([data-blok-database-drag-source]) [data-blok-database-form-insert]')).toContain('visibility: hidden');
  });

  // notion-motion.md Round 53 (a): the lines fade between faint and full over 0.14s.
  it('fades the drag gap lines over 0.14s', () => {
    expect(ruleBody('[data-blok-database-form-drop-zone]')).toContain('transition: opacity 0.14s cubic-bezier(0.2, 0, 0, 1)');
  });

  // notion-motion.md Round 55 §3: each line fades in from 0 when the drag starts, not at 0.28 at once.
  it('fades the drag gap lines in from 0 as they appear', () => {
    const starting = [...database.matchAll(/@starting-style\s*\{\s*([^{}]+)\{([^{}]*)\}\s*\}/g)]
      .filter((match) => match[1].trim() === '[data-blok-database-form-drop-zone]');

    expect(starting.map((match) => match[2].trim())).toEqual(['opacity: 0;']);
  });

  // notion-motion.md Round 53 (b): the moving copy keeps the hovered card's ring. Gray here, not Notion's blue.
  it('draws the dragged card\'s copy with the hover ring', () => {
    expect(ruleBody('[data-blok-database-ghost] > [data-blok-database-form-question]')).toContain('box-shadow: var(--blok-border-strong) 0 0 0 1.25px, var(--blok-border-strong) 0 0 0 1.25px inset');
  });

  // notion-motion.md Round 53 (d) / Round 54 §7: the "+" sits 12 under the last card; the cards stay 24 apart.
  it('sets Add question 12px under the last card', () => {
    expect(ruleBody('[data-blok-database-form-add]')).toContain('margin-block-start: calc(var(--blok-space-3) - var(--blok-space-6))');
  });

  // notion-motion.md Round 52 §3: Add question is a round 32 "+" centred under the cards; hover deepens it over 100ms ease-in-out.
  // Notion tints it blue; neutral here like the gap "+" (CLAUDE.md "No blue selected states").
  it('draws Add question as a round 32px "+" centred under the cards', () => {
    const add = ruleBody('[data-blok-database-form-add]');

    expect(add).toContain('inline-size: 32px');
    expect(add).toContain('block-size: 32px');
    expect(add).toContain('border-radius: var(--blok-radius-pill)');
    expect(add).toContain('align-self: center');
    expect(add).toContain('background: var(--blok-database-hover-bg)');
    expect(add).toContain('transition: background-color 100ms ease-in-out');
    expect(ruleBody('[data-blok-database-form-add]:hover')).toContain('background: var(--blok-database-pressed-bg)');
    expect(add).not.toMatch(/35, 131, 226|39, 131, 222/);
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
  // Round 33 §1 (r33-form-gapplus-exit*.raw): it leaves on the next frame, with no fade or scale.
  it('scales in from its right-middle and fades over 200ms ease; leaves at once', () => {
    const add = ruleBody('[data-blok-database-form-insert]');
    const shown = ruleBody('[data-blok-database-form-gap]:hover > [data-blok-database-form-insert]');

    expect(add).toContain('opacity: 0');
    expect(add).toContain('transform: scale(0.3)');
    expect(add).toContain('transform-origin: 32px 16px');
    expect(add).not.toMatch(/transition: opacity/);
    expect(shown).toContain('opacity: 1');
    expect(shown).toContain('transform: none');
    expect(shown).toContain('transition: opacity 0.2s ease, transform 0.2s ease');
    expect(ruleBody('[data-blok-database-form-insert]:focus-visible')).toContain('opacity: 1');
  });

  // notion-motion.md Round 31 §1, Round 32 §4: the answer box is 38 tall (Blok drew 28).
  it('draws the answer box 38 tall', () => {
    const answer = ruleBody('[data-blok-database-form-question] :is(input:not([type="checkbox"], [type="radio"], [data-blok-database-form-question-name], [data-blok-database-form-option-name]), textarea, select, [data-blok-database-form-provider-answer]):not([data-blok-database-form-checkbox-label])');

    expect(answer).toContain('box-sizing: border-box');
    expect(answer).toContain('min-block-size: 38px');
  });

  // notion-motion.md Round 74 §5 (r74-n-form-card.raw): the text sits 9px 10px in from the box's edge; Blok's 1px border is part of that.
  it('sets a text answer\'s text 9px 10px in from the box edge', () => {
    const text = ruleBody('[data-blok-database-form-question] input:not([type="checkbox"], [type="radio"], [data-blok-database-form-question-name], [data-blok-database-form-option-name])');

    expect(text).toContain('padding-block: calc(var(--blok-space-2-25) - var(--blok-border-width-hairline))');
    expect(text).toContain('padding-inline: calc(var(--blok-space-2-5) - var(--blok-border-width-hairline))');
    expect(ruleBody('[data-blok-database-form-question] :is(input:not([type="checkbox"], [type="radio"], [data-blok-database-form-question-name], [data-blok-database-form-option-name]), textarea, select, [data-blok-database-form-provider-answer]):not([data-blok-database-form-checkbox-label])'))
      .toContain('border-radius: var(--blok-radius-control)');
  });

  // notion-motion.md Round 75 §2 (r75-n-form-answers.raw): Date, Select and Multi-select answers start 62 under the card top,
  // 8 above a text answer; option rows are 32 tall with an 18px box; a checkbox row is 36 tall.
  it('places the builder\'s date, option and checkbox answers where Notion does', () => {
    const builder = '[data-blok-database-form-question]:has(> [data-blok-database-form-question-header])';
    const options = ruleBody(`${builder} > [data-blok-database-form-question-name-error] + :is([data-blok-database-form-options], [data-blok-database-form-date], [data-blok-database-form-selection-limit])`);
    const row = ruleBody('[data-blok-database-form-option]');
    const box = ruleBody(':is([data-blok-database-form-option], [data-blok-database-form-checkbox-row], [data-blok-database-form-checkbox-answer]) input:is([type="radio"], [type="checkbox"])');
    const hint = ruleBody(`${builder} > [data-blok-database-form-selection-limit]`);
    const check = ruleBody('[data-blok-database-form-checkbox-row]');

    expect(options).toContain('margin-block-start: calc(-1 * var(--blok-space-2))');
    expect(hint).toContain('margin-block-end: var(--blok-space-2)');
    expect(hint).toContain('line-height: 24px');
    expect(row).toContain('block-size: 32px');
    expect(row).toContain('margin-inline: calc(-1 * var(--blok-space-2))');
    expect(box).toContain('inline-size: 18px');
    expect(box).toContain('block-size: 18px');
    expect(check).toContain('min-block-size: 36px');
    expect(ruleBody('[data-blok-database-form-add-option]')).toContain('block-size: 28px');
    expect(ruleBody('[data-blok-database-form-date-glyph] svg')).toContain('inline-size: 16px');
    expect(ruleBody('[data-blok-database-form-question] button[data-blok-database-form-date][data-blok-database-form-provider-answer][data-empty]'))
      .toContain('color: var(--blok-database-title-placeholder)');
  });

  // notion-motion.md Round 76 §3 (r76-n-form-builder.raw): option and checkbox marks are 15x15 white boxes
  // with a 1.5px rgba(42,28,0,0.07) ring, r50% / r2, inset 1.5 in their 18px slot.
  it('draws the builder\'s option marks as Notion\'s 15px ringed boxes', () => {
    const mark = ruleBody('[data-blok-database-form-option] input:is([type="radio"], [type="checkbox"])');

    expect(ruleBody(':is([data-blok-database-form-checkbox-row], [data-blok-database-form-checkbox-answer]) input[type="checkbox"]')).toBe(mark);

    expect(mark).toContain('appearance: none');
    expect(mark).toContain('inline-size: 15px');
    expect(mark).toContain('block-size: 15px');
    expect(mark).toContain('margin: 1.5px');
    expect(mark).toContain('box-shadow: 0 0 0 1.5px var(--blok-database-form-mark-ring, var(--blok-database-table-border))');
    // Round 77 §4 "Dark marks": the fill is the page colour, white in light and rgb(25,25,25) in dark.
    expect(mark).toContain('background-color: var(--blok-bg-primary)');
    expect(mark).toContain('border-radius: var(--blok-radius-mark)');
    expect(ruleBody('[data-blok-database-form-option] input[type="radio"]')).toContain('border-radius: 50%');
  });

  // Round 76 §3 "Option row hover": the row fills rgba(55,53,47,0.06); "Drag to move" 16x24 sits 2 in, "Delete option" 24x24 4 from its end.
  it('fills a hovered option row and shows its drag handle and Delete option', () => {
    const shown = ruleBody('[data-blok-database-form-option]:hover :is([data-blok-database-form-option-handle], [data-blok-database-form-option-delete])');

    expect(ruleBody('[data-blok-database-form-option]:has(:focus-visible) :is([data-blok-database-form-option-handle], [data-blok-database-form-option-delete])')).toBe(shown);
    const handle = ruleBody('[data-blok-database-form-option-handle]');
    const remove = ruleBody('[data-blok-database-form-option-delete]');

    expect(ruleBody(':is([data-blok-database-form-option], [data-blok-database-form-checkbox-row]):hover')).toContain('background-color: var(--blok-database-add-hover-bg)');
    expect(ruleBody(':is([data-blok-database-form-option-handle], [data-blok-database-form-option-delete])')).toContain('visibility: hidden');
    expect(shown).toContain('visibility: visible');
    expect(handle).toContain('inline-size: 16px');
    expect(handle).toContain('block-size: 24px');
    expect(handle).toContain('inset-inline-start: 2px');
    expect(remove).toContain('inline-size: 24px');
    expect(remove).toContain('block-size: 24px');
    expect(remove).toContain('inset-inline-end: var(--blok-space-1)');
  });

  // Round 77 §4: the handle's glyph is a 20 box in ink 173,169,163 (dark 125,122,117); the delete glyph is 18 in 142,139,134 (dark 173,169,163).
  it('draws the option row glyphs in Notion\'s sizes and inks', () => {
    const handleSvg = ruleBody('[data-blok-database-form-option-handle] svg');
    const removeSvg = ruleBody('[data-blok-database-form-option-delete] svg');

    expect(handleSvg).toContain('inline-size: 20px');
    expect(handleSvg).toContain('block-size: 20px');
    expect(handleSvg).toContain('flex: none');
    expect(removeSvg).toContain('inline-size: 18px');
    expect(removeSvg).toContain('block-size: 18px');
    expect(ruleBody('[data-blok-database-form-option-handle]')).toContain('color: var(--blok-database-table-gutter-icon)');
    expect(ruleBody('[data-blok-database-form-option-delete]')).toContain('color: var(--blok-database-table-header-icon)');
    expect(tokenValues('--blok-database-table-gutter-icon')).toEqual(['rgb(173, 169, 163)', 'rgb(125, 122, 117)', 'rgb(125, 122, 117)']);
    expect(tokenValues('--blok-database-table-header-icon')).toEqual(['rgb(142, 139, 134)', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
  });

  // Round 77 §4 "Option drag": passed rows slide transform 0.2s ease; the dragged row has no fill and does not slide.
  it('slides the passed option rows and keeps the dragged row unfilled', () => {
    const rows = ruleBody('[data-blok-database-option-reordering] [data-blok-database-form-option]');
    const dragged = ruleBody('[data-blok-database-option-reordering] [data-blok-database-form-option][data-dragging]');

    expect(rows).toContain('transition: transform 200ms ease');
    expect(dragged).toContain('background-color: transparent');
    expect(dragged).toContain('transition: none');
    expect(dragged).toContain('z-index: 1');
  });

  // Round 77 §4 "Respondents": the label is 16px text 12 after the 18 box.
  it('sets a respondent\'s checkbox label beside the box', () => {
    const row = ruleBody('[data-blok-database-form-checkbox-answer]');

    expect(row).toContain('display: flex');
    expect(row).toContain('align-items: center');
    expect(row).toContain('gap: var(--blok-space-3)');
    expect(ruleBody('[data-blok-database-form-checkbox-text]')).toContain('font-size: 16px');
    expect(ruleBody('[data-blok-database-form-checkbox-text]')).toContain('color: var(--blok-database-ink)');
  });

  // Round 78 §3 "Respondent checkbox": an 18 box holding a 15x15 white mark at +1.5, r2, ring rgba(27,21,0,0.19) 1.5px.
  // Dark is unmeasured: the builder mark's dark ring (Round 77 §4).
  it('draws a respondent\'s checkbox as the builder\'s 18px box and 15px mark, with a darker ring', () => {
    const slot = ruleBody(':is([data-blok-database-form-option], [data-blok-database-form-checkbox-row], [data-blok-database-form-checkbox-answer]) input:is([type="radio"], [type="checkbox"])');
    const mark = ruleBody(':is([data-blok-database-form-checkbox-row], [data-blok-database-form-checkbox-answer]) input[type="checkbox"]');

    expect(slot).toContain('inline-size: 18px');
    expect(mark).toContain('inline-size: 15px');
    expect(mark).toContain('margin: 1.5px');
    expect(mark).toContain('border-radius: var(--blok-radius-mark)');
    expect(mark).toContain('box-shadow: 0 0 0 1.5px var(--blok-database-form-mark-ring, var(--blok-database-table-border))');
    expect(ruleBody('[data-blok-database-form-checkbox-answer]')).toContain('--blok-database-form-mark-ring: var(--blok-database-form-answer-mark-ring)');
    expect(tokenValues('--blok-database-form-answer-mark-ring')).toEqual(['rgba(27, 21, 0, 0.19)', 'rgba(255, 255, 243, 0.082)', 'rgba(255, 255, 243, 0.082)']);
  });

  // Round 79 §3 "Respondent checkbox, checked": the 15 mark fills and rings in one colour, a 14 check at +2,+2.
  // r79-n-respondent-cb-checked.raw: the check is Notion's filled 16-unit path in rgb(243, 249, 253), not a stroke.
  it('draws a checked respondent checkbox as the database checkbox\'s checked mark', () => {
    const checked = ruleBody(':is([data-blok-database-form-checkbox-row], [data-blok-database-form-checkbox-answer]) input[type="checkbox"]:checked');

    expect(checked).toContain('background-color: var(--blok-database-checkbox-checked-bg)');
    expect(checked).toContain('box-shadow: 0 0 0 1.5px var(--blok-database-checkbox-checked-bg)');
    expect(checked).toContain('background-size: 14px 14px');
    expect(checked).toContain('background-position: center');
    expect(checked).toContain('background-repeat: no-repeat');
    expect(checked).toMatch(/background-image: url\("data:image\/svg\+xml,[^"]*viewBox='0 0 16 16'[^"]*d='M11\.62 3\.18a\.876\.876 0 0 1 1\.5\.9l-5\.244 8\.74a\.876\.876 0 0 1-1\.414\.12L2\.966 8\.86a\.875\.875 0 1 1 1\.328-1\.138L7 10\.879z' fill='%23f3f9fd'/);
    expect(checked).not.toMatch(/background-image:[^;]*stroke/);
    expect(tokenValues('--blok-database-checkbox-check')).toEqual(['#ffffff', '#ffffff', '#ffffff']);
  });

  // Round 76 §3 "Checkbox label": a 26-tall textarea 12 after the box, no padding, 16px; the row pads 5 10.
  it('draws the checkbox label as a bare 26px field after the box', () => {
    const label = ruleBody('[data-blok-database-form-checkbox-label]');

    expect(label).toContain('block-size: 26px');
    expect(label).toContain('padding: 0');
    expect(label).toContain('border: none');
    expect(label).toContain('resize: none');
    expect(label).toContain('font-size: 16px');
    expect(ruleBody('[data-blok-database-form-checkbox-row]')).toContain('gap: var(--blok-space-3)');
    expect(database).toContain('[data-blok-database-form-provider-answer]):not([data-blok-database-form-checkbox-label]) {');
  });

  // Round 76 §3 "Dropdown mode": a 38-tall hint field, pad 0 10, chevron 6 from its end, rows 4 under it.
  it('draws the dropdown hint field over the option rows', () => {
    const hint = ruleBody('[data-blok-database-form-dropdown-hint]');

    expect(hint).toContain('block-size: 38px');
    expect(hint).toContain('margin-block-end: var(--blok-space-1)');
    expect(hint).toContain('padding-inline: calc(var(--blok-space-2-5) - var(--blok-border-width-hairline)) calc(var(--blok-space-1-5) - var(--blok-border-width-hairline))');
    expect(hint).toContain('border: 1px solid var(--blok-database-form-answer-border)');
    expect(hint).toContain('color: var(--blok-database-title-placeholder)');
    expect(ruleBody('[data-blok-database-form-dropdown-hint] [data-blok-database-form-dropdown-chevron] svg')).toContain('inline-size: 16px');
  });

  it('keeps an option name out of the 38px answer box', () => {
    expect(database).toContain('[data-blok-database-form-question] :is(input:not([type="checkbox"], [type="radio"], [data-blok-database-form-question-name], [data-blok-database-form-option-name])');
  });

  it('has no rule for the in-card Required checkbox, which is gone', () => {
    expect(database).not.toContain('[data-blok-database-form-required-toggle]');
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

  // notion-motion.md Round 52 and Round 65 §4: rows 266 wide at the panel's + 12, and no scale on open.
  it('insets Select type rows 8 inside the panel padding, and opens the panel with no scale', () => {
    const row = ruleBody('[data-blok-database-form-type-row]');

    expect(row).toContain('width: auto');
    expect(row).toContain('margin-inline: var(--blok-space-2)');
    expect(ruleBody("[data-blok-popover][data-blok-popover-custom-class~='blok-database-form-type-menu']:not([data-blok-popover-opened='true']) [data-blok-popover-container]")).toContain('transform: none');
    const scale = database.indexOf("[data-blok-popover-custom-class~='blok-database-cell-editor']:not([data-blok-popover-opened='true']) [data-blok-popover-container] {");
    const none = database.indexOf("[data-blok-popover][data-blok-popover-custom-class~='blok-database-form-type-menu']:not([data-blok-popover-opened='true']) [data-blok-popover-container]");

    // Same specificity as the scale rule, so it must come after it.
    expect(none).toBeGreaterThan(scale);
  });

  // The view box clips; the "+" sits left of the column, so the form bleeds into the gutter as the table does.
  it('the view box bleeds into the gutter for a form, so the "+" is not clipped', () => {
    expect(ruleBody('[data-blok-database-board-container]:has(> [data-blok-database-table], > [data-blok-database-list], > [data-blok-database-form])'))
      .toContain('padding-inline-start');
  });

  it('a card does not light up while the pointer is on the "+" above it', () => {
    expect(database).toContain(`${card}:hover:not(:has([data-blok-database-form-gap]:hover))`);
  });

  // Round 79 §5 "Form builder": Notion pads the title 0 2 and the description 0 4; the placeholder ink stays Blok's AA ink.
  it('insets the builder\'s title 2px and description 4px, keeping the AA placeholder ink', () => {
    expect(ruleBody('[data-blok-database-form-header] input[data-blok-database-form-header-title]')).toContain('padding-inline: var(--blok-space-0-5)');
    expect(ruleBody('[data-blok-database-form-header] input[data-blok-database-form-header-description]')).toContain('padding-inline: var(--blok-space-1)');
    expect(ruleBody('[data-blok-database-form-header] input::placeholder')).toContain('color: var(--blok-database-title-placeholder)');
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

  // notion-motion.md Round 32 §4 (r32-b-form-geom.raw): the builder's 600 column is centred in the database,
  // the Form icon / Form cover row sits 50 under the toolbar, the title 4 under the row and 19 in from the column,
  // the description 16 under the title, the access bar (600x48, padding 10 22) 24 under it and the first card 34 under that.
  describe('builder column', () => {
    const builder = '[data-blok-database-form]:has(> [data-blok-database-form-access])';

    it('centres the header, the access bar and the cards', () => {
      expect(ruleBody(`${builder} > :is([data-blok-database-form-header], [data-blok-database-form-access], form)`)).toContain('margin-inline: auto');
    });

    it('spaces the header as measured', () => {
      const header = ruleBody(`${builder} > [data-blok-database-form-header]`);

      expect(header).toContain('padding-block-start: var(--_blok-form-header-top)');
      expect(ruleBody(builder)).toContain('--_blok-form-header-top: 32px');
      expect(header).toContain('padding-inline-start: var(--_blok-form-header-inset)');
      expect(ruleBody(builder)).toContain('--_blok-form-header-inset: 19px');
      expect(header).toContain('margin-block-end: var(--blok-space-6)');
      expect(ruleBody('[data-blok-database-form-header-row]')).toContain('min-block-size: 28px');
      expect(ruleBody('[data-blok-database-form-header-row]')).toContain('margin-block-end: var(--blok-space-1)');
      // Notion's Form cover starts where Form icon ends (703.3 = 603 + 100.3).
      expect(ruleBody('[data-blok-database-form-header-row] [data-blok-page-add-cover]')).toContain('margin-inline-start: 0');
      expect(ruleBody(`${builder} [data-blok-database-form-header-description]`)).toContain('margin-block-start: var(--blok-space-4)');
    });

    // notion-motion.md Round 44 §1 (r44-q1.raw): the column is min(600, database − 80), so 458 in a 538 database.
    it('narrows the column to 80 under the database, header, access bar and cards alike', () => {
      const column = `${builder} > :is([data-blok-database-form-header], [data-blok-database-form-access], form)`;

      expect(ruleBody(column)).toContain('max-inline-size: min(600px, 100% - 80px)');
      expect(ruleBody(`${builder} > [data-blok-database-form-access]`)).not.toContain('max-inline-size');
    });

    // notion-motion.md Round 65 §4: the first card starts 24 under the bar.
    it('draws the access bar 48 tall, 24 above the first card', () => {
      const access = ruleBody(`${builder} > [data-blok-database-form-access]`);

      expect(access).toContain('min-block-size: 48px');
      expect(access).toContain('padding: var(--blok-space-2-5) var(--_blok-form-access-inset)');
      expect(access).toContain('--_blok-form-access-inset: 22px');
      expect(access).toContain('margin-block-end: var(--blok-space-6)');
    });

    // notion-motion.md Round 33 §1 (r33-form-*.raw): the icon is a 78 box (radius 4, no hover fill) where the title
    // was, 8 right of the title; "Form cover" sits alone in a 40 row under it. A cover is 160 tall across the whole
    // database at the header's top; the icon overlaps its bottom by 18 and the title sits 12 under the icon.
    describe('form icon and cover', () => {
      const header = `${builder} > [data-blok-database-form-header]`;
      const withIcon = `${header} > [data-blok-database-form-header-row]:has(> [data-blok-page-icon])`;
      const withCover = `${header}:has(> [data-blok-page-cover])`;

      it('draws the icon as a 78 box with radius 4 and no hover fill, 8 right of the title', () => {
        expect(ruleBody('[data-blok-database-form-header]')).toContain('--blok-page-icon-box: 78px');
        expect(ruleBody('[data-blok-database-form-header] [data-blok-page-icon]')).toContain('border-radius: var(--blok-radius-control-sm)');
        expect(ruleBody('[data-blok-database-form-header] [data-blok-page-icon]:hover:not(:disabled)')).toContain('background: transparent');
        expect(ruleBody(`${withIcon} > [data-blok-page-icon]`)).toContain('margin-inline-start: calc(var(--blok-space-2) - var(--blok-space-1-25))');
      });

      it('puts the icon where the title was and "Form cover" alone in a 40 row under it', () => {
        const row = ruleBody(withIcon);

        expect(row).toContain('flex-direction: column');
        expect(row).toContain('padding-block-start: var(--_blok-form-header-top)');
        expect(ruleBody(`${withIcon} > [data-blok-page-add-cover]`)).toContain('margin-block-start: var(--blok-space-2)');
      });

      it('spans the cover 160 tall across the database from the header top, under an 18 overlap and a 12 gap', () => {
        const cover = ruleBody(`${header} > [data-blok-page-cover]`);

        expect(ruleBody(builder)).toContain('container-type: inline-size');
        expect(cover).toContain('block-size: 160px');
        expect(cover).toContain('inline-size: 100cqi');
        expect(cover).toContain('margin-block-start: calc(var(--_blok-form-header-top) * -1)');
        expect(cover).toContain('margin-inline-start: calc(min(0px, (600px - 100cqi) / 2) - var(--_blok-form-header-inset))');
        expect(ruleBody(`${withCover} > [data-blok-page-cover]:has(~ [data-blok-database-form-header-row] > [data-blok-page-icon])`)).toContain('margin-block-end: calc(var(--blok-space-4-5) * -1)');
        expect(ruleBody(`${withCover} > [data-blok-database-form-header-row]:has(> [data-blok-page-icon])`)).toContain('padding-block-start: 0');
        expect(ruleBody(`${withCover} > [data-blok-database-form-header-row]:has(> [data-blok-page-icon])`)).toContain('margin-block-end: var(--blok-space-3)');
      });

      // notion-motion.md Round 34 §4: with a cover and no icon, the row starts 24 under the cover with padding
      // 16 0 4, so "Form icon" is at cover + 40 and the title at cover + 72; the button shows at rest.
      it('with a cover but no icon, puts "Form icon" 40 under the cover, the title 72, and shows it at rest', () => {
        const noIcon = `${withCover} > [data-blok-database-form-header-row]:not(:has(> [data-blok-page-icon]))`;
        const row = ruleBody(noIcon);

        // The cover keeps its 8 (page-title.css); the row adds 16.
        expect(row).toContain('margin-block: var(--blok-space-4) 0');
        expect(row).toContain('padding-block: var(--blok-space-4) var(--blok-space-1)');
        expect(ruleBody(`${noIcon} > [data-blok-page-add-icon]`)).toContain('opacity: 1');
      });
    });

    // Round 31 §1: the ghost buttons show while the pointer is on the header, and fade out over 100ms.
    it('shows Form icon and Form cover while the pointer is on the header', () => {
      expect(ruleBody('[data-blok-database-form-header]:hover :is([data-blok-page-add-icon], [data-blok-page-add-cover])')).toContain('opacity: 1');
      // The page title's 100ms fade reaches Add icon only inside its own row; Form icon needs it here.
      expect(ruleBody('[data-blok-database-form-header-row] [data-blok-page-add-icon]')).toContain('transition: opacity 100ms ease');
    });
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

  // notion-motion.md Round 31 §1, Round 32 §4: Notion shows "Edit question" on hover only.
  it('hides the Edit question chip until the card is hovered, keeping it for keyboard focus and an open menu', () => {
    const hidden = ruleBody('[data-blok-database-form-question]:not(:hover) [data-blok-database-form-question-menu]:not(:focus-visible, [aria-expanded="true"])');

    expect(hidden).toContain('opacity: 0');
    expect(database).toMatch(/@media \(hover: hover\) \{ \[data-blok-database-form-question\]:not\(:hover\) \[data-blok-database-form-question-menu\]/);
  });

  // r32-b-form-geom.raw: the name ends at 617.2 and the answer starts at 635.2, 18 below. The card's gap gives 4 of it.
  it('puts the answer 18px under the question name', () => {
    expect(ruleBody('[data-blok-database-form-question-header]')).toContain('margin-block-end: var(--blok-space-3-5)');
    expect(ruleBody('[data-blok-database-form-question]')).toContain('gap: var(--blok-space-1)');
  });
});
