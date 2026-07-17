import { resolvePosition } from './popover-position';
import { clampNestedPopoverTop, resolveNestedPopoverSide } from './popover-nested-position';

/**
 * Side of the anchor the content is placed on (Radix Popper `side` contract).
 */
export type AnchoredSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * Alignment of the content along the cross-axis of `side`
 * (Radix Popper `align` contract). For vertical sides this is the horizontal
 * alignment; for horizontal sides it is the vertical alignment.
 */
export type AnchoredAlign = 'start' | 'center' | 'end';

/**
 * Options for {@link positionAnchored}. Mirrors the floating-ui / Radix Popper
 * contract closely enough that this single engine can serve the popover, the
 * tooltip, the alt-popover / cover-picker and the block context menu.
 */
export interface AnchoredPositionOptions {
  /** Preferred side to place the content on. Defaults to `bottom`. */
  side?: AnchoredSide;
  /** Preferred cross-axis alignment. Defaults to `start` (vertical) / `center` (horizontal). */
  align?: AnchoredAlign;
  /** Gap in px between anchor and content edge. Defaults to 8. */
  offset?: number;
  /**
   * Overlap in px used for horizontal sides — the content may overlap the
   * anchor's trailing edge by this many px, granting a little extra room.
   * Defaults to 4 (matches the `--nested-popover-overlap` CSS variable).
   */
  overlap?: number;
  /** Element or rect that constrains placement. Defaults to the viewport. */
  boundary?: Element | DOMRect;
  /**
   * Cross-axis alignment reference for horizontal sides. When placing a submenu
   * to the side of a parent, the vertical center should track a specific child
   * (the trigger item) rather than the whole parent. Defaults to `anchor`.
   */
  alignTo?: Element | DOMRect;
  /**
   * When true (default) writes the resolved `top`/`left` (in document
   * coordinates) as inline styles on `content`. Set false to compute only —
   * useful when the caller positions the element relative to a different
   * containing block. The `data-side`/`data-align` attributes are stamped
   * regardless, since they are independent of the coordinate space.
   */
  apply?: boolean;
}

/**
 * Result of {@link positionAnchored}: the resolved side/align (after flipping)
 * plus the resolved top/left in document (scroll-adjusted) coordinates.
 */
export interface ResolvedAnchoredPosition {
  side: AnchoredSide;
  align: AnchoredAlign;
  top: number;
  left: number;
}

/**
 * Reads a viewport-relative rect from an Element or passes a DOMRect through.
 * @param target - element or rect
 */
function toRect(target: Element | DOMRect): DOMRect {
  return target instanceof Element ? target.getBoundingClientRect() : target;
}

/**
 * Measured content size, preferring layout box (offsetWidth/Height) and
 * falling back to the bounding rect (offset* is 0 under jsdom / for elements
 * outside the flow).
 * @param content - element being positioned
 */
function measureContent(content: HTMLElement): { width: number; height: number } {
  const boxRect = content.getBoundingClientRect();

  return {
    width: content.offsetWidth || boxRect.width,
    height: content.offsetHeight || boxRect.height,
  };
}

/**
 * Resolves the boundary rect used for collision detection.
 *
 * The document roots are aliases for the live viewport, not ordinary element
 * boundaries. Host pages may give body/html a definite viewport-sized box
 * while their descendants overflow and the document scrolls. Their element
 * rects then move above the viewport and would clamp an anchored surface to a
 * stale first-page boundary. Explicit non-root elements keep their own live
 * rect so callers can still constrain content to an editor or dialog region.
 * @param boundary - explicit boundary
 * @param viewportSize - current viewport size
 */
export function resolveBoundaryRect(
  boundary: Element | DOMRect | undefined,
  viewportSize: { width: number; height: number }
): DOMRect {
  if (
    boundary !== undefined
    && boundary !== document.body
    && boundary !== document.documentElement
  ) {
    return toRect(boundary);
  }

  return {
    x: 0, y: 0, top: 0, left: 0,
    right: viewportSize.width,
    bottom: viewportSize.height,
    width: viewportSize.width,
    height: viewportSize.height,
    toJSON: () => ({}),
  };
}

/**
 * Vertical-primary placement (side `top`/`bottom`) — wraps {@link resolvePosition}.
 * @param anchorRect - anchor rect (viewport-relative)
 * @param size - measured content size
 * @param boundaryRect - constraining rect
 * @param offset - gap in px
 */
function positionVertical(
  anchorRect: DOMRect,
  size: { width: number; height: number },
  boundaryRect: DOMRect,
  offset: number
): ResolvedAnchoredPosition {
  const { top, left, openTop, openLeft } = resolvePosition({
    anchor: anchorRect,
    popoverSize: size,
    scopeBounds: boundaryRect,
    viewportSize: { width: window.innerWidth, height: window.innerHeight },
    scrollOffset: { x: window.scrollX, y: window.scrollY },
    offset,
  });

  return {
    side: openTop ? 'top' : 'bottom',
    align: openLeft ? 'end' : 'start',
    top,
    left,
  };
}

/**
 * Cross-axis (vertical) start position for a horizontally-placed content box,
 * given its alignment against the reference rect.
 * @param align - cross-axis alignment
 * @param alignRect - cross-axis alignment reference rect
 * @param height - measured content height
 */
function resolveDesiredTop(align: AnchoredAlign, alignRect: DOMRect, height: number): number {
  if (align === 'start') {
    return alignRect.top;
  }

  if (align === 'end') {
    return alignRect.bottom - height;
  }

  return alignRect.top + alignRect.height / 2 - height / 2;
}

/**
 * Horizontal-primary placement (side `left`/`right`) — wraps the pure
 * {@link resolveNestedPopoverSide} (side flip) and {@link clampNestedPopoverTop}
 * (cross-axis clamp) that also back the submenu geometry.
 * @param anchorRect - anchor rect (viewport-relative) whose side content sits beside
 * @param alignRect - cross-axis alignment reference rect
 * @param size - measured content size
 * @param boundaryRect - constraining rect (viewport-relative)
 * @param preferLeft - true when the preferred side is `left`
 * @param align - cross-axis alignment
 * @param overlap - permitted overlap in px
 */
function positionHorizontal(
  anchorRect: DOMRect,
  alignRect: DOMRect,
  size: { width: number; height: number },
  boundaryRect: DOMRect,
  preferLeft: boolean,
  align: AnchoredAlign,
  overlap: number
): ResolvedAnchoredPosition {
  // Intersect the boundary with the viewport, mirroring the vertical path
  // (`resolvePosition` clamps its scope bounds the same way).
  const boundaryLeft = Math.max(0, boundaryRect.left);
  const boundaryRight = Math.min(window.innerWidth, boundaryRect.right);
  const boundaryTop = Math.max(0, boundaryRect.top);
  const boundaryBottom = Math.min(window.innerHeight, boundaryRect.bottom);

  // The pure side-resolver reasons in a 0..viewportWidth space; shift the
  // anchor into boundary-local coordinates so its space checks respect the
  // boundary edges instead of the window edges.
  const { openLeft } = resolveNestedPopoverSide({
    parentRect: {
      left: anchorRect.left - boundaryLeft,
      right: anchorRect.right - boundaryLeft,
      width: anchorRect.width,
    },
    nestedWidth: size.width,
    viewportWidth: boundaryRight - boundaryLeft,
    parentPrefersLeft: preferLeft,
    overlap,
  });

  const desiredTop = resolveDesiredTop(align, alignRect, size.height);

  // Same shift for the cross-axis clamp: run it in boundary-local space and
  // translate the result back to viewport coordinates.
  const { top: clampedBoundaryTop } = clampNestedPopoverTop({
    desiredTop: desiredTop - boundaryTop,
    nestedHeight: size.height,
    viewportHeight: boundaryBottom - boundaryTop,
  });
  const clampedViewportTop = clampedBoundaryTop + boundaryTop;

  const viewportLeft = openLeft
    ? anchorRect.left - size.width + overlap
    : anchorRect.right - overlap;

  return {
    side: openLeft ? 'left' : 'right',
    align,
    top: clampedViewportTop + window.scrollY,
    left: viewportLeft + window.scrollX,
  };
}

/**
 * One anchored-positioning engine adapting the Radix Popper / floating-ui
 * contract. Computes the resolved side/align (with flipping) and the
 * document-coordinate top/left, wrapping the pre-existing pure math
 * ({@link resolvePosition} for vertical sides, {@link resolveNestedPopoverSide}
 * + {@link clampNestedPopoverTop} for horizontal sides). Stamps the resolved
 * `data-side`/`data-align` on `content` so animation/CSS can key off them, and
 * (unless `apply` is false) writes the resolved coordinates as inline styles.
 * @param content - the element being positioned
 * @param anchor - anchor element or virtual rect
 * @param options - placement options
 */
export function positionAnchored(
  content: HTMLElement,
  anchor: Element | DOMRect,
  options: AnchoredPositionOptions = {}
): ResolvedAnchoredPosition {
  const { side = 'bottom', offset = 8, overlap = 4, boundary, alignTo, apply = true } = options;
  const isHorizontal = side === 'left' || side === 'right';
  const align = options.align ?? (isHorizontal ? 'center' : 'start');

  const anchorRect = toRect(anchor);
  const size = measureContent(content);
  const viewportSize = { width: window.innerWidth, height: window.innerHeight };
  const boundaryRect = resolveBoundaryRect(boundary, viewportSize);

  const resolved = isHorizontal
    ? positionHorizontal(
      anchorRect,
      alignTo !== undefined ? toRect(alignTo) : anchorRect,
      size,
      boundaryRect,
      side === 'left',
      align,
      overlap
    )
    : positionVertical(anchorRect, size, boundaryRect, offset);

  content.setAttribute('data-side', resolved.side);
  content.setAttribute('data-align', resolved.align);

  if (apply) {
    content.style.setProperty('top', `${resolved.top}px`);
    content.style.setProperty('left', `${resolved.left}px`);
  }

  return resolved;
}

/**
 * Positions a viewport-fixed surface through the shared document-coordinate
 * engine, then converts the result back to viewport coordinates exactly once.
 * This adapter prevents fixed callers from omitting or double-counting window
 * scroll offsets while retaining the shared boundary, flip, and clamp rules.
 * @param content - fixed element being positioned
 * @param anchor - anchor element or virtual rect
 * @param options - placement options (fixed placement always applies styles)
 */
export function positionFixedAnchored(
  content: HTMLElement,
  anchor: Element | DOMRect,
  options: Omit<AnchoredPositionOptions, 'apply'> = {}
): ResolvedAnchoredPosition {
  const resolved = positionAnchored(content, anchor, { ...options, apply: false });

  content.style.setProperty('position', 'fixed');
  content.style.setProperty('top', `${resolved.top - window.scrollY}px`);
  content.style.setProperty('left', `${resolved.left - window.scrollX}px`);

  return resolved;
}

/**
 * Keeps an anchored element positioned while it is open by re-running a
 * `reposition` callback whenever the page scrolls or resizes or the content
 * itself changes size. Adapts the floating-ui `autoUpdate` contract.
 *
 * `attach()` wires a capture-phase, passive `scroll` listener (so scrolls in
 * any ancestor scroll container are observed), a `resize` listener, and a
 * `ResizeObserver` on the content. `detach()` tears all three down. The
 * `ResizeObserver` is feature-detected so environments lacking it (jsdom) do
 * not crash.
 */
export interface PositionTracker {
  attach(): void;
  detach(): void;
}

/**
 * Creates a {@link PositionTracker} for `content`.
 * @param content - element whose position must be kept in sync
 * @param reposition - callback that re-computes and applies the position;
 *   receives the originating event for scroll so consumers can fail closed
 *   when a virtual anchor has no live nested-scroll context
 */
export function createPositionTracker(content: Element, reposition: (event?: Event) => void): PositionTracker {
  const state: { attached: boolean; resizeObserver: ResizeObserver | null } = {
    attached: false,
    resizeObserver: null,
  };

  const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };
  const onScroll = (event: Event): void => reposition(event);
  const onResize = (): void => reposition();

  return {
    attach(): void {
      if (state.attached) {
        return;
      }
      state.attached = true;

      window.addEventListener('scroll', onScroll, scrollOptions);
      window.addEventListener('resize', onResize);

      if (typeof ResizeObserver !== 'undefined') {
        state.resizeObserver = new ResizeObserver(() => reposition());
        state.resizeObserver.observe(content);
      }
    },

    detach(): void {
      if (!state.attached) {
        return;
      }
      state.attached = false;

      window.removeEventListener('scroll', onScroll, scrollOptions);
      window.removeEventListener('resize', onResize);

      state.resizeObserver?.disconnect();
      state.resizeObserver = null;
    },
  };
}
