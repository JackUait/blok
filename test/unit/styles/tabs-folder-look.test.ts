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

  // The open tab's top outline is a shadow drawn above its box. Flush with the
  // scroller's top edge, the scroller's clip erases it.
  it('leaves room inside the scroller for the open tab top outline', () => {
    const hairline = 'var(--blok-border-width-hairline)';

    expect(declaration(ruleBody('[data-blok-tabs-scroller]'), 'padding-block-start')).toBe(hairline);
    expect(declaration(ruleBody('[data-blok-tabs-indicator]'), 'inset-block-start')).toBe(hairline);
  });

  it('keeps the open tab neutral, never blue', () => {
    const selected = ruleBody('[data-blok-tabs-pill][aria-selected="true"]');

    expect(declaration(selected, 'color')).toBe('var(--blok-text-primary)');
    expect(declaration(selected, 'background-color')).toBeUndefined();
    expect(css).not.toMatch(/blue|#2383e2|--blok-(?:link|accent)/i);
  });
});
