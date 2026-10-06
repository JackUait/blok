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

  // The table draws the top and left lines, cells the right and bottom ones, so
  // the physical top-right and bottom-left corners are split between the two
  // boxes. A plain radius there draws two arcs 1px apart: a notch.
  // Which logical corner is split mirrors in RTL, hence the inline sign.
  const R = 'var(--blok-radius-table)';
  const shortWhenLtr = 'calc(var(--blok-radius-table) - (1 + var(--_blok-inline-sign, 1)) * 0.5px)';
  const shortWhenRtl = 'calc(var(--blok-radius-table) - (1 - var(--_blok-inline-sign, 1)) * 0.5px)';

  it.each([
    ['top-start', 'border-start-start-radius', `${R} ${shortWhenRtl}`],
    ['top-end', 'border-start-end-radius', `${R} ${shortWhenLtr}`],
    ['bottom-start', 'border-end-start-radius', `${shortWhenLtr} ${R}`],
    ['bottom-end', 'border-end-end-radius', `${shortWhenRtl} ${R}`],
  ])('rounds the %s corner cell so its arc joins the table arc', (corner, property, value) => {
    const body = ruleBody(`[data-blok-table-cell][data-blok-table-corner~="${corner}"]`);

    expect(body).toMatch(new RegExp(`${property}:\\s*${escape(value)};`));
  });

  it.each([
    [':first-child', 'border-start-start-radius', `${R} ${shortWhenRtl}`],
    [':nth-child(4)', 'border-start-end-radius', `${R} ${shortWhenLtr}`],
    [':nth-last-child(4)', 'border-end-start-radius', `${shortWhenLtr} ${R}`],
    [':last-child', 'border-end-end-radius', `${shortWhenRtl} ${R}`],
  ])('rounds the toolbox preview table corner cell %s the same way', (pseudo, property, value) => {
    const body = ruleBody(`[data-blok-interface='block-preview'] [data-blok-preview='table'] [data-cell]${pseudo}`);

    expect(body).toMatch(new RegExp(`${property}:\\s*${escape(value)};`));
  });

  it('sets heading text in the muted heading ink', () => {
    expect(ruleBody('[data-blok-table-heading-col]')).toMatch(/color:\s*var\(--blok-text-secondary\)/);
  });

  // The heading row is set apart by its fill alone; its bottom line is a plain grid line.
  it('draws no darker line under the heading row', () => {
    expect(css).not.toMatch(/\[data-blok-table-heading\][^{]*\{[^}]*border-bottom-color/);
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

  it('keeps the existing border value, so host overrides still apply', () => {
    expect(colors).toMatch(/--blok-table-border:\s*#d1d5db;/);
  });

  it('fills the heading row with the warm light gray', () => {
    expect(colors).toMatch(/--blok-table-heading-bg:\s*#f7f6f3;/);
  });
});
