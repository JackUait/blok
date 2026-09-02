/**
 * A heading's anchor id — the fragment that in-document links point at.
 *
 * Imported HTML carries it on the heading tag itself (Google Docs writes
 * `<h2 id="h.2y1ok8y7pef0">` and links its table of contents to `#h.2y1ok8y7pef0`).
 * Blok stores it on the header block as `data.anchor` and renders it back as the
 * heading element's `id`, so those links keep resolving after the round trip.
 *
 * DOM-free on purpose: the view renderer reads block data without a document.
 */

/**
 * Validate an anchor coming from block data or from pasted HTML.
 *
 * A fragment cannot contain whitespace and an empty one addresses nothing, so
 * both are rejected rather than written out as a broken id.
 *
 * Cross-heading uniqueness is explicitly OUT of scope, matching `anchorIds`:
 * two headings carrying the same anchor produce the same id, and consumers that
 * need uniqueness must dedup themselves.
 *
 * @param value - the raw anchor from block data or an `id` attribute
 * @returns the trimmed anchor, or undefined when it cannot address anything
 */
export function normalizeHeadingAnchor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed === '' || /\s/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
