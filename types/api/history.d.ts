/**
 * History API interface for undo/redo operations
 */
export interface History {
  /**
   * Performs undo operation, reverting to the previous state
   * @returns Promise resolving to true if undo was performed, false if nothing to undo
   */
  undo(): Promise<boolean>;

  /**
   * Performs redo operation, restoring the previously undone state
   * @returns Promise resolving to true if redo was performed, false if nothing to redo
   */
  redo(): Promise<boolean>;

  /**
   * Checks if undo is available
   * @returns true if there are states to undo
   */
  canUndo(): boolean;

  /**
   * Checks if redo is available
   * @returns true if there are states to redo
   */
  canRedo(): boolean;

  /**
   * Clears the history stacks, removing all undo/redo history
   */
  clear(): void;
}
