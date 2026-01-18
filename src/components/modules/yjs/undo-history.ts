import * as Y from 'yjs';

import { getCaretOffset } from '../../../components/utils/caret';
import type { BlokModules } from '../../../types-internal/blok-modules';

import { CAPTURE_TIMEOUT_MS, BOUNDARY_TIMEOUT_MS, isBoundaryCharacter } from './serializer';
import type { CaretSnapshot, CaretHistoryEntry, MoveHistoryEntry, SingleMoveEntry } from './types';

/**
 * UndoHistory manages all undo/redo state.
 *
 * Responsibilities:
 * - Wraps Yjs UndoManager for standard undo/redo
 * - Manages custom move history (Yjs UndoManager doesn't handle moves correctly)
 * - Tracks caret positions before/after undoable actions
 * - Implements smart undo grouping at word boundaries
 */
export class UndoHistory {
  /**
   * Yjs blocks array (for move operations)
   */
  private yblocks: Y.Array<Y.Map<unknown>>;

  /**
   * Undo manager for history operations
   */
  public readonly undoManager: Y.UndoManager;

  /**
   * Blok modules (for caret operations)
   */
  private blok: BlokModules;

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
   * Callback to execute move operations.
   * Set by YjsManager to delegate move operations.
   */
  private moveCallback: (blockId: string, toIndex: number, origin: 'local' | 'move-undo' | 'move-redo') => void;

  constructor(
    yblocks: Y.Array<Y.Map<unknown>>,
    blok: BlokModules
  ) {
    this.yblocks = yblocks;
    this.blok = blok;

    this.undoManager = new Y.UndoManager(this.yblocks, {
      captureTimeout: CAPTURE_TIMEOUT_MS,
      trackedOrigins: new Set(['local']),
    });

    this.setupCaretTracking();

    // Move callback will be set by YjsManager
    this.moveCallback = () => {
      // Placeholder, will be set by setMoveCallback
    };
  }

  /**
   * Set the move callback. Called by YjsManager to enable move operations.
   */
  public setMoveCallback(
    callback: (blockId: string, toIndex: number, origin: 'local' | 'move-undo' | 'move-redo') => void
  ): void {
    this.moveCallback = callback;
  }

  /**
   * Set the Blok modules. Called when Blok modules are initialized.
   */
  public setBlok(blok: BlokModules): void {
    this.blok = blok;
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
    this.undoManager.on('stack-item-updated', (event: { type: 'undo' | 'redo' }) => {
      if (this.isPerformingUndoRedo) {
        return;
      }

      if (event.type === 'undo' && this.caretUndoStack.length > 0) {
        // Update the 'after' position of the most recent undo entry
        const lastEntry = this.caretUndoStack[this.caretUndoStack.length - 1];
        lastEntry.after = this.captureCaretSnapshot();
      }

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
   * Undo the last operation.
   * Checks move stack first since moves are handled separately from Yjs UndoManager.
   * Restores caret position after the undo operation.
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
        this.moveCallback(move.blockId, move.fromIndex, 'move-undo');
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
   * Redo the last undone operation.
   * Checks move stack first since moves are handled separately from Yjs UndoManager.
   * Restores caret position after the redo operation.
   */
  public redo(): void {
    // Check if the last undone operation was a move (or group of moves)
    const lastMoveGroup = this.moveRedoStack.pop();

    if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
      // Push back to undo stack
      this.moveUndoStack.push(lastMoveGroup);

      // Redo all moves in the group, in original order
      for (const move of lastMoveGroup) {
        this.moveCallback(move.blockId, move.toIndex, 'move-redo');
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
   * Helper to push caret entry to a stack and restore caret position.
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
   * Stop capturing changes into current undo group.
   * Call this to force next change into a new undo entry.
   */
  public stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  /**
   * Check if undo is available.
   */
  public canUndo(): boolean {
    return this.moveUndoStack.length > 0 || this.undoManager.canUndo();
  }

  /**
   * Check if redo is available.
   */
  public canRedo(): boolean {
    return this.moveRedoStack.length > 0 || this.undoManager.canRedo();
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
   * Start collecting move operations into a single undo group.
   * All moveBlock calls after this will be collected until endMoveGroup() is called.
   * Also captures caret position before the group starts.
   */
  public startMoveGroup(): void {
    this.markCaretBeforeChange();
    this.pendingMoveGroup = [];
  }

  /**
   * End the current move group and push all collected moves as a single undo entry.
   * If no moves were collected, nothing is added to the undo stack.
   * Also captures caret position after the group completes.
   */
  public endMoveGroup(): void {
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
   * Record a move operation. Called by YjsManager during moveBlock.
   * @param blockId - Block being moved
   * @param fromIndex - Original index
   * @param toIndex - Target index
   * @param isGrouped - Whether this is part of a grouped move operation
   */
  public recordMove(
    blockId: string,
    fromIndex: number,
    toIndex: number,
    isGrouped: boolean
  ): void {
    const moveEntry: SingleMoveEntry = { blockId, fromIndex, toIndex };

    if (isGrouped && this.pendingMoveGroup !== null) {
      // Grouped move: collect into pending group
      this.pendingMoveGroup.push(moveEntry);
    } else {
      // Single move: record immediately
      this.markCaretBeforeChange();
      this.recordMoveForUndo([moveEntry]);
    }
  }

  /**
   * Capture the current caret position as a snapshot.
   * @returns CaretSnapshot or null if no block is focused
   */
  public captureCaretSnapshot(): CaretSnapshot | null {
    // Guard against being called before Blok is fully initialized
    if (this.blok === undefined || this.blok.BlockManager === undefined) {
      return null;
    }

    const { BlockManager } = this.blok;
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

    const { BlockManager, Caret } = this.blok;
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
   * Check if there is a pending boundary waiting for timeout.
   * @returns true if a boundary character was typed and hasn't timed out yet
   */
  public hasPendingBoundary(): boolean {
    return this.pendingBoundary;
  }

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
    }, BOUNDARY_TIMEOUT_MS);
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

    if (elapsed >= BOUNDARY_TIMEOUT_MS) {
      this.stopCapturing();
      this.clearBoundary();
    }
  }

  /**
   * Export isBoundaryCharacter for use by YjsManager
   */
  public static readonly isBoundaryCharacter = isBoundaryCharacter;

  /**
   * Clear all history stacks (move, caret, and Yjs UndoManager) and pending state.
   * Used when loading new data or destroying the manager.
   */
  public clear(): void {
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
   * Cleanup on destroy.
   */
  public destroy(): void {
    this.clear();
    this.undoManager.destroy();
  }
}
