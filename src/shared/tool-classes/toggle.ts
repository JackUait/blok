/**
 * Toggle's static presentational classes for its wrapper — the single source of
 * truth for both `src/tools/toggle/dom-builder.ts` and the view emitter.
 *
 * `outline-hidden` is deliberately EXCLUDED (focus-ring suppression on a
 * contenteditable host) and stays at the tool's call site, along with
 * `ARROW_STYLES`, `BODY_PLACEHOLDER_STYLES` and the other chrome constants.
 */
export const TOGGLE_WRAPPER_CLASSES: readonly string[] = [
  'pt-[var(--blok-block-padding-top,7px)]',
  'pb-[var(--blok-block-padding-bottom,7px)]',
  'mt-[2px]',
  'mb-px',
];

/**
 * The row holding the disclosure arrow beside the title. `items-start` (not
 * `items-center`) keeps the arrow on the FIRST line of a title that wraps.
 *
 * In the view this lands on the `<summary>` itself, which plays both roles: it
 * is the row, and the native marker stands in for the editor's arrow button.
 * That is also what makes the content element's `flex-1` meaningful.
 */
export const TOGGLE_HEADER_ROW_CLASSES: readonly string[] = ['flex', 'items-start'];

/**
 * The toggle's own title content. `outline-hidden` is excluded — the editor's
 * content element is contenteditable, a static `<summary>` is not.
 */
export const TOGGLE_CONTENT_CLASSES: readonly string[] = [
  'pl-0.5',
  'leading-[1.5]',
  'flex-1',
  'min-w-0',
];

/** Indent on the container holding a toggle's child blocks. */
export const TOGGLE_CHILDREN_CLASSES: readonly string[] = ['pl-7'];
