/**
 * The row page top bar (feel/findings-rowpage R04): Notion's close », diagonal
 * expand, and one window glyph per peek mode (`peekSide`, `peekCenter`, `peekFull`).
 */
import { describe, expect, it } from 'vitest';

import * as Icons from '../../../../src/components/icons';

const svgOf = (markup: string): Document => new DOMParser().parseFromString(markup, 'image/svg+xml');

const iconOf = (name: string): string => {
  const icon: unknown = Object.entries(Icons).find(([key]) => key === name)?.[1];

  if (typeof icon !== 'string') {
    throw new Error(`Missing ${name}`);
  }

  return icon;
};

interface Box { x: number; y: number; width: number; height: number }

const boxOf = (rect: Element | undefined): Box => ({
  x: Number(rect?.getAttribute('x')),
  y: Number(rect?.getAttribute('y')),
  width: Number(rect?.getAttribute('width')),
  height: Number(rect?.getAttribute('height')),
});

const rects = (name: string): Element[] => [...svgOf(iconOf(name)).querySelectorAll('rect')];
const frameOf = (name: string): Element | undefined => rects(name).find((r) => r.getAttribute('stroke') === 'currentColor');
const fillOf = (name: string): Box => boxOf(rects(name).find((r) => r.getAttribute('fill') === 'currentColor'));
const STROKE = 1.25;

describe('peek mode glyphs', () => {
  const modes = ['IconPeekSide', 'IconPeekCenter', 'IconPeekFull'];

  it.each(modes)('%s draws the page frame of IconSidebarRight', (name) => {
    const frame = svgOf(Icons.IconSidebarRight).querySelector('rect');

    expect(['x', 'y', 'width', 'height', 'rx'].map((a) => frameOf(name)?.getAttribute(a))).toStrictEqual(
      ['x', 'y', 'width', 'height', 'rx'].map((a) => frame?.getAttribute(a))
    );
  });

  it.each(modes)('%s fills one region that keeps a stroke width clear of the frame', (name) => {
    const fill = fillOf(name);
    // The frame's inner edge: x 3..17, y 4..16 less half a stroke.
    const inner = { left: 3 + STROKE / 2, top: 4 + STROKE / 2, right: 17 - STROKE / 2, bottom: 16 - STROKE / 2 };

    expect(rects(name)).toHaveLength(2);
    expect(fill.x - inner.left).toBeGreaterThanOrEqual(STROKE);
    expect(fill.y - inner.top).toBeGreaterThanOrEqual(STROKE);
    expect(inner.right - (fill.x + fill.width)).toBeGreaterThanOrEqual(STROKE);
    expect(inner.bottom - (fill.y + fill.height)).toBeGreaterThanOrEqual(STROKE);
  });

  it('puts the side peek in the inline-end half', () => {
    expect(fillOf('IconPeekSide').x).toBeGreaterThanOrEqual(10);
  });

  it('centres the center peek, and the full page fills more of the frame', () => {
    const center = fillOf('IconPeekCenter');
    const full = fillOf('IconPeekFull');

    expect(center.x + center.width / 2).toBe(10);
    expect(center.y + center.height / 2).toBe(10);
    expect(full.width * full.height).toBeGreaterThan(center.width * center.height * 1.4);
  });
});

describe('IconChevronDoubleRight', () => {
  it('repeats IconChevronRight\'s 4-unit arms twice, side by side', () => {
    const single = svgOf(Icons.IconChevronRight).querySelector('path')?.getAttribute('d');
    const paths = [...svgOf(iconOf('IconChevronDoubleRight')).querySelectorAll('path')].map((p) => p.getAttribute('d'));

    expect(single).toBe('M8 6L12 10L8 14');
    expect(paths).toStrictEqual(['M5.5 6L9.5 10L5.5 14', 'M10.5 6L14.5 10L10.5 14']);
  });
});

describe('IconExpandDiagonal', () => {
  // Notion's arrowExpandDiagonalSmall points to the top-left and bottom-right corners.
  it('is a diagonal shaft with an equal arrowhead at each end', () => {
    const paths = [...svgOf(iconOf('IconExpandDiagonal')).querySelectorAll('path')].map((p) => p.getAttribute('d'));

    expect(paths).toStrictEqual(['M5.5 5.5L14.5 14.5', 'M5.5 10L5.5 5.5L10 5.5', 'M14.5 10L14.5 14.5L10 14.5']);
  });

  it('is not IconArrowDiagonal\'s one-way arrow', () => {
    expect(iconOf('IconExpandDiagonal')).not.toBe(Icons.IconArrowDiagonal);
  });
});
