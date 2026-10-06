/**
 * Page block classes. The static look comes from `src/shared/tool-classes/page`,
 * which the view emitter stamps too; only edit chrome is added here.
 */
import {
  PAGE_ICON_CLASSES as SHARED_ICON_CLASSES,
  PAGE_LINK_CLASSES as SHARED_LINK_CLASSES,
  PAGE_LINK_INK_CLASSES as SHARED_LINK_INK_CLASSES,
  PAGE_TITLE_CLASSES as SHARED_TITLE_CLASSES,
  PAGE_TITLE_MUTED_CLASSES as SHARED_TITLE_MUTED_CLASSES,
  PAGE_WRAPPER_CLASSES as SHARED_WRAPPER_CLASSES,
} from '../../shared/tool-classes/page';

export const PAGE_WRAPPER_CLASSES = SHARED_WRAPPER_CLASSES.join(' ');

/**
 * The link row. 28px tall, so its corners take the control radius role. The
 * radius stays edit-only: it shows only under the hover fill.
 */
export const PAGE_LINK_CLASSES = [
  ...SHARED_LINK_CLASSES,
  'rounded-(--blok-radius-control) select-none',
  'transition-colors duration-120 ease-out motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
].join(' ');

/**
 * Kept apart from the disabled set, not overridden by twMerge: twMerge does not
 * drop `can-hover:hover:bg-item-hover-bg` for a later `can-hover:hover:bg-transparent`.
 */
export const PAGE_LINK_ENABLED_CLASSES = [...SHARED_LINK_INK_CLASSES, 'cursor-pointer can-hover:hover:bg-item-hover-bg'].join(' ');

/**
 * Missing or unresolved page: muted and not a link. Important for the same
 * reason as the enabled ink: the holder's `[&_a]:text-link` outranks a plain utility.
 */
export const PAGE_LINK_DISABLED_CLASSES = 'text-text-secondary! cursor-default';

export const PAGE_LINK_DENIED_CLASSES = 'text-text-secondary! cursor-pointer can-hover:hover:bg-item-hover-bg';

export const PAGE_ICON_CLASSES = SHARED_ICON_CLASSES.join(' ');

export const PAGE_TITLE_CLASSES = SHARED_TITLE_CLASSES.join(' ');

export const PAGE_TITLE_MUTED_CLASSES = SHARED_TITLE_MUTED_CLASSES.join(' ');

/**
 * Edit-only hover fill for an inline page reference. The anchor stays inline,
 * so the fill hugs the icon and title instead of the whole line.
 */
export const PAGE_REFERENCE_HOVER_CLASSES = [
  // The page block row's insets and corners, in em so they scale with the text.
  'px-[0.25em]',
  'py-[0.25em]',
  'rounded-(--blok-radius-control)',
  'box-decoration-clone',
  'transition-colors duration-120 ease-out motion-reduce:transition-none',
  'can-hover:hover:bg-item-hover-bg',
].join(' ');
