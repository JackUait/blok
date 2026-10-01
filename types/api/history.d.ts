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

  /**
   * Keep a value the host owns, like a page title outside the editor, in the
   * editor's undo history. Its writes interleave with block edits: Cmd+Z
   * walks back through both in the order they happened. A write and a block
   * change made in the same task undo as one step.
   *
   * The value lives in the editor's document, so collaborators share it. It is
   * not part of `save()` output.
   *
   * @param key - names the value; tracking a key again replaces its callback
   * @param onChange - called when undo, redo or a peer changes the value; not
   *   for the host's own `set`
   * @returns a handle to read and write the value
   */
  track<T extends HistoryValueData>(key: string, onChange: (value: T | undefined) => void): HistoryValue<T>;
}

/**
 * A JSON-compatible value `History.track` can keep.
 */
export type HistoryValueData = string | number | boolean | null | HistoryValueData[] | { [key: string]: HistoryValueData };

/**
 * A value in the editor's undo history. See `History.track`.
 */
export interface HistoryValue<T extends HistoryValueData> {
  /**
   * @returns the value, or undefined when it was never set
   */
  get(): T | undefined;

  /**
   * Write the value. Each write is an undo step of its own, except a typing
   * write that continues a typing run in the same value.
   *
   * @param value - the new value
   * @param options.typing - continue the open typing run in this value
   * @param options.record - false keeps the write out of the history, for a
   *   starting value
   */
  set(value: T, options?: { typing?: boolean; record?: boolean }): void;
}
