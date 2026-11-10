/**
 * Fired by `history.undo()`, `history.redo()` and `history.undoStep()` before they walk. A tool
 * holding an unsaved draft (an open database cell editor) writes it inside
 * `commit`, so the draft becomes its own step and the walk cannot drop it.
 * Keys never fire it: Cmd+Z in such a field stays the field's own undo.
 */
export const HistoryDraftsCommit = 'history drafts commit';

export interface HistoryDraftsCommitPayload {
  direction: 'undo' | 'redo';
  /** Runs `write` as the first write of a new step. Call it only when there is a draft to write. */
  commit: (write: () => void) => void;
}
