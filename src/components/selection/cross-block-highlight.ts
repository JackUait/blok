/**
 * Painting for cross-block text selections.
 *
 * A range spanning two editing hosts is stored correctly by every engine, but
 * only Chromium and Firefox PAINT it; WebKit renders the anchor host's part and
 * nothing else. A single `::highlight()` range behaves the same way. Handing the
 * registry one sub-range PER HOST — each therefore inside a single editing host —
 * is the one form all three engines paint, so the selection is drawn here and the
 * engine's own `::selection` paint is suppressed while it is active (see the
 * `data-blok-cross-selection` rules in main.css). Without that suppression
 * Chromium and Firefox would paint the range twice, at double opacity.
 */

/** Registry key; must match the `::highlight()` rule in main.css. */
const HIGHLIGHT_NAME = 'blok-cross-block-selection';

/**
 * The editor instance whose selection is currently painted. `CSS.highlights` is
 * document-global while editors are not, so an owner token keeps a second editor
 * on the page from clearing a highlight it does not own.
 */
const painted: { owner: unknown } = { owner: null };

/**
 * Whether this engine can paint a custom highlight. When it cannot, the caller
 * must leave the native `::selection` paint alone — suppressing it without a
 * replacement would make the selection invisible.
 */
export const isCrossBlockHighlightSupported = (): boolean => {
  return typeof CSS !== 'undefined' &&
    CSS.highlights !== undefined &&
    typeof Highlight === 'function';
};

/**
 * Paint the given per-host sub-ranges as the cross-block selection.
 * @param owner - token identifying the editor instance doing the painting
 * @param ranges - one range per editing host, each confined to that host
 */
export const paintCrossBlockHighlight = (owner: unknown, ranges: Range[]): void => {
  if (!isCrossBlockHighlightSupported() || ranges.length === 0) {
    return;
  }

  painted.owner = owner;
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
};

/**
 * Remove the cross-block selection paint, but only when `owner` is the editor
 * that painted it.
 * @param owner - token identifying the editor instance asking to clear
 */
export const clearCrossBlockHighlight = (owner: unknown): void => {
  if (!isCrossBlockHighlightSupported() || painted.owner !== owner) {
    return;
  }

  painted.owner = null;
  CSS.highlights.delete(HIGHLIGHT_NAME);
};
