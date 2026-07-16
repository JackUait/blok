/**
 * CSS class names to be used in popover search input class
 */
export const css = {
  // `relative` lifts the wrapper into the positioned paint layer so the
  // focus-within ring (a 2px box-shadow) is not painted over by the opaque
  // background of the context label that sits flush underneath in the popover.
  wrapper: 'relative bg-search-input-bg border border-search-input-border rounded-lg px-2 py-0.5 grid grid-cols-[auto_1fr] grid-rows-[auto] focus-within:border-search-input-focus-border focus-within:shadow-[0_0_0_2px_rgba(35,131,226,0.15)]',
  icon: 'w-6 h-6 flex items-center justify-center mr-1.5 [&_svg]:w-4 [&_svg]:h-4 [&_svg]:text-gray-text',
  input: "text-sm outline-hidden font-medium font-inherit border-0 bg-transparent m-0 p-0 leading-[20px] min-w-[calc(100%-(--spacing(6))-6px)] text-text-primary placeholder:text-gray-text/80 placeholder:font-normal",
};
