/**
 * CSS class names to be used in popover search input class
 */
export const css = {
  // Focus indicator is the border-color change ONLY — never add a ring/halo
  // box-shadow on top of it (renders as a double border; see the Input Focus
  // Double-Border Law test).
  wrapper: 'relative bg-search-input-bg border border-search-input-border rounded-lg px-2.5 py-1 focus-within:border-search-input-focus-border',
  input: "w-full text-sm outline-hidden font-medium font-[inherit] border-0 bg-transparent m-0 p-0 leading-[22px] text-text-primary placeholder:text-search-input-placeholder placeholder:font-normal",
};
