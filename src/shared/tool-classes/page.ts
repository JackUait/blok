/**
 * Page block's static presentational classes — the single source for both
 * `src/tools/page/constants.ts` and the view emitter. Hover, focus ring and
 * cursor stay in the tool's constants: a static view has no interaction.
 */

/** On the block root. */
export const PAGE_WRAPPER_CLASSES: readonly string[] = ['my-px'];

/**
 * The card row. The `!` matters: the card is an `<a>` inside the block holder,
 * whose `[&_a]:underline` (a class plus a type selector) outranks a plain
 * utility on the anchor. A child cannot cancel an ancestor's underline, so it
 * has to be removed here.
 */
export const PAGE_LINK_CLASSES: readonly string[] = [
  'flex',
  'w-full',
  'min-w-0',
  'items-center',
  'gap-1.5',
  'min-h-7',
  'px-0.5',
  'no-underline!',
];

/**
 * Neutral ink for a live page. Important for the same reason as
 * `no-underline!`: the holder's `[&_a]:text-link` would paint it blue.
 */
export const PAGE_LINK_INK_CLASSES: readonly string[] = ['text-text-primary!'];

export const PAGE_ICON_CLASSES: readonly string[] = [
  'flex-none',
  'inline-flex',
  'items-center',
  'justify-center',
  'size-5',
  'text-[1.1em]',
  'leading-none',
  'text-text-secondary',
  '[&>svg]:size-[1.125rem]',
  '[&>img]:size-[1.125rem]',
  '[&>img]:object-cover',
  '[&>img]:rounded-(--blok-radius-mark)',
];

/**
 * The border is the soft underline; the text itself is never underlined. Only the bottom gets a
 * style: `border-solid` styles all four sides, and a host reset such as `* { border: none }`
 * leaves their widths at medium, so the title would draw a box.
 */
export const PAGE_TITLE_CLASSES: readonly string[] = [
  'min-w-0',
  'truncate',
  'font-medium',
  'leading-normal',
  'border-b',
  '[border-bottom-style:solid]',
  '[border-color:var(--blok-border-primary)]',
];

/** An untitled page shows its placeholder title in secondary ink. */
export const PAGE_TITLE_MUTED_CLASSES: readonly string[] = ['text-text-secondary'];

/**
 * The glyph shown when a page has no icon. Must equal `IconPage` in
 * `src/components/icons` (a test pins it). It is copied, not imported: the view
 * may only import pure modules from `src/shared` and `src/view`.
 */
export const PAGE_FALLBACK_ICON = `
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M5 5a2 2 0 0 1 2-2h4l4 4v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11 3v4h4Z" fill="currentColor" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M7.5 10.5h5M7.5 13.5h3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
</svg>
`;

export const PAGE_LOCK_ICON = `
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M7 8V6.5a3 3 0 0 1 6 0V8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="5" y="8" width="10" height="9" rx="2" stroke="currentColor" stroke-width="1.25"/>
  <circle cx="10" cy="12.5" r="0.75" fill="currentColor"/>
</svg>
`;

/**
 * An inline page reference (a mention). The `!` beats the holder's
 * `[&_a]:underline` and `[&_a]:text-link`; the title draws its own underline
 * so the icon stays clear of it.
 */
export const PAGE_REFERENCE_CLASSES: readonly string[] = [
  'no-underline!',
  'font-medium',
  'whitespace-nowrap',
  'cursor-pointer',
];

export const PAGE_REFERENCE_INK_CLASSES: readonly string[] = ['text-text-primary!'];

export const PAGE_REFERENCE_MUTED_CLASSES: readonly string[] = ['text-text-secondary!'];

/** An emoji icon is drawn from `data-blok-emoji`, so it never joins the text. */
export const PAGE_REFERENCE_ICON_CLASSES: readonly string[] = [
  'relative',
  'inline-flex',
  'items-center',
  'justify-center',
  'size-[1.2em]',
  'me-[0.375em]',
  'align-middle',
  'leading-none',
  'text-text-secondary',
  // Only with an emoji: an empty ::before would become the box's baseline.
  '[&[data-blok-emoji]]:before:content-[attr(data-blok-emoji)]',
  'before:text-[1.05em]',
  '[&>svg]:size-full',
  '[&>img]:size-full',
  '[&>img]:object-cover',
  '[&>img]:rounded-(--blok-radius-mark)',
  // The badge corner is cut out of the glyph, not painted over it, so it
  // works on any background (callout, block color, selection, hover).
  '[&>svg:first-child]:[mask:var(--blok-page-reference-cut)]',
  '[&>img]:[mask:var(--blok-page-reference-cut)]',
  'before:[mask:var(--blok-page-reference-cut)]',
  '[--blok-page-reference-cut:linear-gradient(#000_0_0)_exclude,linear-gradient(#000_0_0)_100%_100%/46%_46%_no-repeat]',
];

/** The arrow badge on the icon's corner: it says "link to a page". */
export const PAGE_REFERENCE_ARROW_CLASSES: readonly string[] = [
  'absolute',
  // Physical, like the mask cut and the arrow glyph, which do not mirror in RTL.
  'right-0',
  'bottom-0',
  'inline-flex',
  'size-[0.48em]',
  'text-text-primary',
  '[&>svg]:size-full',
  '[&>svg_path]:[stroke-width:3]',
];

export const PAGE_REFERENCE_TITLE_CLASSES: readonly string[] = [
  'underline',
  'decoration-[color:var(--blok-text-tertiary)]',
  'decoration-1',
  'underline-offset-[0.2em]',
];
