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
 * Current data model only: what a new block's rich fields are (also the Yjs
 * creation contract). Must equal the built-in tools' `richTextFields`.
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

/** Types whose LEGACY data nests item text in `data.items[]`. Current list blocks are flat. */
export const LEGACY_ITEM_TYPES: ReadonlySet<string> = new Set(['list', 'checklist']);

/** Types whose LEGACY data nests child blocks in `data.body.blocks[]`. */
export const LEGACY_BODY_TYPES: ReadonlySet<string> = new Set(['callout', 'toggleList']);
