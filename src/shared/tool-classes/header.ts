/**
 * Header's static presentational classes — the single source of truth for both
 * the tool's `render()` (`src/tools/header/index.ts`) and the view emitter.
 *
 * `outline-hidden` is deliberately EXCLUDED (focus-ring suppression on a
 * contenteditable host) along with `getPlaceholderClasses('always')`; both stay
 * at the tool's call site.
 */

/**
 * Classes shared by every heading level. Padding routes through the public
 * `--blok-block-padding-*` custom properties, so a host retuning those retunes
 * the editor and the view together.
 */
export const HEADER_BASE_CLASSES: readonly string[] = [
  'pt-[var(--blok-block-padding-top,7px)]',
  'pb-[var(--blok-block-padding-bottom,7px)]',
  'px-[var(--blok-block-padding-inline,2px)]',
  'm-0',
  '[&_p]:p-0!',
  '[&_p]:m-0!',
  '[&_div]:p-0!',
  '[&_div]:m-0!',
];

/**
 * Per-level typography, keyed by heading level.
 *
 * This is the ONLY definition — `Header.DEFAULT_LEVELS` builds its `styles`
 * string from here, so the editor's level config and the view emitter cannot
 * disagree about what an H3 looks like.
 */
export const HEADER_LEVEL_CLASSES: Readonly<Record<number, readonly string[]>> = {
  1: ['text-3xl', 'font-semibold', 'mt-8', 'mb-px'],
  2: ['text-2xl', 'font-semibold', 'mt-[26px]', 'mb-px'],
  3: ['text-xl', 'font-semibold', 'mt-5', 'mb-px'],
  4: ['text-lg', 'font-semibold', 'mt-3', 'mb-px'],
  5: ['text-base', 'font-semibold', 'mt-3', 'mb-px'],
  6: ['text-sm', 'font-semibold', 'mt-3', 'mb-px'],
};

/**
 * Left indent reserving room for a toggleable header's disclosure arrow. This
 * is STATIC, not an edit affordance: read-only renders still show the arrow.
 */
export const HEADER_TOGGLEABLE_INDENT_CLASS = 'pl-8';

/**
 * Resolve a heading's classes.
 * @param level - heading level; anything outside 1-6 falls back to level 1
 * @param isToggleable - whether the heading renders a disclosure arrow
 */
export const headerClasses = (level: number, isToggleable = false): readonly string[] => [
  ...HEADER_BASE_CLASSES,
  ...(HEADER_LEVEL_CLASSES[level] ?? HEADER_LEVEL_CLASSES[1]),
  ...(isToggleable ? [HEADER_TOGGLEABLE_INDENT_CLASS] : []),
];
