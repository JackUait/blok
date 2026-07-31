/**
 * Callout's static presentational classes for its wrapper — the single source of
 * truth for both `src/tools/callout/dom-builder.ts` and the view emitter.
 *
 * NOTE: these do NOT vary with `data.color`. Callout colours are applied as
 * inline styles / data attributes by the shared block-colour helper, not as
 * classes, so one static list covers every colour.
 *
 * `EMOJI_BUTTON_STYLES` stays in the tool — it styles a real `<button>` that a
 * static view does not render.
 */
export const CALLOUT_WRAPPER_CLASSES: readonly string[] = [
  /**
   * Host font-size hook (`config.style.fontSize.callout`). Set on the wrapper
   * so the callout's child blocks inherit it — they carry `inherit`-fallback
   * size utilities of their own.
   *
   * This is the ONLY place the callout scale may be applied. The child
   * paragraph used to re-declare the same token (see main.css), which squared
   * any relative value: at `calc(1em * 1.5)` the body text rendered 36px
   * against a 24px wrapper, so the emoji sized off the wrapper fell off the
   * text's centre line. The paragraph fallback moved here with it, keeping the
   * documented callout → paragraph → inherit precedence in one declaration.
   */
  'text-[length:var(--blok-callout-font-size,var(--blok-paragraph-font-size,inherit))]',
  'rounded-xl',
  'pl-8',
  'pr-4',
  'pt-[var(--blok-block-padding-top,5px)]',
  'pb-[var(--blok-block-padding-bottom,5px)]',
  'my-1',
  'flex',
  'items-start',
  'gap-2',
  'relative',
];

/** Classes on the container holding a callout's child blocks. */
export const CALLOUT_CHILDREN_CLASSES: readonly string[] = ['flex-1', 'min-w-0'];
