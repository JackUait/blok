import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconText,
} from '../../../../src/components/icons';

const parse = (icon: string): SVGPathElement[] =>
  Array.from(new DOMParser().parseFromString(icon, 'image/svg+xml').querySelectorAll('path'));

// Toggle headings lead with a solid disclosure triangle; the H and digit follow it.
const letterformsOf = (name: string, icon: string): SVGPathElement[] =>
  name.startsWith('IconToggle') ? parse(icon).slice(1) : parse(icon);

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

  it.each(Object.entries(family))('%s has only stroked letterforms', (name, icon) => {
    const paths = letterformsOf(name, icon);

    expect(paths.length).toBeGreaterThanOrEqual(1);

    for (const path of paths) {
      expect(path.getAttribute('fill')).not.toBe('currentColor');
      expect(path.getAttribute('stroke')).toBe('currentColor');
      expect(path.getAttribute('stroke-linecap')).toBe('round');
      expect(path.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it.each(Object.entries(family))('%s draws the H and its digit at the 1.25 house stroke', (name, icon) => {
    const shapes = Array.from(new DOMParser().parseFromString(icon, 'image/svg+xml').querySelectorAll('path, circle'))
      .slice(name.startsWith('IconToggle') ? 1 : 0);

    expect(shapes.length).toBeGreaterThanOrEqual(1);

    for (const shape of shapes) {
      expect(shape.getAttribute('stroke-width')).toBe('1.25');
    }
  });
});
