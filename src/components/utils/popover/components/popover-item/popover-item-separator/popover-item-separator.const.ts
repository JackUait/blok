/**
 * Tailwind CSS classes for popover separator component
 */
export const css = {
  container: 'py-1 px-[3px]',
  line: 'h-px w-full bg-popover-border',
};

/**
 * Data attributes for popover separator
 */
export const DATA_ATTR = {
  root: 'data-blok-popover-item-separator',
  line: 'data-blok-popover-item-separator-line',
  hidden: 'data-blok-hidden',
} as const;
