/**
 * Page block classes. Edit-only chrome (hover, focus ring) lives here too:
 * there is no view emitter for page yet, so nothing else reads them.
 */

export const PAGE_WRAPPER_CLASSES = 'my-px';

/** The link row. 28px tall, so its corners take the control radius role. */
export const PAGE_LINK_CLASSES = [
  'flex w-full min-w-0 items-center gap-1.5 min-h-7 px-0.5',
  'rounded-(--blok-radius-control) no-underline select-none',
  'transition-colors duration-120 ease-out motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
].join(' ');

/**
 * Kept apart from the disabled set, not overridden by twMerge: twMerge does not
 * drop `can-hover:hover:bg-item-hover-bg` for a later `can-hover:hover:bg-transparent`.
 */
export const PAGE_LINK_ENABLED_CLASSES = 'text-text-primary cursor-pointer can-hover:hover:bg-item-hover-bg';

/** Missing or no-access page: muted and not a link. */
export const PAGE_LINK_DISABLED_CLASSES = 'text-text-secondary cursor-default';

export const PAGE_ICON_CLASSES = [
  'flex-none inline-flex items-center justify-center size-5',
  'text-[1.1em] leading-none text-text-secondary',
  '[&>svg]:size-[1.125rem] [&>img]:size-[1.125rem] [&>img]:object-cover [&>img]:rounded-(--blok-radius-mark)',
].join(' ');

export const PAGE_TITLE_CLASSES = 'min-w-0 truncate font-medium leading-normal border-b border-solid [border-color:var(--blok-border-primary)]';

export const PAGE_TITLE_MUTED_CLASSES = 'text-text-secondary';
