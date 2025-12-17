/**
 * Tailwind CSS classes for popover separator component
 */
export const css = {
  container: 'py-1 px-[3px]',
  containerHidden: 'hidden',
  line: 'h-px w-full bg-popover-border',
};

/**
 * Tailwind CSS classes for inline popover separator
 */
export const cssInline = {
  // Inline context: horizontal separator
  container: 'px-1 py-0',
  line: 'h-full w-px',
  // Nested inline context: back to vertical separator
  nestedContainer: 'py-1 px-[3px]',
  nestedLine: 'w-full h-px',
};
