/**
 * Personal per-browser state for blocks, such as whether a toggle is open.
 * Kept in this browser only and never saved in the document.
 */
export interface ViewState {
  /** This browser's personal value for a block, e.g. whether a toggle is open. Never saved in the document. */
  get(blockId: string, key: string): unknown;
  set(blockId: string, key: string, value: unknown): void;
  /** Called when this or another tab of this browser changes the value. Returns an unsubscribe. */
  onChange(blockId: string, key: string, listener: (value: unknown) => void): () => void;
  /**
   * True for a block this tab created after the document rendered (toolbox,
   * shortcut, paste, convert, split). False for blocks that came from the
   * saved document, another tab, a collaborator, or undo/redo.
   */
  isCreatedHere(blockId: string): boolean;
}
