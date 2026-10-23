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
    const d = [...parse(icons.IconViewBoard).querySelectorAll('path')].map((path) => path.getAttribute('d')).join(' ');
    const dividers = [...d.matchAll(/M([\d.]+) 4v12/g)].map((match) => Number(match[1]));

    expect(dividers).toHaveLength(2);
    // The panel runs x 3 to 17: columns 14/3 wide.
    expect(dividers[0]).toBeCloseTo(3 + 14 / 3, 1);
    expect(dividers[1]).toBeCloseTo(3 + 28 / 3, 1);
  });

  it('is the board tab glyph, and differs from the dashboard columns glyph', () => {
    expect(VIEW_ICONS.board).toBe(icons.IconViewBoard);
    expect(icons.IconViewBoard).not.toBe(icons.IconColumns);
  });
});
