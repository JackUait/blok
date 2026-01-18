/**
 * Threshold in pixels to distinguish between a click and a drag.
 * Should be higher than DragManager's dragThreshold (5px) so that
 * clicks with slight mouse movement still open the menu.
 */
export const DRAG_THRESHOLD = 10;

/**
 * Tolerance in pixels for toolbar repositioning.
 * Prevents unnecessary repositioning when the position hasn't changed significantly.
 */
export const POSITION_TOLERANCE = 2;
