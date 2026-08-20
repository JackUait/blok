/**
 * Painting for cross-block text selections.
 *
 * A range spanning two editing hosts is stored correctly by every engine, but
 * not every engine PAINTS it. WebKit renders the anchor host's part and nothing
 * else. Firefox collapses the range back into one host on every move of a drag —
 * repaired from `selectionchange`, but the collapsed state reaches a rendered
 * frame first. Handing the registry one sub-range PER HOST — each therefore
 * inside a single editing host — is the one form all three engines paint, so for
 * those engines the selection is drawn here and the engine's own `::selection`
 * paint is suppressed while it is up (see the `data-blok-cross-selection` rules
 * in main.css).
 *
 * For THOSE engines only. Chromium paints the spanning range itself, correctly,
 * and taking over from it is not a neutral swap: it draws `::selection` over the
 * whole line box but a custom highlight over the text box alone, so substituting
 * shrinks the band and opens gaps between the lines the moment a drag leaves its
 * first block — a visible jump mid-gesture. `isNativeCrossHostPaintTrusted`
 * decides, from what an engine is caught doing rather than from what it is.
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

/**
 * Whether the engine can be left to paint a range that spans two editing hosts.
 *
 * Both signals are behaviour, never a user-agent string. An engine that REPORTS
 * the selection clamped to a single host paints it that way too — WebKit keeps
 * `getRangeAt(0)` spanning while `anchorNode`/`focusNode` collapse into the
 * anchor host, and paints only that host. An engine caught rewriting the drag's
 * range back into one host cannot be trusted either, whatever it reports now:
 * the rewritten state is painted before the repair lands (Firefox).
 *
 * Direction is deliberately not a signal — a backwards drag reports its anchor
 * in the LATER host and its native paint is just as correct.
 * @param anchorHost - editing host of the selection's reported anchor
 * @param focusHost - editing host of the selection's reported focus
 * @param engineHasClampedRange - whether this engine was caught clamping a
 * spanning range back into one host
 */
export const isNativeCrossHostPaintTrusted = (
  anchorHost: HTMLElement | null,
  focusHost: HTMLElement | null,
  engineHasClampedRange: boolean
): boolean => {
  if (engineHasClampedRange || anchorHost === null || focusHost === null) {
    return false;
  }

  return anchorHost !== focusHost;
};
