/**
 * Gallery and calendar look: measured Notion values (research/07, research/08),
 * tokens kept out of colors.css, logical properties and reduced motion.
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');

/** Body of every rule whose selector list holds `selector`, joined. */
const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

const section = (start: string, end: string): string => css.slice(css.indexOf(start), css.indexOf(end));

const galleryCss = section('[data-blok-database-gallery] {', '/* ─── Calendar ─── */');
const calendarCss = css.slice(css.indexOf('[data-blok-database-calendar] {'));

const TOKENS = [
  '--blok-database-gallery-card-bg',
  '--blok-database-gallery-card-shadow',
  '--blok-database-gallery-card-hover-bg',
  '--blok-database-gallery-preview-bg',
  '--blok-database-gallery-preview-border',
  '--blok-database-gallery-preview-text',
  '--blok-database-gallery-title-text',
  '--blok-database-gallery-muted-text',
  '--blok-database-calendar-border',
  '--blok-database-calendar-weekend-bg',
  '--blok-database-calendar-muted-text',
  '--blok-database-calendar-day-text',
  '--blok-database-calendar-nav-icon',
  '--blok-database-calendar-event-bg',
  '--blok-database-calendar-event-shadow',
  '--blok-database-calendar-event-hover-bg',
  '--blok-database-calendar-today-text',
];

describe('database gallery and calendar styles', () => {
  it.each(TOKENS)('%s is defined for light, system dark and forced dark, and not in colors.css', (token) => {
    expect(css.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(colors).not.toContain(`${token}:`);
  });

  it('uses the measured gallery grid gap and title type', () => {
    expect(ruleBody('[data-blok-database-gallery-grid]')).toContain('gap: var(--blok-space-4)');
    expect(ruleBody('[data-blok-database-gallery-title]')).toMatch(/font-size:\s*15px/);
    expect(ruleBody('[data-blok-database-gallery-title]')).toMatch(/font-weight:\s*500/);
  });

  // findings-listgallery L13: the preview is 9/16 of the card width; the card is preview + title, no bottom padding.
  it('draws the preview 16:9 at every card size, with no padding under the card', () => {
    expect(ruleBody('[data-blok-database-gallery-preview]')).toContain('aspect-ratio: 16 / 9');
    expect(css).not.toContain('--blok-database-gallery-preview-height');
    expect(ruleBody('[data-blok-database-gallery-card]')).not.toContain('padding-block-end');
  });

  // findings-listgallery L12: a long title wraps in full; grid rows stretch same-row cards to one height.
  it('wraps a long title instead of cutting it', () => {
    const title = ruleBody('[data-blok-database-gallery-title]');

    expect(title).toContain('white-space: normal');
    expect(title).toContain('overflow-wrap: anywhere');
    expect(title).not.toContain('text-overflow: ellipsis');
    expect(ruleBody('[data-blok-database-gallery-grid]')).not.toContain('align-items');
  });

  // findings-listgallery L22: a compact gallery card sets its properties side by side, as a compact board card.
  it('sets a compact gallery card\'s properties side by side', () => {
    const body = ruleBody('[data-blok-database-gallery][data-card-layout="compact"] [data-blok-database-gallery-properties]');

    expect(body).toContain('flex-direction: row');
    expect(body).toContain('flex-wrap: wrap');
  });

  // findings-listgallery L14: the "+ New page" tile is a card-size tile with the card ring, 15px gray.
  it('draws the "+ New page" tile at card height with the card ring', () => {
    const tile = ruleBody('[data-blok-database-gallery-new]');

    expect(tile).toContain('box-shadow: 0 0 0 1px var(--blok-database-gallery-preview-border)');
    expect(tile).toContain('font-size: 15px');
    expect(tile).not.toContain('min-height: 80px');
    expect(ruleBody('[data-blok-database-gallery-new]::before')).toContain('padding-block-start: calc(56.25% + 38.5px)');
  });

  it('crops images unless Fit image is on', () => {
    expect(ruleBody('[data-blok-database-gallery-image]')).toMatch(/object-fit:\s*cover/);
    expect(ruleBody('[data-blok-database-gallery][data-fit-image] [data-blok-database-gallery-image]')).toMatch(/object-fit:\s*contain/);
  });

  it('sizes the grid per card size', () => {
    for (const size of ['small', 'medium', 'large']) {
      expect(ruleBody(`[data-blok-database-gallery][data-card-size="${size}"]`)).toContain('--blok-database-gallery-card-min');
    }
  });

  it('uses the measured calendar sizes: 124px day cells inline, 140px wide, 28px event cards, 24px today circle', () => {
    // findings C09: 124px at a 98.7px column (inline), research/07: 140px at a 175.9px column.
    expect(ruleBody('[data-blok-database-calendar-day]')).toMatch(/max\(124px,/);
    expect(css).toMatch(/@container blok-calendar \(min-width: 960px\)\s*\{\s*\[data-blok-database-calendar-day\]\s*\{[^}]*max\(140px,/);
    expect(ruleBody('[data-blok-database-calendar]')).toContain('container: blok-calendar / inline-size');
    expect(ruleBody('[data-blok-database-calendar-event]')).toMatch(/min-block-size:\s*28px/);
    expect(ruleBody('[data-blok-database-calendar-event-title]')).toMatch(/font-weight:\s*600/);
    expect(ruleBody('[data-blok-database-calendar-day][data-today] [data-blok-database-calendar-day-number]')).toContain('var(--blok-database-today)');
  });

  // 78-alarm-calendar.png: a card grows from 28px to 52px with one shown property, and the date is cut, not ellipsized.
  it('gives each shown property its own 24px line, clipped at the card edge', () => {
    const event = ruleBody('[data-blok-database-calendar-event]');
    const property = ruleBody('[data-blok-database-calendar-event-property]');

    expect(event).not.toMatch(/(?:^|;)\s*height:/);
    expect(event).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody('[data-blok-database-calendar-event-title]')).toMatch(/block-size:\s*24px/);
    expect(property).toMatch(/line-height:\s*24px/);
    expect(property).toMatch(/white-space:\s*nowrap/);
    expect(property).toMatch(/text-overflow:\s*clip/);
    // The base cell wraps (pre-wrap flex): a plain date would take two lines and spill out of the card.
    expect(ruleBody('[data-blok-database-calendar-event-property] > [data-blok-database-cell]')).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody('[data-blok-database-calendar-event-property] > [data-blok-database-cell]')).toMatch(/flex-wrap:\s*nowrap/);
    // notion-spec-2 §21.9: every value row is 24 tall, so the 34 + 24n lane pitch holds, and it is cut at the card's
    // own edge (calendar-card-crop.png: "2:3" stops at the border), not 6px inside it.
    expect(property).toMatch(/block-size:\s*24px/);
    expect(property).toMatch(/align-items:\s*center/);
    expect(property).toMatch(/flex:\s*1 0 calc\(100% \+ 2 \* var\(--blok-space-1-5\)\)/);
    expect(property).toMatch(/margin-inline:\s*calc\(-1 \* var\(--blok-space-1-5\)\)/);
    expect(property).toMatch(/padding-inline:\s*var\(--blok-space-1-5\)/);
    // Links are pre-wrap elsewhere: a URL took four lines and pushed the card past the week row.
    expect(ruleBody('[data-blok-database-calendar-event-property] [data-blok-database-cell-link]')).toMatch(/white-space:\s*nowrap/);
    // findings C10: a 28px card and a 6px gap.
    expect(css).toMatch(/--blok-database-calendar-lane-pitch:\s*calc\(34px \+ var\(--blok-database-calendar-event-lines, 0\) \* 24px\)/);
  });

  // notion-spec-2 §21.9: card values look as on the board card. calendar-card.png: the Alpha and Gamma pills span 18-19 pixel rows.
  it('draws every pill on a calendar card, status included, 18 tall with 12/18 text', () => {
    const body = ruleBody('[data-blok-database-calendar-event-property] [data-blok-database-option-pill]');

    expect(body).toMatch(/height:\s*18px/);
    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/line-height:\s*18px/);
  });

  // notion-spec-2 §21.9, calendar-card.png: a 14x14 box (x 977-991), its name starting 19px after the box's left edge, as on the board.
  it('draws a calendar card checkbox 14x14 with its name 5px after it', () => {
    expect(ruleBody('[data-blok-database-calendar-event-property] [data-blok-database-checkbox]')).toMatch(/width:\s*14px/);
    expect(ruleBody('[data-blok-database-calendar-event-property] [data-blok-database-checkbox]')).toMatch(/height:\s*14px/);
    expect(ruleBody('[data-blok-database-calendar-event-property] > [data-blok-database-cell="checkbox"]')).toMatch(/gap:\s*var\(--blok-space-1-25\)/);
  });

  it('makes a week-range row 372px tall (findings C08)', () => {
    expect(ruleBody('[data-blok-database-calendar][data-range="week"] [data-blok-database-calendar-day]')).toMatch(/max\(372px,/);
  });

  it('starts the first card 33px below the cell top (findings C10)', () => {
    expect(css).toMatch(/--blok-database-calendar-number-row:\s*33px/);
  });

  it('draws the day "+" 20px at 8px from the corner, with a 20px glyph (findings C11)', () => {
    const add = ruleBody('[data-blok-database-calendar-add]');

    expect(add).toMatch(/inset-block-start:\s*8px/);
    expect(add).toMatch(/inset-inline-start:\s*8px/);
    expect(add).toMatch(/inline-size:\s*20px/);
    expect(add).toMatch(/block-size:\s*20px/);
    expect(ruleBody('[data-blok-database-calendar-add] svg')).toMatch(/inline-size:\s*20px/);
  });

  it('draws ‹ and › as 24px squares (findings C12)', () => {
    const arrows = ruleBody('[data-blok-database-calendar-nav] [data-blok-database-calendar-prev]');

    expect(arrows).toMatch(/padding:\s*0/);
    expect(arrows).toMatch(/inline-size:\s*24px/);
  });

  it('insets an event 6px from each side of its cell (findings C13)', () => {
    const event = ruleBody('[data-blok-database-calendar-event]');

    expect(event).toMatch(/inset-inline-start:\s*6px/);
    expect(event).toMatch(/inline-size:\s*calc\(var\(--blok-database-calendar-span, 1\) \* 100% - 12px\)/);
    expect(ruleBody('[data-blok-database-calendar-event][data-continues-before]')).toMatch(/- 6px\)/);
  });

  it('paints a drop target gray, never blue (D3)', () => {
    const drop = ruleBody('[data-blok-database-calendar-day][data-drop]');

    expect(drop).toContain('var(--blok-icon-active-bg)');
    expect(drop).not.toMatch(/focus-ring|rgb\(39,\s*131,\s*222\)/);
  });

  // research/22 §1: the picked event's overlay is the card's own 6px shape, in the gray selected token (no blue).
  it('paints a picked calendar event with the shared gray selected token', () => {
    const picked = ruleBody('[data-blok-database-row-selected]');

    expect(picked).toContain('var(--blok-icon-active-bg)');
    expect(ruleBody('[data-blok-database-calendar-event]')).toContain('border-radius: var(--blok-radius-control)');
  });

  // research/35 §1.4: the fill stays and a halo sits 1px inside the card. Notion's halo is blue; Blok's is the gray token.
  it('keeps a picked event\'s fill and lays the gray halo 1px inside it', () => {
    const picked = '[data-blok-database-calendar-event][data-blok-database-row-selected]';

    expect(ruleBody(picked)).toContain('background-image: none');
    expect(ruleBody(picked)).not.toContain('background-color');
    const halo = ruleBody(`${picked}::after`);

    expect(halo).toContain('inset: 1px');
    expect(halo).toContain('border-start-start-radius: inherit');
    expect(halo).toContain('border-end-end-radius: inherit');
    expect(halo).toContain('pointer-events: none');
    expect(halo).toContain('background-color: var(--blok-icon-active-bg)');
  });

  // research/35 §1.4: rest white, hover rgba(84, 72, 49, 0.08) over the cell.
  it('hovers an event to the measured light fill', () => {
    expect(ruleBody('[data-blok-database-calendar-event]:hover')).toContain('background-color: var(--blok-database-calendar-event-hover-bg)');
    expect(css).toContain('--blok-database-calendar-event-bg: #ffffff;');
    expect(css).toContain('--blok-database-calendar-event-hover-bg: rgba(84, 72, 49, 0.08);');
  });

  // research/35 §18: 16px icon, bordered with the control border (dark rgba(255, 255, 235, 0.1)), day ink.
  it('draws "Manage in Calendar" with a 16px icon and the control border', () => {
    const manage = '[data-blok-database-calendar-nav] [data-blok-database-calendar-manage-calendar]';

    expect(ruleBody(manage)).toContain('border: 1px solid var(--blok-database-table-control-border)');
    expect(ruleBody(`${manage} svg`)).toContain('inline-size: 16px');
    expect(ruleBody(`${manage} svg`)).toContain('block-size: 16px');
    expect(ruleBody('[data-blok-database-calendar-nav] button')).toContain('color: var(--blok-database-calendar-day-text)');
  });

  it('lets an event title shrink so its comment badge stays in the card', () => {
    const title = ruleBody('[data-blok-database-calendar-event-title]:has(+ [data-blok-database-comment-badge])');

    expect(title).toMatch(/flex:\s*0 1 auto/);
    expect(title).toMatch(/min-inline-size:\s*0/);
  });

  it('rounds only through role tokens', () => {
    const radii = [...`${galleryCss}${calendarCss}`.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => match[1].trim());

    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) {
      expect(radius).toMatch(/^(?:0|50%|var\(--blok-radius-[a-z-]+\)|var\(--blok-radius-inner, var\(--blok-radius-[a-z-]+\)\))$/);
    }
  });

  it('uses logical properties only, so RTL mirrors both layouts', () => {
    for (const block of [galleryCss, calendarCss]) {
      expect(block.length).toBeGreaterThan(500);
      expect(block).not.toMatch(/(?:^|[\s;{])(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right|text-align:\s*(?:left|right))\s*[:;]/m);
    }
  });

  it('gives no ring on a plain focus, only on keyboard focus', () => {
    expect(`${galleryCss}${calendarCss}`).not.toMatch(/:focus(?![-\w])/);
    expect(ruleBody('[data-blok-database-gallery-card]:focus-visible')).toContain('var(--blok-focus-ring)');
    expect(ruleBody('[data-blok-database-calendar-day]:focus-visible')).toContain('var(--blok-focus-ring)');
  });

  // The "Manage in Calendar" icon sits in the nav too; only the arrows flip in RTL.
  it('mirrors only the previous and next arrows in RTL', () => {
    expect(ruleBody('[dir="rtl"] [data-blok-database-calendar-nav] svg')).toBe('');
    expect(ruleBody('[dir="rtl"] [data-blok-database-calendar-prev] svg')).toContain('transform: scaleX(-1)');
    expect(ruleBody('[dir="rtl"] [data-blok-database-calendar-next] svg')).toContain('transform: scaleX(-1)');
  });

  it('turns every gallery and calendar transition off for reduced motion', () => {
    expect(galleryCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(calendarCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe('gallery drop into an empty group', () => {
  it('rings the empty grid with the drop line color (Notion unmeasured)', () => {
    expect(ruleBody('[data-blok-database-gallery-grid][data-drop="inside"]')).toContain('var(--blok-database-table-drop-line)');
  });
});

/** The token's value in the media-query dark block, then the theme-attribute copy. */
const darkValues = (name: string): string[] =>
  Array.from(css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))).map((m) => (m[1] ?? '').trim()).slice(1);

describe('gallery and calendar in dark (research/21 §1g, §1h)', () => {
  it.each([
    ['--blok-database-gallery-card-bg', 'rgba(255, 255, 255, 0.055)'],
    ['--blok-database-gallery-card-shadow', 'rgba(25, 25, 25, 0.08) 0 2px 4px, rgba(255, 255, 243, 0.082) 0 0 0 1px'],
    ['--blok-database-gallery-card-hover-bg', 'rgb(47, 47, 47)'],
    ['--blok-database-gallery-preview-bg', 'rgba(252, 252, 252, 0.03)'],
    ['--blok-database-gallery-preview-border', 'transparent'],
    ['--blok-database-calendar-border', 'rgb(56, 56, 54)'],
    ['--blok-database-calendar-weekend-bg', 'rgb(32, 32, 32)'],
    // Notion's rgb(125, 122, 117) fails AA in dark; the tertiary ink is the AA step rgb(143, 140, 135).
    ['--blok-database-calendar-muted-text', 'var(--blok-database-ink-tertiary)'],
    ['--blok-database-calendar-nav-icon', 'rgb(173, 169, 163)'],
    ['--blok-database-calendar-event-bg', 'rgb(47, 47, 47)'],
    ['--blok-database-calendar-event-shadow', 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 2px 4px'],
    ['--blok-database-calendar-event-hover-bg', 'rgb(55, 55, 55)'],
  ])('%s is %s in both dark blocks', (token, value) => {
    expect(darkValues(token)).toEqual([value, value]);
  });

  // Divergence: Notion's dark today digit computes black on red (its white var does not resolve). Blok keeps it white.
  it('keeps the today digit white on red in dark, as in light', () => {
    expect(darkValues('--blok-database-calendar-today-text')).toEqual(['#ffffff', '#ffffff']);
    expect(darkValues('--blok-database-today')).toEqual(['rgb(229, 100, 88)', 'rgb(229, 100, 88)']);
  });

  it('notion-spec-2 §19.17: a card file chip is 20 tall, at most 200 wide, text 12/20 cut with "…", in a 28px row with 4px padding', () => {
    const chip = ruleBody('[data-blok-database-gallery-property] [data-blok-database-file-chip]');

    expect(chip).toMatch(/height:\s*20px/);
    expect(chip).toMatch(/line-height:\s*20px/);
    expect(chip).toMatch(/max-width:\s*200px/);
    expect(ruleBody('[data-blok-database-gallery-property] [data-blok-database-file-chip] > [data-blok-database-cell-link]')).toMatch(/text-overflow:\s*ellipsis/);
    expect(ruleBody('[data-blok-database-gallery-property]:has(> [data-blok-database-cell="files"])')).toMatch(/padding:\s*var\(--blok-space-1\)/);
  });
});
