/**
 * Configuration constants for drag operations
 */

export const DRAG_CONFIG = {
  /** Offset from cursor to preview element */
  previewOffsetX: 10,
  previewOffsetY: 0,
  /** Minimum distance to start drag (prevents accidental drags) */
  dragThreshold: 5,
  /** Auto-scroll configuration */
  autoScrollZone: 50,
  autoScrollSpeed: 10,
  /** Throttle delay for drop position announcements (ms) */
  announcementThrottleMs: 300,
  /** Horizontal distance to the left of blocks where drop is still valid */
  leftDropZone: 50,
} as const;

/**
 * Styles for the drag preview element
 */
export const PREVIEW_STYLES = {
  base: 'fixed pointer-events-none z-[10000] opacity-80 transition-none',
  content: 'relative mx-auto max-w-content',
} as const;

/**
 * Checks if the mouse has moved enough to start a drag operation
 * @param startX - Starting X position
 * @param startY - Starting Y position
 * @param currentX - Current X position
 * @param currentY - Current Y position
 * @param threshold - Minimum distance to pass (defaults to DRAG_CONFIG.dragThreshold)
 * @returns true if the drag threshold has been passed
 */
export const hasPassedThreshold = (
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold: number = DRAG_CONFIG.dragThreshold
): boolean => {
  const dx = currentX - startX;
  const dy = currentY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return distance >= threshold;
};
