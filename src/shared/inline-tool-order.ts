/**
 * Canonical left-to-right order of the built-in Inline Tools.
 *
 * The Inline Toolbar renders tools in this sequence no matter what order a
 * consumer registered them in or listed them in an `inlineToolbar` array —
 * that array picks WHICH tools appear, never where. Tools missing from this
 * list (any third-party Inline Tool) are appended after all built-ins in
 * registration order.
 *
 * Laid out as Notion's grid: color and emphasis on the first row, link and
 * technical marks on the second.
 *
 * Adding an Inline Tool to `allTools` in `src/full.ts` without placing it here
 * fails `test/unit/components/modules/tools.test.ts`.
 *
 * Ask AI is not listed: `Tools.sortInlineTools` puts it after every tool, as
 * the card's last row.
 */
export const INLINE_TOOL_ORDER: readonly string[] = [
  'convertTo',
  'marker',
  'bold',
  'italic',
  'underline',
  'clearFormat',
  'link',
  'strikethrough',
  'inlineCode',
  'equation',
  'supSub',
  // Opt-in. Last in the grid, so it takes the free cell beside ⋯.
  'annotation',
];

/**
 * Built-in tools the inline toolbar moves out of its grid into the ⋯ menu.
 * These are popover item names (what a tool's render() calls itself), not
 * tool names: Superscript & subscript renders as 'sup-sub'.
 */
export const INLINE_TOOL_MORE_MENU: readonly string[] = ['equation', 'sup-sub'];
