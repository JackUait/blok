/**
 * Classes on the CORE's per-block scaffolding — the `holder → contentElement`
 * pair every block is wrapped in (see the DOM-nesting note in CLAUDE.md).
 *
 * Single-sourced here because the view renderer must reproduce it to match a
 * read-only editor render. This is NOT per-tool styling, and that distinction
 * caused a real mis-scope: the inline appearance of links, bold and italic
 * inside EVERY text block comes from the wrapper's descendant selectors
 * (`[&_a]:text-link`, `[&_b]:font-bold`, `[&_i]:italic`), not from any tool's
 * classes. A view that emits only tool classes renders unstyled links.
 *
 * `src/components/block/style-manager.ts` derives its own constants from these,
 * so the editor and the view cannot disagree.
 *
 * PURITY: plain string arrays, no imports — safe for the DOM-free view graph.
 */

/**
 * The block holder. Carries the block's outer rhythm and the descendant
 * selectors that style inline content.
 */
export const BLOCK_WRAPPER_CLASSES: readonly string[] = [
  'relative',
  'opacity-100',
  'first:mt-0',
  'last:pb-0',
  'last:mb-0',
  '[&_a]:cursor-pointer',
  '[&_a]:underline',
  '[&_a]:text-link',
  '[&_b]:font-bold',
  '[&_i]:italic',
];

/**
 * The content element inside the holder. Establishes the centred content
 * column that gives the editor its measure.
 */
export const BLOCK_CONTENT_CLASSES: readonly string[] = [
  'relative',
  'mx-auto',
  'transition-colors',
  'duration-150',
  'ease-out',
  'max-w-blok-content',
];
