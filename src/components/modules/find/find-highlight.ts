/**
 * Paints find matches with the CSS Custom Highlight API, so the editor's DOM is
 * never touched: wrapping matches in spans would be a content mutation, synced
 * to Yjs and recorded as an undo step.
 */

/** Registry keys; must match the `::highlight()` rules in find.css. */
const MATCH = 'blok-find-match';
const ACTIVE = 'blok-find-match-active';

interface Paint {
  matches: Range[];
  active: Range | null;
}

/** `CSS.highlights` is document-global; editors are not. Each owner keeps its own paint. */
const paints = new Map<unknown, Paint>();

export const isFindHighlightSupported = (): boolean =>
  typeof CSS !== 'undefined' && CSS.highlights !== undefined && typeof Highlight === 'function';

const repaint = (): void => {
  if (!isFindHighlightSupported()) {
    return;
  }

  const all = [...paints.values()];
  const active = all.flatMap((paint) => paint.active === null ? [] : [paint.active]);
  const matches = all.flatMap((paint) => paint.matches.filter((range) => range !== paint.active));

  if (matches.length === 0 && active.length === 0) {
    CSS.highlights.delete(MATCH);
    CSS.highlights.delete(ACTIVE);

    return;
  }

  const activeHighlight = new Highlight(...active);

  activeHighlight.priority = 1;
  CSS.highlights.set(MATCH, new Highlight(...matches));
  CSS.highlights.set(ACTIVE, activeHighlight);
};

/**
 * Paint one editor's matches.
 * @param owner - token identifying the editor
 * @param matches - every match
 * @param active - the current match, drawn on top in its own colour
 */
export const paintFindHighlights = (owner: unknown, matches: Range[], active: Range | null): void => {
  paints.set(owner, { matches, active });
  repaint();
};

/**
 * Remove one editor's paint.
 * @param owner - token identifying the editor
 */
export const clearFindHighlights = (owner: unknown): void => {
  if (paints.delete(owner)) {
    repaint();
  }
};
