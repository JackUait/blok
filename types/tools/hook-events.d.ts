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
  /**
   * The pointer-resolved nesting depth the drag indicator showed for this drop.
   * Set by the drag controller when it re-fires moved() after a horizontal
   * drag-to-indent, so a depth-carrying tool (list) lands at the depth the cursor
   * indicated instead of neighbour auto-resolution — the "indicator == drop"
   * invariant. Undefined for keyboard/programmatic moves and group drags.
   */
  targetDepth?: number;
  /**
   * True when the move is a STRUCTURAL reparent (parentId/contentIds) whose depth
   * must be derived from the block tree, not the tool's cached carrier — e.g. an
   * undo/redo history replay. A depth-carrying tool (list) MUST recompute its
   * depth from its structural position (0 when it now has no list parent), even
   * on a freshly-rendered instance that has lost its in-memory "was nested" flag.
   */
  structural?: boolean;
}
