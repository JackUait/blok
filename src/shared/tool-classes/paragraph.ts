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
  /**
   * Host font-size hook (`config.style.fontSize.paragraph`). The `inherit`
   * fallback is what a paragraph did before the token existed, so an
   * unconfigured editor is unchanged — and it keeps paragraphs nested in a
   * callout/toggle/quote following THAT block's size rather than pinning them
   * to the editor's. The tool's own `styles.size` config still wins: it lands
   * as an inline style.
   */
  'text-[length:var(--blok-paragraph-font-size,inherit)]',
  'leading-[1.5]',
  'mt-px',
  'mb-px',
  '[&>p:first-of-type]:mt-0',
  '[&>p:last-of-type]:mb-0',
];
