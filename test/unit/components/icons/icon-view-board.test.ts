import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';
import { VIEW_ICONS } from '../../../../src/tools/database/database-tab-bar';

const parse = (markup: string | undefined): Document => new DOMParser().parseFromString(markup ?? '', 'image/svg+xml');

const panelOf = (markup: string | undefined): string[] =>
  [...parse(markup).querySelectorAll('rect')].map((rect) => ['x', 'y', 'width', 'height', 'rx'].map((name) => rect.getAttribute(name)).join(' '));

/** Notion's viewBoard: one panel cut into three columns (feel/findings-toolbar V31). */
describe('IconViewBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares the Table view glyph panel', () => {
    expect(panelOf(icons.IconViewBoard)).toEqual(panelOf(icons.IconTable));
  });

  it('cuts the panel into three equal columns with two full-height dividers', () => {
    const [panel] = [...parse(icons.IconViewBoard).querySelectorAll('rect')].map(rect => ['x', 'y', 'width', 'height'].map(name => Number(rect.getAttribute(name))));
    const [x = 0, y = 0, width = 0, height = 0] = panel ?? [];
    const d = [...parse(icons.IconViewBoard).querySelectorAll('path')].map((path) => path.getAttribute('d')).join(' ');
    const dividers = [...d.matchAll(/M([\d.]+) ([\d.]+)v([\d.]+)/g)].map(([, left, top, length]) => [Number(left), Number(top), Number(length)]);

    expect(dividers).toHaveLength(2);
    for (const [, top, length] of dividers) {
      expect(top).toBe(y);
      expect(length).toBe(height);
    }
    const [first = 0, second = 0] = dividers.map(([left]) => left ?? 0);

    // Keyline snaps to 0.25, so a divider sits within half a snap of the exact third.
    expect(Math.abs(first - (x + width / 3))).toBeLessThanOrEqual(0.125);
    expect(Math.abs(second - (x + 2 * width / 3))).toBeLessThanOrEqual(0.125);
    expect(first + second).toBe(2 * x + width);
  });

  it('is the board tab glyph, and differs from the dashboard columns glyph', () => {
    expect(VIEW_ICONS.board).toBe(icons.IconViewBoard);
    expect(icons.IconViewBoard).not.toBe(icons.IconColumns);
  });
});
