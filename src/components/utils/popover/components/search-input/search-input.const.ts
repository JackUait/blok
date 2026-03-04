/**
 * CSS class names to be used in popover search input class
 */
export const css = {
  wrapper: 'bg-search-input-bg border border-search-input-border rounded-lg p-0.5 grid grid-cols-[auto_auto_1fr] grid-rows-[auto] transition-colors duration-150 focus-within:bg-popover-bg focus-within:border-search-input-focus-border',
  icon: 'w-toolbox-btn h-toolbox-btn flex items-center justify-center mr-2 [&_svg]:w-icon [&_svg]:h-icon [&_svg]:text-gray-text',
  input: "text-sm outline-hidden font-medium font-inherit border-0 bg-transparent m-0 p-0 leading-[22px] min-w-[calc(100%-(--spacing(6))-10px)] placeholder:text-gray-text placeholder:font-medium",
};
