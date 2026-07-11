import { IMAGE_TABLE_CELL_MIN_WIDTH_PX, TABLE_CELL_ATTR } from './constants';

/**
 * The minimum resize width (in pixels) for an image at its current DOM location.
 *
 * Inside a table cell the image is floored at a fixed pixel width so a narrow
 * column can't shrink it below a legible thumbnail; everywhere else there is no
 * extra floor and the global percent floor (MIN_WIDTH_PERCENT) applies.
 *
 * Resolved lazily at drag start (not at render time): an image block is rendered
 * before it is inserted into its cell, so the figure isn't under the cell in the
 * DOM until it is mounted and the user actually grabs a handle.
 */
export function resizeFloorPx(figure: Element): number | undefined {
  return figure.closest(`[${TABLE_CELL_ATTR}]`) ? IMAGE_TABLE_CELL_MIN_WIDTH_PX : undefined;
}
