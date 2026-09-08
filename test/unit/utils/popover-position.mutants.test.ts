import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolvePosition, shouldFlip } from '../../../src/components/utils/popover/popover-position';

/**
 * jsdom lays nothing out, so every rect here is hand-built with numbers picked
 * so the original expression and each arithmetic mutant land on distinct
 * values. Assertions compare the WHOLE resolved object: a single-coordinate
 * assertion survives every mutant that only moves the other axis.
 */
const rect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
  ...overrides,
});

describe('popover-position — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldFlip boundaries', () => {
    it('does not flip when the popover exactly fills the preferred space', () => {
      // Boundary case for `popoverDimension <= spaceOnPreferred`: an exact fit
      // must stay on the preferred side even though the alternate side is roomier.
      expect(shouldFlip(200, 200, 500)).toBe(false);
    });

    it('flips when the popover exactly fills the alternate space', () => {
      // Boundary case for `popoverDimension <= spaceOnAlternate`: an exact fit
      // on the alternate side is still a fit.
      expect(shouldFlip(200, 100, 200)).toBe(true);
    });

    it('stays on the preferred side when neither side fits', () => {
      expect(shouldFlip(200, 100, 150)).toBe(false);
    });
  });

  describe('boundary clamping of the scope rect', () => {
    it('takes the LOWER edge of viewport-top and scope-top as the top boundary', () => {
      // boundaryTop = Math.max(0, scopeBounds.top) = 100.
      // spaceBelow = 600 - 340 - 8 = 252 < 270, spaceAbove = 300 - 8 - 100 = 192 < 270
      // => neither side fits => stay below. With Math.min the boundary becomes 0,
      // spaceAbove grows to 292 >= 270 and the popover would flip above.
      const result = resolvePosition({
        anchor: rect({ top: 300, bottom: 340, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 270 },
        scopeBounds: rect({ top: 100, bottom: 600, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 600 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 348, left: 50, openTop: false, openLeft: false });
    });

    it('takes the RIGHTMOST edge of viewport-left and scope-left as the left boundary', () => {
      // boundaryLeft = Math.max(0, scopeBounds.left) = 120.
      // spaceRight = 600 - 380 = 220 < 300, spaceLeft = 400 - 120 = 280 < 300
      // => no flip, then the right-edge clamp pins the popover to 600 - 300 = 300.
      // With Math.min the boundary becomes 0, spaceLeft grows to 400 >= 300 and
      // the popover flips left to 400 - 300 = 100.
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 380, right: 400 }),
        popoverSize: { width: 300, height: 200 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 120, right: 600 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 148, left: 300, openTop: false, openLeft: false });
    });
  });

  describe('document-coordinate conversion while scrolled', () => {
    it('ADDS the scroll offset to the scope top before clamping', () => {
      // scopeTopInDocCoords = 50 + 200 = 250. rawTop = 30 + 8 + 200 = 238 < 250,
      // so the popover is pushed down to the scope top. Subtracting the scroll
      // instead gives -150 and the clamp never fires (top stays 238); dropping
      // the clamp altogether does the same.
      const result = resolvePosition({
        anchor: rect({ top: 10, bottom: 30, left: 100, right: 260 }),
        popoverSize: { width: 300, height: 300 },
        scopeBounds: rect({ top: 50, bottom: 700, left: 0, right: 900 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 200 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 250, left: 100, openTop: false, openLeft: false });
    });

    it('clamps a popover anchored above the scope down to the scope top', () => {
      // rawTop = 100 + 8 = 108, scopeTopInDocCoords = 400 => clamped to 400.
      const result = resolvePosition({
        anchor: rect({ top: 60, bottom: 100, left: 150, right: 300 }),
        popoverSize: { width: 200, height: 200 },
        scopeBounds: rect({ top: 400, bottom: 900, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 400, left: 150, openTop: false, openLeft: false });
    });
  });

  describe('aside placement — fit test', () => {
    it("SUBTRACTS the offset from the right-side gap (asideSide: 'right')", () => {
      // asideSpace = 900 - 600 - 8 = 292 < 300 => the aside placement is refused
      // and the popover opens below. Adding the offset gives 308 >= 300 and the
      // popover would sit beside the anchor at { top: 170, left: 600 }.
      const result = resolvePosition({
        anchor: rect({ top: 200, bottom: 240, left: 450, right: 600 }),
        popoverSize: { width: 300, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 900 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
        placeLeftOfAnchor: true,
        asideSide: 'right',
      });

      expect(result).toStrictEqual({ top: 248, left: 450, openTop: false, openLeft: false });
    });

    it('SUBTRACTS both the offset and the left boundary from the left-side gap', () => {
      // asideSpace = 300 - 8 - 100 = 192 < 200 => opens below.
      // `+ boundaryLeft` gives 392 and `anchor.left + offset` gives 208 — both
      // >= 200, so either would place the menu beside the anchor at
      // { top: 210, left: 100, openLeft: true }.
      const result = resolvePosition({
        anchor: rect({ top: 250, bottom: 290, left: 300, right: 460 }),
        popoverSize: { width: 200, height: 120 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 100, right: 900 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
        placeLeftOfAnchor: true,
      });

      expect(result).toStrictEqual({ top: 298, left: 300, openTop: false, openLeft: false });
    });

    it('places the popover aside when it exactly fills the aside gap', () => {
      // asideSpace = 500 - 8 - 100 = 392 === popover width => `<=` keeps the
      // aside placement. A strict `<` falls through to the below placement
      // at { top: 348, left: 500 }.
      const result = resolvePosition({
        anchor: rect({ top: 300, bottom: 340, left: 500, right: 560 }),
        popoverSize: { width: 392, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 100, right: 900 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
        placeLeftOfAnchor: true,
      });

      expect(result).toStrictEqual({ top: 270, left: 100, openTop: false, openLeft: true });
    });
  });

  describe('aside placement — vertical window', () => {
    it('ADDS the scroll offset to the scope bottom and never reports openTop', () => {
      // scopeBottomInDocCoords = 500 + 400 = 900, viewportBottomCeiling = 1168
      // => bottomCeiling 900, maxTop 700, desiredTop 540 - 100 = 440 => top 440.
      // Subtracting the scroll gives a ceiling of 100, maxTop -100 < topFloor 400,
      // pinning the popover to 400. The aside placement is always a side
      // placement, so openTop stays false.
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 180, left: 300, right: 340 }),
        popoverSize: { width: 250, height: 200 },
        scopeBounds: rect({ top: 0, bottom: 500, left: 0, right: 900 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 400 },
        offset: 8,
        placeLeftOfAnchor: true,
      });

      expect(result).toStrictEqual({ top: 440, left: 42, openTop: false, openLeft: true });
    });
  });

  describe('aside placement — horizontal offset', () => {
    it("ADDS the scroll offset to the right-side left coordinate (asideSide: 'right')", () => {
      // rawLeft = 400 + 8 + 300 = 708, below the 1000 clamp => left 708.
      // Subtracting the scroll gives 108.
      const result = resolvePosition({
        anchor: rect({ top: 200, bottom: 240, left: 340, right: 400 }),
        popoverSize: { width: 200, height: 150 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 900 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 300, y: 0 },
        offset: 8,
        placeLeftOfAnchor: true,
        asideSide: 'right',
      });

      expect(result).toStrictEqual({ top: 145, left: 708, openTop: false, openLeft: false });
    });

    it("ADDS the scroll offset to the right-side boundary clamp (asideSide: 'right')", () => {
      // Popover exactly fills the aside gap (asideSpace = 900 - 500 - 8 = 392),
      // so rawLeft 568 meets the clamp 900 + 60 - 392 = 568 exactly. Subtracting
      // the scroll from the clamp drops it to 448 and the popover jumps left,
      // off its anchor.
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 180, left: 440, right: 500 }),
        popoverSize: { width: 392, height: 200 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 900 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 60, y: 0 },
        offset: 8,
        placeLeftOfAnchor: true,
        asideSide: 'right',
      });

      expect(result).toStrictEqual({ top: 40, left: 568, openTop: false, openLeft: false });
    });

    it('ADDS the scroll offset to the left-side boundary clamp under rubber-band overscroll', () => {
      // `window.scrollX` (what both callers pass) goes NEGATIVE during macOS
      // rubber-band overscroll. That is the only input that reaches this clamp:
      // for scrollX >= 0 the branch guard `width <= asideSpace` already
      // guarantees rawLeft >= boundaryLeft + scrollX, so Math.max returns rawLeft.
      // Here rawLeft = 400 - 8 - 290 - 40 = 62 and the floor is 100 - 40 = 60.
      // Subtracting the scroll raises the floor to 140 and detaches the menu.
      const result = resolvePosition({
        anchor: rect({ top: 200, bottom: 240, left: 400, right: 440 }),
        popoverSize: { width: 290, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 100, right: 900 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: -40, y: 0 },
        offset: 8,
        placeLeftOfAnchor: true,
      });

      expect(result).toStrictEqual({ top: 170, left: 62, openTop: false, openLeft: true });
    });
  });

  describe('below/above placement', () => {
    it('SUBTRACTS the offset from the space below the anchor', () => {
      // spaceBelow = 900 - 600 - 8 = 292 < 300 while spaceAbove = 552 >= 300,
      // so the popover flips above to 560 - 8 - 300 = 252. Adding the offset
      // gives 308 >= 300 and it would stay below at 608.
      const result = resolvePosition({
        anchor: rect({ top: 560, bottom: 600, left: 100, right: 250 }),
        popoverSize: { width: 200, height: 300 },
        scopeBounds: rect({ top: 0, bottom: 900, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 900 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 252, left: 100, openTop: true, openLeft: false });
    });

    it('SUBTRACTS both the offset and the top boundary from the space above the anchor', () => {
      // spaceBelow = 700 - 440 - 8 = 252 and spaceAbove = 400 - 8 - 100 = 292,
      // both < 300 => stay below at 448. `+ boundaryTop` gives 492 and
      // `anchor.top + offset` gives 308 — either would flip above and then be
      // clamped to the scope top (100).
      const result = resolvePosition({
        anchor: rect({ top: 400, bottom: 440, left: 200, right: 350 }),
        popoverSize: { width: 250, height: 300 },
        scopeBounds: rect({ top: 100, bottom: 700, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 700 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 448, left: 200, openTop: false, openLeft: false });
    });
  });

  describe('left/right placement', () => {
    it('ADDS the scroll offset to the anchor right edge before measuring the left space', () => {
      // spaceLeft = (500 + 100) - 0 - 100 = 500 >= 400 and spaceRight = 320 < 400
      // => flip left to max(100, 500 - 400 + 100) = 200. Subtracting the scroll
      // shrinks spaceLeft to 300 < 400, so the popover would stay right-aligned
      // and be clamped to 400.
      const result = resolvePosition({
        anchor: rect({ top: 200, bottom: 240, left: 380, right: 500 }),
        popoverSize: { width: 400, height: 150 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 700 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 100, y: 50 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 298, left: 200, openTop: false, openLeft: true });
    });

    it('ADDS the scroll offset to the right boundary before measuring the right space', () => {
      // spaceRight = 900 + 120 - 520 = 500 >= 300 => no flip. Subtracting the
      // scroll shrinks it to 260 < 300 and, because spaceLeft (700) fits, the
      // popover would report openLeft (the left coordinate happens to match,
      // which is why the whole object has to be asserted).
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 400, right: 700 }),
        popoverSize: { width: 300, height: 200 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 900 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 120, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 148, left: 520, openTop: false, openLeft: false });
    });

    it('SUBTRACTS both the left boundary and the scroll offset from the left space', () => {
      // spaceRight = 380 and spaceLeft = 600 - 150 - 100 = 350, both < 400
      // => stay right-aligned, then the right-edge clamp pins to 900 - 400 = 500.
      // `+ scrollOffset.x` gives 550 and `+ boundaryLeft` gives 650 — either
      // would flip the popover left to 250.
      const result = resolvePosition({
        anchor: rect({ top: 200, bottom: 240, left: 420, right: 500 }),
        popoverSize: { width: 400, height: 150 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 150, right: 800 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 100, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 248, left: 500, openTop: false, openLeft: false });
    });

    it('ADDS the scroll offset to the left boundary of a flipped popover under rubber-band overscroll', () => {
      // Same rubber-band case as the aside clamp: for scrollX >= 0 the flip
      // condition (width <= anchor.right - boundaryLeft) already guarantees
      // anchor.right - width >= boundaryLeft, so this Math.max returns its
      // second argument. With scrollX = -50 the floor is 250 and the raw value
      // 260 still wins; subtracting the scroll raises the floor to 350 and the
      // popover slides right, away from the anchor.
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 500, right: 610 }),
        popoverSize: { width: 300, height: 200 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 300, right: 750 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: -50, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 148, left: 260, openTop: false, openLeft: true });
    });
  });

  describe('right-edge clamp', () => {
    it('does NOT clamp when the popover ends exactly on the right boundary', () => {
      // rawLeft + width = 150 + 450 = 600 === boundaryRight. A `>=` comparison
      // would clamp and, because the anchor starts left of the scope
      // (150 < 200), push the popover to the scope left edge at 200.
      const result = resolvePosition({
        anchor: rect({ top: 300, bottom: 340, left: 150, right: 260 }),
        popoverSize: { width: 450, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 200, right: 600 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 348, left: 150, openTop: false, openLeft: false });
    });

    it('ADDS the scroll offset to the left boundary when a too-wide popover is clamped', () => {
      // The popover (750) is wider than the scope (700 - 200 = 500), so the
      // clamp falls back to the left boundary 200 + 100 = 300. Subtracting the
      // scroll gives 100, half a scroll-width off.
      const result = resolvePosition({
        anchor: rect({ top: 200, bottom: 240, left: 300, right: 450 }),
        popoverSize: { width: 750, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 200, right: 700 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 100, y: 0 },
        offset: 8,
      });

      expect(result).toStrictEqual({ top: 248, left: 300, openTop: false, openLeft: false });
    });
  });
});

/*
 * PROVEN-EQUIVALENT MUTANTS (swept, still Survived — the proofs below say why
 * no input can observe them). Line numbers refer to
 * src/components/utils/popover/popover-position.ts.
 *
 * 1. L88 `asideSide = 'left'` -> `''` (StringLiteral).
 *    `asideSide` is read exactly once, at L107 `asideSide === 'right'`.
 *    `'' === 'right'` and `'left' === 'right'` are both false, so
 *    `asideOnRight` is unchanged for every input. (TypeScript would reject `''`
 *    for `'left' | 'right'`, but the mutation run transpiles with esbuild, so
 *    the mutant reaches runtime instead of failing to compile.)
 *
 * 2. L130 `maxTop < topFloor ? topFloor : ...` -> `false` (ConditionalExpression).
 *    The else branch is `Math.max(topFloor, Math.min(desiredTop, maxTop))`.
 *    When `maxTop < topFloor`, `Math.min(desiredTop, maxTop) <= maxTop < topFloor`,
 *    so `Math.max` returns `topFloor` — exactly the then branch. The ternary is
 *    redundant with its own else branch for every input.
 *
 * 3. L130 `maxTop < topFloor` -> `maxTop <= topFloor` (EqualityOperator).
 *    The two operators differ only at `maxTop === topFloor`, where the else
 *    branch is `Math.max(topFloor, Math.min(desiredTop, topFloor)) === topFloor`,
 *    identical to the then branch.
 *
 * 4. L143 `Math.min(boundaryRight + scrollOffset.x - popoverSize.width, rawLeft)`
 *    -> `+ popoverSize.width` (ArithmeticOperator).
 *    The branch guard at L112 is `popoverSize.width <= asideSpace`, i.e.
 *    `w <= boundaryRight - anchor.right - offset`, which rearranges to
 *    `rawLeft = anchor.right + offset + sx <= boundaryRight + sx - w`. So the
 *    original Math.min always returns `rawLeft`, and since `w >= 0` the mutated
 *    ceiling `boundaryRight + sx + w` is even larger — also returning `rawLeft`.
 *
 * 5. L164 `rawTop < scopeTopInDocCoords` -> `<=` (EqualityOperator).
 *    The ternary returns `scopeTopInDocCoords` or `rawTop`; the operators differ
 *    only when those two are equal, where both branches produce the same number.
 */
