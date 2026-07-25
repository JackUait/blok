/**
 * Paragraph's static presentational classes — the single source of truth for
 * both the tool's `render()` (`src/tools/paragraph/index.ts`) and the view
 * emitter, so a read-only editor render and `blocksToHtml` output cannot drift
 * visually.
 *
 * `blok-block` is included here rather than pulled from `api.styles.block`: the
 * view has no `api`, and the class name is a stable public contract
 * (`src/components/modules/api/styles.ts`).
 *
 * Deliberately EXCLUDED, because they have no static counterpart:
 * - `outline-hidden` — focus-ring suppression on a contenteditable host
 * - `getPlaceholderClasses('focus')` — empty-state placeholder machinery
 *
 * Both stay at the tool's call site.
 */
export const PARAGRAPH_CLASSES: readonly string[] = [
  'blok-block',
  'leading-[1.5]',
  'mt-px',
  'mb-px',
  '[&>p:first-of-type]:mt-0',
  '[&>p:last-of-type]:mb-0',
];
