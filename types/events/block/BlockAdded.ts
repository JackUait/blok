import type { BlockMutationEventDetail } from './Base';

/**
 * Type name of CustomEvent related to block added event
 */
export const BlockAddedMutationType = 'block-added';

/**
 * Information about added block
 */
interface BlockAddedEventDetail extends BlockMutationEventDetail {
  /**
   * Index of added block
   */
  index: number;

  /**
   * Id of the new block's parent, `null` at the root
   */
  parentId?: string | null;

  /**
   * Id of the sibling right before the new block, `null` when it is first
   */
  previousSiblingId?: string | null;
}

/**
 * Event will be fired when the new block is added to the blok
 */
export type BlockAddedEvent = CustomEvent<BlockAddedEventDetail>;
