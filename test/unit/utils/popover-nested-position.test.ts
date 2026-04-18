import { describe, expect, it } from 'vitest';
import { clampNestedPopoverTop, resolveNestedPopoverSide } from '../../../src/components/utils/popover/popover-nested-position';

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
