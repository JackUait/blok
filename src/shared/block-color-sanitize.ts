/**
 * Sanitize entries for the block-color data fields. They hold plain preset
 * names, not HTML, so they are passed through untouched. Spread into a tool's
 * static `sanitize` config alongside its `text` field.
 */
export const BLOCK_COLOR_SANITIZE = {
  textColor: false,
  backgroundColor: false,
} as const;
