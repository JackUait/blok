/**
 * The Ask AI bar's Undo: a hooked arrow that turns back. Its head is the
 * return icon's head, so the two arrows read as one family.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconReturn, IconUndo } from '../../../../src/components/icons';

const paths = (markup: string): string[] =>
  [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')]
    .map((path) => path.getAttribute('d') ?? '');

/** A three-point "M x y L x y L x y" head, as its two arms from the tip. */
const arms = (d: string): Array<[number, number]> => {
  const [a, tip, b] = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

  return [[a[0] - tip[0], a[1] - tip[1]], [b[0] - tip[0], b[1] - tip[1]]];
};

const isHead = (d: string): boolean => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+$/.test(d);

describe('IconUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('points left with the return icon\'s arrowhead', () => {
    const head = paths(IconUndo).find(isHead);
    const returnHead = paths(IconReturn).find(isHead);

    expect(head).toBeDefined();
    expect(returnHead).toBeDefined();

    const undoArms = arms(head ?? '').sort((p, q) => p[1] - q[1]);
    const returnArms = arms(returnHead ?? '').sort((p, q) => p[1] - q[1]);

    expect(undoArms).toEqual(returnArms);
    // Both arms go right of the tip: the arrow points left.
    undoArms.forEach(([dx]) => expect(dx).toBeGreaterThan(0));
  });
});
