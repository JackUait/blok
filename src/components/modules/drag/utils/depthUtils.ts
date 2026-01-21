/**
 * Shared utility for getting list item depth from a block's DOM
 * @param block - Block to check
 * @returns Depth number (0 for root level) or null if not a list item
 */
export const getListItemDepth = (block: { holder: HTMLElement }): number | null => {
  // For list items, block.holder IS the wrapper with data-list-depth attribute
  // Try direct attribute access first (for list items where holder has the attribute)
  const depthAttr = block.holder.getAttribute('data-list-depth');

  if (depthAttr !== null && depthAttr !== '') {
    const parsed = parseInt(depthAttr, 10);
    return isNaN(parsed) ? null : parsed;
  }

  // Fallback: check if any child element has the attribute (for other block types)
  const listWrapper = block.holder.querySelector('[data-list-depth]');

  if (!listWrapper) {
    return null;
  }

  const childDepthAttr = listWrapper.getAttribute('data-list-depth');

  if (childDepthAttr && childDepthAttr !== '') {
    const parsed = parseInt(childDepthAttr, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};
