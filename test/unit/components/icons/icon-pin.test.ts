/**
 * The page layout builder's pin buttons (research/09 §3: Notion's `pin` and
 * `pinFill`). Pinned fills the pin's body; both share one outline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconPin, IconPinFilled } from '../../../../src/components/icons';

const paths = (markup: string): Array<{ d: string; fill: string | null }> =>
  [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')]
    .map((path) => ({ d: path.getAttribute('d') ?? '', fill: path.getAttribute('fill') }));

describe('pin icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the filled pin on the outline pin, filling only its body', () => {
    const outline = paths(IconPin);
    const filled = paths(IconPinFilled);

    expect(outline).toHaveLength(1);
    expect(outline[0].fill).toBeNull();
    expect(filled.map((p) => p.d)).toContain(outline[0].d);
    const solid = filled.filter((p) => p.fill === 'currentColor');

    expect(solid).toHaveLength(1);
    expect(solid[0].d).not.toBe(outline[0].d);
  });

  it('stands upright on the vertical centre line, inside x/y 3-17', () => {
    const numbers = (d: string): number[] => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const { d } = paths(IconPin)[0];

    expect(d).toMatch(/M10 [\d.]+V16\.5/);
    for (const n of numbers(d)) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(17);
    }
  });
});
