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
