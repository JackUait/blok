import type * as Y from 'yjs';

/**
 * Shared types the Y.UndoManager tracks: the blocks map and the root
 * order array. contentIds arrays nest inside blocks-map values, so these
 * two roots cover every block write.
 */
export type UndoScopeType = Y.Map<Y.Map<unknown>> | Y.Array<string>;

/**
 * The two top-level shared types of doc schema v2, handed to the observer.
 */
export interface DocumentScope {
  blocksMap: Y.Map<Y.Map<unknown>>;
  rootOrder: Y.Array<string>;
}

/**
 * Where a block sits: its parent (null = root) and the sibling it follows
 * (null = first child). Index-free, so it survives concurrent edits.
 */
export interface BlockPlacement {
  parentId: string | null;
  afterId: string | null;
}

/**
 * Presence delta from y-protocols Awareness: the client ids whose state was
 * added, changed, or dropped since the last emission. Client ids are Yjs
 * `doc.clientID` numbers, not block ids.
 */
export interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/**
 * Event emitted when blocks change.
 *
 * Most events carry a single `blockId`. The `batch-add` type carries
 * multiple IDs so that parent and child blocks can be created together
 * before any lifecycle hooks fire.
 */
export type BlockChangeEvent =
  | { type: 'add' | 'remove' | 'update' | 'move'; blockId: string; origin: TransactionOrigin }
  | { type: 'batch-add'; blockIds: string[]; origin: TransactionOrigin };

/**
 * Transaction origin types AFTER classification by
 * `BlockObserver.mapTransactionOrigin`. This is what downstream consumers
 * (e.g. `BlockYjsSync`) see on a `BlockChangeEvent`.
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
 * Whitelist of raw origin tags that our own code passes to `Y.Doc.transact`.
 *
 * A new local-authored tag MUST be added here AND handled explicitly in
 * `BlockObserver.mapTransactionOrigin` (the mapper's exhaustiveness check and
 * the `block-observer.test.ts` enumeration fail otherwise). A tag that falls
 * through classifies as 'remote', and `BlockYjsSync` then overwrites the
 * authoring tool's state with stale doc data mid-operation.
 */
export const LOCAL_ORIGIN_TAGS = [
  'local',
  'load',
  'no-capture',
  'move',
  'move-undo',
  'move-redo',
] as const;

export type LocalOriginTag = (typeof LOCAL_ORIGIN_TAGS)[number];

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
  /**
   * Which timeline this operation belongs to. The caret stack interleaves moves
   * and Yjs text edits in chronological order, so undo/redo consult the top
   * entry's kind to unwind the correct stack — keeping history strictly
   * reverse-chronological even when a move sits between edits.
   */
  kind?: 'move' | 'edit';
}

/**
 * Replays one recorded move step during move-undo/move-redo: restore the
 * block to `placement` (doc write + in-memory reparent). Owned by
 * YjsManager; must not record its own history entry.
 */
export type MoveReplayCallback = (
  blockId: string,
  placement: BlockPlacement,
  origin: 'move-undo' | 'move-redo'
) => void;

/**
 * Represents a single move operation within a move group.
 *
 * Both sides are full placements (parent + preceding sibling), captured
 * from the doc BEFORE/AFTER the mutation, so replay is index-free and
 * survives concurrent remote edits that shift flat indices. A parent
 * change recorded mid-group rides the same entry — without this, a
 * drag-reparent splits across two history stacks (`moveUndoStack` for the
 * position, Y.UndoManager for the parentId write) and requires two Cmd+Z
 * presses to fully reverse.
 */
export interface SingleMoveEntry {
  blockId: string;
  /** Placement before the move; undo restores this side */
  from: BlockPlacement;
  /** Placement after the move; redo restores this side */
  to: BlockPlacement;
}

/**
 * Represents a group of move operations for custom undo/redo handling.
 * Yjs UndoManager doesn't handle moves correctly (delete+insert creates issues),
 * so we track moves separately and handle them at the application level.
 * Multi-block moves are stored as arrays to ensure they're undone atomically.
 */
export type MoveHistoryEntry = SingleMoveEntry[];
