/**
 * Divider's static presentational classes — the single source of truth for both
 * `src/tools/divider/index.ts` and the view emitter.
 *
 * The classes belong on the WRAPPER, not the `<hr>`: the wrapper carries the
 * vertical spacing and the minimal line-height the toolbar's positioning
 * algorithm needs to centre on the rule. The view emitter therefore emits the
 * wrapper too, so the parity harness pairs like with like.
 */
export const DIVIDER_WRAPPER_CLASSES: readonly string[] = ['py-3', 'leading-[1px]'];

/**
 * Classes on the `<hr>` itself. `--blok-border-primary` is referenced directly
 * because the theme has no `--color-border-primary`, so `border-border-primary`
 * emitted nothing and the rule silently fell back to `currentColor`.
 */
export const DIVIDER_RULE_CLASSES: readonly string[] = [
  'border-t',
  'border-(--blok-border-primary)',
  'border-b-0',
  'border-l-0',
  'border-r-0',
];
