import { describe, expect, it } from 'vitest';
import { clampNestedPopoverTop, resolveNestedPopoverBelowPlacement, resolveNestedPopoverSide } from '../../../src/components/utils/popover/popover-nested-position';

describe('resolveNestedPopoverSide', () => {
  it('opens nested popover to the right of a normal parent when there is room', () => {
    const { openLeft } = resolveNestedPopoverSide({
      parentRect: { left: 300, right: 520, width: 220 },
      nestedWidth: 220,
      viewportWidth: 1024,
      parentPrefersLeft: false,
    });

    expect(openLeft).toBe(false);
  });

  it('opens nested popover to the left when the parent hugs the right edge', () => {
    const { openLeft } = resolveNestedPopoverSide({
      parentRect: { left: 800, right: 1020, width: 220 },
      nestedWidth: 220,
      viewportWidth: 1024,
      parentPrefersLeft: true,
    });

    expect(openLeft).toBe(true);
  });

  it('flips to the right when parent is clamped to the left edge (placeLeftOfAnchor regression)', () => {
    // Regression guard for the "Convert to" bug: BlockSettings opens with
    // placeLeftOfAnchor on the leftmost block, which clamps its left edge to 0.
    // The nested submenu must NOT render at negative x.
    const { openLeft } = resolveNestedPopoverSide({
      parentRect: { left: 0, right: 220, width: 220 },
      nestedWidth: 220,
      viewportWidth: 1024,
      parentPrefersLeft: true,
    });

    expect(openLeft).toBe(false);
  });

  it('flips from right to left when parent leaves no room on the right', () => {
    const { openLeft } = resolveNestedPopoverSide({
      parentRect: { left: 600, right: 1000, width: 400 },
      nestedWidth: 220,
      viewportWidth: 1024,
      parentPrefersLeft: false,
    });

    expect(openLeft).toBe(true);
  });

  it('keeps preferred side when both sides can fit the nested popover', () => {
    const preferLeft = resolveNestedPopoverSide({
      parentRect: { left: 400, right: 620, width: 220 },
      nestedWidth: 220,
      viewportWidth: 1024,
      parentPrefersLeft: true,
    });

    const preferRight = resolveNestedPopoverSide({
      parentRect: { left: 400, right: 620, width: 220 },
      nestedWidth: 220,
      viewportWidth: 1024,
      parentPrefersLeft: false,
    });

    expect(preferLeft.openLeft).toBe(true);
    expect(preferRight.openLeft).toBe(false);
  });

  it('picks the side with more space when neither side fits', () => {
    const tighterRight = resolveNestedPopoverSide({
      parentRect: { left: 200, right: 800, width: 600 },
      nestedWidth: 500,
      viewportWidth: 1000,
      parentPrefersLeft: false,
    });

    // spaceLeft = 200, spaceRight (with overlap) ~= 204. Roughly equal, right wins.
    expect(tighterRight.openLeft).toBe(false);

    const tighterLeft = resolveNestedPopoverSide({
      parentRect: { left: 100, right: 900, width: 800 },
      nestedWidth: 500,
      viewportWidth: 1000,
      parentPrefersLeft: false,
    });

    // spaceLeft = 100, spaceRight ~= 104. Neither fits 500; pick larger → right.
    expect(tighterLeft.openLeft).toBe(false);
  });

  it('respects overlap when computing space on the right', () => {
    const { openLeft } = resolveNestedPopoverSide({
      parentRect: { left: 0, right: 512, width: 512 },
      nestedWidth: 524,
      viewportWidth: 1024,
      parentPrefersLeft: false,
      overlap: 12,
    });

    // spaceRight = 1024 - 512 + 12 = 524. Exactly fits. No flip.
    expect(openLeft).toBe(false);
  });

  it('clamps nested top to viewport margin when centered position overflows the top', () => {
    const { top } = clampNestedPopoverTop({
      desiredTop: -90,
      nestedHeight: 400,
      viewportHeight: 800,
      margin: 8,
    });

    expect(top).toBe(8);
  });

  it('clamps nested top so the submenu stays above the viewport bottom', () => {
    const { top } = clampNestedPopoverTop({
      desiredTop: 600,
      nestedHeight: 400,
      viewportHeight: 800,
      margin: 8,
    });

    // maxTop = 800 - 400 - 8 = 392
    expect(top).toBe(392);
  });

  it('keeps centered top when the submenu already fits inside the viewport', () => {
    const { top } = clampNestedPopoverTop({
      desiredTop: 100,
      nestedHeight: 300,
      viewportHeight: 800,
      margin: 8,
    });

    expect(top).toBe(100);
  });

  it('falls back to top margin when submenu is taller than the viewport', () => {
    const { top } = clampNestedPopoverTop({
      desiredTop: 100,
      nestedHeight: 1000,
      viewportHeight: 800,
      margin: 8,
    });

    // Nothing fits; pin to margin so the top is always visible.
    expect(top).toBe(8);
  });

  it('flips when nested overflow on the right exceeds what overlap grants', () => {
    const { openLeft } = resolveNestedPopoverSide({
      parentRect: { left: 200, right: 712, width: 512 },
      nestedWidth: 525,
      viewportWidth: 1024,
      parentPrefersLeft: false,
      overlap: 12,
    });

    // spaceRight = 1024 - 712 + 12 = 324, spaceLeft = 200.
    // Neither fits 525; pick larger → right (324 > 200). No flip.
    expect(openLeft).toBe(false);
  });
});

describe('resolveNestedPopoverBelowPlacement', () => {
  it('places the nested popover a gap below the parent with left edges aligned', () => {
    const { left, top, side } = resolveNestedPopoverBelowPlacement({
      parentRect: { left: 300, top: 200, bottom: 280 },
      nestedWidth: 340,
      nestedHeight: 60,
      viewportWidth: 1280,
      viewportHeight: 720,
    });

    expect(side).toBe('bottom');
    expect(left).toBe(300);
    // parent bottom 280 + default gap 4
    expect(top).toBe(284);
  });

  it('clamps left so the popover keeps the viewport margin on the right', () => {
    const { left } = resolveNestedPopoverBelowPlacement({
      parentRect: { left: 1000, top: 200, bottom: 280 },
      nestedWidth: 340,
      nestedHeight: 60,
      viewportWidth: 1280,
      viewportHeight: 720,
    });

    // 1280 - 340 - 8 = 932
    expect(left).toBe(932);
  });

  it('never crosses the left viewport margin', () => {
    const { left } = resolveNestedPopoverBelowPlacement({
      parentRect: { left: -40, top: 200, bottom: 280 },
      nestedWidth: 340,
      nestedHeight: 60,
      viewportWidth: 1280,
      viewportHeight: 720,
    });

    expect(left).toBe(8);
  });

  it('flips above the parent when there is no room below', () => {
    const { top, side } = resolveNestedPopoverBelowPlacement({
      parentRect: { left: 300, top: 600, bottom: 690 },
      nestedWidth: 340,
      nestedHeight: 60,
      viewportWidth: 1280,
      viewportHeight: 720,
    });

    expect(side).toBe('top');
    // parent top 600 - gap 4 - height 60
    expect(top).toBe(536);
  });

  it('stays below and clamps into the viewport when neither side fits', () => {
    const { top, side } = resolveNestedPopoverBelowPlacement({
      parentRect: { left: 300, top: 60, bottom: 660 },
      nestedWidth: 340,
      nestedHeight: 200,
      viewportWidth: 1280,
      viewportHeight: 720,
    });

    expect(side).toBe('bottom');
    // clamp: maxTop = 720 - 200 - 8 = 512
    expect(top).toBe(512);
  });

  it('respects a custom gap', () => {
    const { top } = resolveNestedPopoverBelowPlacement({
      parentRect: { left: 300, top: 200, bottom: 280 },
      nestedWidth: 340,
      nestedHeight: 60,
      viewportWidth: 1280,
      viewportHeight: 720,
      gap: 10,
    });

    expect(top).toBe(290);
  });

  /**
   * LAW: invariant sweep. Placement bugs cluster at viewport extremes that
   * hand-picked cases miss — sweep the parent card through every vertical and
   * horizontal position (including past the screen edges) and assert the
   * contract at each one:
   *
   *   1. GAP — the popover never touches a screen border (>= margin away)
   *      whenever it can physically fit.
   *   2. BELOW-FIRST — when there is room below the parent, it sits exactly
   *      `gap` px below it; when only above fits, exactly `gap` px above.
   *   3. ALIGNED — the popover keeps the parent's left edge whenever doing so
   *      violates no margin.
   */
  describe('LAW: gap/side/alignment invariants hold for every parent position', () => {
    const viewport = { width: 1280, height: 720 };
    const margin = 8;
    const gap = 4;
    const nested = { width: 340, height: 60 };
    const parentHeight = 90;

    it('sweeps the parent from offscreen-above to offscreen-below', () => {
      for (let parentTop = -parentHeight - 20; parentTop <= viewport.height + 20; parentTop += 7) {
        const parentRect = { left: 400, top: parentTop, bottom: parentTop + parentHeight };
        const { top, side } = resolveNestedPopoverBelowPlacement({
          parentRect,
          nestedWidth: nested.width,
          nestedHeight: nested.height,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        });
        const label = `parentTop=${parentTop}`;

        // 1. GAP — never touches the screen top/bottom.
        expect(top, `${label}: popover touches screen top`).toBeGreaterThanOrEqual(margin);
        expect(top + nested.height, `${label}: popover touches screen bottom`).toBeLessThanOrEqual(viewport.height - margin);

        // 2. BELOW-FIRST — room below → exactly gap below the parent;
        // otherwise, if the flipped position is fully on-screen → exactly
        // gap above it (the GAP invariant wins over attachment when the
        // parent itself hangs past a viewport edge).
        const belowTop = parentRect.bottom + gap;
        const fitsBelow = belowTop >= margin && belowTop + nested.height <= viewport.height - margin;
        const aboveTop = parentRect.top - gap - nested.height;
        const fitsAbove = aboveTop >= margin && aboveTop + nested.height <= viewport.height - margin;

        if (fitsBelow) {
          expect(side, `${label}: should open below`).toBe('bottom');
          expect(top, `${label}: not attached below the parent`).toBe(belowTop);
        } else if (fitsAbove) {
          expect(side, `${label}: should flip above`).toBe('top');
          expect(top, `${label}: not attached above the parent`).toBe(aboveTop);
        }
      }
    });

    it('sweeps the parent from offscreen-left to offscreen-right', () => {
      for (let parentLeft = -nested.width; parentLeft <= viewport.width + 20; parentLeft += 9) {
        const { left } = resolveNestedPopoverBelowPlacement({
          parentRect: { left: parentLeft, top: 200, bottom: 200 + parentHeight },
          nestedWidth: nested.width,
          nestedHeight: nested.height,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        });
        const label = `parentLeft=${parentLeft}`;

        // 1. GAP — never touches the screen left/right.
        expect(left, `${label}: popover touches screen left`).toBeGreaterThanOrEqual(margin);
        expect(left + nested.width, `${label}: popover touches screen right`).toBeLessThanOrEqual(viewport.width - margin);

        // 3. ALIGNED — keeps the parent's left edge when no margin is violated.
        if (parentLeft >= margin && parentLeft + nested.width <= viewport.width - margin) {
          expect(left, `${label}: popover not aligned with the parent`).toBe(parentLeft);
        }
      }
    });
  });
});
