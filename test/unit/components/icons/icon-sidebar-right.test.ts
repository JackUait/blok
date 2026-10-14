/**
 * Page info (research/10 §10: Notion's `sidebarRight`): the page frame with a
 * narrow panel at its inline end. It sits next to "Open pages in" (IconSplitView),
 * so the two must read as different pictures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as Icons from '../../../../src/components/icons';

const svgOf = (markup: string): Document => new DOMParser().parseFromString(markup, 'image/svg+xml');

const frameOf = (markup: string): string[] => {
  const rect = svgOf(markup).querySelector('rect');

  return ['x', 'y', 'width', 'height', 'rx'].map((name) => rect?.getAttribute(name) ?? '');
};

const iconOf = (name: string): string => {
  const icon: unknown = Object.entries(Icons).find(([key]) => key === name)?.[1];

  if (typeof icon !== 'string') {
    throw new Error(`Missing ${name}`);
  }

  return icon;
};

describe('IconSidebarRight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the same page frame as IconColumns', () => {
    const icon = iconOf('IconSidebarRight');

    expect(svgOf(icon).querySelectorAll('rect')).toHaveLength(1);
    expect(frameOf(icon)).toStrictEqual(frameOf(Icons.IconColumns));
  });

  it('splits off a narrow panel at the inline end with one full-height divider', () => {
    const paths = [...svgOf(iconOf('IconSidebarRight')).querySelectorAll('path')];

    expect(paths).toHaveLength(1);
    const match = /^M([\d.]+) 4v12$/.exec(paths[0].getAttribute('d') ?? '');

    expect(match).not.toBeNull();
    const x = Number(match?.[1]);
    const frameEnd = 17;
    const frameStart = 3;

    // Narrower than half: a side panel, not IconColumns' two equal columns.
    expect(frameEnd - x).toBeLessThan(x - frameStart);
    // Leaves an open interior at 16px: at least 2.5 stroke widths of room.
    expect(frameEnd - x).toBeGreaterThanOrEqual(2.5 * 1.25);
  });

  it('is a different picture from the adjacent Open pages in button', () => {
    expect(iconOf('IconSidebarRight')).not.toBe(Icons.IconSplitView);
  });
});
