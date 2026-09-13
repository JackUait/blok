import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  resolvePosition,
  shouldFlip,
  type PositionInput,
  type ResolvedPosition,
} from '../../../../../src/components/utils/popover/popover-position';

/**
 * `resolvePosition` and `shouldFlip` are pure: every number below is a real
 * coordinate supplied by the fixture, so jsdom's missing layout never matters.
 */
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});

type Overrides = Partial<PositionInput>;

/** Builds an input where every value is explicit, then applies the overrides. */
const resolve = (overrides: Overrides): ResolvedPosition => {
  const base: PositionInput = {
    anchor: rect(100, 200, 50, 20),
    popoverSize: {
      width: 200,
      height: 100,
    },
    scopeBounds: rect(0, 0, 1000, 800),
    viewportSize: {
      width: 1000,
      height: 800,
    },
    scrollOffset: {
      x: 0,
      y: 0,
    },
  };

  return resolvePosition({
    ...base,
    ...overrides,
  });
};

describe('shouldFlip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not flip when the popover exactly fills the preferred space', () => {
    // Exact fit is a fit: flipping here would move the popover for nothing,
    // even though the alternate side fits just as well.
    expect(shouldFlip(100, 100, 100)).toBe(false);
  });

  it('does not flip while the preferred space is larger than the popover', () => {
    expect(shouldFlip(100, 101, 1000)).toBe(false);
  });

  it('flips when the popover exactly fills the alternate space and overflows the preferred one', () => {
    expect(shouldFlip(100, 99, 100)).toBe(true);
  });

  it('stays on the preferred side when neither side fits', () => {
    expect(shouldFlip(100, 99, 99)).toBe(false);
  });

  it('flips on a one pixel alternate surplus and not on a one pixel deficit', () => {
    expect(shouldFlip(100, 50, 100)).toBe(true);
    expect(shouldFlip(100, 50, 99)).toBe(false);
  });
});

describe('resolvePosition — default below/right placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places the popover below and left-aligned with the anchor when everything fits', () => {
    expect(resolve({})).toEqual({
      top: 228,
      left: 100,
      openTop: false,
      openLeft: false,
    });
  });

  it('honours a custom offset on both the vertical gap and the fit computation', () => {
    expect(resolve({ offset: 20 })).toEqual({
      top: 240,
      left: 100,
      openTop: false,
      openLeft: false,
    });
  });

  it('uses leftAlignRect.left instead of the anchor left for horizontal alignment', () => {
    expect(resolve({ leftAlignRect: rect(40, 0, 10, 10) }).left).toBe(40);
  });

  it('adds the scroll offset to both coordinates', () => {
    expect(resolve({ scrollOffset: {
      x: 30,
      y: 70,
    } })).toEqual({
      top: 298,
      left: 130,
      openTop: false,
      openLeft: false,
    });
  });
});

describe('resolvePosition — vertical flip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens above when the space below is one pixel short and the space above fits', () => {
    // boundaryBottom 500, anchor.bottom 300 => spaceBelow 192 < 200.
    const result = resolve({
      anchor: rect(100, 290, 50, 10),
      popoverSize: {
        width: 100,
        height: 200,
      },
      scopeBounds: rect(0, 0, 1000, 500),
      viewportSize: {
        width: 1000,
        height: 500,
      },
    });

    expect(result.openTop).toBe(true);
    expect(result.top).toBe(82);
  });

  it('stays below when the space below exactly fits the popover', () => {
    // spaceBelow is exactly 200 here, so no flip may happen.
    const result = resolve({
      anchor: rect(100, 282, 50, 10),
      popoverSize: {
        width: 100,
        height: 200,
      },
      scopeBounds: rect(0, 0, 1000, 500),
      viewportSize: {
        width: 1000,
        height: 500,
      },
    });

    expect(result.openTop).toBe(false);
    expect(result.top).toBe(300);
  });

  it('measures the space above from the scope top, not from the anchor alone', () => {
    // scope.top 100 => spaceAbove 242 < 250, and spaceBelow 222 < 250, so the
    // popover must stay below even though the raw anchor gap looks sufficient.
    const result = resolve({
      anchor: rect(100, 350, 50, 20),
      popoverSize: {
        width: 100,
        height: 250,
      },
      scopeBounds: rect(0, 100, 1000, 500),
      viewportSize: {
        width: 1000,
        height: 600,
      },
    });

    expect(result.openTop).toBe(false);
    expect(result.top).toBe(378);
  });

  it('clamps a negative scope top to the viewport top when measuring the space above', () => {
    // boundaryTop is max(0, -100) = 0, so spaceAbove is 42 and the popover of
    // height 100 fits on neither side: it stays below.
    const result = resolve({
      anchor: rect(100, 50, 50, 20),
      popoverSize: {
        width: 100,
        height: 100,
      },
      scopeBounds: rect(0, -100, 1000, 300),
      viewportSize: {
        width: 1000,
        height: 150,
      },
    });

    expect(result.openTop).toBe(false);
    expect(result.top).toBe(78);
  });
});

describe('resolvePosition — top clamp in document coordinates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pins the popover to the scope top when the raw top would land above it', () => {
    // rawTop 148 vs scope top in doc coords 150: the clamp wins by 2px, and it
    // must use scopeBounds.top + scrollY, not scopeBounds.top - scrollY.
    const result = resolve({
      anchor: rect(100, 20, 50, 20),
      popoverSize: {
        width: 100,
        height: 100,
      },
      scopeBounds: rect(0, 50, 1000, 750),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: 0,
        y: 100,
      },
    });

    expect(result.top).toBe(150);
    expect(result.openTop).toBe(false);
  });

  it('leaves the raw top alone when it already sits below the scope top', () => {
    const result = resolve({
      anchor: rect(100, 20, 50, 30),
      popoverSize: {
        width: 100,
        height: 100,
      },
      scopeBounds: rect(0, 50, 1000, 750),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: 0,
        y: 100,
      },
    });

    expect(result.top).toBe(158);
  });
});

describe('resolvePosition — horizontal flip and clamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the scroll offset out of the available-space arithmetic', () => {
    // spaceRight is boundaryRight - anchor.left = 200, an exact fit for a 200px
    // popover, so scrolling right by 50px must not turn this into a flip.
    const result = resolve({
      anchor: rect(100, 200, 150, 20),
      popoverSize: {
        width: 200,
        height: 50,
      },
      scopeBounds: rect(0, 0, 300, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: 50,
        y: 0,
      },
    });

    expect(result.openLeft).toBe(false);
    expect(result.left).toBe(150);
  });

  it('flips left using the anchor right edge measured against the scope left', () => {
    // spaceRight 150 < 200 and spaceLeft 200 is an exact fit, so it flips.
    const result = resolve({
      anchor: rect(100, 200, 100, 20),
      popoverSize: {
        width: 200,
        height: 50,
      },
      scopeBounds: rect(0, 0, 250, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: 50,
        y: 0,
      },
    });

    expect(result.openLeft).toBe(true);
    expect(result.left).toBe(50);
  });

  it('subtracts the scope left from the space on the left side', () => {
    // spaceLeft is 400 - 100 - 50 = 250 < 300, so no flip is possible and the
    // popover is clamped against the right boundary instead.
    const result = resolve({
      anchor: rect(200, 200, 150, 20),
      popoverSize: {
        width: 300,
        height: 50,
      },
      scopeBounds: rect(100, 0, 350, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: 50,
        y: 0,
      },
    });

    expect(result.openLeft).toBe(false);
    expect(result.left).toBe(200);
  });

  it('clamps a negative scope left to the viewport left when measuring the space on the left', () => {
    // boundaryLeft is max(0, -100) = 0 => spaceLeft 60 < 100, so no flip.
    const result = resolve({
      anchor: rect(40, 200, 20, 20),
      popoverSize: {
        width: 100,
        height: 50,
      },
      scopeBounds: rect(-100, 0, 220, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
    });

    expect(result.openLeft).toBe(false);
    expect(result.left).toBe(20);
  });

  it('right-aligns the flipped popover on the anchor right edge', () => {
    const result = resolve({
      anchor: rect(200, 200, 20, 20),
      popoverSize: {
        width: 200,
        height: 50,
      },
      scopeBounds: rect(0, 0, 300, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: 40,
        y: 0,
      },
    });

    expect(result.openLeft).toBe(true);
    expect(result.left).toBe(60);
  });

  it('does not clamp when the popover right edge exactly meets the boundary', () => {
    // rawLeft 50 + width 250 == boundaryRight 300: an exact touch is not an
    // overflow, and clamping here would jump the popover to the scope left.
    const result = resolve({
      anchor: rect(50, 200, 10, 20),
      popoverSize: {
        width: 250,
        height: 50,
      },
      scopeBounds: rect(100, 0, 200, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
    });

    expect(result.left).toBe(50);
  });

  it('prefers the scope left when the popover is wider than the whole scope', () => {
    const result = resolve({
      anchor: rect(200, 200, 20, 20),
      popoverSize: {
        width: 400,
        height: 50,
      },
      scopeBounds: rect(100, 0, 200, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: 60,
        y: 0,
      },
    });

    expect(result.left).toBe(160);
  });

  it('uses the viewport width as the right boundary when the scope is wider', () => {
    const result = resolve({
      anchor: rect(100, 200, 20, 20),
      popoverSize: {
        width: 350,
        height: 50,
      },
      scopeBounds: rect(0, 0, 1000, 800),
      viewportSize: {
        width: 400,
        height: 800,
      },
    });

    expect(result.openLeft).toBe(false);
    expect(result.left).toBe(50);
  });
});

describe('resolvePosition — aside placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const asideBase: Overrides = {
    anchor: rect(400, 300, 24, 24),
    popoverSize: {
      width: 200,
      height: 100,
    },
    scopeBounds: rect(100, 0, 700, 800),
    viewportSize: {
      width: 1000,
      height: 800,
    },
    placeLeftOfAnchor: true,
  };

  it('places the popover left of the anchor and vertically centered on it', () => {
    const result = resolve(asideBase);

    expect(result).toEqual({
      top: 262,
      left: 192,
      openTop: false,
      openLeft: true,
    });
  });

  it('accepts an aside placement whose width exactly equals the available space', () => {
    // asideSpace is anchor.left - offset - boundaryLeft = 292.
    const result = resolve({
      ...asideBase,
      popoverSize: {
        width: 292,
        height: 100,
      },
    });

    expect(result.openLeft).toBe(true);
    expect(result.left).toBe(100);
  });

  it('falls back to below placement when the popover is one pixel too wide for the aside space', () => {
    const result = resolve({
      ...asideBase,
      popoverSize: {
        width: 293,
        height: 100,
      },
    });

    expect(result.top).toBe(332);
    expect(result.left).toBe(400);
    expect(result.openLeft).toBe(false);
  });

  it('measures the aside space from the scope left and shrinks it by the offset', () => {
    // 300 > 292, so this must NOT be an aside placement.
    const result = resolve({
      ...asideBase,
      popoverSize: {
        width: 300,
        height: 100,
      },
    });

    expect(result.top).toBe(332);
    expect(result.openLeft).toBe(false);
  });

  it('shifts the popover down to the scope top when centering would overflow it', () => {
    const result = resolve({
      ...asideBase,
      anchor: rect(400, 100, 24, 24),
      popoverSize: {
        width: 200,
        height: 300,
      },
      scopeBounds: rect(100, 80, 700, 720),
    });

    expect(result.top).toBe(80);
  });

  it('shifts the popover up to the scope bottom when centering would overflow it', () => {
    // bottomCeiling is the scope bottom in document coords (500 + 100), so the
    // popover of height 200 may not start below 400.
    const result = resolve({
      ...asideBase,
      anchor: rect(400, 540, 24, 20),
      popoverSize: {
        width: 200,
        height: 200,
      },
      scopeBounds: rect(100, 0, 700, 500),
      scrollOffset: {
        x: 0,
        y: 100,
      },
    });

    expect(result.top).toBe(400);
  });

  it('keeps the viewport margin away from the top edge', () => {
    const result = resolve({
      ...asideBase,
      anchor: rect(400, 0, 24, 24),
      viewportMargin: 12,
    });

    expect(result.top).toBe(12);
  });

  it('keeps the viewport margin away from the bottom edge', () => {
    const result = resolve({
      ...asideBase,
      anchor: rect(400, 780, 24, 20),
      viewportMargin: 12,
    });

    expect(result.top).toBe(688);
  });

  it('pins the popover to the top floor when it is taller than the available window', () => {
    const result = resolve({
      ...asideBase,
      anchor: rect(400, 300, 24, 24),
      popoverSize: {
        width: 200,
        height: 900,
      },
      viewportMargin: 10,
      scrollOffset: {
        x: 0,
        y: 50,
      },
    });

    expect(result.top).toBe(60);
  });

  it('mirrors to the right of the anchor when asideSide is right', () => {
    const result = resolve({
      ...asideBase,
      asideSide: 'right',
      scrollOffset: {
        x: 50,
        y: 0,
      },
    });

    expect(result.openLeft).toBe(false);
    expect(result.left).toBe(482);
    expect(result.openTop).toBe(false);
  });

  it('measures the right aside space from the anchor right edge minus the offset', () => {
    // boundaryRight 800 - anchor.right 424 - offset 8 = 368, so 376 does not fit.
    const result = resolve({
      ...asideBase,
      asideSide: 'right',
      popoverSize: {
        width: 376,
        height: 100,
      },
    });

    expect(result.openLeft).toBe(false);
    expect(result.top).toBe(332);
    expect(result.left).toBe(400);
  });

  it('never pushes the right-side popover past the right boundary', () => {
    const result = resolve({
      ...asideBase,
      asideSide: 'right',
      popoverSize: {
        width: 100,
        height: 100,
      },
      scrollOffset: {
        x: 300,
        y: 0,
      },
    });

    expect(result.left).toBe(732);
  });

  it('ignores the aside request entirely when placeLeftOfAnchor is false', () => {
    const result = resolve({
      ...asideBase,
      placeLeftOfAnchor: false,
    });

    expect(result.left).toBe(400);
    expect(result.top).toBe(332);
  });
});

describe('resolvePosition — negative horizontal scroll (RTL documents)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the flipped popover on the anchor right edge instead of jumping to a mirrored scope left', () => {
    // scrollX is negative in an RTL document. The left clamp is
    // boundaryLeft + scrollX; using boundaryLeft - scrollX would flip the sign
    // of the clamp and win the Math.max, tearing the popover off its anchor.
    const result = resolve({
      anchor: rect(300, 200, 100, 20),
      popoverSize: {
        width: 400,
        height: 50,
      },
      scopeBounds: rect(0, 0, 600, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: -50,
        y: 0,
      },
    });

    expect(result.left).toBe(-50);
    expect(result.openLeft).toBe(true);
  });

  it('keeps the aside popover beside its anchor when the document is scrolled left', () => {
    const result = resolve({
      anchor: rect(400, 300, 24, 24),
      popoverSize: {
        width: 300,
        height: 100,
      },
      scopeBounds: rect(0, 0, 1000, 800),
      viewportSize: {
        width: 1000,
        height: 800,
      },
      scrollOffset: {
        x: -100,
        y: 0,
      },
      placeLeftOfAnchor: true,
    });

    expect(result.left).toBe(-8);
    expect(result.openLeft).toBe(true);
  });
});
