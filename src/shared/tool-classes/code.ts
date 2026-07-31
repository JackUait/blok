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
  'rounded-xl',
  'border',
  'border-border-secondary',
  'bg-bg-secondary',
  'overflow-hidden',
  'my-2',
];
