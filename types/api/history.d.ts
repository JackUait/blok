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

  /**
   * Captures the initial document state for undo/redo
   * Typically called after the editor is fully initialized
   * @returns Promise that resolves when the initial state is captured
   */
  captureInitialState(): Promise<void>;

  /**
   * Executes a function as a transaction, grouping all mutations into a single undo step.
   *
   * This is a convenience wrapper around the internal batch API that ensures
   * proper cleanup even if the function throws an error.
   *
   * @param fn - The function to execute as a transaction. Can be sync or async.
   * @returns Promise resolving to the result of the function
   *
   * @example
   * ```typescript
   * // Sync example
   * const result = await editor.history.transaction(() => {
   *   editor.blocks.move(0, 2);
   *   editor.blocks.move(1, 3);
   *   return 'done';
   * });
   *
   * // Async example
   * await editor.history.transaction(async () => {
   *   await editor.blocks.insert({ type: 'paragraph', data: { text: 'Hello' } });
   *   await editor.blocks.insert({ type: 'paragraph', data: { text: 'World' } });
   * });
   * ```
   */
  transaction<T>(fn: () => T | Promise<T>): Promise<T>;
}
