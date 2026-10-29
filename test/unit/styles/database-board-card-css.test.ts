/**
 * Board card parity and the calendar "No date" look: measured values
 * (research/07, research/08), logical properties and reduced motion. jsdom
 * has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

describe('database board card and calendar "No date" styles', () => {
  // research/03: compact cards set their properties inline (card_property_width_mode inline); List keeps one per line.
  it('Compact puts card properties side by side and wraps them; List keeps the column', () => {
    const body = ruleBody('[data-blok-database-board][data-card-layout="compact"] [data-blok-database-card-properties]');

    expect(body).toMatch(/flex-direction:\s*row/);
    expect(body).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody('[data-blok-database-card-properties]')).toMatch(/flex-direction:\s*column/);
  });

  it('the picked Card layout tile is never blue: a neutral ring in primary ink, the same ink as the other tile (no-blue law)', () => {
    const picked = ruleBody('[data-blok-database-card-layout-tile][aria-pressed="true"] [data-blok-database-card-layout-drawing]');
    const tile = ruleBody('[data-blok-database-card-layout-tile]');

    expect(picked).not.toMatch(/blue|focus-ring|#2383e2|rgb\(35, 131, 226\)/i);
    expect(picked).toMatch(/--blok-database-ink\)/);
    expect(picked).not.toMatch(/background/);
    expect(picked).not.toMatch(/(^|;)\s*color:/);
    expect(tile).toMatch(/color:\s*var\(--blok-database-ink(-secondary)?\)/);
  });

  it('draws card properties as the measured 12px rows', () => {
    const body = ruleBody('[data-blok-database-card-property]');

    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/line-height:\s*18px/);
    expect(body).toMatch(/min-block-size:\s*28px/);
  });

  // feel findings B10: Notion's untitled card keeps its white card and ring.
  it('keeps the card surface and ring on an untitled card', () => {
    expect(ruleBody('[data-blok-database-card][data-empty]')).toBe('');
  });

  // feel findings B22: Notion edits the title at its own 15px/22.5px/500, with no underline.
  it('edits a card title at the title\'s own size, with no underline', () => {
    const body = ruleBody('[data-blok-database-card-title-input]');

    expect(body).toMatch(/font-size:\s*15px/);
    expect(body).toMatch(/line-height:\s*22\.5px/);
    expect(body).toMatch(/font-weight:\s*500/);
    expect(body).not.toMatch(/border-bottom/);
    expect(ruleBody('[data-blok-database-card-edit-glyph]')).toMatch(/inline-size:\s*18px/);
  });

  // feel findings B08: the board card's action glyphs are 16px.
  it('sizes the board card action glyphs 16px', () => {
    const body = ruleBody('[data-blok-database-card] [data-blok-database-card-actions] svg');

    expect(body).toMatch(/inline-size:\s*16px/);
    expect(body).toMatch(/block-size:\s*16px/);
  });

  // feel findings B15: Notion fits its 502px row menu in a 717px window; the core 400px cap cut off Move to Trash.
  it('lets the row menu grow to the window instead of the 400px cap', () => {
    expect(ruleBody("[data-blok-popover-custom-class~='blok-database-card-menu'] [data-blok-popover-container]"))
      .toMatch(/--max-height:\s*calc\(100dvh - 24px\)/);
  });

  // research/07:95 (feel findings B17): a select pill on a board card is 18px, 0 6px, 12px/18px.
  // notion-spec-2 §21.7 and board-status.png: the status pill too has 12/18 text and spans the same 18 rows as the select.
  it('draws every pill on a card, status included, at 18px and 12px', () => {
    const body = ruleBody('[data-blok-database-card-property] [data-blok-database-option-pill]');

    expect(body).toMatch(/height:\s*18px/);
    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/line-height:\s*18px/);
    expect(body).not.toMatch(/padding/);
  });

  // notion-spec-2 §21.7: a board card's Button keeps its 24px pill in a 32px row, so the row padding is 4px.
  it('gives the Button row 4px padding, so it is 32 tall', () => {
    expect(ruleBody('[data-blok-database-card-property]:has(> [data-blok-database-cell="button"])')).toContain('padding: var(--blok-space-1)');
  });

  // notion-spec-2 §21.7: a board card's checkbox is 14x14, its name at box x + 19 (5px after).
  it('draws a card checkbox 14x14 with its name 5px after', () => {
    const box = ruleBody('[data-blok-database-card-property] [data-blok-database-checkbox]');

    expect(box).toMatch(/width:\s*14px/);
    expect(box).toMatch(/height:\s*14px/);
    expect(ruleBody('[data-blok-database-card-property] > [data-blok-database-cell="checkbox"]')).toContain('gap: var(--blok-space-1-25)');
  });

  // notion-spec-2 §21.7: Person, Created by and Last edited by show an 18x18 avatar on a board card.
  it('draws card avatars 18x18', () => {
    const body = ruleBody('[data-blok-database-card-property] :is([data-blok-database-person-avatar], [data-blok-database-person-initial])');

    expect(body).toMatch(/width:\s*18px/);
    expect(body).toMatch(/height:\s*18px/);
  });

  // notion-spec-2 §21.7: a board card's file chip is 20 tall, at most 200 wide, its name cut with "…", in a row with 4px padding.
  it('draws a card file chip 20 tall and at most 200 wide, in a 28px row', () => {
    const chip = ruleBody('[data-blok-database-card-property] [data-blok-database-file-chip]');
    const name = ruleBody('[data-blok-database-card-property] [data-blok-database-file-chip] > [data-blok-database-cell-link]');

    expect(chip).toMatch(/height:\s*20px/);
    expect(chip).toMatch(/max-width:\s*200px/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody('[data-blok-database-card-property]:has(> [data-blok-database-cell="files"])')).toContain('padding: var(--blok-space-1)');
  });

  // notion-spec-2 §21.7: a relation on a board card is a 14.4px icon and a 12/18 title, weight 500, in a 28px row.
  it('draws a card relation chip with a 14.4px glyph and a 12/18 title', () => {
    const icon = ruleBody('[data-blok-database-card-property] [data-blok-database-relation-chip-icon]');

    expect(icon).toMatch(/width:\s*14\.4px/);
    expect(icon).toMatch(/height:\s*14\.4px/);
    expect(ruleBody('[data-blok-database-card-property] [data-blok-database-relation-chip-icon] svg')).toMatch(/width:\s*14\.4px/);
    expect(ruleBody('[data-blok-database-card-property] [data-blok-database-relation-chip-title]')).toMatch(/line-height:\s*18px/);
  });

  // feel findings B09: Notion's "Add …" rows are rgb(161,158,153), under AA; the nearest passing ink is the secondary gray.
  it('draws the "Add …" rows of an edited card in the secondary ink with a 16px glyph', () => {
    expect(ruleBody('[data-blok-database-card-property][data-ghost]')).toMatch(/color:\s*var\(--blok-database-ink-secondary\)/);
    expect(ruleBody('[data-blok-database-card-property][data-ghost] svg')).toMatch(/inline-size:\s*16px/);
  });

  // The card is white again (B10), and the placeholder's light gray is 2.4:1 there; the secondary ink passes AA (user decision 2026-10-21).
  it('draws the card title placeholders in an ink that passes AA', () => {
    expect(ruleBody('[data-blok-database-card-title][data-placeholder]')).toMatch(/color:\s*var\(--blok-database-ink-secondary\)/);
    expect(ruleBody('[data-blok-database-card-title-input]::placeholder')).toMatch(/color:\s*var\(--blok-database-ink-secondary\)/);
  });

  it('wraps a property only when its wrap setting is on', () => {
    expect(ruleBody('[data-blok-database-card-property][data-wrap="false"]')).toMatch(/white-space:\s*nowrap/);
  });

  it('pads a card like Notion\'s title row, 8px 10px 6px (research/07)', () => {
    expect(ruleBody('[data-blok-database-card]')).toContain('padding: var(--blok-space-2) var(--blok-space-2-5) var(--blok-space-1-5)');
  });

  it('keeps property rows 6px from the card edge and 8px from its bottom (research/07)', () => {
    const body = ruleBody('[data-blok-database-card-properties]');

    expect(body).toContain('margin-inline: calc(-1 * var(--blok-space-1))');
    expect(body).toContain('margin-block-end: var(--blok-space-0-5)');
  });

  it('bleeds the preview to the card edges and crops unless Fit image is on', () => {
    expect(ruleBody('[data-blok-database-card-preview]')).toContain('margin: calc(-1 * var(--blok-space-2)) calc(-1 * var(--blok-space-2-5)) var(--blok-space-2)');
    expect(ruleBody('[data-blok-database-card-image]')).toMatch(/object-fit:\s*cover/);
    expect(ruleBody('[data-blok-database-board][data-fit-image] [data-blok-database-card-image]')).toMatch(/object-fit:\s*contain/);
  });

  it('sizes the preview by card size', () => {
    expect(ruleBody('[data-blok-database-board][data-card-size="medium"]')).toMatch(/--blok-database-card-preview-height:\s*146px/);
  });

  it('rings a card only for keyboard focus', () => {
    expect(ruleBody('[data-blok-database-card]:focus-visible')).toContain('outline: 2px solid var(--blok-focus-ring)');
    expect(css).not.toMatch(/\[data-blok-database-card\]:focus\s*\{/);
  });

  it('keeps the one row of column headers on top of sub-group lanes', () => {
    const body = ruleBody('[data-blok-database-board-heads]');

    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/inset-block-start:\s*0/);
  });

  it('labels each sub-group lane', () => {
    expect(ruleBody('[data-blok-database-board-lane-header]')).toMatch(/display:\s*flex/);
    expect(ruleBody('[data-blok-database-board-lane-columns]')).toMatch(/display:\s*flex/);
  });

  it('draws the band toggle as the measured 24px button that turns -90deg in 200ms (research/31 §3)', () => {
    const body = ruleBody('[data-blok-database-board-lane-toggle]');

    expect(body).toMatch(/width:\s*24px/);
    expect(body).toMatch(/height:\s*24px/);
    expect(body).toMatch(/background:\s*transparent/);
    expect(ruleBody('[data-blok-database-board-lane-toggle]:hover')).toContain('var(--blok-database-table-header-hover-bg)');
    expect(ruleBody('[data-blok-database-board-lane-toggle] svg')).toMatch(/transition:\s*transform 200ms ease-out/);
    expect(ruleBody('[data-blok-database-board-lane][data-collapsed] [data-blok-database-board-lane-toggle] svg')).toMatch(/rotate\(-90deg\)/);
    expect(ruleBody('[dir="rtl"] [data-blok-database-board-lane][data-collapsed] [data-blok-database-board-lane-toggle] svg')).toMatch(/rotate\(90deg\)/);
  });

  it('hides a collapsed band\'s row of cards', () => {
    expect(ruleBody('[data-blok-database-board-lane][data-collapsed] [data-blok-database-board-lane-columns]')).toMatch(/display:\s*none/);
  });

  it('draws the measured "No date" button', () => {
    const body = ruleBody('[data-blok-database-view-toolbar] [data-blok-database-no-date-button]');

    expect(body).toMatch(/block-size:\s*28px/);
    // Words in icon gray: Notion's 142,139,134 is 3.39:1 on white, so the light AA step.
    expect(body).toContain('color: var(--blok-database-ink-secondary)');
  });
});
