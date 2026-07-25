/**
 * Quote's static presentational classes — the single source of truth for both
 * the tool's `render()` (`src/tools/quote/index.ts`) and the view emitter.
 *
 * `outline-hidden` is deliberately EXCLUDED (focus-ring suppression on a
 * contenteditable host), as is `getPlaceholderClasses('focus')`; both stay at
 * the tool's call site.
 */

/**
 * Classes every quote carries.
 *
 * `blok-block` comes FIRST on purpose: the vertical-padding utilities below
 * override the `blok-block` declarations by generated-utility source order at
 * equal specificity (the quote wants its own 0.2em defaults, not the 7px block
 * defaults). That cascade is pinned by
 * `test/unit/styles/host-customization-tokens.test.ts`.
 */
export const QUOTE_BASE_CLASSES: readonly string[] = [
  'blok-block',
  'border-l-[3px]',
  'border-current',
  'pl-[0.9em]',
  'pr-[0.9em]',
  'pt-[var(--blok-block-padding-top,0.2em)]',
  'pb-[var(--blok-block-padding-bottom,0.2em)]',
  'leading-[1.5]',
  'mt-[0.3em]',
  'mb-[0.3em]',
];

/** Type scale bump applied when `data.size === 'large'`. */
export const QUOTE_LARGE_CLASS = 'text-[1.2em]';

/**
 * Resolve a quote's classes.
 * @param size - saved size; anything other than 'large' is treated as default
 */
export const quoteClasses = (size: 'default' | 'large'): readonly string[] =>
  size === 'large' ? [...QUOTE_BASE_CLASSES, QUOTE_LARGE_CLASS] : [...QUOTE_BASE_CLASSES];
