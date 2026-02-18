/**
 * Describes Blok's history API
 */
export interface History {
  /**
   * Undo the last operation
   */
  undo(): void;

  /**
   * Redo the last undone operation
   */
  redo(): void;

  /**
   * Check if undo is available
   *
   * @returns {boolean} true if undo is available
   */
  canUndo(): boolean;

  /**
   * Check if redo is available
   *
   * @returns {boolean} true if redo is available
   */
  canRedo(): boolean;

  /**
   * Clear all history
   */
  clear(): void;
}
