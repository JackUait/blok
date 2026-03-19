/**
 * CSS class names to be used in popover search input class
 */
export const css = {
  wrapper: 'bg-search-input-bg border border-search-input-border rounded-lg p-1 grid grid-cols-[auto_auto_1fr] grid-rows-[auto] transition-all duration-200 focus-within:border-search-input-focus-border focus-within:shadow-[0_0_0_2px_rgba(35,131,226,0.15)]',
  icon: 'w-toolbox-btn h-toolbox-btn flex items-center justify-center mr-2 [&_svg]:w-icon [&_svg]:h-icon [&_svg]:text-gray-text',
  input: "text-sm outline-hidden font-medium font-inherit border-0 bg-transparent m-0 p-0 leading-[22px] min-w-[calc(100%-(--spacing(6))-10px)] text-text-primary placeholder:text-gray-text/80 placeholder:font-normal",
  clearButton: 'flex items-center justify-center w-toolbox-btn h-toolbox-btn cursor-pointer border-0 bg-transparent rounded p-0 opacity-0 pointer-events-none transition-opacity duration-150 [&_svg]:w-3 [&_svg]:h-3 [&_svg]:text-gray-text can-hover:hover:[&_svg]:text-text-primary',
};
