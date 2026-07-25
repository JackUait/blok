/**
 * Code block's static presentational classes for its outer wrapper — the single
 * source of truth for both `src/tools/code/dom-builder.ts` and the view emitter.
 *
 * `group/code` is deliberately EXCLUDED: it paints nothing itself, existing only
 * to enable `group-hover/code:` rules on the header controls, which a static
 * view never renders. It stays at the tool's call site, as does every
 * `HEADER_*` / `VIEW_MODE_*` / `GUTTER_*` constant (all editor chrome).
 */
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
