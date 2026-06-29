import * as Y from 'yjs';

import { getCaretOffset } from '../../../components/utils/caret/index';
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

  /**
   * Callback to restore a block's parent during move-undo/move-redo.
   *
   * Must not record its own history entry — the call is part of replaying
   * an existing `SingleMoveEntry`. Set by YjsManager to route through
   * `transactWithoutCapture` + a direct in-memory reparent.
   */
  private parentRestoreCallback: (blockId: string, parentId: string | null) => void;

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
    this.parentRestoreCallback = () => {
      // Placeholder, will be set by setParentRestoreCallback
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
   * Set the parent-restore callback used by move-undo/move-redo to rewind
   * drag-reparent side effects. See `parentRestoreCallback`.
   */
  public setParentRestoreCallback(
    callback: (blockId: string, parentId: string | null) => void
  ): void {
    this.parentRestoreCallback = callback;
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
        const entry: CaretHistoryEntry = {
          before: this.pendingCaretBefore,
          after: this.captureCaretSnapshot(),
          kind: 'edit',
        };

        this.caretUndoStack.push(entry);
        // Clear redo stack on new action (standard undo/redo behavior)
        this.caretRedoStack = [];

        // Defense-in-depth backstop for "redo caret does not catch up to the new
        // block". This listener runs mid-transaction, BEFORE a structural handler
        // (Enter split, paste, tool insert) calls Caret.setToBlock on the newly
        // created block — so `after` above still points at the original block.
        // Re-capture once the synchronous gesture has settled focus, making redo
        // land on the right block AUTOMATICALLY for every tool, instead of relying
        // on each handler to remember updateLastCaretAfterPosition() by hand.
        this.scheduleAfterSnapshotRefresh(entry);
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
        const lastEntry = this.caretUndoStack[this.caretUndoStack.length - 1];

        // Backfill the 'before' position if the initial capture failed
        // (e.g., for table cell paragraphs where the debounced selectionchange
        // hadn't set currentBlock yet when the first character was typed)
        if (lastEntry.before === null && this.pendingCaretBefore !== null) {
          lastEntry.before = this.pendingCaretBefore;
        }

        // Update the 'after' position of the most recent undo entry
        lastEntry.after = this.captureCaretSnapshot();
      }

      this.resetPendingCaretState();
    });
  }

  /**
   * Re-capture the "after" snapshot of a freshly recorded undo entry once the
   * current synchronous gesture has settled focus.
   *
   * Yjs fires `stack-item-added` mid-transaction, before control returns to the
   * handler that created the block and moved the caret into it. A microtask
   * drains after that handler completes (still before any user interaction or
   * undo/redo), so by then `Caret.setToBlock` has run and the live selection
   * reflects where the caret truly ended up. Updating the captured entry there
   * is what makes redo restore the caret to the new block for ANY tool — the
   * generalized form of the per-handler updateLastCaretAfterPosition() calls.
   *
   * The scheduled entry's identity is checked against the current top of the
   * stack so a later unrelated entry can't be clobbered if more changes land
   * before the drain.
   */
  private scheduleAfterSnapshotRefresh(entry: CaretHistoryEntry): void {
    queueMicrotask(() => {
      // Never fight an in-flight undo/redo (it owns caret restoration).
      if (this.isPerformingUndoRedo) {
        return;
      }

      // Only refresh while the scheduled entry is still the most recent one — if
      // another change (or a clear) landed before this microtask drained, leave
      // it alone rather than rewriting an unrelated entry.
      const lastIndex = this.caretUndoStack.length - 1;

      if (lastIndex < 0 || this.caretUndoStack[lastIndex] !== entry) {
        return;
      }

      const settled = this.captureCaretSnapshot();

      // Never downgrade a good snapshot to null if focus has since left every
      // block (e.g. moved to a toolbar control) by the time the microtask runs.
      if (settled !== null) {
        this.caretUndoStack[lastIndex].after = settled;
      }
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
    // Save scroll position before DOM manipulation. Removing focused elements
    // from the DOM (e.g., undoing an Enter in a table cell removes cell paragraph
    // blocks) can cause the browser to scroll to the top. We restore scroll after
    // caret restoration to catch cases where the referenced block no longer exists.
    const savedScrollY = window.scrollY;

    // The caret stack interleaves moves and Yjs edits in chronological order, so
    // its top entry tells us which timeline the most recent operation belongs to.
    // Unwind that one — keeping undo strictly reverse-chronological even when a
    // move is sandwiched between text edits (otherwise moves were always undone
    // first, regardless of when they happened).
    const lastWasMove = this.caretUndoStack[this.caretUndoStack.length - 1]?.kind === 'move';
    const lastMoveGroup = lastWasMove ? this.moveUndoStack.pop() : undefined;

    if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
      // Push to redo stack for potential redo
      this.moveRedoStack.push(lastMoveGroup);

      // Reverse all moves in the group, in reverse order.
      // This is crucial for multi-block moves to restore correctly.
      //
      // Drag-reparent entries may additionally carry `fromParentId`; restore
      // the parent BEFORE the position so the block lands in the correct
      // flat-array slot relative to its (soon-to-be-restored) parent siblings.
      [...lastMoveGroup].reverse().forEach((move) => {
        this.replayMoveUndo(move);
      });

      // Pop caret entry only after move succeeds
      const caretEntry = this.caretUndoStack.pop();

      this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');
      this.restoreScrollIfJumped(savedScrollY);

      return;
    }

    // No move to undo, delegate to Yjs UndoManager
    this.performYjsUndoRedo(() => this.undoManager.undo());

    // Pop caret entry only after Yjs undo succeeds
    const caretEntry = this.caretUndoStack.pop();

    this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');
    this.restoreScrollIfJumped(savedScrollY);
  }

  /**
   * Redo the last undone operation.
   * Checks move stack first since moves are handled separately from Yjs UndoManager.
   * Restores caret position after the redo operation.
   */
  public redo(): void {
    // Save scroll position before DOM manipulation (same rationale as undo).
    const savedScrollY = window.scrollY;

    // Mirror undo(): the caret redo stack's top entry tells us whether the next
    // redo is a move or a Yjs edit, so they replay in the same chronological order
    // they were undone.
    const nextIsMove = this.caretRedoStack[this.caretRedoStack.length - 1]?.kind === 'move';
    const lastMoveGroup = nextIsMove ? this.moveRedoStack.pop() : undefined;

    if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
      // Push back to undo stack
      this.moveUndoStack.push(lastMoveGroup);

      // Redo all moves in the group, in original order. Drag-reparent
      // entries restore the destination parent AFTER the position so that
      // the flat-array splice settles first and the parent's contentIds
      // then re-attach cleanly.
      for (const move of lastMoveGroup) {
        this.replayMoveRedo(move);
      }

      // Pop caret entry only after move succeeds
      const caretEntry = this.caretRedoStack.pop();

      this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');
      this.restoreScrollIfJumped(savedScrollY);

      return;
    }

    // No move to redo, delegate to Yjs UndoManager
    this.performYjsUndoRedo(() => this.undoManager.redo());

    // Pop caret entry only after Yjs redo succeeds
    const caretEntry = this.caretRedoStack.pop();

    this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');
    this.restoreScrollIfJumped(savedScrollY);
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

    // Use the requested position, falling back to the other one when the
    // requested snapshot wasn't captured (e.g., the debounced selectionchange
    // hadn't set currentBlock for table cell paragraphs).
    // The fallback offset will be clamped to the actual text length by the
    // caret restore logic, so the caret ends up at a reasonable position.
    const snapshot = position === 'before'
      ? entry.before ?? entry.after
      : entry.after ?? entry.before;

    this.restoreCaretSnapshot(snapshot);
  }

  /**
   * Replay a single move entry in the undo direction.
   * Parent restore runs BEFORE the position restore so the block lands in
   * the correct slot relative to its (soon-to-be-restored) parent siblings.
   */
  private replayMoveUndo(move: SingleMoveEntry): void {
    if (move.fromParentId !== undefined) {
      this.parentRestoreCallback(move.blockId, move.fromParentId);
    }

    if (move.fromIndex !== -1) {
      this.moveCallback(move.blockId, move.fromIndex, 'move-undo');
    }
  }

  /**
   * Replay a single move entry in the redo direction.
   * Position restore runs BEFORE the parent restore so the flat-array splice
   * settles first and the destination parent's contentIds re-attach cleanly.
   */
  private replayMoveRedo(move: SingleMoveEntry): void {
    if (move.toIndex !== -1) {
      this.moveCallback(move.blockId, move.toIndex, 'move-redo');
    }

    if (move.toParentId !== undefined) {
      this.parentRestoreCallback(move.blockId, move.toParentId);
    }
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
      kind: 'move',
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
   * Attach a parent change to the in-flight move entry (or create a
   * parent-only entry if the block hasn't been moved inside the group yet).
   *
   * Used by drag-reparent so that `undo` restores the parent relationship
   * atomically with the array move. The caller (`BlockManager.setBlockParent`
   * when `YjsManager.isInMoveGroup` is true) is responsible for writing the
   * parentId/contentIds to Yjs through `transactWithoutCapture` so the
   * Y.UndoManager does not also record the change.
   * @param blockId - id of the reparented block
   * @param fromParentId - parent id before the reparent (null for root)
   * @param toParentId - parent id after the reparent (null for root)
   */
  public recordParentChangeForPendingMove(
    blockId: string,
    fromParentId: string | null,
    toParentId: string | null
  ): void {
    if (this.pendingMoveGroup === null) {
      // Not inside a move group — nothing to attach to. Drop the hint.
      return;
    }

    const existing = this.pendingMoveGroup.find(
      entry => entry.blockId === blockId
    );

    if (existing !== undefined) {
      // Preserve the earliest known `fromParentId` (first write wins — that's
      // the parent BEFORE the drag started). Always update `toParentId` to
      // the most recent write.
      if (existing.fromParentId === undefined) {
        existing.fromParentId = fromParentId;
      }
      existing.toParentId = toParentId;

      return;
    }

    // No matching move entry yet (e.g. a same-index reparent within a toggle
    // body, where DragController calls setBlockParent without a prior move).
    // Push a parent-only entry with identical from/to indices so the undo
    // walker still has something to unwind.
    this.pendingMoveGroup.push({
      blockId,
      fromIndex: -1,
      toIndex: -1,
      fromParentId,
      toParentId,
    });
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

    // Prefer the block the caret is *actually* in (the live DOM selection) over
    // `BlockManager.currentBlock`. The latter is updated by a debounced (180ms)
    // selectionchange handler, so it can lag behind the real caret — e.g. when
    // the caret just moved into another block and an undoable change fires before
    // the debounce. Trusting the stale block records a snapshot whose blockId
    // belongs to one block while the offset is read from another, sending the
    // caret to the wrong block on undo/redo.
    //
    // Resolution must stay side-effect free: this runs inside the Yjs
    // `stack-item-added` / `stack-item-updated` listeners (mid-transaction), so
    // it uses the read-only `getBlockByChildNode` rather than
    // `setCurrentBlockByChildNode`, which would mutate `currentBlockIndex` and
    // corrupt in-flight merge/undo operations.
    //
    // Fall back to currentBlock when there is no in-block selection (e.g. focus
    // is on a toolbar control, or selectionchange hasn't set it yet for nested
    // blocks like table cell paragraphs).
    const anchorNode = window.getSelection()?.anchorNode ?? null;
    const selectionBlock = anchorNode !== null
      ? BlockManager.getBlockByChildNode(anchorNode)
      : undefined;

    const currentBlock = selectionBlock ?? BlockManager.currentBlock;

    if (currentBlock === undefined) {
      return null;
    }

    // When the snapshot comes from the live selection, derive the input + offset
    // from that same selection so the inputIndex/offset stay consistent with the
    // block id (a multi-input block records the input the caret is actually in).
    // Otherwise fall back to the block's tracked current input.
    const selectedIndex = selectionBlock !== undefined && anchorNode !== null
      ? currentBlock.inputs.findIndex(
        candidate => candidate === anchorNode || candidate.contains(anchorNode)
      )
      : -1;

    const inputIndex = selectedIndex !== -1 ? selectedIndex : currentBlock.currentInputIndex;
    const input = selectedIndex !== -1 ? currentBlock.inputs[selectedIndex] : currentBlock.currentInput;

    const offset = input !== undefined ? getCaretOffset(input) : 0;

    return {
      blockId: currentBlock.id,
      inputIndex,
      offset,
    };
  }

  /**
   * Mark the caret position before a change starts.
   * Call this before any operation that might be undoable.
   *
   * By default only the first call captures; subsequent calls are ignored until
   * the pending state is reset (when a change is recorded). This dedupes the
   * keydown + beforeinput pair for one keystroke and, crucially, prevents a
   * change's own follow-up writes (e.g. the deferred `syncBlockDataToYjs` after
   * an Enter split) from overwriting the genuine pre-change caret with the
   * post-change one.
   *
   * @param force - When true, always (re)capture, discarding any existing
   *   pending snapshot. Pass this from keyboard gesture handlers (keydown /
   *   beforeinput): a new gesture means the caret-before is the caret *now*, so
   *   a stale pending left dangling by a prior operation's no-op follow-up write
   *   must not survive into this one. Without it, the caret would restore to that
   *   stale position (e.g. the start of the wrong block) on undo.
   */
  public markCaretBeforeChange(force = false): void {
    if (this.hasPendingCaret && !force) {
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
   * Restore scroll position if it jumped far from the original position.
   * This catches cases where caret restoration focused a distant block
   * (e.g., the referenced block was removed during undo and the fallback
   * set focus to the first block at the top of the article).
   */
  private restoreScrollIfJumped(savedScrollY: number): void {
    if (Math.abs(window.scrollY - savedScrollY) > window.innerHeight) {
      window.scrollTo(0, savedScrollY);
    }
  }

  /**
   * Restore caret position from a snapshot.
   * Handles edge cases: null snapshot, deleted block, invalid input index,
   * and disconnected inputs (e.g., after table DOM rebuild during undo).
   */
  private restoreCaretSnapshot(snapshot: CaretSnapshot | null): void {
    if (snapshot === null) {
      // No snapshot available — preserve whatever focus state exists after the
      // DOM update rather than actively destroying the selection.
      return;
    }

    const { BlockManager, Caret } = this.blok;
    const block = BlockManager.getBlockById(snapshot.blockId);

    // Block no longer exists. Do NOT yank the caret to the first block at the
    // document START — that is the user-visible "caret jumps to the very
    // beginning on undo/redo" bug. The snapshot recorded a position deep in the
    // document; teleporting to the top is never the right recovery and loses the
    // user's place. Preserve whatever focus state exists after the DOM update
    // instead (same philosophy as the null-snapshot branch above).
    if (block === undefined) {
      return;
    }

    // Get the specific input within the block
    const input = block.inputs[snapshot.inputIndex];

    if (input !== undefined && input.isConnected) {
      Caret.setToInput(input, Caret.positions.DEFAULT, snapshot.offset);
      return;
    }

    // Input is disconnected or doesn't exist (e.g., the block was removed from
    // a table cell during undo but still exists in BlockManager). Try to find
    // a connected sibling block in the same parent context.
    if (block.parentId != null) {
      const lastConnectedSibling = BlockManager.blocks
        .filter(b => b.parentId === block.parentId && b.id !== block.id && b.inputs.length > 0 && b.inputs[0].isConnected)
        .at(-1);

      if (lastConnectedSibling !== undefined) {
        Caret.setToBlock(lastConnectedSibling, Caret.positions.END);
        return;
      }

      // No connected siblings — try the parent block itself
      const parentBlock = BlockManager.getBlockById(block.parentId);

      if (parentBlock !== undefined) {
        Caret.setToBlock(parentBlock, Caret.positions.START);
        return;
      }
    }

    // Fall back to block start
    Caret.setToBlock(block, Caret.positions.START);
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
   *
   * Notion coalesces a continuous typing run into a SINGLE undo step, broken
   * only by a pause longer than the Yjs capture window (CAPTURE_TIMEOUT_MS) or a
   * structural operation. So this no longer forces a per-word checkpoint: the
   * boundary state is still tracked (and auto-cleared after BOUNDARY_TIMEOUT_MS)
   * for callers that inspect it, but the timer must NOT call stopCapturing().
   */
  public markBoundary(): void {
    this.pendingBoundary = true;
    this.boundaryTimestamp = Date.now();

    // Clear any existing timeout
    if (this.boundaryTimeoutId !== null) {
      clearTimeout(this.boundaryTimeoutId);
    }

    // Clear the pending boundary after the idle window, WITHOUT creating a
    // checkpoint (the per-word checkpoint was the non-Notion divergence).
    this.boundaryTimeoutId = setTimeout(() => {
      this.pendingBoundary = false;
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
   * Check if a pending boundary has timed out and clear it if so.
   * Called on each keystroke to handle the case where the user resumes typing
   * after a pause longer than BOUNDARY_TIMEOUT_MS.
   *
   * No longer creates an undo checkpoint: Notion keeps a typing run as one undo
   * step regardless of word boundaries (run-breaking is left to the Yjs capture
   * window and structural ops). This only tidies up the pending-boundary state.
   */
  public checkAndHandleBoundary(): void {
    if (!this.pendingBoundary) {
      return;
    }

    const elapsed = Date.now() - this.boundaryTimestamp;

    if (elapsed >= BOUNDARY_TIMEOUT_MS) {
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
