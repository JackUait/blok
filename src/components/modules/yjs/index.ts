import type * as Y from 'yjs';

import type { BlokModules } from '../../../types-internal/blok-modules';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { modificationsObserverBatchTimeout } from '../../constants';
import { Module } from '../../__module';

import { BlockObserver } from './block-observer';
import { DocumentStore } from './document-store';
import { YBlockSerializer, isBoundaryCharacter, type YjsOutputBlockData } from './serializer';
import type { AwarenessChange, BlockChangeCallback, BlockPlacement, CaretSnapshot } from './types';
import { UndoHistory } from './undo-history';
import { BlockWriteBuffer, type BufferedBlockWriteFlush } from './write-buffer';

/**
 * @class YjsManager
 * @classdesc Manages Yjs document and block synchronization
 * @module YjsManager
 *
 * This is a facade that coordinates:
 * - DocumentStore: Y.Doc management and block CRUD
 * - UndoHistory: Undo/redo with move tracking, caret tracking, and smart grouping
 * - BlockObserver: Yjs event observation and domain event emission
 * - YBlockSerializer: Data conversion between Yjs and OutputBlockData formats
 */
export class YjsManager extends Module {
  /**
   * Document store for Y.Doc management and block operations
   */
  private documentStore: DocumentStore;

  /**
   * Undo/redo history manager
   */
  private undoHistory: UndoHistory;

  /**
   * Serializer for Yjs ↔ OutputBlockData conversion
   */
  private serializer: YBlockSerializer;

  /**
   * Block observer for change events
   */
  private blockObserver: BlockObserver;

  /**
   * Coalescing buffer for typing-driven block data writes (leading + trailing
   * flush on the 400ms mutation batch window). Drained synchronously by
   * `flushPendingBlockWrites`, which every structural chokepoint calls first.
   */
  private writeBuffer = new BlockWriteBuffer(modificationsObserverBatchTimeout);

  /**
   * Flag to track if move group is active.
   *
   * Read via the `isInMoveGroup` getter by `BlockManager.setBlockParent`,
   * which routes its Yjs writes through `transactWithoutCapture` while this
   * flag is true so the parent change attaches to the in-flight move entry
   * instead of landing on Y.UndoManager as a separate stack item.
   */
  private isMoveGroupActive = false;

  /**
   * Whether the currently-open move group is a DRAG move group (the drag pipeline
   * fires the tool MOVED lifecycle hook itself via `move()`, so `setBlockParent`
   * must NOT also fire it). Keyboard move groups (Tab/Shift+Tab nesting) leave
   * this false: they do not fire MOVED elsewhere, so `setBlockParent` owns it.
   */
  private isDragMoveGroup = false;

  /**
   * Whether a move group is currently open (drag OR keyboard nesting).
   * See `isMoveGroupActive`.
   */
  public get isInMoveGroup(): boolean {
    return this.isMoveGroupActive;
  }

  /**
   * Whether the open move group is a drag move group (vs a keyboard one).
   * Used by `BlockManager.setBlockParent` to decide whether to fire the tool
   * MOVED hook (skipped for drag, which fires it itself).
   */
  public get isDragMoveGroupActive(): boolean {
    return this.isDragMoveGroup;
  }

  /**
   * Constructor - initializes all components
   */
  constructor(params: ModuleConfig) {
    super(params);

    // Initialize components
    this.serializer = new YBlockSerializer();
    this.documentStore = new DocumentStore(this.serializer);
    this.blockObserver = new BlockObserver();
    this.undoHistory = new UndoHistory(
      this.documentStore.undoScope,
      this.Blok
    );

    // ONE placement callback replays recorded moves during move-undo /
    // move-redo (parent restore + position, see replayMovePlacement).
    this.undoHistory.setPlacementCallback((blockId, placement, origin) => {
      this.replayMovePlacement(blockId, placement, origin);
    });

    // Barrier inside UndoHistory so the internal 100ms word-boundary timer's
    // stopCapturing also flushes buffered typing writes before splitting.
    this.undoHistory.setFlushPendingWritesHook(() => this.flushPendingBlockWrites());

    // A trailing flush lands up to 400ms after the typing it carries. Anchor
    // the undo captureTimeout at the typing time, not the flush time —
    // otherwise two actions the user separated by more than the capture
    // window merge into one undo entry.
    this.writeBuffer.onTrailingFlush((lastEnqueueAt) => {
      this.undoHistory.rewindCaptureClock(lastEnqueueAt);
    });

    this.observeDocument();
  }

  /**
   * Point the observer at the store's CURRENT roots and undo manager. Called
   * once at construction and again after a lineage reset swaps both.
   */
  private observeDocument(): void {
    this.blockObserver.observe(
      {
        blocksMap: this.documentStore.blocksMap,
        rootOrder: this.documentStore.rootOrder,
      },
      this.undoHistory.undoManager
    );
  }

  /**
   * Discard this document and start over on a genuinely FRESH Y.Doc, because
   * the server reset the room and our history no longer belongs to it.
   *
   * Every step is ordered against the swap, and every one of them is a bug if
   * moved:
   *
   * 1. FLUSH the write buffer. A pending flush closure captured the OLD Y.Maps;
   *    running it after the swap would write typing into a dead document —
   *    silently, since `updateBlockData` on a missing block just returns false.
   *    Flushing also cancels the trailing timers, so nothing fires later.
   * 2. CLEAR the undo history while the old document is still alive:
   *    `Y.UndoManager.clear` transacts on its doc.
   * 3. UNOBSERVE, so the dying document's teardown classifies nothing. The
   *    observer keeps its subscribers, so `BlockYjsSync` never re-subscribes.
   * 4. SWAP the document (the store owns the seam handlers and Awareness).
   * 5. REBIND the undo manager to the new roots — an UndoManager is bound to
   *    its scope's document at construction.
   * 6. RE-OBSERVE, with the NEW undo manager, or every post-reset undo would
   *    be misclassified as a remote change.
   *
   * The rendered DOM is NOT this method's business: the Collaboration module
   * clears it (with `skipYjsSync`) so the fresh initial sync materialises
   * through the ordinary remote path.
   */
  public resetForRelineage(): void {
    this.flushPendingBlockWrites();
    this.undoHistory.clear();
    this.blockObserver.unobserve();

    this.documentStore.resetForRelineage();

    this.undoHistory.rebindScope(this.documentStore.undoScope);
    this.observeDocument();
  }

  /**
   * Replay one recorded move step during move-undo/move-redo: restore the
   * block to the recorded {parentId, afterId} placement.
   *
   * The parent restore runs FIRST in BOTH directions and stays INVISIBLE
   * to the sync layer: it goes through `applyPlacement` under 'no-capture'
   * (maps to a 'local' event origin `BlockYjsSync` deliberately ignores,
   * and Y.UndoManager does not track it), so the in-memory reparent goes
   * DIRECT via `reparentFromHistoryReplay`.
   *
   * The position restore then re-asserts the SAME placement under the
   * replay origin. By then the doc's parentId already agrees, and
   * `applyPlacement`'s idempotent parentId write skips it — the visible
   * transaction touches order arrays only, so the observer emits a pure
   * 'move' under 'undo'/'redo' and `BlockYjsSync` resyncs the DOM order
   * (never `setData`). Degradation is applyPlacement's: a since-deleted
   * afterId appends to the parent's order; a since-deleted parent leaves
   * the block an orphan (stays in the doc, renders at the end).
   */
  private replayMovePlacement(
    blockId: string,
    placement: BlockPlacement,
    origin: 'move-undo' | 'move-redo'
  ): void {
    const yblock = this.documentStore.getBlockById(blockId);

    if (yblock === undefined) {
      return;
    }

    const rawParentId = yblock.get('parentId');
    const docParentId = typeof rawParentId === 'string' ? rawParentId : null;

    if (docParentId !== placement.parentId) {
      this.documentStore.applyPlacement(blockId, placement, 'no-capture');
      this.reparentInMemoryFromReplay(blockId, placement.parentId);
    }

    this.documentStore.applyPlacement(blockId, placement, origin);
  }

  /**
   * In-memory half of the replay parent restore (see replayMovePlacement).
   */
  private reparentInMemoryFromReplay(blockId: string, parentId: string | null): void {
    const blockManager = this.Blok?.BlockManager;
    const block = blockManager?.getBlockById(blockId);

    if (blockManager !== undefined && block !== undefined) {
      blockManager.reparentFromHistoryReplay(block, parentId);
    }
  }

  /**
   * Set Blok modules (called by Core after initialization)
   */
  public override set state(Blok: BlokModules) {
    super.state = Blok;
    this.undoHistory.setBlok(Blok);
  }

  // ========== Public API: CRUD ==========

  /**
   * Load blocks from JSON data.
   * Clears all history when loading new data.
   * @param blocks - Array of block data to load
   */
  public fromJSON(blocks: YjsOutputBlockData[]): void {
    this.flushPendingBlockWrites();

    // Clear all history when loading new data
    this.undoHistory.clear();

    this.documentStore.fromJSON(blocks);
  }

  /**
   * Serialize blocks to JSON format.
   * @returns Array of block data
   */
  public toJSON(): YjsOutputBlockData[] {
    this.flushPendingBlockWrites();

    return this.documentStore.toJSON();
  }

  /**
   * Add a new block.
   * @param blockData - Block data to add
   * @param index - Optional index to insert at
   * @returns The created Y.Map
   */
  public addBlock(blockData: YjsOutputBlockData, index?: number): Y.Map<unknown> {
    this.flushPendingBlockWrites();
    this.undoHistory.markCaretBeforeChange();

    return this.documentStore.addBlock(blockData, index);
  }

  /**
   * Remove a block by id.
   * @param id - Block id to remove
   */
  public removeBlock(id: string): void {
    this.flushPendingBlockWrites();
    this.undoHistory.markCaretBeforeChange();

    this.documentStore.removeBlock(id);
  }

  /**
   * Replace a block's tool TYPE and DATA in place (turn-into / markdown
   * conversion), preserving its id, position, parentId, contentIds and tunes.
   * Emits an `update` event so undo/redo re-renders the correct tool — unlike a
   * remove+add of the same id, which the observer misreads as a no-op move.
   * @param id - Block id whose content to replace
   * @param type - New tool name
   * @param data - New tool data
   * @returns true if the block existed and was mutated
   */
  public replaceBlockContent(id: string, type: string, data: Record<string, unknown>): boolean {
    this.flushPendingBlockWrites();
    this.undoHistory.markCaretBeforeChange();

    return this.documentStore.replaceBlockContent(id, type, data);
  }

  /**
   * Move a block to a new index.
   * @param id - Block id to move
   * @param toIndex - Target index (the final position where the block should end up)
   */
  public moveBlock(id: string, toIndex: number): void {
    this.flushPendingBlockWrites();

    // The FROM placement must be read BEFORE the mutation — it is what
    // undo restores, index-free.
    const from = this.documentStore.getPlacement(id);

    if (from === null) {
      return;
    }

    // Caret-before also predates the mutation (idempotent: inside a move
    // group, startMoveGroup's capture wins).
    this.undoHistory.markCaretBeforeChange();

    this.documentStore.moveBlock(id, toIndex, 'local');

    const to = this.documentStore.getPlacement(id) ?? from;

    this.undoHistory.recordMove({ blockId: id, from, to }, this.isMoveGroupActive);
  }

  /**
   * A block's current doc placement (parent + preceding sibling), or null
   * when the block is not in the doc. `BlockManager.setBlockParent` reads
   * this BEFORE a drag-reparent write so the pending move entry records
   * the true from-placement.
   * @param id - Block id
   */
  public getBlockPlacement(id: string): BlockPlacement | null {
    return this.documentStore.getPlacement(id);
  }

  /**
   * Place a block in the doc: ONE transaction owning the parentId
   * set/delete AND order-array membership (root array included). This is
   * the single write path for reparents — BlockManager delegates here and
   * never touches contentIds Y.Arrays directly.
   * @param id - Block id to place
   * @param placement - Target parent (null = root) and preceding sibling (null = first)
   * @param options.capture - true (default): a tracked 'local' transaction
   *   that lands on the undo stack. false: 'no-capture', for drag move
   *   groups whose parent change attaches to the in-flight move entry via
   *   `recordParentChangeForPendingMove` instead.
   */
  public applyBlockPlacement(
    id: string,
    placement: BlockPlacement,
    options?: { capture?: boolean }
  ): void {
    const capture = options?.capture ?? true;

    if (capture) {
      this.flushPendingBlockWrites();
    }

    this.documentStore.applyPlacement(id, placement, capture ? 'local' : 'no-capture');
  }

  /**
   * Update a property in block data.
   * @param id - Block id
   * @param key - Data property key
   * @param value - New value
   */
  public updateBlockData(id: string, key: string, value: unknown): boolean {
    // Barrier: a fresh write (api.blocks.update, split, merge) must land AFTER
    // the buffered typing it supersedes. Without it the still-open window's
    // trailing flush lands 400ms later and REGRESSES the doc to the stale
    // value. The flush body calls this method itself, but the buffer's
    // dispatch guard makes that nested drain a no-op, not a recursion.
    this.flushPendingBlockWrites();
    this.undoHistory.markCaretBeforeChange();

    return this.documentStore.updateBlockData(id, key, value);
  }

  /**
   * Update a tune in block tunes.
   * @param id - Block id
   * @param tuneName - Tune name
   * @param tuneData - Tune data value
   */
  public updateBlockTune(id: string, tuneName: string, tuneData: unknown): void {
    // Barrier: a tune write is a structural chokepoint like every other
    // non-flush-body write — buffered typing must land first so the tune
    // change never reorders ahead of the text it followed.
    this.flushPendingBlockWrites();
    this.undoHistory.markCaretBeforeChange();

    this.documentStore.updateBlockTune(id, tuneName, tuneData);
  }

  /**
   * Update a block's edit metadata.
   * @param id - Block id
   * @param lastEditedAt - Timestamp in milliseconds
   * @param lastEditedBy - User ID, or null
   */
  public updateBlockMetadata(id: string, lastEditedAt: number, lastEditedBy: string | null): boolean {
    // Same barrier as updateBlockData — see there.
    this.flushPendingBlockWrites();

    return this.documentStore.updateBlockMetadata(id, lastEditedAt, lastEditedBy);
  }

  // ========== Public API: Typing write coalescing ==========

  /**
   * Buffer a typing-driven block data write (BlockManager's didMutated →
   * save() path). The first write of an idle block flushes immediately
   * (leading edge — preserves the undo captureTimeout anchor and caret-listener
   * timing); follow-up writes coalesce until the trailing flush at the 400ms
   * mutation batch window. The caret-before snapshot is marked HERE, at
   * enqueue, so a deferred flush cannot record a post-typing caret as
   * "before".
   * @param blockId - block whose data is being written
   * @param data - saved data entries from block.save()
   * @param flush - callback performing the actual Yjs writes for this block
   */
  public enqueueBlockDataWrite(
    blockId: string,
    data: Record<string, unknown>,
    flush: BufferedBlockWriteFlush
  ): void {
    this.undoHistory.markCaretBeforeChange();
    this.writeBuffer.enqueue(blockId, data, flush);
  }

  /**
   * Flush barrier: synchronously land every buffered typing write.
   * Called at the START of every structural chokepoint (undo/redo/
   * stopCapturing via UndoHistory, block CRUD, transact/transactMoves,
   * toJSON/fromJSON/getBlockDataObject, destroy) so no operation ever
   * observes or reorders around a stale buffered value.
   */
  public flushPendingBlockWrites(): void {
    this.writeBuffer.flushAll();
  }

  /**
   * Get block Y.Map by id.
   * @param id - Block id
   * @returns Y.Map or undefined if not found
   */
  public getBlockById(id: string): Y.Map<unknown> | undefined {
    return this.documentStore.getBlockById(id);
  }

  /**
   * Get a block's `data` as a plain object by id.
   *
   * Used when an operation must create a sibling that inherits the source
   * block's full tool data (e.g. a header's `level`) rather than only its
   * text — writing a partial `data` leaves keys missing in Yjs, which a later
   * didMutated→syncBlockDataToYjs then fills in as a SEPARATE transaction,
   * producing a spurious extra undo entry.
   *
   * @param id - Block id
   * @returns Plain object of the block's data, or undefined if not found
   */
  public getBlockDataObject(id: string): Record<string, unknown> | undefined {
    this.flushPendingBlockWrites();

    const yblock = this.documentStore.getBlockById(id);

    if (yblock === undefined) {
      return undefined;
    }

    return this.serializer.yMapToObject(yblock.get('data') as Y.Map<unknown>);
  }

  // ========== Public API: Undo/Redo ==========

  /**
   * Undo the last operation.
   */
  public undo(): void {
    this.undoHistory.undo();
  }

  /**
   * Redo the last undone operation.
   */
  public redo(): void {
    this.undoHistory.redo();
  }

  /**
   * Check if undo is available.
   * @returns true if undo is available
   */
  public canUndo(): boolean {
    return this.undoHistory.canUndo();
  }

  /**
   * Check if redo is available.
   * @returns true if redo is available
   */
  public canRedo(): boolean {
    return this.undoHistory.canRedo();
  }

  /**
   * Clear all history.
   */
  public clear(): void {
    // Barrier: a buffered write that lands AFTER the wipe arrives as a tracked
    // transaction and repopulates the history that was just cleared.
    this.flushPendingBlockWrites();

    this.undoHistory.clear();
  }

  /**
   * Keep a replace-insert inside the undo entry that created the block it is
   * about to remove, so the pair is ONE undo press. No-op unless that creation
   * is still the newest entry. See {@link UndoHistory.continueEntryThatCreated}.
   *
   * Must run BEFORE the replace transaction: it reads the block's Y item, which
   * that transaction deletes. The flush is the usual structural barrier — and it
   * has to land first, since a buffered write that opens a new entry is exactly
   * the case that must NOT merge.
   * @param blockId - id of the block the replace removes
   */
  public continueUndoEntryThatCreated(blockId: string): void {
    this.flushPendingBlockWrites();

    this.undoHistory.continueEntryThatCreated(this.documentStore.getBlockById(blockId)?._item?.id ?? null);
  }

  /**
   * Stop capturing changes into current undo group.
   * Call this to force next change into a new undo entry.
   */
  public stopCapturing(): void {
    this.undoHistory.stopCapturing();
  }

  /**
   * Mark the caret position before a change starts.
   * Call this before any operation that might be undoable.
   * @param force - When true, re-capture even if a pending snapshot exists.
   *   Pass this from keyboard gesture handlers so a stale pending left by a
   *   prior operation cannot become this gesture's caret-before. See
   *   {@link UndoHistory.markCaretBeforeChange}.
   */
  public markCaretBeforeChange(force = false): void {
    this.undoHistory.markCaretBeforeChange(force);
  }

  /**
   * Capture the current caret position as a snapshot.
   * @returns CaretSnapshot or null if no block is focused
   */
  public captureCaretSnapshot(): CaretSnapshot | null {
    return this.undoHistory.captureCaretSnapshot();
  }

  /**
   * Update the "after" position of the most recent caret undo entry.
   */
  public updateLastCaretAfterPosition(): void {
    this.undoHistory.updateLastCaretAfterPosition();
  }

  /**
   * Execute multiple move operations as a single atomic undo group.
   * @param fn - Function containing move operations to execute atomically
   * @param isDrag - true when the group is a pointer drag (the drag pipeline
   *   fires the tool MOVED hook itself, so `setBlockParent` must not). Keyboard
   *   nesting leaves this false so `setBlockParent` fires MOVED.
   */
  public transactMoves(fn: () => void, isDrag = false): void {
    this.flushPendingBlockWrites();

    this.isMoveGroupActive = true;
    this.isDragMoveGroup = isDrag;
    try {
      this.undoHistory.transactMoves(fn);
    } finally {
      this.isMoveGroupActive = false;
      this.isDragMoveGroup = false;
    }
  }

  /**
   * Attach a reparent to the in-flight move entry so `undo`/`redo`
   * restores the block's parent atomically with its position.
   *
   * Called from `BlockManager.setBlockParent` when a drag-backed move group
   * is open (see `isInMoveGroup`). The accompanying Yjs placement write
   * must use the no-capture flavor — otherwise Y.UndoManager records it as
   * a separate stack item and the drag splits into a two-step undo.
   * @param blockId - id of the block being reparented
   * @param from - the block's doc placement BEFORE the reparent write
   *   (read via `getBlockPlacement`)
   * @param to - the placement the reparent wrote
   */
  public recordParentChangeForPendingMove(
    blockId: string,
    from: BlockPlacement,
    to: BlockPlacement
  ): void {
    this.undoHistory.recordParentChangeForPendingMove(blockId, from, to);
  }

  /**
   * Execute multiple Yjs operations as a single atomic transaction.
   * All operations within the callback will be grouped into one undo entry.
   * @param fn - Function containing Yjs operations to execute atomically
   */
  public transact(fn: () => void): void {
    // Barrier first. Flush bodies themselves call transact — the buffer's
    // dispatch guard makes the nested flushAll a no-op, not a recursion.
    this.flushPendingBlockWrites();

    this.documentStore.transact(fn, 'local');
  }

  /**
   * Execute Yjs operations without adding them to the undo history.
   * Uses a non-tracked origin so the UndoManager ignores these changes.
   * Use this for auto-repair operations (e.g. ensuring empty cells have a block)
   * that should never be undoable by the user.
   * @param fn - Function containing Yjs operations to execute
   */
  public transactWithoutCapture(fn: () => void): void {
    this.documentStore.transactWithoutCapture(fn);
  }

  // ========== Public API: Smart Grouping ==========

  /**
   * Check if there is a pending boundary waiting for timeout.
   * @returns true if a boundary character was typed and hasn't timed out yet
   */
  public hasPendingBoundary(): boolean {
    return this.undoHistory.hasPendingBoundary();
  }

  /**
   * Mark that a boundary character (space, punctuation) was just typed.
   */
  public markBoundary(): void {
    this.undoHistory.markBoundary();
  }

  /**
   * Clear the pending boundary state without creating a checkpoint.
   */
  public clearBoundary(): void {
    this.undoHistory.clearBoundary();
  }

  /**
   * Check if a pending boundary has timed out and create a checkpoint if so.
   */
  public checkAndHandleBoundary(): void {
    this.undoHistory.checkAndHandleBoundary();
  }

  /**
   * Check if a character is a boundary character.
   * @param char - Single character to check
   * @returns true if the character is a boundary character
   */
  public static isBoundaryCharacter(char: string): boolean {
    return isBoundaryCharacter(char);
  }

  // ========== Public API: Events ==========

  /**
   * Register callback for block changes.
   * @param callback - Function to call on changes
   * @returns Unsubscribe function
   */
  public onBlocksChanged(callback: BlockChangeCallback): () => void {
    return this.blockObserver.onBlocksChanged(callback);
  }

  // ========== Public API: Binary provider seam ==========

  /**
   * Apply a binary Yjs update from a sync provider.
   * @param update - Encoded Yjs update
   * @param origin - Provider origin; must not be a LocalOriginTag
   */
  public applyRemoteUpdate(update: Uint8Array, origin?: unknown): void {
    this.flushPendingBlockWrites();
    this.documentStore.applyRemoteUpdate(update, origin);
  }

  /**
   * Subscribe to this document's binary updates. Updates applied through
   * `applyRemoteUpdate` are filtered out (echo suppression).
   * @param callback - Receives the encoded update and its transaction origin
   * @returns Unsubscribe function
   */
  public onDocUpdate(callback: (update: Uint8Array, origin: unknown) => void): () => void {
    return this.documentStore.onUpdate(callback);
  }

  /**
   * Subscribe to EVERY binary update, remote ones included — for persistence,
   * never for broadcast. See `DocumentStore.onAnyUpdate`.
   * @param callback - Receives the encoded update and its transaction origin
   * @returns Unsubscribe function
   */
  public onAnyDocUpdate(callback: (update: Uint8Array, origin: unknown) => void): () => void {
    return this.documentStore.onAnyUpdate(callback);
  }

  /**
   * Encode this document's state vector for diff exchange with a peer.
   */
  public getStateVector(): Uint8Array {
    this.flushPendingBlockWrites();
    return this.documentStore.getStateVector();
  }

  /**
   * Encode document state as a binary update, optionally as a diff against
   * a peer's state vector.
   * @param stateVector - Peer state vector; omit for the full document
   */
  public encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
    this.flushPendingBlockWrites();
    return this.documentStore.encodeStateAsUpdate(stateVector);
  }

  // ========== Public API: Awareness seam ==========

  /**
   * Turn presence on (idempotent). Lazily creates the Awareness; absent = zero
   * cost for single-player.
   */
  public enableAwareness(): void {
    this.documentStore.enableAwareness();
  }

  /**
   * Set one field of this peer's presence state.
   * @param field - Field name (e.g. `user`, `blockId`)
   * @param value - Field value
   */
  public setAwarenessField(field: string, value: unknown): void {
    this.documentStore.setAwarenessField(field, value);
  }

  /**
   * Every known peer's presence state, keyed by Yjs client id (presence face).
   */
  public getAwarenessStates(): Map<number, Record<string, unknown>> {
    return this.documentStore.getAwarenessStates();
  }

  /**
   * Subscribe to presence deltas.
   * @param callback - Receives the change delta and its origin
   * @returns Unsubscribe function
   */
  public onAwarenessChange(callback: (changes: AwarenessChange, origin: unknown) => void): () => void {
    return this.documentStore.onAwarenessChange(callback);
  }

  /**
   * Subscribe to every presence emission, keepalive renewals included — what a
   * provider must broadcast so peers never prune an idle collaborator.
   * @param callback - Receives the raw delta and its origin
   * @returns Unsubscribe function
   */
  public onAwarenessUpdate(callback: (changes: AwarenessChange, origin: unknown) => void): () => void {
    return this.documentStore.onAwarenessUpdate(callback);
  }

  /**
   * Encode a binary awareness update for the provider to broadcast.
   * @param clients - Client ids to include; defaults to every known state
   */
  public encodeAwarenessUpdate(clients?: number[]): Uint8Array {
    return this.documentStore.encodeAwarenessUpdate(clients);
  }

  /**
   * Apply a binary awareness update received from a peer.
   * @param update - Encoded awareness update
   * @param origin - Provider origin carried on the emitted change
   */
  public applyAwarenessUpdate(update: Uint8Array, origin: unknown): void {
    this.documentStore.applyAwarenessUpdate(update, origin);
  }

  /**
   * Drop every remote peer's presence but keep this peer's own (disconnect).
   */
  public clearRemoteAwarenessStates(): void {
    this.documentStore.clearRemoteAwarenessStates();
  }

  // ========== Internal Helpers (exposed for UndoHistory) ==========

  /**
   * Convert Y.Map to plain object.
   * Exposed for internal use.
   * @param ymap - Y.Map to convert
   * @returns Plain object representation
   */
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
    return this.serializer.yMapToObject(ymap);
  }

  // ========== Lifecycle ==========

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    // Land buffered writes while the doc is still observable, and cancel
    // trailing timers so nothing fires against a destroyed doc.
    this.flushPendingBlockWrites();

    this.blockObserver.destroy();
    this.undoHistory.destroy();
    this.documentStore.destroy();
  }
}

// Re-export types for consumers
export type { AwarenessChange, CaretSnapshot } from './types';
export type { YjsOutputBlockData };
