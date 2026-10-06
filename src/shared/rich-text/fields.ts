/**
 * Rich-text fields per built-in block type, for code that has no tool classes
 * (src/view, @bloklabs/core/migrate). The editor derives the same list from
 * each tool's sanitize config instead (`BlockToolAdapter.richTextFields`).
 * Keep in sync with the tag-map rules in each tool's `static sanitize`.
 */
export const RICH_TEXT_FIELDS: Record<string, string[]> = {
  paragraph: ['text'],
  header: ['text'],
  quote: ['text', 'caption'],
  toggle: ['text'],
  list: ['text'],
  toggleList: ['title'],
  callout: ['title'],
  warning: ['title', 'message'],
};

/** Unknown types: `text` is checked, and converted only if it already is segments on input. */
export const richTextFieldsFor = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(RICH_TEXT_FIELDS, type) ? RICH_TEXT_FIELDS[type] : ['text'];
