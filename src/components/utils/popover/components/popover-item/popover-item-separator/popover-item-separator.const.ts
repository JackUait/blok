/**
 * Tailwind CSS classes for popover separator component
 */
export const css = {
  container: 'py-1.5 max-h-5 overflow-hidden',
  containerHidden: 'opacity-0 max-h-0! py-0!',
  line: 'h-px w-full bg-popover-border/60',
};

/**
 * Tailwind CSS classes for inline popover separator
 */
export const cssInline = {
  container: 'px-1 py-0 h-6 max-h-none shrink-0 mobile:hidden',
  line: 'h-full w-px bg-popover-border/60',
  // Nested inline context: back to vertical separator
  nestedContainer: 'py-1 px-[3px]',
  nestedLine: 'w-full h-px',
};
