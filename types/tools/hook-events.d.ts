/**
 * Move event for block relocation
 * Passed to the moved() lifecycle hook when a block is moved to a new position
 */
export interface MoveEvent {
  /**
   * index the block was moved from
   */
  fromIndex: number;
  /**
   * index the block was moved to
   */
  toIndex: number;
}
