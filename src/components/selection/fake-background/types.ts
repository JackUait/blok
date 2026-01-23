/**
 * Internal types for fake background functionality.
 */

/**
 * Represents a line rectangle from a span element.
 * Used for grouping rects by visual line.
 */
export interface LineRect {
  top: number;
  bottom: number;
  span: HTMLElement;
}

/**
 * Represents a visual line group after grouping rectangles.
 */
export interface LineGroup {
  top: number;
  bottom: number;
}
