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

/**
 * Generic nesting depth for ANY block, unifying the two depth carriers so the
 * drag can nest any block type inside a list:
 *   - list items expose their depth via `data-list-depth` (even at depth 0)
 *   - every other block exposes its STRUCTURAL depth (length of the
 *     parentId chain) via `data-blok-depth`, which is only meaningful when > 0
 *
 * Returns the depth as a number, or `null` when the block is neither a list
 * item nor nested — i.e. a plain root block that is not part of any nesting
 * context. Treating an explicit `data-blok-depth="0"` as `null` keeps an
 * outdented (root) block from being mistaken for a nesting parent.
 * @param block - block to check
 * @returns nesting depth, or null when the block sits at root with no nesting role
 */
export const getBlockNestingDepth = (block: { holder: HTMLElement }): number | null => {
  const listDepth = getListItemDepth(block);

  if (listDepth !== null) {
    return listDepth;
  }

  const depthAttr = block.holder.getAttribute('data-blok-depth');

  if (depthAttr !== null && depthAttr !== '') {
    const parsed = parseInt(depthAttr, 10);

    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};
