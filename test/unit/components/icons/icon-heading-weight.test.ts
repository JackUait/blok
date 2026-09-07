import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconText,
} from '../../../../src/components/icons';

const parse = (icon: string): SVGPathElement[] =>
  Array.from(new DOMParser().parseFromString(icon, 'image/svg+xml').querySelectorAll('path'));

describe('heading icon weight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const family = {
    IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
    IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  };

  it('IconText is the 1.25 hairline reference', () => {
    expect(parse(IconText)[0]?.getAttribute('stroke-width')).toBe('1.25');
  });

  it.each(Object.entries(family))('%s has only stroked letterforms', (_name, icon) => {
    const paths = parse(icon);

    expect(paths.length).toBeGreaterThanOrEqual(1);

    for (const path of paths) {
      expect(path.getAttribute('fill')).not.toBe('currentColor');
      expect(path.getAttribute('stroke')).toBe('currentColor');
      expect(path.getAttribute('stroke-linecap')).toBe('round');
      expect(path.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it.each(Object.entries(family))('%s uses a 1.25 main glyph and a lighter 1.1 digit', (_name, icon) => {
    const paths = parse(icon);

    expect(paths[0]?.getAttribute('stroke-width')).toBe('1.25');

    for (const digit of paths.slice(1)) {
      expect(digit.getAttribute('stroke-width')).toBe('1.1');
    }
  });
});
