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
  /**
   * When true, the block was moved as part of a multi-block group drag.
   * Tools should skip depth-promotion heuristics (shouldMatchNext/Prev) in this case,
   * because the group maintains its own relative structure — only hard caps apply.
   */
  isGroupMove?: boolean;
}
