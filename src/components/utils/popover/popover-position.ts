/**
 * Input for popover position resolution.
 * All rects/sizes are in viewport coordinates unless noted.
 */
export interface PositionInput {
  /** Bounding rect of the anchor element (trigger or popover container) */
  anchor: DOMRect;
  /** Measured popover dimensions */
  popoverSize: { width: number; height: number };
  /** Bounding rect of the scope element that constrains the popover */
  scopeBounds: DOMRect;
  /** Viewport dimensions */
  viewportSize: { width: number; height: number };
  /** Current scroll offset */
  scrollOffset: { x: number; y: number };
  /** Gap between anchor and popover edge (default 8) */
  offset?: number;
  /** Element rect whose left edge overrides anchor's left for horizontal alignment */
  leftAlignRect?: DOMRect;
}

export interface ResolvedPosition {
  /** Final top coordinate in document (scroll-adjusted) coordinates */
  top: number;
  /** Final left coordinate in document (scroll-adjusted) coordinates */
  left: number;
  /** True if popover opens above the anchor */
  openTop: boolean;
  /** True if popover opens to the left of the anchor */
  openLeft: boolean;
}

/**
 * Determines whether the popover should flip to the alternate side.
 * Returns true only when the popover fits on the alternate side but not the preferred side.
 * When neither side fits, stays on the preferred side so the popover remains adjacent
 * to the anchor instead of getting clamped to a distant boundary edge.
 */
function shouldFlip(popoverDimension: number, spaceOnPreferred: number, spaceOnAlternate: number): boolean {
  if (popoverDimension <= spaceOnPreferred) {
    return false;
  }

  if (popoverDimension <= spaceOnAlternate) {
    return true;
  }

  return false;
}

/**
 * Pure function that resolves popover position.
 * Picks the direction with more available space when the popover doesn't fit on the preferred side.
 * Clamps to scope/viewport boundaries on both edges.
 */
export function resolvePosition(input: PositionInput): ResolvedPosition {
  const {
    anchor,
    popoverSize,
    scopeBounds,
    viewportSize,
    scrollOffset,
    offset = 8,
    leftAlignRect,
  } = input;

  // --- Vertical ---
  const boundaryBottom = Math.min(viewportSize.height, scopeBounds.bottom);
  const boundaryTop = Math.max(0, scopeBounds.top);

  const spaceBelow = boundaryBottom - anchor.bottom - offset;
  const spaceAbove = anchor.top - offset - boundaryTop;

  const openTop = shouldFlip(popoverSize.height, spaceBelow, spaceAbove);

  const rawTop = openTop
    ? anchor.top - offset - popoverSize.height + scrollOffset.y
    : anchor.bottom + offset + scrollOffset.y;

  // Clamp: ensure popover doesn't overflow above top boundary.
  // Use the scope's top in document coords (scopeBounds.top + scrollOffset.y) rather
  // than the viewport-clamped boundaryTop, so the clamp is correct when the page is
  // scrolled (boundaryTop is viewport-relative; adding scrollOffset converts it to
  // document coords but discards any negative scope top that was clamped to 0).
  const scopeTopInDocCoords = scopeBounds.top + scrollOffset.y;
  const top = rawTop < scopeTopInDocCoords
    ? scopeTopInDocCoords
    : rawTop;

  // --- Horizontal ---
  const boundaryRight = Math.min(viewportSize.width, scopeBounds.right);
  const boundaryLeft = Math.max(0, scopeBounds.left);

  const alignLeft = (leftAlignRect?.left ?? anchor.left) + scrollOffset.x;
  const alignRight = anchor.right + scrollOffset.x;

  const spaceRight = boundaryRight + scrollOffset.x - alignLeft;
  const spaceLeft = alignRight - boundaryLeft - scrollOffset.x;

  const openLeft = shouldFlip(popoverSize.width, spaceRight, spaceLeft);

  const rawLeft = openLeft
    ? Math.max(boundaryLeft + scrollOffset.x, anchor.right - popoverSize.width + scrollOffset.x)
    : alignLeft;

  // Clamp: ensure popover doesn't overflow right boundary
  const left = rawLeft + popoverSize.width > boundaryRight + scrollOffset.x
    ? Math.max(boundaryLeft + scrollOffset.x, boundaryRight + scrollOffset.x - popoverSize.width)
    : rawLeft;

  return { top, left, openTop, openLeft };
}
