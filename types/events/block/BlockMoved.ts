import type { BlockMutationEventDetail } from './Base';

/**
 * Type name of CustomEvent related to block moved event
 */
export const BlockMovedMutationType = 'block-moved';

/**
 * Information about moved block
 */
interface BlockMovedEventDetail extends BlockMutationEventDetail {
  /**
   * Previous block position
   */
  fromIndex: number;

  /**
   * New block position
   */
  toIndex: number;

  /**
   * Id of the block's parent after the move, `null` at the root. Absent when
   * the parent is not final at the time of the event (a step of a larger move)
   */
  parentId?: string | null;

  /**
   * Id of the block's parent before the move, `null` at the root
   */
  oldParentId?: string | null;

  /**
   * Id of the sibling right before the block after the move, `null` when it is first
   */
  previousSiblingId?: string | null;
}

/**
 * Event will be fired when some block is moved to another position
 */
export type BlockMovedEvent = CustomEvent<BlockMovedEventDetail>;
