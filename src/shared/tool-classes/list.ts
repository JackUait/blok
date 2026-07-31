/**
 * List/checklist static presentational classes — the single source of truth for
 * both `src/tools/list/*` and the view emitter.
 *
 * Two mechanism differences between the editor and the view are DELIBERATE and
 * cannot be closed by sharing classes:
 *
 * 1. STRUCTURE. The editor renders a FLAT sequence of item blocks, each its own
 *    block with `data-list-style`; the view emits nested `<ul>`/`<ol>` runs.
 *    Nested lists are better HTML (screen readers announce depth), so the view
 *    keeps them.
 * 2. INDENTATION. Following from that, the editor indents with an inline
 *    `margin-left: depth * INDENT_PER_LEVEL`, while the view relies on the
 *    nested list's own padding. {@link LIST_INDENT_PER_LEVEL} is exported so the
 *    generated stylesheet can set that padding to the SAME value instead of
 *    inheriting a browser default.
 *
 * Neither depth nor item size varies the CLASSES: depth is inline margin
 * (editor) or nesting (view), and the list padding comes from
 * `[data-list-style]` rules redeclaring `--_blok-list-pad` in main.css.
 */

/** Pixels of indentation per nesting level for bulleted lists. */
export const LIST_INDENT_PER_LEVEL = 27;

/** Pixels of indentation per nesting level for ordered lists (narrower marker). */
export const ORDERED_LIST_INDENT_PER_LEVEL = 26;

/**
 * The list item block root. `outline-hidden` is excluded (focus-ring
 * suppression on a contenteditable host).
 */
export const LIST_ITEM_CLASSES: readonly string[] = [
  /**
   * Host font-size hook (`config.style.fontSize.list.item`). Checklists take
   * their own token on top of this one — see `src/styles/checklist.css`. The
   * tool's `itemSize` config still wins: it lands as an inline style.
   */
  'text-[length:var(--blok-list-font-size,inherit)]',
  'pt-[var(--blok-block-padding-top,7px)]',
  'pb-[var(--blok-block-padding-bottom,7px)]',
  'mt-[2px]',
  'mb-px',
  'ps-[var(--_blok-list-pad,0px)]',
];

/**
 * The row inside a bulleted/ordered item: marker beside the content.
 *
 * `flex` is included here even though the tool merges it in separately at the
 * call site — the view has one place to stamp, and twMerge is order-stable.
 */
export const LIST_ITEM_ROW_CLASSES: readonly string[] = [
  'flex',
  'items-start',
  'pl-0.5',
  'leading-[1.5]',
  'gap-[var(--blok-list-gap,0px)]',
];

/**
 * The row inside a CHECKLIST item. Deliberately without `leading-[1.5]`: the
 * checkbox sets the row height, and adding it here would shift the editor's
 * existing checklist metrics.
 */
export const LIST_CHECKLIST_ROW_CLASSES: readonly string[] = [
  'flex',
  'items-start',
  'pl-0.5',
  'gap-[var(--blok-list-gap,0px)]',
];

/** The item's content cell. `outline-hidden` stays at the tool's call site. */
export const LIST_CONTENT_CLASSES: readonly string[] = ['flex-1', 'min-w-0'];

/**
 * A CHECKLIST item's content cell. Deliberately different from
 * {@link LIST_CONTENT_CLASSES}: no `min-w-0`, and a literal `leading-[1.5]`
 * rather than `leading-normal` (which would resolve to a theme token a host can
 * redefine).
 */
export const LIST_CHECKLIST_CONTENT_CLASSES: readonly string[] = ['flex-1', 'leading-[1.5]'];

/**
 * Applied to a CHECKED checklist item's content. The view omitted these, so
 * completed items rendered as plain text instead of struck-through and faded.
 */
export const LIST_CHECKED_CLASSES: readonly string[] = ['line-through', 'opacity-60'];

/**
 * A checklist item's checkbox.
 *
 * The top margin CENTRES the fixed 20px (`h-5` = 1.25rem) box on the first line
 * box of the item's text, whose height is `1.5em` ({@link
 * LIST_CHECKLIST_CONTENT_CLASSES}). It must stay a formula: a hardcoded offset
 * only centres at one font size, and the row's font size is host-settable —
 * the list tool's `itemSize` config writes it inline on this very row, and any
 * ambient font-size the editor inherits changes it too. At 16px the formula
 * still resolves to the historical 2px.
 */
export const LIST_CHECKBOX_CLASSES: readonly string[] = [
  'mt-[calc((1.5em_-_1.25rem)/2)]',
  'w-5',
  'mr-2',
  'h-5',
  'cursor-pointer',
  'accent-current',
];
