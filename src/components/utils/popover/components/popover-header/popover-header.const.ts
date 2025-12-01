/**
 * Tailwind CSS classes for popover header component
 */
export const css = {
  root: 'flex items-center mb-2 mt-1',
  text: 'text-lg font-semibold',
  backButton: 'border-0 bg-transparent w-9 h-9 text-black cursor-pointer [&_svg]:block [&_svg]:w-7 [&_svg]:h-7',
};

/**
 * Data attributes for popover header
 */
export const DATA_ATTR = {
  root: 'data-blok-popover-header',
  text: 'data-blok-popover-header-text',
  backButton: 'data-blok-popover-header-back-button',
} as const;
