import * as Y from 'yjs';

import { getCaretOffset } from '../../../components/utils/caret/index';
import type { BlokModules } from '../../../types-internal/blok-modules';

import { CAPTURE_TIMEOUT_MS, BOUNDARY_TIMEOUT_MS } from './serializer';
import type { BlockPlacement, CaretSnapshot, CaretHistoryEntry, MoveHistoryEntry, MoveReplayCallback, SingleMoveEntry, UndoScopeType } from './types';

type StackItem = Y.UndoManager['undoStack'][number];

interface StackItemEvent {
  type: 'undo' | 'redo';
  stackItem: StackItem;
}

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
   * Undo manager for history operations.
   *
   * Backed by a field rather than a readonly property because a lineage reset
   * swaps the whole Y.Doc: an UndoManager is bound to its scope's document at
   * construction, so it has to be rebuilt (see {@link rebindScope}).
   */
  private currentUndoManager: Y.UndoManager;

  /**
   * The live undo manager. Callers MUST read it through this getter rather
   * than caching it — `rebindScope` replaces the instance.
   */
  public get undoManager(): Y.UndoManager {
    return this.currentUndoManager;
  }

  /**
   * Blok modules (for caret operations)
   */
  private blok: BlokModules;

  /**
   * Move history, kept apart from Y.UndoManager: to yjs a move is a
   * delete+insert, which undoes as a resurrection rather than a move. Each
   * entry is one group undone together.
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
   * The caret entry recorded for each yjs stack item, by identity. One
   * `undo()` can pop SEVERAL items — yjs skips an item whose changes a peer
   * has since deleted and keeps popping until one performs a change — so
   * the caret stacks shed exactly the entries whose items left the yjs
   * stack, never "the top one".
   */
  private readonly entryByStackItem = new WeakMap<StackItem, CaretHistoryEntry>();

  /**
   * The item the in-flight undo/redo transaction added to the opposite yjs
   * stack; the caret entry carried across is keyed to it.
   */
  private replayStackItem: StackItem | null = null;

  /**
   * The popped item that actually changed the document during the in-flight
   * undo/redo — the one whose caret entry is worth restoring.
   */
  private poppedStackItem: StackItem | null = null;

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
   * The ONE placement callback replaying a recorded move step (parent
   * restore + position) during move-undo/move-redo.
   *
   * Must not record its own history entry — the call is part of replaying
   * an existing `SingleMoveEntry`. Set by YjsManager.
   */
  private placementCallback: MoveReplayCallback;

  /**
   * Flush barrier for coalesced typing writes (see BlockWriteBuffer). Runs at
   * the START of stopCapturing/undo/redo so buffered writes join the capture
   * group being closed or unwound. Living here (not only on YjsManager) is
   * load-bearing: the 100ms word-boundary timer calls stopCapturing internally,
   * and without the flush-first ordering a 400ms trailing write could land
   * AFTER the boundary split it belongs before.
   */
  private flushPendingWritesHook: () => void = () => {
    // No-op until YjsManager wires the write buffer.
  };

  constructor(
    scope: UndoScopeType[],
    blok: BlokModules
  ) {
    this.blok = blok;

    this.currentUndoManager = this.createUndoManager(scope);

    this.setupCaretTracking();

    // Placement callback will be set by YjsManager
    this.placementCallback = () => {
      // Placeholder, will be set by setPlacementCallback
    };
  }

  /**
   * Build an UndoManager over the given roots. One place, so the constructor
   * and {@link rebindScope} can never drift on captureTimeout / trackedOrigins.
   * @param scope - the shared types to track
   */
  private createUndoManager(scope: UndoScopeType[]): Y.UndoManager {
    return new Y.UndoManager(scope, {
      captureTimeout: CAPTURE_TIMEOUT_MS,
      trackedOrigins: new Set(['local']),
    });
  }

  /**
   * Rebuild the undo manager over a NEW document's roots (lineage reset).
   *
   * Deliberately does NOT call `clear()`: `Y.UndoManager.clear` transacts on its
   * document, and by the time this runs the old document is already destroyed.
   * The caller clears the history BEFORE the swap — see
   * `YjsManager.resetForRelineage`, whose step order this method depends on.
   *
   * Caret tracking is re-armed here because its listeners live on the manager
   * instance that is being replaced.
   * @param scope - the fresh document's shared types
   */
  public rebindScope(scope: UndoScopeType[]): void {
    this.currentUndoManager.destroy();
    this.currentUndoManager = this.createUndoManager(scope);

    this.setupCaretTracking();
  }

  /**
   * Set the placement callback used by move-undo/move-redo to replay
   * recorded moves. See `placementCallback`.
   */
  public setPlacementCallback(callback: MoveReplayCallback): void {
    this.placementCallback = callback;
  }

  /**
   * Set the Blok modules. Called when Blok modules are initialized.
   */
  public setBlok(blok: BlokModules): void {
    this.blok = blok;
  }

  /**
   * Set the flush barrier for coalesced typing writes.
   * See `flushPendingWritesHook`.
   */
  public setFlushPendingWritesHook(hook: () => void): void {
    this.flushPendingWritesHook = hook;
  }

  /**
   * Set up caret tracking via Yjs UndoManager events.
   * Captures caret position after each undoable change.
   */
  private setupCaretTracking(): void {
    this.undoManager.on('stack-item-added', (event: StackItemEvent) => {
      // Skip if we're in the middle of an explicit undo/redo operation.
      // During redo, Yjs fires stack-item-added with type='undo' which would
      // incorrectly add entries to our caret stack.
      if (this.isPerformingUndoRedo) {
        this.replayStackItem = event.stackItem;

        return;
      }

      if (event.type === 'undo') {
        // New undo entry was created - record caret positions
        const entry: CaretHistoryEntry = {
          before: this.pendingCaretBefore,
          after: this.captureCaretSnapshot(),
          kind: 'edit',
        };

        this.entryByStackItem.set(event.stackItem, entry);
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

    this.undoManager.on('stack-item-popped', (event: StackItemEvent) => {
      this.poppedStackItem = event.stackItem;
    });

    // Listen for stack-item-updated to update the 'after' position when changes
    // are merged into an existing stack item (due to captureTimeout batching).
    this.undoManager.on('stack-item-updated', (event: StackItemEvent) => {
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
    // Land buffered typing writes first so they are part of the group we pop.
    this.flushPendingWritesHook();

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
      // Each entry replays its full FROM placement (parent + preceding
      // sibling) through the one placement callback.
      [...lastMoveGroup].reverse().forEach((move) => {
        this.placementCallback(move.blockId, move.from, 'move-undo');
      });

      // Pop caret entry only after move succeeds
      const caretEntry = this.caretUndoStack.pop();

      this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');
      this.restoreScrollIfJumped(savedScrollY);

      return;
    }

    // No move to undo, delegate to Yjs UndoManager
    this.performYjsUndoRedo(() => this.undoManager.undo());

    const caretEntry = this.settleReplayedEntries(this.caretUndoStack, this.undoManager.undoStack);

    this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');
    this.restoreScrollIfJumped(savedScrollY);
  }

  /**
   * Redo the last undone operation.
   * Checks move stack first since moves are handled separately from Yjs UndoManager.
   * Restores caret position after the redo operation.
   */
  public redo(): void {
    // Same barrier as undo: buffered writes must not outlive the replay.
    this.flushPendingWritesHook();

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

      // Redo all moves in the group, in original order: each entry
      // replays its full TO placement through the placement callback.
      for (const move of lastMoveGroup) {
        this.placementCallback(move.blockId, move.to, 'move-redo');
      }

      // Pop caret entry only after move succeeds
      const caretEntry = this.caretRedoStack.pop();

      this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');
      this.restoreScrollIfJumped(savedScrollY);

      return;
    }

    // No move to redo, delegate to Yjs UndoManager
    this.performYjsUndoRedo(() => this.undoManager.redo());

    const caretEntry = this.settleReplayedEntries(this.caretRedoStack, this.undoManager.redoStack);

    this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');
    this.restoreScrollIfJumped(savedScrollY);
  }

  /**
   * After a yjs undo/redo: drop every non-move entry whose stack item is no
   * longer on `live` (move entries belong to the move stacks and stay), and
   * return the entry to carry to the opposite caret stack — the popped
   * item's own when one performed a change, else the newest shed entry.
   * That entry is keyed to the item the replay added, so the next press in
   * the other direction can settle it the same way.
   * @param entries - the caret stack that was just unwound
   * @param live - the yjs stack it mirrors, after the replay
   */
  private settleReplayedEntries(entries: CaretHistoryEntry[], live: readonly StackItem[]): CaretHistoryEntry | undefined {
    const liveEntries = new Set(live.map((item) => this.entryByStackItem.get(item)));
    const shed = new Set(entries.filter((entry) => entry.kind !== 'move' && !liveEntries.has(entry)));

    entries.splice(0, entries.length, ...entries.filter((entry) => !shed.has(entry)));

    const performed = this.poppedStackItem === null ? undefined : this.entryByStackItem.get(this.poppedStackItem);
    const carried = performed ?? [...shed].at(-1);

    if (carried !== undefined && this.replayStackItem !== null) {
      this.entryByStackItem.set(this.replayStackItem, carried);
    }

    return carried;
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
   * Execute a Yjs UndoManager operation with the isPerformingUndoRedo flag set.
   * This prevents the stack-item-added listener from modifying caret stacks during
   * explicit undo/redo operations.
   */
  private performYjsUndoRedo(operation: () => void): void {
    this.isPerformingUndoRedo = true;
    this.replayStackItem = null;
    this.poppedStackItem = null;
    try {
      operation();
    } finally {
      this.isPerformingUndoRedo = false;
    }
  }

  /**
   * Re-anchor the capture-merge clock to when the change actually happened.
   *
   * A coalesced trailing flush transacts up to 400ms after the typing it
   * carries; Y.UndoManager stamps `lastChange` with the FLUSH time, so the
   * captureTimeout would measure the next action's gap from the flush and
   * merge actions the user separated by more than the capture window (two
   * typing pauses, or typing followed by a tune change). Rewind only —
   * never push the clock forward, and never touch the `0` sentinel a
   * stopCapturing leaves (`0` means "always split next"; every real
   * timestamp exceeds a rewind target).
   * @param toTime - the wall-clock time of the flushed writes' last enqueue
   */
  public rewindCaptureClock(toTime: number): void {
    if (this.undoManager.lastChange > toTime) {
      this.undoManager.lastChange = toTime;
    }
  }

  /**
   * Re-open the newest undo entry when the block about to be replaced is one
   * that very entry created.
   *
   * A replace-insert removes the block it replaces (see `BlockInsertion`), and
   * Y.UndoManager only skips resurrecting a deleted item when the SAME stack
   * item also holds its insertion. A scaffold slot — the empty paragraph the
   * plus button builds before the toolbox opens — is created in one entry and
   * replaced in the next as soon as the user takes longer than `captureTimeout`
   * to pick a tool, so undoing the pick brought the scaffold back and the
   * gesture needed two presses. Merging the two makes it one press again, and
   * redo then restores only the chosen block.
   *
   * The check is exact, not a heuristic: only a block whose creation is still
   * the newest entry never existed as a state of its own. A slot the user made
   * earlier (their own Enter, then typing) or one that came from the loaded
   * document is buried under later entries — no merge, and undo restores it.
   * @param creationId - id of the Y item holding the block, or null when the
   *   block is not in the doc
   */
  public continueEntryThatCreated(creationId: Y.ID | null): void {
    const { undoStack } = this.undoManager;
    const newestEntry = undoStack[undoStack.length - 1];

    if (creationId === null || newestEntry === undefined) {
      return;
    }

    if (!Y.isDeleted(newestEntry.insertions, creationId)) {
      return;
    }

    this.undoManager.lastChange = Date.now();
  }

  /**
   * Stop capturing changes into current undo group.
   * Call this to force next change into a new undo entry.
   */
  public stopCapturing(): void {
    // Flush BEFORE closing the group: a word-boundary checkpoint must carry
    // the buffered tail of the word it ends (100ms boundary vs 400ms trailing).
    this.flushPendingWritesHook();

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
    // A nested call rides the open group; starting another would discard
    // the moves collected so far.
    if (this.pendingMoveGroup !== null) {
      fn();

      return;
    }

    this.startMoveGroup();
    try {
      fn();
    } finally {
      this.endMoveGroup();
    }
  }

  /**
   * Record a move operation. Called by YjsManager during moveBlock.
   * The entry's `from` placement must be captured from the doc BEFORE the
   * mutation and `to` after it.
   * @param entry - Move entry carrying both placements
   * @param isGrouped - Whether this is part of a grouped move operation
   */
  public recordMove(entry: SingleMoveEntry, isGrouped: boolean): void {
    if (isGrouped && this.pendingMoveGroup !== null) {
      // Grouped move: collect into pending group
      this.pendingMoveGroup.push(entry);
    } else {
      // Single move: record immediately
      this.markCaretBeforeChange();
      this.recordMoveForUndo([entry]);
    }
  }

  /**
   * Attach a reparent to the in-flight move entry (or create a parent-only
   * entry if the block hasn't been moved inside the group yet).
   *
   * Used by drag-reparent so that `undo` restores the parent relationship
   * atomically with the position. The caller (`BlockManager.setBlockParent`
   * when `YjsManager.isInMoveGroup` is true) is responsible for writing the
   * placement to Yjs through the no-capture flavor so the Y.UndoManager
   * does not also record the change.
   * @param blockId - id of the reparented block
   * @param from - the block's doc placement BEFORE the reparent write
   * @param to - the placement the reparent wrote
   */
  public recordParentChangeForPendingMove(
    blockId: string,
    from: BlockPlacement,
    to: BlockPlacement
  ): void {
    if (this.pendingMoveGroup === null) {
      // Not inside a move group — nothing to attach to. Drop the hint.
      return;
    }

    const existing = this.pendingMoveGroup.find(
      entry => entry.blockId === blockId
    );

    if (existing !== undefined) {
      // `from` is first-write-wins: the entry's existing `from` is the
      // placement BEFORE the drag started (a mid-group flat move already
      // displaced the block, so `from` here would be wrong). Only `to`
      // advances to the most recent write.
      existing.to = to;

      return;
    }

    // No matching move entry yet (e.g. a same-slot reparent within a toggle
    // body, where DragController calls setBlockParent without a prior move).
    this.pendingMoveGroup.push({ blockId, from, to });
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
    this.replayStackItem = null;
    this.poppedStackItem = null;
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
