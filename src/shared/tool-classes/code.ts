/**
 * Code block's static presentational classes for its outer wrapper — the single
 * source of truth for both `src/tools/code/dom-builder.ts` and the view emitter.
 *
 * `group/code` is deliberately EXCLUDED: it paints nothing itself, existing only
 * to enable `group-hover/code:` rules on the header controls, which a static
 * view never renders. It stays at the tool's call site, as does every
 * `HEADER_*` / `VIEW_MODE_*` / `GUTTER_*` constant (all editor chrome).
 */
/**
 * The `<pre>` code area. Without these a static render loses the monospace
 * font, the padding and the scroll/wrap behaviour — the most visible parity gap
 * of any block, and invisible to a root-only class comparison.
 */
export const CODE_AREA_CLASSES: readonly string[] = [
  'block',
  'px-4',
  'py-3',
  'font-mono',
  /** Host font-size hook (`config.style.fontSize.code`); 0.875rem is `text-sm`. */
  'text-[length:var(--blok-code-font-size,0.875rem)]',
  'leading-relaxed',
  'whitespace-pre-wrap',
  'overflow-x-auto',
  'min-h-[1.5em]',
];

export const CODE_WRAPPER_CLASSES: readonly string[] = [
  'flex',
  'flex-col',
  'rounded-(--blok-radius-block)',
  'border',
  'border-border-secondary',
  'bg-code-bg',
  'overflow-hidden',
  'my-2',
];

/**
 * The view's caption row above the code, emitted only when the block has a
 * filename. Built from rules view.css already carries, so it costs the
 * budgeted sheet almost nothing. The editor's header is chrome with its own
 * classes (`HEADER_STYLES` in src/tools/code/constants.ts).
 */
export const CODE_HEADER_CLASSES: readonly string[] = [
  'flex',
  'px-4',
  'py-3',
];

/**
 * Added to the code area under a caption row: the hairline sits on the code's
 * top edge (`border-t`, a rule view.css already has) rather than the caption's
 * bottom edge, which would cost the sheet a new rule.
 */
export const CODE_CAPTIONED_AREA_CLASSES: readonly string[] = [
  'border-t',
  'border-border-secondary',
];

export const CODE_FILENAME_CLASSES: readonly string[] = [
  'font-mono',
  'text-sm',
];
