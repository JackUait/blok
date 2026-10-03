/**
 * The table frame is softened by a 1px radius. Core stamps the real corner cells with
 * `data-blok-table-corner` (merged cells included), so only those four cells
 * round and a heading or cell color never pokes past the frame.
 * Nothing here may change a line width or padding: resize, corner-drag and the
 * selection overlay measure against BORDER_WIDTH and the cell box.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf-8');

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Body of the first rule whose selector list contains `selector`. */
const ruleBody = (selector: string): string | undefined =>
  new RegExp(`(?:^|[},])\\s*${escape(selector)}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css)?.[1];

describe('table card look', () => {
  it('rounds the grid frame with the table radius role', () => {
    expect(ruleBody('[data-blok-table-scroll] > table')).toMatch(/border-radius:\s*var\(--blok-radius-table\)/);
  });

  it.each([
    ['top-start', 'border-start-start-radius'],
    ['top-end', 'border-start-end-radius'],
    ['bottom-start', 'border-end-start-radius'],
    ['bottom-end', 'border-end-end-radius'],
  ])('rounds the %s corner cell, whose own border may be the frame line', (corner, property) => {
    const body = ruleBody(`[data-blok-table-cell][data-blok-table-corner~="${corner}"]`);

    expect(body).toMatch(new RegExp(`${property}:\\s*var\\(--blok-radius-table\\)`));
  });

  it('sets heading text in the muted heading ink', () => {
    expect(ruleBody('[data-blok-table-heading-col]')).toMatch(/color:\s*var\(--blok-text-secondary\)/);
  });

  it('draws a firmer line under the heading row without changing its width', () => {
    const body = ruleBody('[data-blok-table-heading] > [data-blok-table-cell]');

    expect(body).toMatch(
      /border-bottom-color:\s*color-mix\(in srgb,\s*var\(--blok-table-border\) 75%,\s*var\(--blok-text-primary\)\)\s*!important/
    );
    expect(body).not.toMatch(/border-bottom-width|border-bottom:/);
  });

  // A resize handle is not inside a row, so a :hover row tint blinked off on
  // every column border the pointer crossed.
  it('does not tint the hovered row', () => {
    expect(css).not.toMatch(/\[data-blok-table-row\][^{]*:hover[^{]*\{[^}]*background/);
  });

  // view.css ships every token and has a hard byte budget, so the new colors
  // derive from tokens that already follow the theme and host overrides.
  it('adds no color tokens', () => {
    expect(colors).not.toMatch(/--blok-table-(?:heading-text|heading-divider|row-hover-bg):/);
  });

  it('keeps the existing border and heading fill values, so host overrides still apply', () => {
    expect(colors).toMatch(/--blok-table-border:\s*#d1d5db;/);
    expect(colors).toMatch(/--blok-table-heading-bg:\s*#f9fafb;/);
  });
});
