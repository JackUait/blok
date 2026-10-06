/**
 * Rich-text fields per built-in block type, for INPUT conversion where no tool
 * classes exist (src/view). Holds the current fields plus legacy ones, like the
 * view's legacy tables. The editor reads each tool's `static richTextFields`.
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

/**
 * Current data model only, for @bloklabs/core/migrate. Legacy-only fields
 * (quote.caption, warning.title, …) must stay strings, or the legacy grammar
 * in migrate() drops them. Must equal the built-in tools' `richTextFields`.
 */
export const CURRENT_RICH_TEXT_FIELDS: Record<string, string[]> = {
  paragraph: ['text'],
  header: ['text'],
  quote: ['text'],
  toggle: ['text'],
  list: ['text'],
};

/** Unknown types have none: a custom tool's fields are not ours to rewrite. */
export const richTextFieldsFor = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(RICH_TEXT_FIELDS, type) ? RICH_TEXT_FIELDS[type] : [];
