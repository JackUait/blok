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
   * With a collaboration server, the value survives the room closing and
   * opening again. It is lost when the server builds the document anew from
   * your record: after a reset, on the first seed, or when the working set is
   * gone. Keep the value in your own record, and set it again once the
   * collaboration status is `connected`.
   *
   * The page title and icon are different. The server saves them in your
   * record as `title` and `icon`, so they survive a reset.
   *
   * @param key - names the value; tracking a key again replaces its callback
   * @param onChange - called when undo, redo or a peer changes the value; not
   *   for the host's own `set`. `change.source` says which: move focus to the
   *   value for an undo or redo, never for a peer's change.
   * @returns a handle to read and write the value
   */
  track<T extends HistoryValueData>(key: string, onChange: (value: T | undefined, change: HistoryValueChange) => void): HistoryValue<T>;
}

/**
 * What changed a tracked value. See `History.track`.
 */
export interface HistoryValueChange {
  source: 'undo' | 'redo' | 'remote';
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
