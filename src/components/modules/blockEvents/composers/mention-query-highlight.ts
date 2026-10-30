/**
 * Paints the typed "@query" as a gray pill with the CSS Custom Highlight API.
 * A span in the editable would be content: saved, synced to Yjs and copied.
 */

/** Must match the `::highlight()` rule in slash-search.css. */
const NAME = 'blok-page-mention-query';

/** `CSS.highlights` is document-global; editors are not. Each owner keeps its own range. */
const paints = new Map<unknown, Range>();

const supported = (): boolean =>
  typeof CSS !== 'undefined' && CSS.highlights !== undefined && typeof Highlight === 'function';

const repaint = (): void => {
  if (!supported()) {
    return;
  }
  if (paints.size === 0) {
    CSS.highlights.delete(NAME);

    return;
  }
  CSS.highlights.set(NAME, new Highlight(...paints.values()));
};

/**
 * Paints one editor's query, or clears it with `null`.
 * @param owner - token identifying the editor
 * @param range - the "@query" text
 */
export const paintMentionQuery = (owner: unknown, range: Range | null): void => {
  if (range === null) {
    if (paints.delete(owner)) {
      repaint();
    }

    return;
  }
  paints.set(owner, range);
  repaint();
};
