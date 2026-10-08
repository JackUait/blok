/**
 * CSS properties allowed on <mark> elements inside table cells.
 */
export const ALLOWED_MARK_STYLE_PROPS = new Set(['color', 'background-color']);

/** Block tags and attributes read by the table-cell parser. */
export const CELL_BLOCK_TAGS_SANITIZE = {
  ul: true,
  ol: true,
  li: { style: true, 'aria-level': true, 'data-list-style': true },
  input: { type: true, checked: true },
  // Each <p>/<div> is a separate paragraph to the parser; stripped, lines glue together.
  p: {},
  div: {},
};
