import * as Y from 'yjs';
import { Module } from '../__module';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import { getCaretOffset } from '../utils/caret';

/**
 * Event emitted when blocks change
 */
export interface BlockChangeEvent {
  type: 'add' | 'remove' | 'update' | 'move';
  blockId: string;
  origin: 'local' | 'undo' | 'redo' | 'load' | 'remote';
}

type BlockChangeCallback = (event: BlockChangeEvent) => void;

/**
 * Represents a single move operation within a move group.
 */
interface SingleMoveEntry {
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
type MoveHistoryEntry = SingleMoveEntry[];

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
interface CaretHistoryEntry {
  before: CaretSnapshot | null;
  after: CaretSnapshot | null;
}

/**
 * @class YjsManager
 * @classdesc Manages Yjs document and block synchronization
 * @module YjsManager
 */
/**
 * Time in milliseconds to batch consecutive changes into a single undo entry.
 * This should be long enough to cover normal human typing speed (50-200ms between keystrokes).
 * Smart grouping logic calls stopCapturing() to force checkpoints at word boundaries.
 */
const CAPTURE_TIMEOUT_MS = 500;

export class YjsManager extends Module {
  /**
   * Characters that mark potential undo checkpoint positions.
   */
  private static readonly BOUNDARY_CHARACTERS = new Set([
    ' ',   // space
    '\t',  // tab
    '.',   // period
    '?',   // question mark
    '!',   // exclamation
    ',',   // comma
    ';',   // semicolon
    ':',   // colon
  ]);

  /**
   * Check if a character is a boundary character that can trigger an undo checkpoint.
   * @param char - Single character to check
   * @returns true if the character is a boundary character
   */
  public static isBoundaryCharacter(char: string): boolean {
    return YjsManager.BOUNDARY_CHARACTERS.has(char);
  }

  /**
   * Yjs document instance
   */
  private ydoc: Y.Doc = new Y.Doc();

  /**
   * Yjs array containing all blocks
   */
  private yblocks: Y.Array<Y.Map<unknown>> = this.ydoc.getArray('blocks');

  /**
   * Undo manager for history operations
   */
  private undoManager: Y.UndoManager = new Y.UndoManager(this.yblocks, {
    captureTimeout: CAPTURE_TIMEOUT_MS,
    trackedOrigins: new Set(['local']),
  });

  /**
   * Callbacks for block changes
   */
  private changeCallbacks: BlockChangeCallback[] = [];

  /**
   * Custom move history stack for undo.
   * Yjs UndoManager doesn't handle array moves correctly when implemented as delete+insert,
   * so we track moves separately and handle undo/redo at the application level.
   * Each entry is an array of moves that should be undone together.
   */
  private moveUndoStack: MoveHistoryEntry[] = [];

  /**
   * Custom move history stack for redo.
   */
  private moveRedoStack: MoveHistoryEntry[] = [];

  /**
   * Temporary buffer for collecting moves during a grouped operation.
   * When not null, moves are collected here instead of pushed to moveUndoStack.
   */
  private pendingMoveGroup: SingleMoveEntry[] | null = null;

  /**
   * Caret position history stack for undo.
   * Tracks caret position before/after each undoable action.
   */
  private caretUndoStack: CaretHistoryEntry[] = [];

  /**
   * Caret position history stack for redo.
   */
  private caretRedoStack: CaretHistoryEntry[] = [];

  /**
   * Pending caret snapshot captured before a change starts.
   * Used because Yjs 'stack-item-added' fires after the change.
   */
  private pendingCaretBefore: CaretSnapshot | null = null;

  /**
   * Flag indicating we have a pending caret snapshot.
   */
  private hasPendingCaret = false;

  /**
   * Flag to skip caret stack updates during explicit undo/redo operations.
   * When true, the stack-item-added listener won't modify caret stacks.
   */
  private isPerformingUndoRedo = false;

  /**
   * Whether the last typed character was a boundary (space, punctuation).
   * Used for smart undo grouping.
   */
  private pendingBoundary = false;

  /**
   * Timestamp when the boundary character was typed.
   * Used to check if 100ms has elapsed.
   */
  private boundaryTimestamp = 0;

  /**
   * Timer ID for the boundary timeout.
   * Fires stopCapturing() after 100ms idle at a boundary.
   */
  private boundaryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Constructor - sets up change observers
   */
  constructor(params: ConstructorParameters<typeof Module>[0]) {
    super(params);
    this.setupObservers();
    this.setupCaretTracking();
  }

  /**
   * Set up Yjs observers for change tracking
   */
  private setupObservers(): void {
    this.yblocks.observeDeep((events, transaction) => {
      const origin = this.mapTransactionOrigin(transaction.origin);

      for (const event of events) {
        this.handleYjsEvent(event, origin);
      }
    });
  }

  /**
   * Set up caret tracking via Yjs UndoManager events.
   * Captures caret position after each undoable change.
   */
  private setupCaretTracking(): void {
    this.undoManager.on('stack-item-added', (event: { type: 'undo' | 'redo' }) => {
      // Skip if we're in the middle of an explicit undo/redo operation.
      // During redo, Yjs fires stack-item-added with type='undo' which would
      // incorrectly add entries to our caret stack.
      if (this.isPerformingUndoRedo) {
        return;
      }

      if (event.type === 'undo') {
        // New undo entry was created - record caret positions
        this.caretUndoStack.push({
          before: this.pendingCaretBefore,
          after: this.captureCaretSnapshot(),
        });
        // Clear redo stack on new action (standard undo/redo behavior)
        this.caretRedoStack = [];
      }
      this.resetPendingCaretState();
    });

    // Listen for stack-item-updated to update the 'after' position when changes
    // are merged into an existing stack item (due to captureTimeout batching).
    // This ensures the caret position reflects where the user ends up after
    // typing multiple characters quickly, not just after the first character.
    this.undoManager.on('stack-item-updated', (event: { type: 'undo' | 'redo' }) => {
      if (this.isPerformingUndoRedo) {
        return;
      }

      if (event.type === 'undo' && this.caretUndoStack.length > 0) {
        // Update the 'after' position of the most recent undo entry
        const lastEntry = this.caretUndoStack[this.caretUndoStack.length - 1];

        lastEntry.after = this.captureCaretSnapshot();
      }

      // Reset pending state so the next distinct action can capture fresh 'before' position.
      // Without this, subsequent beforeinput events during batching would overwrite
      // pendingCaretBefore with intermediate positions (e.g., position 1, 2, 3...)
      // instead of keeping it clean for the next undo group.
      this.resetPendingCaretState();
    });
  }

  /**
   * Reset pending caret capture state.
   * Called after caret positions are recorded or when batching completes.
   */
  private resetPendingCaretState(): void {
    this.hasPendingCaret = false;
    this.pendingCaretBefore = null;
  }

  /**
   * Handle a single Yjs event
   */
  private handleYjsEvent(event: Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>, origin: BlockChangeEvent['origin']): void {
    if (event.target === this.yblocks) {
      this.handleArrayEvent(event as Y.YArrayEvent<Y.Map<unknown>>, origin);

      return;
    }

    if (event.target instanceof Y.Map) {
      this.handleMapEvent(event.target, origin);
    }
  }

  /**
   * Handle array-level changes (add/remove/move)
   * Detects moves by finding block IDs that appear in both adds and removes
   */
  private handleArrayEvent(yArrayEvent: Y.YArrayEvent<Y.Map<unknown>>, origin: BlockChangeEvent['origin']): void {
    // Collect added and removed block IDs
    const adds: string[] = [];
    const removes: string[] = [];

    // Extract IDs from added items
    yArrayEvent.changes.added.forEach((item) => {
      const content = item.content.getContent();

      for (const yblock of content) {
        if (!(yblock instanceof Y.Map)) {
          continue;
        }

        const id = yblock.get('id');

        if (typeof id === 'string') {
          adds.push(id);
        }
      }
    });

    // Extract IDs from deleted items
    yArrayEvent.changes.deleted.forEach((item) => {
      const blockId = this.extractBlockIdFromDeletedItem(item);

      if (blockId !== undefined) {
        removes.push(blockId);
      }
    });

    // Use Set for O(1) lookups
    const addSet = new Set(adds);
    const removeSet = new Set(removes);

    // Detect moves: same ID appears in both adds and removes
    const moveIds = adds.filter(id => removeSet.has(id));
    const pureAdds = adds.filter(id => !removeSet.has(id));
    const pureRemoves = removes.filter(id => !addSet.has(id));

    // Emit move events first (so DOM can reposition before other changes)
    // Note: We emit one event per move, but handleYjsMove batches them via microtask
    for (const blockId of moveIds) {
      this.emitChange({ type: 'move', blockId, origin });
    }

    // Emit pure adds
    for (const blockId of pureAdds) {
      this.emitChange({ type: 'add', blockId, origin });
    }

    // Emit pure removes
    for (const blockId of pureRemoves) {
      this.emitChange({ type: 'remove', blockId, origin });
    }
  }

  /**
   * Extract block id from a deleted Y.Map item
   */
  private extractBlockIdFromDeletedItem(item: Y.Item): string | undefined {
    const content = item.content.getContent();

    if (content.length === 0) {
      return undefined;
    }

    const yblock = content[0];

    if (!(yblock instanceof Y.Map)) {
      return undefined;
    }

    // Access the internal _map to get the id since the Y.Map is deleted
    const idEntry = yblock._map.get('id');
    const idContent = idEntry?.content?.getContent()[0];

    return typeof idContent === 'string' ? idContent : undefined;
  }

  /**
   * Handle map-level changes (data update)
   */
  private handleMapEvent(ymap: Y.Map<unknown>, origin: BlockChangeEvent['origin']): void {
    const yblock = this.findParentBlock(ymap);

    if (yblock === undefined) {
      return;
    }

    this.emitChange({
      type: 'update',
      blockId: yblock.get('id') as string,
      origin,
    });
  }

  /**
   * Map transaction origin to event origin
   */
  private mapTransactionOrigin(origin: unknown): BlockChangeEvent['origin'] {
    if (origin === 'local') {
      return 'local';
    }

    if (origin === 'load') {
      return 'load';
    }

    if (origin === this.undoManager) {
      return this.undoManager.undoing ? 'undo' : 'redo';
    }

    // Handle custom move origins for our application-level move undo/redo
    if (origin === 'move') {
      return 'local';
    }

    if (origin === 'move-undo') {
      return 'undo';
    }

    if (origin === 'move-redo') {
      return 'redo';
    }

    return 'remote';
  }

  /**
   * Find the parent block Y.Map for a nested Y.Map (data or tunes)
   */
  private findParentBlock(ymap: Y.Map<unknown>): Y.Map<unknown> | undefined {
    return this.yblocks.toArray().find((yblock) => {
      const ydata = yblock.get('data');
      const ytunes = yblock.get('tunes');

      return ydata === ymap || ytunes === ymap;
    });
  }

  /**
   * Register callback for block changes
   * @param callback - Function to call on changes
   * @returns Unsubscribe function
   */
  public onBlocksChanged(callback: BlockChangeCallback): () => void {
    this.changeCallbacks.push(callback);

    return (): void => {
      const index = this.changeCallbacks.indexOf(callback);

      if (index !== -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit change event to all callbacks
   */
  private emitChange(event: BlockChangeEvent): void {
    for (const callback of this.changeCallbacks) {
      callback(event);
    }
  }

  /**
   * Load blocks from JSON data
   * @param blocks - Array of block data to load
   */
  public fromJSON(blocks: OutputBlockData[]): void {
    // Clear all history when loading new data
    this.clearHistory();

    this.ydoc.transact(() => {
      this.yblocks.delete(0, this.yblocks.length);

      for (const block of blocks) {
        const yblock = this.outputDataToYBlock(block);

        this.yblocks.push([yblock]);
      }
    }, 'load');
  }

  /**
   * Serialize blocks to JSON format
   * @returns Array of block data
   */
  public toJSON(): OutputBlockData[] {
    return this.yblocks.toArray().map((yblock) => this.yBlockToOutputData(yblock));
  }

  /**
   * Add a new block
   * @param blockData - Block data to add
   * @param index - Optional index to insert at
   * @returns The created Y.Map
   */
  public addBlock(blockData: OutputBlockData, index?: number): Y.Map<unknown> {
    this.markCaretBeforeChange();

    const yblock = this.outputDataToYBlock(blockData);

    this.ydoc.transact(() => {
      const insertIndex = index ?? this.yblocks.length;

      this.yblocks.insert(insertIndex, [yblock]);
    }, 'local');

    return yblock;
  }

  /**
   * Remove a block by id
   * @param id - Block id to remove
   */
  public removeBlock(id: string): void {
    this.markCaretBeforeChange();

    const index = this.findBlockIndex(id);

    if (index === -1) {
      return;
    }

    this.ydoc.transact(() => {
      this.yblocks.delete(index, 1);
    }, 'local');
  }

  /**
   * Move a block to a new index
   * @param id - Block id to move
   * @param toIndex - Target index (the final position where the block should end up)
   * @param origin - Transaction origin ('local' for user actions, 'move-undo'/'move-redo' for history)
   */
  public moveBlock(id: string, toIndex: number, origin: 'local' | 'move-undo' | 'move-redo' = 'local'): void {
    const fromIndex = this.findBlockIndex(id);

    if (fromIndex === -1) {
      return;
    }

    // Skip if no actual movement needed
    if (fromIndex === toIndex) {
      return;
    }

    // For user-initiated moves, track in our custom undo stack
    // We store the original fromIndex and the final toIndex for proper undo/redo
    if (origin === 'local' && this.pendingMoveGroup !== null) {
      // Grouped move: collect into pending group (will be recorded when group ends)
      this.pendingMoveGroup.push({ blockId: id, fromIndex, toIndex });
    }

    if (origin === 'local' && this.pendingMoveGroup === null) {
      // Single move: capture caret and record immediately
      this.markCaretBeforeChange();
      this.recordMoveForUndo([{ blockId: id, fromIndex, toIndex }]);
    }

    // Use the origin for the transaction:
    // - 'local' for user-initiated moves (not tracked by Yjs UndoManager since we use 'move')
    // - 'move-undo' / 'move-redo' for our custom undo/redo (maps to 'undo'/'redo' for DOM sync)
    // We use 'move' for user-initiated moves so Yjs UndoManager doesn't track them.
    const transactionOrigin = origin === 'local' ? 'move' : origin;

    this.ydoc.transact(() => {
      const yblock = this.yblocks.get(fromIndex);

      // Clone the block data before deletion since Y.Map can't be reinserted after deletion
      const blockData = this.yBlockToOutputData(yblock);

      this.yblocks.delete(fromIndex, 1);

      // toIndex is the final position. Since we just deleted from fromIndex,
      // the array is now shorter. The insertion index equals toIndex because
      // Y.Array.insert(n, [item]) places item at index n, shifting others right.
      this.yblocks.insert(toIndex, [this.outputDataToYBlock(blockData)]);
    }, transactionOrigin);
  }

  /**
   * Convert OutputBlockData to Y.Map
   */
  private outputDataToYBlock(blockData: OutputBlockData): Y.Map<unknown> {
    const yblock = new Y.Map<unknown>();

    yblock.set('id', blockData.id);
    yblock.set('type', blockData.type);

    // Normalize empty paragraph data to { text: '' } for consistent undo/redo behavior
    const normalizedData = this.normalizeBlockData(blockData.type, blockData.data);

    yblock.set('data', this.objectToYMap(normalizedData));

    if (blockData.tunes !== undefined) {
      yblock.set('tunes', this.objectToYMap(blockData.tunes));
    }

    if (blockData.parent !== undefined) {
      yblock.set('parentId', blockData.parent);
    }

    if (blockData.content !== undefined) {
      yblock.set('contentIds', Y.Array.from(blockData.content));
    }

    return yblock;
  }

  /**
   * Normalize block data for consistent undo/redo behavior.
   * Empty paragraph data {} is normalized to { text: '' } so undo reverts to
   * a state with an explicit text property rather than an empty object.
   */
  private normalizeBlockData(type: string, data: Record<string, unknown>): Record<string, unknown> {
    // Only normalize paragraph blocks with empty data
    if (type === 'paragraph' && Object.keys(data).length === 0) {
      return { text: '' };
    }

    return data;
  }

  /**
   * Convert a Y.Map block to OutputBlockData.
   * Includes type validation to ensure data integrity.
   */
  private yBlockToOutputData(yblock: Y.Map<unknown>): OutputBlockData {
    const id = yblock.get('id');
    const type = yblock.get('type');
    const data = yblock.get('data');

    if (typeof id !== 'string') {
      throw new Error('Block id must be a string');
    }

    if (typeof type !== 'string') {
      throw new Error('Block type must be a string');
    }

    if (!(data instanceof Y.Map)) {
      throw new Error('Block data must be a Y.Map');
    }

    const block: OutputBlockData = {
      id,
      type,
      data: this.yMapToObject(data),
    };

    const tunes = yblock.get('tunes');

    if (tunes instanceof Y.Map && tunes.size > 0) {
      block.tunes = this.yMapToObject(tunes);
    }

    const parentId = yblock.get('parentId');

    if (typeof parentId === 'string') {
      block.parent = parentId;
    }

    const contentIds = yblock.get('contentIds');

    if (contentIds instanceof Y.Array && contentIds.length > 0) {
      block.content = contentIds.toArray();
    }

    return block;
  }

  /**
   * Get block Y.Map by id
   * @param id - Block id
   * @returns Y.Map or undefined if not found
   */
  public getBlockById(id: string): Y.Map<unknown> | undefined {
    const index = this.findBlockIndex(id);

    if (index === -1) {
      return undefined;
    }

    return this.yblocks.get(index);
  }

  /**
   * Update a property in block data
   * @param id - Block id
   * @param key - Data property key
   * @param value - New value
   */
  public updateBlockData(id: string, key: string, value: unknown): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    const ydata = yblock.get('data') as Y.Map<unknown>;
    const currentValue = ydata.get(key);

    // Skip if value hasn't changed - this prevents creating unnecessary undo entries
    // when block data is synced after mutations that don't actually change data
    // (e.g., marker updates in list items during undo/redo)
    if (currentValue === value) {
      return;
    }

    this.markCaretBeforeChange();

    this.ydoc.transact(() => {
      ydata.set(key, value);
    }, 'local');
  }

  /**
   * Update a tune in block tunes
   * @param id - Block id
   * @param tuneName - Tune name
   * @param tuneData - Tune data value
   */
  public updateBlockTune(id: string, tuneName: string, tuneData: unknown): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    this.ydoc.transact(() => {
      const ytunes = this.getOrCreateTunesMap(yblock);

      ytunes.set(tuneName, tuneData);
    }, 'local');
  }

  /**
   * Get existing tunes Y.Map or create a new one
   * @param yblock - The block Y.Map
   * @returns The tunes Y.Map
   */
  private getOrCreateTunesMap(yblock: Y.Map<unknown>): Y.Map<unknown> {
    const existing = yblock.get('tunes') as Y.Map<unknown> | undefined;

    if (existing !== undefined) {
      return existing;
    }

    const newTunes = new Y.Map<unknown>();

    yblock.set('tunes', newTunes);

    return newTunes;
  }

  /**
   * Find block index by id
   */
  private findBlockIndex(id: string): number {
    return this.yblocks.toArray().findIndex((yblock) => yblock.get('id') === id);
  }

  /**
   * Record a move entry for undo and clear the redo stack.
   * This is the standard undo/redo behavior: new actions invalidate the redo stack.
   * Also records caret position before/after the move(s).
   * @param entry - Move history entry to record
   * @param skipCaretCapture - If true, skip caret capture (used by endMoveGroup which handles it separately)
   */
  private recordMoveForUndo(entry: MoveHistoryEntry, skipCaretCapture = false): void {
    this.moveUndoStack.push(entry);
    this.moveRedoStack = [];

    // Record caret positions for this move entry (single moves only)
    // Grouped moves handle caret tracking via startMoveGroup/endMoveGroup
    if (!skipCaretCapture) {
      this.finalizeCaretEntry();
    }
  }

  /**
   * Finalize and record a caret history entry.
   * Captures the current caret position as the "after" state,
   * pushes the entry to the undo stack, clears redo stack, and resets pending state.
   */
  private finalizeCaretEntry(): void {
    this.caretUndoStack.push({
      before: this.pendingCaretBefore,
      after: this.captureCaretSnapshot(),
    });
    this.caretRedoStack = [];
    this.resetPendingCaretState();
  }

  /**
   * Clear all history stacks (move, caret, and Yjs UndoManager) and pending state.
   * Used when loading new data or destroying the manager.
   */
  private clearHistory(): void {
    this.moveUndoStack = [];
    this.moveRedoStack = [];
    this.pendingMoveGroup = null;
    this.caretUndoStack = [];
    this.caretRedoStack = [];
    this.pendingCaretBefore = null;
    this.hasPendingCaret = false;
    this.isPerformingUndoRedo = false;
    // Clear smart grouping state
    this.clearBoundary();
    this.undoManager.clear();
  }

  /**
   * Capture the current caret position as a snapshot.
   * @returns CaretSnapshot or null if no block is focused
   */
  public captureCaretSnapshot(): CaretSnapshot | null {
    // Guard against being called before Blok is fully initialized
    if (this.Blok === undefined || this.Blok.BlockManager === undefined) {
      return null;
    }

    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (currentBlock === undefined) {
      return null;
    }

    const currentInput = currentBlock.currentInput;

    return {
      blockId: currentBlock.id,
      inputIndex: currentBlock.currentInputIndex,
      offset: currentInput !== undefined ? getCaretOffset(currentInput) : 0,
    };
  }

  /**
   * Mark the caret position before a change starts.
   * Call this before any operation that might be undoable.
   * Only captures on first call; subsequent calls are ignored until reset.
   */
  public markCaretBeforeChange(): void {
    if (this.hasPendingCaret) {
      return;
    }

    this.pendingCaretBefore = this.captureCaretSnapshot();
    this.hasPendingCaret = true;
  }

  /**
   * Update the "after" position of the most recent caret undo entry.
   * This is used when the caret is moved asynchronously (e.g., via requestAnimationFrame)
   * after a Yjs transaction has already captured the initial "after" position.
   *
   * Call this after the caret has been moved to its final position to ensure
   * redo operations restore the caret to the correct location.
   */
  public updateLastCaretAfterPosition(): void {
    if (this.caretUndoStack.length === 0) {
      return;
    }

    const lastEntry = this.caretUndoStack[this.caretUndoStack.length - 1];

    lastEntry.after = this.captureCaretSnapshot();
  }

  /**
   * Restore caret position from a snapshot.
   * Handles edge cases: null snapshot, deleted block, invalid input index.
   * @param snapshot - CaretSnapshot to restore, or null to clear selection
   */
  private restoreCaretSnapshot(snapshot: CaretSnapshot | null): void {
    if (snapshot === null) {
      window.getSelection()?.removeAllRanges();

      return;
    }

    const { BlockManager, Caret } = this.Blok;
    const block = BlockManager.getBlockById(snapshot.blockId);

    // Block no longer exists - focus first block if available
    if (block === undefined && BlockManager.firstBlock !== undefined) {
      Caret.setToBlock(BlockManager.firstBlock, Caret.positions.START);

      return;
    }

    if (block === undefined) {
      return;
    }

    // Get the specific input within the block
    const input = block.inputs[snapshot.inputIndex];

    if (input !== undefined) {
      Caret.setToInput(input, Caret.positions.DEFAULT, snapshot.offset);
    } else {
      // Input doesn't exist anymore, fall back to block start
      Caret.setToBlock(block, Caret.positions.START);
    }
  }

  /**
   * Undo the last operation.
   * Checks move stack first since moves are handled separately from Yjs UndoManager.
   * Restores caret position after the undo operation.
   *
   * Note: Caret entry is popped AFTER the operation succeeds to prevent
   * the caret and move/Yjs stacks from drifting out of sync if an operation fails.
   */
  public undo(): void {
    // Check if the last operation was a move (or group of moves)
    const lastMoveGroup = this.moveUndoStack.pop();

    if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
      // Push to redo stack for potential redo
      this.moveRedoStack.push(lastMoveGroup);

      // Reverse all moves in the group, in reverse order
      // This is crucial for multi-block moves to restore correctly
      [...lastMoveGroup].reverse().forEach((move) => {
        this.moveBlock(move.blockId, move.fromIndex, 'move-undo');
      });

      // Pop caret entry only after move succeeds
      const caretEntry = this.caretUndoStack.pop();

      this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');

      return;
    }

    // No move to undo, delegate to Yjs UndoManager
    this.performYjsUndoRedo(() => this.undoManager.undo());

    // Pop caret entry only after Yjs undo succeeds
    const caretEntry = this.caretUndoStack.pop();

    this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');
  }

  /**
   * Helper to push caret entry to a stack and restore caret position.
   * @param entry - Caret history entry or undefined
   * @param stack - Target stack to push the entry to
   * @param position - Which position to restore ('before' or 'after')
   */
  private pushCaretAndRestore(
    entry: CaretHistoryEntry | undefined,
    stack: CaretHistoryEntry[],
    position: 'before' | 'after'
  ): void {
    if (entry === undefined) {
      return;
    }

    stack.push(entry);
    this.restoreCaretSnapshot(position === 'before' ? entry.before : entry.after);
  }

  /**
   * Execute a Yjs UndoManager operation with the isPerformingUndoRedo flag set.
   * This prevents the stack-item-added listener from modifying caret stacks during
   * explicit undo/redo operations.
   * @param operation - The undo or redo operation to execute
   */
  private performYjsUndoRedo(operation: () => void): void {
    this.isPerformingUndoRedo = true;
    try {
      operation();
    } finally {
      this.isPerformingUndoRedo = false;
    }
  }

  /**
   * Redo the last undone operation.
   * Checks move stack first since moves are handled separately from Yjs UndoManager.
   * Restores caret position after the redo operation.
   *
   * Note: Caret entry is popped AFTER the operation succeeds to prevent
   * the caret and move/Yjs stacks from drifting out of sync if an operation fails.
   */
  public redo(): void {
    // Check if the last undone operation was a move (or group of moves)
    const lastMoveGroup = this.moveRedoStack.pop();

    if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
      // Push back to undo stack
      this.moveUndoStack.push(lastMoveGroup);

      // Redo all moves in the group, in original order
      for (const move of lastMoveGroup) {
        this.moveBlock(move.blockId, move.toIndex, 'move-redo');
      }

      // Pop caret entry only after move succeeds
      const caretEntry = this.caretRedoStack.pop();

      this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');

      return;
    }

    // No move to redo, delegate to Yjs UndoManager
    this.performYjsUndoRedo(() => this.undoManager.redo());

    // Pop caret entry only after Yjs redo succeeds
    const caretEntry = this.caretRedoStack.pop();

    this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');
  }

  /**
   * Stop capturing changes into current undo group
   * Call this to force next change into a new undo entry
   */
  public stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  /**
   * Check if there is a pending boundary waiting for timeout.
   * @returns true if a boundary character was typed and hasn't timed out yet
   */
  public hasPendingBoundary(): boolean {
    return this.pendingBoundary;
  }

  /**
   * Time in milliseconds to wait after a boundary character before creating a checkpoint.
   */
  private static readonly BOUNDARY_TIMEOUT_MS = 100;

  /**
   * Mark that a boundary character (space, punctuation) was just typed.
   * Starts a timer that will call stopCapturing() after BOUNDARY_TIMEOUT_MS
   * if no new input arrives.
   */
  public markBoundary(): void {
    this.pendingBoundary = true;
    this.boundaryTimestamp = Date.now();

    // Clear any existing timeout
    if (this.boundaryTimeoutId !== null) {
      clearTimeout(this.boundaryTimeoutId);
    }

    // Set new timeout to create checkpoint if no more input
    this.boundaryTimeoutId = setTimeout(() => {
      if (this.pendingBoundary) {
        this.stopCapturing();
        this.pendingBoundary = false;
      }
      this.boundaryTimeoutId = null;
    }, YjsManager.BOUNDARY_TIMEOUT_MS);
  }

  /**
   * Clear the pending boundary state without creating a checkpoint.
   * Called when the user continues typing before the timeout.
   */
  public clearBoundary(): void {
    this.pendingBoundary = false;

    if (this.boundaryTimeoutId !== null) {
      clearTimeout(this.boundaryTimeoutId);
      this.boundaryTimeoutId = null;
    }
  }

  /**
   * Check if a pending boundary has timed out and create a checkpoint if so.
   * Called on each keystroke to handle the case where the user resumes typing
   * after a pause longer than BOUNDARY_TIMEOUT_MS.
   */
  public checkAndHandleBoundary(): void {
    if (!this.pendingBoundary) {
      return;
    }

    const elapsed = Date.now() - this.boundaryTimestamp;

    if (elapsed >= YjsManager.BOUNDARY_TIMEOUT_MS) {
      this.stopCapturing();
      this.clearBoundary();
    }
  }

  /**
   * Start collecting move operations into a single undo group.
   * All moveBlock calls after this will be collected until endMoveGroup() is called.
   * Also captures caret position before the group starts.
   */
  private startMoveGroup(): void {
    this.markCaretBeforeChange();
    this.pendingMoveGroup = [];
  }

  /**
   * End the current move group and push all collected moves as a single undo entry.
   * If no moves were collected, nothing is added to the undo stack.
   * Also captures caret position after the group completes.
   */
  private endMoveGroup(): void {
    if (this.pendingMoveGroup !== null && this.pendingMoveGroup.length > 0) {
      // Record moves without auto-caret capture (we handle it here)
      this.recordMoveForUndo(this.pendingMoveGroup, true);
      this.finalizeCaretEntry();
    }
    this.pendingMoveGroup = null;
  }

  /**
   * Execute multiple move operations as a single atomic undo group.
   * Provides exception safety: endMoveGroup is always called even if fn throws.
   * @param fn - Function containing move operations to execute atomically
   */
  public transactMoves(fn: () => void): void {
    this.startMoveGroup();
    try {
      fn();
    } finally {
      this.endMoveGroup();
    }
  }

  /**
   * Execute multiple Yjs operations as a single atomic transaction
   * All operations within the callback will be grouped into one undo entry
   * @param fn - Function containing Yjs operations to execute atomically
   */
  public transact(fn: () => void): void {
    this.ydoc.transact(fn, 'local');
  }

  /**
   * Convert plain object to Y.Map
   */
  private objectToYMap(obj: Record<string, unknown>): Y.Map<unknown> {
    const ymap = new Y.Map<unknown>();

    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        ymap.set(key, this.objectToYMap(value as Record<string, unknown>));
      } else {
        ymap.set(key, value);
      }
    }

    return ymap;
  }

  /**
   * Convert Y.Map to plain object
   */
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    ymap.forEach((value, key) => {
      if (value instanceof Y.Map) {
        obj[key] = this.yMapToObject(value);
      } else {
        obj[key] = value;
      }
    });

    return obj;
  }

  /**
   * Cleanup on destroy
   */
  public destroy(): void {
    this.clearHistory();
    this.changeCallbacks = [];
    this.undoManager.destroy();
    this.ydoc.destroy();
  }
}
