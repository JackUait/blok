import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { Block } from '../../../block';

type BlockManager = BlokModules['BlockManager'];

/**
 * Returns the block immediately before `block` (in document order) that shares
 * its parent — its preceding sibling — or null when `block` is the first child
 * of its parent (or the first block).
 *
 * Shared by the single-block Tab nesting (keyboardNavigation) and the
 * multi-selection Tab nesting (blockSelectionKeys) so both resolve siblings the
 * same way.
 * @param BlockManager - the BlockManager module
 * @param block - the block whose preceding sibling to find
 */
export const getPrecedingSibling = (BlockManager: BlockManager, block: Block): Block | null => {
  const index = BlockManager.getBlockIndex(block);
  const preceding = BlockManager.blocks.slice(0, index).reverse();

  for (const candidate of preceding) {
    // Reached the parent without finding a sibling: block is the first child.
    if (candidate.id === block.parentId) {
      return null;
    }

    if (candidate.parentId === block.parentId) {
      return candidate;
    }
  }

  return null;
};

/**
 * Returns `block`'s following siblings (same parent, after it in order), read
 * from the parent's contentIds so it is robust to interleaved descendants.
 * @param BlockManager - the BlockManager module
 * @param block - the block whose following siblings to collect
 */
export const getFollowingSiblings = (BlockManager: BlockManager, block: Block): Block[] => {
  if (block.parentId === null) {
    return [];
  }

  const parent = BlockManager.getBlockById(block.parentId);

  if (parent === undefined) {
    return [];
  }

  const position = parent.contentIds.indexOf(block.id);

  if (position === -1) {
    return [];
  }

  return parent.contentIds
    .slice(position + 1)
    .map((id) => BlockManager.getBlockById(id))
    .filter((sibling): sibling is Block => sibling !== undefined);
};
