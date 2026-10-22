import { splitRangeByEditingHost } from '../../selection/cross-block-range';

/** Registry key; must match the `::highlight()` rule in main.css. */
const TINT = 'blok-assistant-selection';

/** `CSS.highlights` is one per document, so only the editor that painted may clear. */
const painted: { owner: unknown } = { owner: null };

const supported = (): boolean => typeof CSS !== 'undefined' && CSS.highlights !== undefined && typeof Highlight === 'function';

/**
 * Keep the selection visible in gray while focus sits in the Ask AI field,
 * where the browser stops painting it. One range per editing host: WebKit
 * paints only the first host of a range that spans several.
 * @param owner - the editor instance painting
 * @param range - the selection to keep
 */
export const paintSelectionTint = (owner: unknown, range: Range): void => {
  if (!supported() || range.collapsed) {
    return;
  }

  const ranges = splitRangeByEditingHost(range).map((sub) => sub.range);

  if (ranges.length === 0) {
    return;
  }
  painted.owner = owner;
  CSS.highlights.set(TINT, new Highlight(...ranges));
};

/**
 * Remove the tint, if `owner` painted it.
 * @param owner - the editor instance asking
 */
export const clearSelectionTint = (owner: unknown): void => {
  if (!supported() || painted.owner !== owner) {
    return;
  }
  painted.owner = null;
  CSS.highlights.delete(TINT);
};
