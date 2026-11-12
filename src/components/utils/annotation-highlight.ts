/** Must match the `::highlight()` rule in main.css. */
const OPEN_HIGHLIGHT = 'blok-annotation-open';

/**
 * Paints the phrase whose hint is open, as a CSS highlight. An attribute or a
 * wrapper on the phrase would be a content mutation: a change event and an undo step.
 * @param range - the phrase to light, or null to clear
 */
export const lightAnnotationPhrase = (range: Range | null): void => {
  if (typeof CSS === 'undefined' || CSS.highlights === undefined || typeof Highlight !== 'function') {
    return;
  }

  if (range === null) {
    CSS.highlights.delete(OPEN_HIGHLIGHT);

    return;
  }

  CSS.highlights.set(OPEN_HIGHLIGHT, new Highlight(range));
};
