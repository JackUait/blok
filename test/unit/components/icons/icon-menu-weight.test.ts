import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  IconText, IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconListBulleted, IconListNumbered, IconListChecklist, IconToggleList,
  IconCallout, IconQuote, IconCode,
} from '../../../../src/components/icons';

const menuIcons = {
  IconText, IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconListBulleted, IconListNumbered, IconListChecklist, IconToggleList,
  IconCallout, IconQuote, IconCode,
};

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

describe('convert-menu icon weight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(menuIcons))('%s draws strokes at or below the house hairline', (_name, icon) => {
    const stroked = Array.from(svgOf(icon).querySelectorAll('[stroke="currentColor"]'));

    expect(stroked.length).toBeGreaterThan(0);

    for (const element of stroked) {
      const width = Number(element.getAttribute('stroke-width'));

      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(1.25);
    }
  });

  it.each(Object.entries(menuIcons))('%s has no solid structural bars', (_name, icon) => {
    const filledRects = Array.from(svgOf(icon).querySelectorAll('rect')).filter(
      (rect) => rect.getAttribute('fill') === 'currentColor',
    );

    expect(filledRects).toHaveLength(0);
  });

  it('numbered-list markers are lighter than their text lines and never filled', () => {
    const paths = Array.from(svgOf(IconListNumbered).querySelectorAll('path'));

    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('stroke-width')).toBe('1.25');
    expect(paths[1]?.getAttribute('stroke-width')).toBe('1.05');

    for (const path of paths) {
      expect(path.getAttribute('fill')).not.toBe('currentColor');
      expect(path.getAttribute('stroke')).toBe('currentColor');
    }
  });
});
