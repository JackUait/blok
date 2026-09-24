import type { Block } from '../../../src/components/block';
import type { Blocks } from '../../../src/components/blocks';
import { BlockHierarchy } from '../../../src/components/modules/blockManager/hierarchy';
import type { BlockRepository } from '../../../src/components/modules/blockManager/repository';
import type { TreePlacement } from '../../../src/components/utils/tree-order';

/**
 * The `placeBlock` sync handler as BlockManager wires it, over a real
 * BlockHierarchy, for harnesses that build BlockYjsSync by hand.
 * @param repository - the harness repository
 * @param blocksStore - the store behind it
 */
export const placeBlockWithHierarchy = (
  repository: BlockRepository,
  blocksStore: Pick<Blocks, 'mount'>
): ((block: Block, placement: TreePlacement) => void) => {
  const hierarchy = new BlockHierarchy(repository, undefined, () => true, blocksStore);

  return (block, placement) => {
    const oldParentId = block.parentId;

    hierarchy.placeBlock(block, placement);
    hierarchy.syncVisibilityWithParent(block, oldParentId);
  };
};
