/**
 * Canonical left-to-right order of the built-in Inline Tools.
 *
 * The Inline Toolbar renders tools in this sequence no matter what order a
 * consumer registered them in or listed them in an `inlineToolbar` array —
 * that array picks WHICH tools appear, never where. Tools missing from this
 * list (any third-party Inline Tool) are appended after all built-ins in
 * registration order.
 *
 * Grouped by what the marks do: block type, emphasis, technical marks,
 * reference, color, and finally the destructive reset.
 *
 * Adding an Inline Tool to `allTools` in `src/full.ts` without placing it here
 * fails `test/unit/components/modules/tools.test.ts`.
 */
export const INLINE_TOOL_ORDER: readonly string[] = [
  'convertTo',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'inlineCode',
  'equation',
  'supSub',
  'link',
  'marker',
  'clearFormat',
];
