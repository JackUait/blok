/**
 * Tabs block "folder" look: the open tab and the panels are one sheet of paper
 * rising out of a recessed band, joined by two concave corners that ride on
 * the sliding indicator.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/tabs.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Body of the first rule whose selector list is exactly `selector`. */
const ruleBody = (selector: string): string => {
  const body = new RegExp(`(?<!,\\s*)(?:^|[}\\n])\\s*${escape(selector)}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1];

  if (body === undefined) {
    throw new Error(`no rule for ${selector}`);
  }

  return body;
};

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;{\\s])${escape(property)}:\\s*([^;]+);`).exec(body)?.[1].trim();

describe('tabs folder look', () => {
  it('paints the open tab and the panels with the same sheet surface', () => {
    const sheet = declaration(ruleBody('[data-blok-tabs]'), '--blok-tabs-sheet');

    expect(sheet).toBeDefined();
    expect(declaration(ruleBody('[data-blok-tabs-indicator]'), 'background-color')).toBe('var(--blok-tabs-sheet)');
    expect(declaration(ruleBody('[data-blok-tabs-panels]'), 'background-color')).toBe('var(--blok-tabs-sheet)');
  });

  // Strip inset + scroller inset + pill inset puts the first label's text here;
  // the panel takes the paragraph's own inset back off so the text lines up.
  it('starts the panel text where the first tab label starts', () => {
    expect(declaration(ruleBody('[data-blok-tabs-panels]'), 'padding-inline')).toBe(
      'calc(var(--blok-space-1) + var(--blok-tabs-neck-radius) + var(--blok-space-3) - var(--blok-tabs-paragraph-inset))'
    );
  });

  it('sets the strip on a band that differs from the sheet', () => {
    const root = ruleBody('[data-blok-tabs]');
    const band = declaration(root, '--blok-tabs-band');

    expect(band).toBeDefined();
    expect(band).not.toBe(declaration(root, '--blok-tabs-sheet'));
    expect(declaration(ruleBody('[data-blok-tabs-strip]'), 'background-color')).toBe('var(--blok-tabs-band)');
  });

  it('joins the open tab to the sheet with a concave corner on each inline side', () => {
    const corners = ruleBody('[data-blok-tabs-indicator]::before,\n[data-blok-tabs-indicator]::after');

    expect(declaration(corners, 'width')).toBe('var(--blok-tabs-neck-radius)');
    expect(declaration(corners, 'height')).toBe('var(--blok-tabs-neck-radius)');
    expect(declaration(ruleBody('[data-blok-tabs-indicator]::before'), 'inset-inline-start')).toBe('calc(-1 * var(--blok-tabs-neck-radius))');
    expect(declaration(ruleBody('[data-blok-tabs-indicator]::after'), 'inset-inline-end')).toBe('calc(-1 * var(--blok-tabs-neck-radius))');
  });

  // The circle that cuts each corner sits on its OUTER side, which flips in RTL.
  it('mirrors the corner curves in RTL through the inline sign', () => {
    expect(ruleBody('[data-blok-tabs-indicator]::before')).toContain('circle at calc(50% - 50% * var(--_blok-inline-sign, 1)) 0');
    expect(ruleBody('[data-blok-tabs-indicator]::after')).toContain('circle at calc(50% + 50% * var(--_blok-inline-sign, 1)) 0');
  });

  // The scroller scrolls sideways, so it clips both axes: a corner of the
  // first or last tab is cut off unless the scroller pads at least that much.
  it('pads the scroller so the outer corners of the first and last tab are not clipped', () => {
    expect(declaration(ruleBody('[data-blok-tabs-scroller]'), 'padding-inline')).toBe('var(--blok-tabs-neck-radius)');
  });

  it('seats the open tab on the band edge so it covers the band hairline', () => {
    const strip = ruleBody('[data-blok-tabs-strip]');

    expect(declaration(strip, 'align-items')).toBe('flex-end');
    expect(declaration(strip, 'padding-block-end')).toBe('0');
    expect(declaration(ruleBody('[data-blok-tabs-indicator]'), 'inset-block-end')).toBe('0');
  });

  // motion.ts folds tabs down and up: hinged anywhere else, a tab would lift off the band.
  it('hinges the open tab on its bottom edge', () => {
    expect(declaration(ruleBody('[data-blok-tabs-indicator]'), 'transform-origin')).toBe('50% 100%');
  });

  // The open tab's top outline is a shadow drawn above its box. Flush with the
  // scroller's top edge, the scroller's clip erases it.
  it('leaves room inside the scroller for the open tab top outline', () => {
    const hairline = 'var(--blok-border-width-hairline)';

    expect(declaration(ruleBody('[data-blok-tabs-scroller]'), 'padding-block-start')).toBe(hairline);
    expect(declaration(ruleBody('[data-blok-tabs-indicator]'), 'inset-block-start')).toBe(hairline);
  });

  // The shared ring sits outside the pill (outline-offset: 1px). The scroller
  // is exactly one pill tall and clips both axes, so it cut the ring to two
  // side brackets.
  it('draws a tab focus ring inside the tab so the scroller cannot clip it', () => {
    const preflight = readFileSync(resolve(__dirname, '../../../src/styles/preflight.css'), 'utf-8');
    const width = /outline:\s*(\d+)px solid var\(--blok-focus-ring\)/.exec(preflight)?.[1];

    expect(width).toBeDefined();
    expect(declaration(ruleBody('[data-blok-tabs-pill]:focus-visible'), 'outline-offset')).toBe(`-${width}px`);
  });

  // The hint's text must stay where the first block's text will be, so the
  // fill can only grow outward: what the margin takes, the padding gives back.
  it('keeps the empty-tab hint fill close to its text, clear of the card edges', () => {
    const hint = ruleBody('[data-blok-tab-empty]');

    expect(declaration(hint, 'margin-inline')).toBe('calc(-1 * var(--blok-space-1))');
    expect(declaration(hint, 'padding-inline')).toBe('calc(var(--blok-tabs-paragraph-inset) + var(--blok-space-1))');
  });

  // A `size` in characters sizes by average glyph width, so a short title got a wide box.
  it('sizes the tab title field to its text', () => {
    expect(declaration(ruleBody('[data-blok-tabs-rename-input]'), 'field-sizing')).toBe('content');
  });

  // The pill's line-height is its full height; inherited, it made the selection fill the whole tab.
  it('keeps the tab title field selection to the height of the text', () => {
    const field = ruleBody('[data-blok-tabs-rename-input]');

    expect(declaration(ruleBody('[data-blok-tabs-pill]'), 'line-height')).toBe('var(--blok-tabs-pill-height)');
    expect(declaration(field, 'line-height')).toBeDefined();
    expect(declaration(field, 'line-height')).not.toBe('var(--blok-tabs-pill-height)');
    expect(declaration(field, 'line-height')).not.toBe('inherit');
  });

  it('keeps the open tab neutral, never blue', () => {
    const selected = ruleBody('[data-blok-tabs-pill][aria-selected="true"]');

    expect(declaration(selected, 'color')).toBe('var(--blok-text-primary)');
    expect(declaration(selected, 'background-color')).toBeUndefined();
    expect(css).not.toMatch(/blue|#2383e2|--blok-(?:link|accent)/i);
  });
});
