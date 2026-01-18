/**
 * Event emitted when blocks change
 */
export interface BlockChangeEvent {
  type: 'add' | 'remove' | 'update' | 'move';
  blockId: string;
  origin: TransactionOrigin;
}

/**
 * Transaction origin types.
 * Includes 'move' and 'move-undo'/'move-redo' for custom move handling.
 */
export type TransactionOrigin =
  | 'local'
  | 'undo'
  | 'redo'
  | 'load'
  | 'remote'
  | 'move'
  | 'move-undo'
  | 'move-redo';

/**
 * Callback for block change events
 */
export type BlockChangeCallback = (event: BlockChangeEvent) => void;

/**
 * Represents caret position at a point in time
 */
export interface CaretSnapshot {
  blockId: string;
  inputIndex: number;
  offset: number;
}

/**
 * Caret state before and after an undoable action
 */
export interface CaretHistoryEntry {
  before: CaretSnapshot | null;
  after: CaretSnapshot | null;
}

/**
 * Represents a single move operation within a move group.
 */
export interface SingleMoveEntry {
  blockId: string;
  fromIndex: number;
  toIndex: number;
}

/**
 * Represents a group of move operations for custom undo/redo handling.
 * Yjs UndoManager doesn't handle moves correctly (delete+insert creates issues),
 * so we track moves separately and handle them at the application level.
 * Multi-block moves are stored as arrays to ensure they're undone atomically.
 */
export type MoveHistoryEntry = SingleMoveEntry[];
