/**
 * Input for resolving the side (left / right of the parent popover) the
 * nested popover should open on.
 */
export interface NestedPopoverPositionInput {
  /** Viewport-relative rect of the parent popover container. */
  parentRect: { left: number; right: number; width: number };
  /** Measured nested popover width (container offsetWidth). */
  nestedWidth: number;
  /** Current viewport width (window.innerWidth). */
  viewportWidth: number;
  /**
   * Preferred side derived from the parent's own positioning.
   * True when the parent already sits "open-left" (right-aligned or
   * placed left of its anchor) — the nested popover prefers to continue
   * extending leftward unless no room remains.
   */
  parentPrefersLeft: boolean;
  /**
   * Horizontal overlap (px) between the parent and a right-side nested
   * popover. The nested popover can overlap the parent's trailing edge by
   * this many pixels, which effectively grants the nested popover extra
   * horizontal room on the right.
   * Defaults to 4 to match the `--nested-popover-overlap` CSS variable.
   */
  overlap?: number;
}

export interface NestedPopoverPositionOutput {
  /** True when the nested popover should open to the left of the parent. */
  openLeft: boolean;
}

/**
 * Picks the side the nested popover should open on.
 *
 * The rules, in order:
 *   1. If the nested popover fits on the preferred side, keep it there.
 *   2. Otherwise, flip to the alternate side if it fits there.
 *   3. If neither side fits, pick the side with more available space so the
 *      popover stays as close to on-screen as possible.
 *
 * The decision is based purely on measured pixel geometry — never on the
 * parent's own positioning flag alone. That flag may mean different things
 * in different placement modes (open-left after right-edge flip vs.
 * placeLeftOfAnchor), and blindly mirroring it onto the nested popover
 * pushed it off-screen when the parent itself hugged the viewport's left
 * edge. See `src/components/utils/popover/popover-desktop.ts`.
 */
export function resolveNestedPopoverSide(input: NestedPopoverPositionInput): NestedPopoverPositionOutput {
  const {
    parentRect,
    nestedWidth,
    viewportWidth,
    parentPrefersLeft,
    overlap = 4,
  } = input;

  const spaceOnLeft = Math.max(0, parentRect.left);
  const spaceOnRight = Math.max(0, viewportWidth - parentRect.right + overlap);

  const fitsLeft = nestedWidth <= spaceOnLeft;
  const fitsRight = nestedWidth <= spaceOnRight;

  if (parentPrefersLeft) {
    if (fitsLeft) {
      return { openLeft: true };
    }

    if (fitsRight) {
      return { openLeft: false };
    }
  } else {
    if (fitsRight) {
      return { openLeft: false };
    }

    if (fitsLeft) {
      return { openLeft: true };
    }
  }

  // Neither side fits — pick the side with more space. Break ties by
  // keeping the default (right) side so the nested popover stays anchored
  // next to the trigger rather than flipping for no visible benefit.
  return { openLeft: spaceOnLeft > spaceOnRight };
}

/**
 * Input for clamping the nested popover's vertical position.
 * All coordinates are in viewport space.
 */
export interface ClampNestedPopoverTopInput {
  /** Desired top (viewport-relative) before any clamping — usually centered on the trigger item. */
  desiredTop: number;
  /** Measured nested popover height. */
  nestedHeight: number;
  /** Current viewport height (window.innerHeight). */
  viewportHeight: number;
  /** Minimum gap from the viewport's top/bottom edges. Defaults to 8. */
  margin?: number;
}

export interface ClampNestedPopoverTopOutput {
  /** Clamped top (viewport-relative). */
  top: number;
}

/**
 * Clamps the nested popover's vertical position so it stays inside the
 * viewport. When the popover is taller than the viewport minus margins,
 * pins it to the top margin so at least its first items remain reachable.
 *
 * Horizontal flipping is handled separately by {@link resolveNestedPopoverSide}.
 */
export function clampNestedPopoverTop(input: ClampNestedPopoverTopInput): ClampNestedPopoverTopOutput {
  const {
    desiredTop,
    nestedHeight,
    viewportHeight,
    margin = 8,
  } = input;

  const topFloor = margin;
  const maxTop = viewportHeight - nestedHeight - margin;

  if (maxTop < topFloor) {
    return { top: topFloor };
  }

  return { top: Math.max(topFloor, Math.min(maxTop, desiredTop)) };
}
