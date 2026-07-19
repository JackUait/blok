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
  /**
   * When true, the popover is placed to the left of the anchor (when it fully
   * fits there) and is vertically centered on the anchor, shifted up or down
   * only as far as needed to stay inside the viewport/scope.
   */
  placeLeftOfAnchor?: boolean;
  /**
   * Minimum distance (in pixels) between the popover and the viewport top/bottom
   * edges. Applied only when placeLeftOfAnchor is true. Keeps the popover
   * within the viewport — shifting it vertically when centered placement would
   * overflow either edge. Has no effect when 0.
   */
  viewportMargin?: number;
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
export function shouldFlip(popoverDimension: number, spaceOnPreferred: number, spaceOnAlternate: number): boolean {
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
    placeLeftOfAnchor = false,
    viewportMargin = 0,
  } = input;

  const boundaryBottom = Math.min(viewportSize.height, scopeBounds.bottom);
  const boundaryTop = Math.max(0, scopeBounds.top);
  const boundaryRight = Math.min(viewportSize.width, scopeBounds.right);
  const boundaryLeft = Math.max(0, scopeBounds.left);
  const scopeTopInDocCoords = scopeBounds.top + scrollOffset.y;

  // Placement mode: left of the anchor, vertically centered on the anchor
  // (the six-dots handle), shifted up/down only as far as needed to stay
  // inside the viewport/scope. Used only when the popover fully fits left of
  // the anchor: a clamped partial fit would slide the menu over its own
  // trigger (the six-dots handle must stay visible), and the anchor's right
  // side is the block content. When it does not fit, fall through to the
  // standard below/above placement — the handle stays clear and the menu
  // covers only content below, matching the context-menu behavior.
  if (placeLeftOfAnchor && popoverSize.width <= anchor.left - offset - boundaryLeft) {
    const anchorCenterInDocCoords = (anchor.top + anchor.bottom) / 2 + scrollOffset.y;
    const scopeBottomInDocCoords = scopeBounds.bottom + scrollOffset.y;
    // The viewport margin is an aesthetic preference and must never detach
    // the menu from its own anchor: when the six-dots handle sits inside the
    // margin zone, clamping to the margin would place the whole menu above
    // (or below) the handle. Relax the floor/ceiling to the anchor's edge in
    // that case, hard-bounded by the viewport itself.
    const anchorTopInDocCoords = anchor.top + scrollOffset.y;
    const anchorBottomInDocCoords = anchor.bottom + scrollOffset.y;
    const viewportTopFloor = Math.max(
      scrollOffset.y,
      Math.min(scrollOffset.y + viewportMargin, anchorTopInDocCoords)
    );
    const viewportBottomCeiling = Math.min(
      scrollOffset.y + viewportSize.height,
      Math.max(scrollOffset.y + viewportSize.height - viewportMargin, anchorBottomInDocCoords)
    );

    const topFloor = Math.max(scopeTopInDocCoords, viewportTopFloor);
    const bottomCeiling = Math.min(scopeBottomInDocCoords, viewportBottomCeiling);
    const maxTop = bottomCeiling - popoverSize.height;
    // Centered on the anchor; when precise centering would overflow the
    // top/bottom boundary, shift vertically just enough to fit. When the
    // popover is taller than the available window, pin it to the top floor.
    const desiredTop = anchorCenterInDocCoords - popoverSize.height / 2;
    const top = maxTop < topFloor
      ? topFloor
      : Math.max(topFloor, Math.min(desiredTop, maxTop));

    // The menu sits left of the anchor, clamped to the boundary when it does
    // not fully fit. Never flip to the anchor's right side: the block content
    // always lies right of the dots button, so a right-side placement would
    // cover the very content the menu belongs to, while clamping merely
    // compresses the gap between menu and anchor.
    const rawLeft = anchor.left - offset - popoverSize.width + scrollOffset.x;
    const left = Math.max(boundaryLeft + scrollOffset.x, rawLeft);

    return { top, left, openTop: false, openLeft: true };
  }

  // --- Vertical ---
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
  const top = rawTop < scopeTopInDocCoords
    ? scopeTopInDocCoords
    : rawTop;

  // --- Horizontal ---
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
