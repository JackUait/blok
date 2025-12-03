import { useState, useCallback, useLayoutEffect, type RefObject } from 'react';

/**
 * Position state returned by usePopoverPosition hook
 * @internal
 */
export interface PopoverPosition {
  /**
   * Top position in pixels (includes scroll offset)
   */
  top: number;

  /**
   * Left position in pixels (includes scroll offset)
   */
  left: number;

  /**
   * Whether popover should open upward
   */
  openTop: boolean;

  /**
   * Whether popover should open to the left
   */
  openLeft: boolean;
}

/**
 * Options for usePopoverPosition hook
 * @internal
 */
export interface UsePopoverPositionOptions {
  /**
   * Ref to the trigger element that popover is positioned relative to
   */
  triggerRef?: RefObject<HTMLElement | null>;

  /**
   * Ref to the scope element that bounds the popover position
   */
  scopeElementRef?: RefObject<HTMLElement | null>;

  /**
   * Ref to the popover element (for size calculations)
   */
  popoverRef?: RefObject<HTMLElement | null>;

  /**
   * Ref to the popover container element (for size calculations)
   */
  containerRef?: RefObject<HTMLElement | null>;

  /**
   * Static popover size (if known, avoids DOM measurement)
   */
  popoverSize?: { width: number; height: number };

  /**
   * Offset from trigger element in pixels
   * @default 8
   */
  offset?: number;

  /**
   * Whether to calculate position on mount
   * @default true
   */
  calculateOnMount?: boolean;
}

/**
 * Return value from usePopoverPosition hook
 * @internal
 */
export interface UsePopoverPositionReturn {
  /**
   * Current position state
   */
  position: PopoverPosition;

  /**
   * Recalculate position based on current DOM state
   */
  recalculate: () => void;

  /**
   * Calculate if popover should open at bottom
   */
  shouldOpenBottom: () => boolean;

  /**
   * Calculate if popover should open to the right
   */
  shouldOpenRight: () => boolean;

  /**
   * Calculate position for trigger-relative positioning
   */
  calculateTriggerPosition: () => { top: number; left: number };
}

/**
 * Default position state
 */
const DEFAULT_POSITION: PopoverPosition = {
  top: 0,
  left: 0,
  openTop: false,
  openLeft: false,
};

/**
 * Hook for calculating popover position
 *
 * Handles:
 * - Trigger-relative positioning
 * - Viewport boundary detection
 * - Scope element boundary detection
 * - Open direction (top/bottom, left/right)
 *
 * @param options - Hook configuration
 * @returns Position state and calculation functions
 * @internal
 */
export const usePopoverPosition = ({
  triggerRef,
  scopeElementRef,
  popoverRef,
  containerRef,
  popoverSize,
  offset = 8,
  calculateOnMount = true,
}: UsePopoverPositionOptions): UsePopoverPositionReturn => {
  const [position, setPosition] = useState<PopoverPosition>(DEFAULT_POSITION);

  /**
   * Get the popover size (from prop or by measuring DOM)
   */
  const getPopoverSize = useCallback((): { width: number; height: number } => {
    if (popoverSize) {
      return popoverSize;
    }

    // Try to get from container ref
    if (containerRef?.current) {
      return {
        width: containerRef.current.offsetWidth,
        height: containerRef.current.offsetHeight,
      };
    }

    // Try to get from popover ref
    const container = popoverRef?.current?.querySelector('[data-blok-popover-container]') as HTMLElement | null;

    if (container) {
      return {
        width: container.offsetWidth,
        height: container.offsetHeight,
      };
    }

    return { width: 0, height: 0 };
  }, [popoverSize, containerRef, popoverRef]);

  /**
   * Get the scope element (defaults to document.body)
   */
  const getScopeElement = useCallback((): HTMLElement => {
    return scopeElementRef?.current ?? document.body;
  }, [scopeElementRef]);

  /**
   * Check if popover should open at bottom
   * Returns true if there's enough space below OR not enough space above
   */
  const shouldOpenBottom = useCallback((): boolean => {
    if (!containerRef?.current) {
      return true;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const scopeRect = getScopeElement().getBoundingClientRect();
    const size = getPopoverSize();

    const potentialBottomEdge = containerRect.top + size.height;
    const potentialTopEdge = containerRect.top - size.height;
    const bottomEdgeForComparison = Math.min(window.innerHeight, scopeRect.bottom);

    return potentialTopEdge < scopeRect.top || potentialBottomEdge <= bottomEdgeForComparison;
  }, [containerRef, getScopeElement, getPopoverSize]);

  /**
   * Check if popover should open to the right
   * Returns true if there's enough space on the right OR not enough space on the left
   */
  const shouldOpenRight = useCallback((): boolean => {
    if (!popoverRef?.current) {
      return true;
    }

    const popoverRect = popoverRef.current.getBoundingClientRect();
    const scopeRect = getScopeElement().getBoundingClientRect();
    const size = getPopoverSize();

    const potentialRightEdge = popoverRect.right + size.width;
    const potentialLeftEdge = popoverRect.left - size.width;
    const rightEdgeForComparison = Math.min(window.innerWidth, scopeRect.right);

    return potentialLeftEdge < scopeRect.left || potentialRightEdge <= rightEdgeForComparison;
  }, [popoverRef, getScopeElement, getPopoverSize]);

  /**
   * Calculate position relative to trigger element
   */
  const calculateTriggerPosition = useCallback((): { top: number; left: number } => {
    if (!triggerRef?.current) {
      return { top: 0, left: 0 };
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const size = getPopoverSize();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // Calculate initial top (below trigger)
    const initialTop = triggerRect.bottom + offset + window.scrollY;

    // Check if we should flip to top
    const shouldFlipTop = (triggerRect.bottom + offset + size.height > windowHeight + window.scrollY) &&
      (triggerRect.top - offset - size.height > window.scrollY);

    const top = shouldFlipTop
      ? triggerRect.top - offset - size.height + window.scrollY
      : initialTop;

    // Calculate initial left
    const initialLeft = triggerRect.left + window.scrollX;

    // Check if we should flip to left
    const shouldFlipLeft = initialLeft + size.width > windowWidth + window.scrollX;

    const left = shouldFlipLeft
      ? Math.max(0, triggerRect.right - size.width + window.scrollX)
      : initialLeft;

    return { top, left };
  }, [triggerRef, getPopoverSize, offset]);

  /**
   * Recalculate all position state
   */
  const recalculate = useCallback(() => {
    const openBottom = shouldOpenBottom();
    const openRight = shouldOpenRight();
    const triggerPos = calculateTriggerPosition();

    setPosition({
      top: triggerPos.top,
      left: triggerPos.left,
      openTop: !openBottom,
      openLeft: !openRight,
    });
  }, [shouldOpenBottom, shouldOpenRight, calculateTriggerPosition]);

  /**
   * Calculate position on mount if enabled
   */
  useLayoutEffect(() => {
    if (calculateOnMount) {
      recalculate();
    }
  }, [calculateOnMount, recalculate]);

  return {
    position,
    recalculate,
    shouldOpenBottom,
    shouldOpenRight,
    calculateTriggerPosition,
  };
};
