import { describe, it, expect } from 'vitest';

import {
  clampNestedPopoverTop,
  resolveNestedPopoverBelowPlacement,
  resolveNestedPopoverSide,
} from '../../../../../src/components/utils/popover/popover-nested-position';

const side = (input: {
  left: number;
  right: number;
  nestedWidth: number;
  viewportWidth: number;
  parentPrefersLeft: boolean;
}): boolean =>
  resolveNestedPopoverSide({
    parentRect: { left: input.left, right: input.right, width: input.right - input.left },
    nestedWidth: input.nestedWidth,
    viewportWidth: input.viewportWidth,
    parentPrefersLeft: input.parentPrefersLeft,
  }).openLeft;

const below = (input: {
  left?: number;
  top: number;
  bottom: number;
  nestedHeight: number;
  viewportHeight: number;
}): { top: number; side: string } => {
  const { top: placedTop, side: placedSide } = resolveNestedPopoverBelowPlacement({
    parentRect: { left: input.left ?? 100, top: input.top, bottom: input.bottom },
    nestedWidth: 200,
    nestedHeight: input.nestedHeight,
    viewportWidth: 1000,
    viewportHeight: input.viewportHeight,
  });

  return { top: placedTop, side: placedSide };
};

/**
 * Nine survivors are equivalent, in three groups, and all three come from the
 * geometry rather than from missing coverage.
 *
 * Dropping either "the other side fits" return (and either of their bodies)
 * changes nothing, because the fall-through picks the side with more space and
 * that is always the side that fits: not fitting left means the width exceeds
 * the space on the left, and fitting right means it does not exceed the space
 * on the right, so the right side is provably the roomier one. The mirror
 * argument covers the other branch.
 *
 * The `belowTop >= margin` half of the below-placement test is unreachable as a
 * decision. `aboveTop` is smaller than the parent top, which is at most the
 * parent bottom, which is smaller than `belowTop` — so whenever the above
 * placement clears the margin the below one already did, and when it does not,
 * the side is "bottom" either way.
 *
 * The taller-than-viewport pin is a shortcut, not a rule: when maxTop is below
 * (or equal to) the floor, `Math.max(floor, Math.min(maxTop, desired))` already
 * yields the floor for every desired value.
 */
describe('nested popover position mutants', () => {
  describe('picking a side', () => {
    // The popover is exactly as wide as the space on the preferred side, and
    // the other side has room to spare — the only shape that separates fitting
    // from strictly fitting.
    it('keeps the left when the width exactly equals the space there', () => {
      expect(side({ left: 100, right: 400, nestedWidth: 100, viewportWidth: 600, parentPrefersLeft: true }))
        .toBe(true);
    });

    it('keeps the right when the width exactly equals the space there', () => {
      expect(side({ left: 200, right: 504, nestedWidth: 100, viewportWidth: 600, parentPrefersLeft: false }))
        .toBe(false);
    });

    it('stays on the right when both sides fit and nothing prefers the left', () => {
      expect(side({ left: 500, right: 600, nestedWidth: 100, viewportWidth: 700, parentPrefersLeft: false }))
        .toBe(false);
    });

    it('falls back to the roomier side when neither fits', () => {
      expect(side({ left: 300, right: 400, nestedWidth: 500, viewportWidth: 450, parentPrefersLeft: true }))
        .toBe(true);
      expect(side({ left: 50, right: 400, nestedWidth: 500, viewportWidth: 900, parentPrefersLeft: true }))
        .toBe(false);
    });

    // Equal space on both sides keeps the default right side, so the nested
    // popover does not flip for no visible benefit.
    it('breaks a tie by staying on the right', () => {
      expect(side({ left: 100, right: 304, nestedWidth: 500, viewportWidth: 400, parentPrefersLeft: true }))
        .toBe(false);
    });
  });

  describe('placing below the parent', () => {
    it('stays below when the popover ends exactly on the bottom margin', () => {
      expect(below({ top: 300, bottom: 488, nestedHeight: 100, viewportHeight: 600 }))
        .toStrictEqual({ top: 492, side: 'bottom' });
    });

    // Above fits only just: its top lands exactly on the margin.
    it('flips above when below overflows and above clears the margin exactly', () => {
      expect(below({ top: 112, bottom: 500, nestedHeight: 100, viewportHeight: 550 }))
        .toStrictEqual({ top: 8, side: 'top' });
    });

    it('stays below, clamped, when neither side fits', () => {
      expect(below({ top: 60, bottom: 500, nestedHeight: 100, viewportHeight: 550 }))
        .toStrictEqual({ top: 442, side: 'bottom' });
    });
  });

  describe('clamping the top', () => {
    it('pins to the top margin when the popover is taller than the viewport', () => {
      expect(clampNestedPopoverTop({ desiredTop: 300, nestedHeight: 800, viewportHeight: 400 }))
        .toStrictEqual({ top: 8 });
    });

    it('keeps a top that already fits, and pulls one that does not back in', () => {
      expect(clampNestedPopoverTop({ desiredTop: 100, nestedHeight: 100, viewportHeight: 600 }))
        .toStrictEqual({ top: 100 });
      expect(clampNestedPopoverTop({ desiredTop: 900, nestedHeight: 100, viewportHeight: 600 }))
        .toStrictEqual({ top: 492 });
    });
  });
});
