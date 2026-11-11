import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';
import { VIEW_ICONS } from '../../../../src/tools/database/database-tab-bar';

const rects = (markup: string | undefined): Array<{ x: number; y: number; width: number; height: number; rx: number }> =>
  [...new DOMParser().parseFromString(markup ?? '', 'image/svg+xml').querySelectorAll('rect')].map((rect) => ({
    x: Number(rect.getAttribute('x')),
    y: Number(rect.getAttribute('y')),
    width: Number(rect.getAttribute('width')),
    height: Number(rect.getAttribute('height')),
    rx: Number(rect.getAttribute('rx')),
  }));

/** Notion's viewDashboard (notion-motion Round 15 A): a wide and a narrow box on top, a narrow and a wide one below. */
describe('IconViewDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the dashboard tab glyph', () => {
    expect(VIEW_ICONS.dashboard).toBe(icons.IconViewDashboard);
  });

  it('keeps the Gallery glyph rows, gutter and corner radius', () => {
    const gallery = rects(icons.IconGallery);
    const dashboard = rects(icons.IconViewDashboard);
    const rows = (list: typeof gallery): number[][] => [...new Set(list.map((rect) => rect.y))].map((y) => {
      const box = list.find((rect) => rect.y === y);

      return [y, box?.height ?? 0];
    });

    expect(dashboard).toHaveLength(4);
    expect(rows(dashboard)).toEqual(rows(gallery));
    expect(new Set(dashboard.map((rect) => rect.rx))).toEqual(new Set(gallery.map((rect) => rect.rx)));
    const gutter = gallery[1].x - (gallery[0].x + gallery[0].width);

    for (const y of new Set(dashboard.map((rect) => rect.y))) {
      const [left, right] = dashboard.filter((rect) => rect.y === y).sort((a, b) => a.x - b.x);

      expect(right.x - (left.x + left.width)).toBe(gutter);
      expect(left.x).toBe(3);
      expect(right.x + right.width).toBe(17);
    }
  });

  it('puts the wide box left on top and right below', () => {
    const [topLeft, topRight, bottomLeft, bottomRight] = rects(icons.IconViewDashboard);

    expect(topLeft.width).toBeGreaterThan(topRight.width);
    expect(bottomLeft.width).toBeLessThan(bottomRight.width);
    expect(topLeft.width).toBe(bottomRight.width);
  });
});
