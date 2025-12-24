/**
 * @class History
 * @classdesc Manages undo/redo functionality using state snapshots
 * @module History
 */
import { Module } from '../__module';
import type { OutputData, OutputBlockData } from '../../../types';
import { BlockChanged, HistoryStateChanged } from '../events';
import type { BlockMutationEvent } from '../../../types/events/block';
import { Shortcuts } from '../utils/shortcuts';
import type { Block } from '../block';
import { SmartGrouping } from './history/smart-grouping';
import type { ActionType } from './history/types';
import { Dom as $ } from '../dom';

/**
 * Default maximum history stack size
 */
const DEFAULT_MAX_HISTORY_LENGTH = 30;

/**
 * Default debounce time for content changes (ms)
 */
const DEFAULT_DEBOUNCE_TIME = 300;

/**
 * Default new group delay (ms)
 * If user pauses typing for this duration, a checkpoint is created
 */
const DEFAULT_NEW_GROUP_DELAY = 500;

/**
 * Time to wait after restore before accepting new changes (ms)
 * This prevents late-firing events from corrupting history
 */
const RESTORE_COOLDOWN_TIME = 100;

/**
 * Configuration interface for History module
 */
interface HistoryConfig {
  maxHistoryLength?: number;
  historyDebounceTime?: number;
  newGroupDelay?: number;
  globalUndoRedo?: boolean;
}

/**
 * Represents caret position for restoration after undo/redo
 */
interface CaretPosition {
  /**
   * ID of the block containing the caret
   */
  blockId: string;

  /**
   * Index of the block in the editor at capture time.
   * Used as fallback when blockId lookup fails (e.g., block was deleted).
   */
  blockIndex: number;

  /**
   * Index of the input element within the block
   */
  inputIndex: number;

  /**
   * Character offset within the input (start of selection or cursor position)
   */
  offset: number;

  /**
   * End offset of the selection within the input.
   * If undefined or equal to offset, the selection is collapsed (just a cursor).
   */
  endOffset?: number;
}

/**
 * History entry representing a document state
 */
interface HistoryEntry {
  /**
   * The document state snapshot
   */
  state: OutputData;

  /**
   * Timestamp when this entry was created
   */
  timestamp: number;

  /**
   * Caret position at the time of the snapshot
   */
  caretPosition?: CaretPosition;
}

/**
 * History module for undo/redo functionality
 *
 * Uses state snapshots approach:
 * - Captures full document state after mutations
 * - Debounces rapid changes (typing) into single undo steps
 * - Provides keyboard shortcuts (Cmd+Z / Cmd+Shift+Z)
 */
export class History extends Module {
  /**
   * Tracks which History instance should respond to global shortcuts.
   * Set to the instance that last received a block mutation.
   */
  private static activeInstance: History | null = null;

  /**
   * Stack of past states for undo
   */
  private undoStack: HistoryEntry[] = [];

  /**
   * Stack of future states for redo
   */
  private redoStack: HistoryEntry[] = [];

  /**
   * Shortcut names registered on document for cleanup
   */
  private registeredShortcuts: Array<{ name: string; element: HTMLElement | Document }> = [];

  /**
   * Debounce timeout for batching rapid changes
   */
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Flag to prevent recording during undo/redo operations
   */
  private isPerformingUndoRedo = false;

  /**
   * Flag indicating whether initial state has been captured
   */
  private initialStateCaptured = false;

  /**
   * Smart grouping logic for determining when to create checkpoints
   */
  private smartGrouping = new SmartGrouping();

  /**
   * Current action type being tracked (for detecting action type changes)
   */
  private currentActionType: ActionType = 'insert';

  /**
   * Current inserted character being tracked (for word boundary detection)
   */
  private currentInsertedText: string | undefined = undefined;

  /**
   * Keydown handler reference for cleanup
   */
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Selection change handler reference for cleanup
   */
  private selectionChangeHandler: (() => void) | null = null;

  /**
   * Pending caret position - captured on keydown (before mutation) or selection change (fallback)
   * This ensures we always have the caret position from BEFORE any mutation
   */
  private pendingCaretPosition: CaretPosition | undefined = undefined;

  /**
   * Flag indicating whether keydown already captured the position for the current action.
   * This prevents selectionchange from overwriting the correct pre-mutation position.
   */
  private keydownCapturedPosition = false;

  /**
   * Flag indicating whether we've already captured the caret position for the current action group.
   * This ensures we only capture the position from the FIRST mutation in a group,
   * not from subsequent mutations that are grouped together by debouncing.
   *
   * Without this, when deleting multiple characters (e.g., "Привет" → "При"),
   * each backspace would update pendingCaretPosition, and the last position (4)
   * would be stored instead of the first position (6, end of "Привет").
   */
  private hasCapturedGroupPosition = false;

  /**
   * Batch depth counter for grouping multiple operations into a single undo step.
   * When > 0, mutations are accumulated but not recorded until batch ends.
   * Supports nested batches - only the outermost batch triggers recording.
   */
  private batchDepth = 0;

  /**
   * Flag indicating whether any mutations occurred during the current batch.
   * Used to determine if state should be recorded when batch ends.
   */
  private batchHasMutations = false;

  /**
   * Generation counter for batches.
   * Incremented when a batch completes. Used to detect stale recordState() calls
   * that were scheduled before a batch started but run after it ended.
   */
  private batchGeneration = 0;

  /**
   * Timestamp of the last mutation.
   * Used for pause detection to create checkpoints when user pauses typing.
   */
  private lastMutationTime: number | null = null;

  /**
   * Maximum number of entries in history stack
   */
  private get maxHistoryLength(): number {
    const historyConfig = this.config as HistoryConfig;

    return historyConfig.maxHistoryLength ?? DEFAULT_MAX_HISTORY_LENGTH;
  }

  /**
   * Debounce time for batching changes
   */
  private get debounceTime(): number {
    const historyConfig = this.config as HistoryConfig;

    return historyConfig.historyDebounceTime ?? DEFAULT_DEBOUNCE_TIME;
  }

  /**
   * New group delay - pause duration that creates a checkpoint
   */
  private get newGroupDelay(): number {
    const historyConfig = this.config as HistoryConfig;

    return historyConfig.newGroupDelay ?? DEFAULT_NEW_GROUP_DELAY;
  }

  /**
   * Whether to use document-level shortcuts for undo/redo
   */
  private get globalUndoRedo(): boolean {
    const historyConfig = this.config as HistoryConfig;

    return historyConfig.globalUndoRedo ?? true;
  }

  /**
   * Module preparation
   * Sets up event listeners and keyboard shortcuts
   */
  public async prepare(): Promise<void> {
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.setupActionTypeTracking();
    this.setupSelectionTracking();
  }

  /**
   * Captures the initial document state
   * Should be called after rendering is complete
   *
   * Note: We don't capture caret position for the initial state.
   * The caret position will be set when the first action is recorded,
   * ensuring we restore to where the caret was before that first action.
   */
  public async captureInitialState(): Promise<void> {
    if (this.initialStateCaptured) {
      return;
    }

    const state = await this.getCurrentState();

    if (state) {
      this.undoStack = [{
        state,
        timestamp: Date.now(),
        // Note: No caretPosition here - it will be set when the next state is recorded
      }];
      this.initialStateCaptured = true;
      this.emitStateChanged();
    }
  }

  /**
   * Performs undo operation
   * @returns true if undo was performed, false if nothing to undo
   */
  public async undo(): Promise<boolean> {
    // Need at least 2 entries: current state + previous state to restore
    if (this.undoStack.length < 2) {
      // Preserve caret position when there's nothing to undo
      this.preserveCaretPosition();

      return false;
    }

    if (this.isPerformingUndoRedo) {
      return false;
    }

    this.isPerformingUndoRedo = true;
    this.clearDebounce();

    try {
      // Pop current state and push to redo stack
      const currentEntry = this.undoStack.pop();

      if (currentEntry) {
        this.redoStack.push(currentEntry);
      }

      // Get previous state to restore
      const previousEntry = this.undoStack[this.undoStack.length - 1];

      if (previousEntry) {
        // Pass both target caret position and fallback from current state
        // When a block is deleted, we want to fall back to the block preceding the deleted block
        const fallbackIndex = currentEntry?.caretPosition
          ? Math.max(0, currentEntry.caretPosition.blockIndex - 1)
          : undefined;

        // If the previous entry has no caret position (e.g., initial state),
        // use the current entry's caret position as a fallback
        const fallbackCaretPosition = !previousEntry.caretPosition
          ? currentEntry?.caretPosition
          : undefined;

        await this.restoreState(
          previousEntry.state,
          previousEntry.caretPosition,
          fallbackIndex,
          fallbackCaretPosition
        );

        // Clean up any orphaned fake background elements that may have been restored
        this.Blok.SelectionAPI.methods.clearFakeBackground();

        this.emitStateChanged();

        // Keep the flag true for a short period to ignore late events
        await this.cooldown();

        return true;
      }

      return false;
    } finally {
      this.isPerformingUndoRedo = false;
    }
  }

  /**
   * Performs redo operation
   * @returns true if redo was performed, false if nothing to redo
   */
  public async redo(): Promise<boolean> {
    if (this.redoStack.length === 0) {
      return false;
    }

    if (this.isPerformingUndoRedo) {
      return false;
    }

    this.isPerformingUndoRedo = true;
    this.clearDebounce();

    try {
      // Get the current state before popping (to use its caret as fallback)
      const currentEntry = this.undoStack[this.undoStack.length - 1];
      const entryToRestore = this.redoStack.pop();

      if (entryToRestore) {
        this.undoStack.push(entryToRestore);

        // Pass both target caret position and fallback from current state
        // When a block is deleted during redo, fall back to the block preceding the deleted block
        const fallbackIndex = currentEntry?.caretPosition
          ? Math.max(0, currentEntry.caretPosition.blockIndex - 1)
          : undefined;

        await this.restoreState(entryToRestore.state, entryToRestore.caretPosition, fallbackIndex);

        // Clean up any orphaned fake background elements that may have been restored
        this.Blok.SelectionAPI.methods.clearFakeBackground();

        this.emitStateChanged();

        // Keep the flag true for a short period to ignore late events
        await this.cooldown();

        return true;
      }

      return false;
    } finally {
      this.isPerformingUndoRedo = false;
    }
  }

  /**
   * Returns whether undo is available
   */
  public canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  /**
   * Returns whether redo is available
   */
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clears history stacks
   */
  public clear(): void {
    this.clearDebounce();
    this.undoStack = [];
    this.redoStack = [];
    this.initialStateCaptured = false;
    this.lastMutationTime = null;
    this.smartGrouping.clearContext();
    this.emitStateChanged();
  }

  /**
   * Starts a batch operation that groups multiple mutations into a single undo step.
   *
   * Use this when performing multiple related operations that should be undone together,
   * such as moving multiple blocks during a drag-and-drop operation.
   *
   * Batches can be nested - only the outermost batch triggers state recording.
   *
   * @example
   * ```typescript
   * history.startBatch();
   * try {
   *   // Multiple operations here...
   *   blockManager.move(0, 2);
   *   blockManager.move(1, 3);
   * } finally {
   *   history.endBatch();
   * }
   * ```
   */
  public startBatch(): void {
    // If this is the first batch level, capture caret position before any mutations
    if (this.batchDepth === 0) {
      this.pendingCaretPosition = this.getCaretPosition();
      this.batchHasMutations = false;
      // Reset to prevent stale pause detection after batch completes
      this.lastMutationTime = null;
      // Clear any pending debounce to ensure clean state before batch
      this.clearDebounce();
    }

    this.batchDepth++;
  }

  /**
   * Ends a batch operation and records the final state if mutations occurred.
   *
   * Must be called once for each corresponding `startBatch()` call.
   * Only the outermost `endBatch()` triggers state recording.
   */
  public endBatch(): void {
    if (this.batchDepth === 0) {
      // Mismatched endBatch call - ignore
      return;
    }

    this.batchDepth--;

    // Only process when the outermost batch ends
    if (this.batchDepth !== 0) {
      return;
    }

    // Increment the batch generation to invalidate any pending recordState() calls
    // that were scheduled before this batch started.
    this.batchGeneration++;

    if (!this.batchHasMutations) {
      return;
    }

    // Don't pass scheduledGeneration - this is a fresh call from endBatch
    void this.recordState();
    this.batchHasMutations = false;
  }

  /**
   * Returns whether a batch operation is currently in progress
   */
  public isInBatch(): boolean {
    return this.batchDepth > 0;
  }

  /**
   * Executes a function as a transaction, grouping all mutations into a single undo step.
   *
   * This is a convenience wrapper around startBatch()/endBatch() that ensures
   * proper cleanup even if the function throws an error.
   *
   * @param fn - The function to execute as a transaction. Can be sync or async.
   * @returns The result of the function
   *
   * @example
   * ```typescript
   * // Sync example
   * const result = await history.transaction(() => {
   *   blockManager.move(0, 2);
   *   blockManager.move(1, 3);
   *   return 'done';
   * });
   *
   * // Async example
   * await history.transaction(async () => {
   *   await blockManager.insert({ tool: 'paragraph', data: { text: 'Hello' } });
   *   await blockManager.insert({ tool: 'paragraph', data: { text: 'World' } });
   * });
   * ```
   */
  public async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.startBatch();
    try {
      return await fn();
    } finally {
      this.endBatch();
    }
  }

  /**
   * Sets up listeners for block mutation events
   */
  private setupEventListeners(): void {
    this.eventsDispatcher.on(BlockChanged, (payload) => {
      this.handleBlockMutation(payload.event);
    });
  }

  /**
   * Sets up keyboard shortcuts for undo/redo
   */
  private setupKeyboardShortcuts(): void {
    // Wait for UI to be ready
    setTimeout(() => {
      const redactor = this.Blok.UI?.nodes?.redactor;

      if (!redactor) {
        return;
      }

      const target = this.globalUndoRedo ? document : redactor;
      const shortcutNames = ['CMD+Z', 'CMD+SHIFT+Z', 'CMD+Y'];

      // Clear any existing undo/redo shortcuts on the target to avoid duplicate registration errors
      shortcutNames.forEach(name => Shortcuts.remove(target, name));

      // Undo: Cmd+Z (Mac) / Ctrl+Z (Windows/Linux)
      Shortcuts.add({
        name: 'CMD+Z',
        on: target,
        handler: (event: KeyboardEvent) => {
          if (!this.shouldHandleShortcut(event)) {
            return;
          }
          event.preventDefault();
          void this.undo();
        },
      });
      this.registeredShortcuts.push({ name: 'CMD+Z', element: target });

      // Redo: Cmd+Shift+Z (Mac) / Ctrl+Shift+Z (Windows/Linux)
      Shortcuts.add({
        name: 'CMD+SHIFT+Z',
        on: target,
        handler: (event: KeyboardEvent) => {
          if (!this.shouldHandleShortcut(event)) {
            return;
          }
          event.preventDefault();
          void this.redo();
        },
      });
      this.registeredShortcuts.push({ name: 'CMD+SHIFT+Z', element: target });

      // Alternative Redo: Cmd+Y (Windows convention)
      Shortcuts.add({
        name: 'CMD+Y',
        on: target,
        handler: (event: KeyboardEvent) => {
          if (!this.shouldHandleShortcut(event)) {
            return;
          }
          event.preventDefault();
          void this.redo();
        },
      });
      this.registeredShortcuts.push({ name: 'CMD+Y', element: target });
    }, 0);
  }

  /**
   * Determines whether this instance should handle the shortcut event
   * @param event - the keyboard event
   * @returns true if this instance should handle the shortcut
   */
  private shouldHandleShortcut(event: KeyboardEvent): boolean {
    // When using global shortcuts, only the active instance should respond
    if (this.globalUndoRedo && History.activeInstance !== this) {
      return false;
    }

    // Don't intercept shortcuts when focus is in native form controls outside the editor
    if (this.isNativeFormControl(event.target)) {
      return false;
    }

    return true;
  }

  /**
   * Checks if the target element is a native form control outside the editor
   * @param target - the event target
   * @returns true if target is a form control not within this editor
   */
  private isNativeFormControl(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const editorWrapper = this.Blok.UI?.nodes?.wrapper;

    // If target is inside the editor, it's not an external form control
    if (editorWrapper?.contains(target)) {
      return false;
    }

    // Check for native form controls
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return true;
    }

    // Check for contenteditable elements outside the editor
    if (target.isContentEditable) {
      return true;
    }

    return false;
  }

  /**
   * Sets up keydown tracking for action type detection and caret position capture
   *
   * IMPORTANT: We capture the caret position on keydown because this fires BEFORE
   * any DOM mutation happens. The selectionchange event fires AFTER mutations,
   * which means the caret has already moved to a new position (e.g., to a newly
   * created block after pressing Enter).
   */
  private setupActionTypeTracking(): void {
    // Wait for UI to be ready
    setTimeout(() => {
      const redactor = this.Blok.UI?.nodes?.redactor;

      if (!redactor) {
        return;
      }

      this.keydownHandler = (e: KeyboardEvent): void => {
        // Skip modifier-only keys and shortcuts that won't cause mutations
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
          return;
        }

        // Skip undo/redo shortcuts - we don't want to capture position for these
        if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
          return;
        }

        // Detect action type from key press and determine if this key causes mutations
        const isMutationKey = e.key === 'Backspace' ||
          e.key === 'Delete' ||
          e.key === 'Enter' ||
          (e.key.length === 1 && !e.ctrlKey && !e.metaKey);

        // Only capture caret position for keys that will cause mutations.
        // For navigation keys (arrows, Home, End, etc.), we let selectionchange
        // update the position after the caret moves.
        //
        // Only capture caret position for the FIRST mutation key in a group.
        // This ensures that when multiple actions are grouped (e.g., deleting "вет"),
        // we preserve the position from BEFORE the first action (end of "Привет"),
        // not from before the last action in the group.
        if (isMutationKey && !this.hasCapturedGroupPosition) {
          this.pendingCaretPosition = this.getCaretPosition();
          this.hasCapturedGroupPosition = true;
        }

        if (isMutationKey) {
          this.keydownCapturedPosition = true;
        }

        // Detect action type from key press
        if (e.key === 'Backspace') {
          this.currentActionType = 'delete-back';
          this.currentInsertedText = undefined;

          return;
        }

        if (e.key === 'Delete') {
          this.currentActionType = 'delete-fwd';
          this.currentInsertedText = undefined;

          return;
        }

        // Single character key (typing)
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          this.currentActionType = 'insert';
          // Capture the character for word boundary detection
          this.currentInsertedText = e.key;
        }
      };

      // Use capture phase to ensure we capture the caret position BEFORE
      // BlockEvents.enter() (which runs on block.holder's bubble phase) moves the caret
      redactor.addEventListener('keydown', this.keydownHandler, { capture: true });
    }, 0);
  }

  /**
   * Sets up selection change tracking as a backup for capturing caret position
   *
   * This serves as a fallback for non-keyboard actions (like paste via context menu,
   * drag-and-drop, etc.). For keyboard actions, the keydown handler captures the
   * position more reliably since it fires BEFORE any DOM mutation.
   *
   * Note: selectionchange fires AFTER DOM mutations, so for keyboard actions that
   * create new blocks (like Enter), this would capture the wrong position.
   * That's why keydown is the primary capture mechanism.
   */
  private setupSelectionTracking(): void {
    // Wait for UI to be ready
    setTimeout(() => {
      const redactor = this.Blok.UI?.nodes?.redactor;

      if (!redactor) {
        return;
      }

      this.selectionChangeHandler = (): void => {
        // If keydown already captured the position for this action, don't overwrite it.
        // selectionchange fires AFTER DOM mutations, so it would capture the wrong position
        // for actions like Enter that create new blocks.
        if (this.keydownCapturedPosition) {
          return;
        }

        // Only capture if selection is within the editor
        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          return;
        }

        const range = selection.getRangeAt(0);

        if (!redactor.contains(range.startContainer)) {
          return;
        }

        // Capture the current caret position as fallback for non-keyboard actions
        // (e.g., context menu paste, drag-and-drop)
        this.pendingCaretPosition = this.getCaretPosition();
      };

      document.addEventListener('selectionchange', this.selectionChangeHandler);
    }, 0);
  }

  /**
   * Handles block mutation events
   * Uses smart grouping to create checkpoints when action type changes
   * Also creates checkpoints when user pauses typing (newGroupDelay)
   */
  private handleBlockMutation(event: BlockMutationEvent): void {
    // Mark this instance as active for global shortcuts
    History.activeInstance = this;

    // Don't record changes during undo/redo operations
    if (this.isPerformingUndoRedo) {
      return;
    }

    // Ensure initial state is captured
    if (!this.initialStateCaptured) {
      void this.captureInitialState();

      return;
    }

    // If in a batch, just mark that mutations occurred and skip normal processing.
    // State will be recorded when the batch ends.
    if (this.batchDepth > 0) {
      this.batchHasMutations = true;

      return;
    }

    // Get block ID from event
    const blockId = event.detail.target.id;

    // Check for pause detection (newGroupDelay)
    // If the user paused for longer than newGroupDelay, we need to treat the last
    // recorded state as a checkpoint (don't record current state which is AFTER mutation)
    const currentTime = Date.now();
    const pauseDetected = this.lastMutationTime !== null &&
      (currentTime - this.lastMutationTime) > this.newGroupDelay;

    // Update last mutation time
    this.lastMutationTime = currentTime;

    // Check if we should create a checkpoint before this action
    const shouldCheckpoint = this.smartGrouping.shouldCreateCheckpoint(
      {
        actionType: this.currentActionType,
        insertedText: this.currentInsertedText,
      },
      blockId
    );

    // Clear the inserted text after use to avoid reusing it for the next action
    this.currentInsertedText = undefined;

    // Check if this is an immediate checkpoint action
    const isImmediate = this.smartGrouping.isImmediateCheckpoint(this.currentActionType);

    // When a pause is detected (user paused longer than newGroupDelay), we treat
    // the last recorded state as a checkpoint boundary. We do NOT record the current
    // state because:
    // 1. The DOM has already changed (mutation happened before this handler)
    // 2. Recording now would capture the post-mutation state, not pre-mutation
    // 3. The previous state in the stack is already the correct checkpoint
    //
    // Instead, we just reset the smart grouping context and start fresh debouncing.
    if (pauseDetected) {
      this.clearDebounce();
      this.smartGrouping.resetPendingActionCount();
      this.smartGrouping.updateContext(this.currentActionType, blockId);
      // NOTE: We do NOT reset hasCapturedGroupPosition here because the keydown
      // handler already captured the correct caret position BEFORE the first mutation.
      // Resetting it would cause the next keydown to overwrite the correct position.
      this.startDebounce();

      return;
    }

    if (shouldCheckpoint || isImmediate) {
      // Create checkpoint immediately (flush pending debounce)
      this.clearDebounce();
      // Capture the batch generation at the time of scheduling.
      // This allows recordState to detect if a batch occurred between scheduling and execution.
      const generationAtSchedule = this.batchGeneration;

      void this.recordState(generationAtSchedule).then(() => {
        // Reset pending action count after checkpoint
        this.smartGrouping.resetPendingActionCount();
        // Update context after recording
        this.smartGrouping.updateContext(this.currentActionType, blockId);
        // Start new debounce for continued editing
        this.startDebounce();
      });
    } else {
      // Update context and debounce normally
      this.smartGrouping.updateContext(this.currentActionType, blockId);
      this.clearDebounce();
      this.startDebounce();
    }
  }

  /**
   * Starts the debounce timer for recording state
   */
  private startDebounce(): void {
    // Capture the batch generation at the time of scheduling.
    const generationAtSchedule = this.batchGeneration;

    this.debounceTimeout = setTimeout(() => {
      // Reset pending action count - debounce expiry acts as a checkpoint
      this.smartGrouping.resetPendingActionCount();
      void this.recordState(generationAtSchedule);
    }, this.debounceTime);
  }

  /**
   * Records the current state to history
   *
   * IMPORTANT: To fix caret restoration on undo, we capture the caret position
   * and store it on the PREVIOUS entry (not the new entry). This is because:
   *
   * 1. When undoing, we want to restore to where the caret was BEFORE the action
   * 2. The previous entry represents the state we'll restore to
   * 3. The caret might have moved since the previous entry was recorded (without content changes)
   *
   * Example flow:
   * - User types "hello" → state recorded with caret at end of "hello"
   * - User moves caret to position 2 (no content change, no state recorded)
   * - User presses Enter to split block
   * - NEW state is recorded, but we update PREVIOUS entry's caret to position 2
   * - On undo: we restore to "hello" with caret at position 2 (where Enter was pressed)
   *
   * @param scheduledGeneration - Optional batch generation at the time this call was scheduled.
   *                              If provided and doesn't match current generation, the call is skipped.
   *                              This prevents stale recordState() calls that were scheduled before
   *                              a batch started from running after the batch ends.
   */
  private async recordState(scheduledGeneration?: number): Promise<void> {
    // Double-check we're not in undo/redo mode
    if (this.isPerformingUndoRedo) {
      return;
    }

    // Skip if we're in a batch - the batch will record state when it ends.
    // This prevents race conditions where a pending recordState() from before
    // the batch started captures the wrong state (after batch mutations).
    if (this.batchDepth > 0) {
      return;
    }

    // Skip if a batch occurred between when this call was scheduled and now.
    // This prevents stale recordState() calls from recording incorrect states.
    // For example, when typing "1. " triggers a list conversion:
    // - The space mutation schedules recordState() before the batch starts
    // - The batch runs (list conversion) and increments batchGeneration
    // - This stale recordState() runs after the batch but would capture the list state
    // By checking the generation, we skip this stale call.
    if (scheduledGeneration !== undefined && scheduledGeneration !== this.batchGeneration) {
      return;
    }

    // Clean up any fake background elements before capturing state,
    // UNLESS they are actively being used (e.g., by inline link tool).
    // This ensures fake background spans are never persisted to history,
    // but also preserves the visual selection when inline tools are active.
    const inlineToolInputFocused = document.activeElement?.hasAttribute('data-blok-testid') &&
      document.activeElement?.getAttribute('data-blok-testid') === 'inline-tool-input';

    if (!inlineToolInputFocused) {
      this.Blok.SelectionAPI.methods.clearFakeBackground();
    }

    const state = await this.getCurrentState();

    if (!state) {
      return;
    }

    // Use the pending caret position (captured on keydown or selection change BEFORE the mutation)
    // This ensures we get the caret position from before the action, not after
    const caretPosition = this.pendingCaretPosition;

    // Reset capture flags now that we've used the position.
    // This allows the next action group to capture a fresh position.
    this.keydownCapturedPosition = false;
    this.hasCapturedGroupPosition = false;

    // Check if this state is identical to the last entry (avoid duplicates)
    const lastEntry = this.undoStack[this.undoStack.length - 1];

    // Always update the last entry's caret position to where the caret WAS
    // (captured before this action via selection change tracking).
    // This ensures that when we undo back to the previous state,
    // we restore to where the caret was when the action started.
    if (lastEntry && caretPosition) {
      lastEntry.caretPosition = caretPosition;
    }

    // If state hasn't changed, we're done (caret was already updated above)
    if (lastEntry && this.areStatesEqual(lastEntry.state, state)) {
      return;
    }

    // Clear redo stack when new changes are made
    this.redoStack = [];

    // Add new entry (without caret position - it will be set when the NEXT state is recorded)
    this.undoStack.push({
      state,
      timestamp: Date.now(),
      // Note: We intentionally don't set caretPosition here.
      // It will be set when the next state is recorded, capturing where the
      // caret was just before that action. This ensures correct undo behavior.
    });

    // Trim stack if exceeds max length
    while (this.undoStack.length > this.maxHistoryLength) {
      this.undoStack.shift();
    }

    this.emitStateChanged();
  }

  /**
   * Gets current document state without sanitization
   * This captures raw block data for history to preserve inline formatting
   */
  private async getCurrentState(): Promise<OutputData | null> {
    try {
      const { BlockManager } = this.Blok;
      const blocks = BlockManager.blocks;

      // If there is only one block and it is empty, return empty blocks array
      if (blocks.length === 1 && blocks[0].isEmpty) {
        return {
          time: Date.now(),
          blocks: [],
          version: '',
        };
      }

      const blockPromises = blocks.map(async (block): Promise<OutputBlockData | null> => {
        const savedData = await block.save();

        if (!savedData || savedData.data === undefined) {
          return null;
        }

        const isValid = await block.validate(savedData.data);

        if (!isValid) {
          return null;
        }

        return {
          id: savedData.id,
          type: savedData.tool,
          data: savedData.data,
          ...(savedData.tunes && Object.keys(savedData.tunes).length > 0 && { tunes: savedData.tunes }),
        };
      });

      const results = await Promise.all(blockPromises);
      const validBlocks = results.filter((block): block is OutputBlockData => block !== null);

      return {
        time: Date.now(),
        blocks: validBlocks,
        version: '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Compares two states for equality (ignoring timestamps)
   * @param a - first state
   * @param b - second state
   * @returns true if the block content is identical
   */
  private areStatesEqual(a: OutputData, b: OutputData): boolean {
    // Quick check: different number of blocks
    if (a.blocks.length !== b.blocks.length) {
      return false;
    }

    // Compare each block using every() for functional approach
    return a.blocks.every((blockA, i) => {
      const blockB = b.blocks[i];

      // Check ID and type
      if (blockA.id !== blockB.id || blockA.type !== blockB.type) {
        return false;
      }

      // Compare data (deep comparison via JSON)
      if (JSON.stringify(blockA.data) !== JSON.stringify(blockB.data)) {
        return false;
      }

      // Compare tunes if present
      const tunesA = JSON.stringify(blockA.tunes ?? {});
      const tunesB = JSON.stringify(blockB.tunes ?? {});

      if (tunesA !== tunesB) {
        return false;
      }

      return true;
    });
  }

  /**
   * Restores document to a given state using smart diffing
   * Only updates blocks that have changed to preserve DOM state
   * @param state - the document state to restore
   * @param caretPosition - optional caret position to restore after state is applied
   * @param fallbackBlockIndex - optional block index to use when caret block no longer exists
   * @param fallbackCaretPosition - optional caret position to use when the target state has no caret position
   */
  private async restoreState(
    state: OutputData,
    caretPosition?: CaretPosition,
    fallbackBlockIndex?: number,
    fallbackCaretPosition?: CaretPosition
  ): Promise<void> {
    // Disable modifications observer during restore
    this.Blok.ModificationsObserver.disable();

    try {
      await this.applyStateDiff(state);
    } finally {
      this.Blok.ModificationsObserver.enable();
    }

    // Restore caret position after state is applied
    this.restoreCaretPosition(caretPosition, fallbackBlockIndex, fallbackCaretPosition);
  }

  /**
   * Apply state changes using diff-based approach
   * This minimizes DOM changes and preserves focus/selection
   */
  private async applyStateDiff(targetState: OutputData): Promise<void> {
    const { BlockManager, Renderer } = this.Blok;
    const currentBlocks = BlockManager.blocks;
    const targetBlocks = targetState.blocks;

    // Build maps for quick lookup
    const currentBlocksById = new Map<string, { block: typeof currentBlocks[0]; index: number }>();

    currentBlocks.forEach((block, index) => {
      currentBlocksById.set(block.id, { block, index });
    });

    const targetBlocksById = new Map<string, { data: OutputBlockData; index: number }>();

    targetBlocks.forEach((blockData, index) => {
      if (blockData.id) {
        targetBlocksById.set(blockData.id, { data: blockData, index });
      }
    });

    // Find blocks to remove (exist in current but not in target)
    const blocksToRemove: typeof currentBlocks[0][] = [];

    for (const block of currentBlocks) {
      if (!targetBlocksById.has(block.id)) {
        blocksToRemove.push(block);
      }
    }

    // Find blocks to add (exist in target but not in current)
    const blocksToAdd: { data: OutputBlockData; index: number }[] = [];

    for (const [id, { data, index }] of targetBlocksById) {
      if (!currentBlocksById.has(id)) {
        blocksToAdd.push({ data, index });
      }
    }

    // Find blocks to update (exist in both but may have changed data)
    const blocksToUpdate: { block: typeof currentBlocks[0]; data: OutputBlockData; targetIndex: number }[] = [];

    for (const [id, { data, index: targetIndex }] of targetBlocksById) {
      const current = currentBlocksById.get(id);

      if (current) {
        blocksToUpdate.push({ block: current.block, data, targetIndex });
      }
    }

    // If the structure changed significantly, fall back to full re-render
    // This threshold can be adjusted based on performance needs
    const totalChanges = blocksToRemove.length + blocksToAdd.length;
    const significantChange = totalChanges > currentBlocks.length / 2 || totalChanges > 5;

    if (significantChange || currentBlocks.length === 0) {
      // Full re-render for significant changes
      await BlockManager.clear();
      await Renderer.render(targetBlocks);

      return;
    }

    // Apply incremental changes

    // 1. Remove blocks that no longer exist
    for (const block of blocksToRemove) {
      await BlockManager.removeBlock(block);
    }

    // 2. Update existing blocks with new data (in-place when possible)
    for (const { block, data } of blocksToUpdate) {
      // Check if data actually changed
      const currentData = await block.data;
      const dataChanged = JSON.stringify(currentData) !== JSON.stringify(data.data);

      if (!dataChanged) {
        continue;
      }

      // Try in-place update first to preserve DOM and focus
      const updated = await block.setData(data.data);

      // Fall back to full re-render if in-place update not supported
      if (!updated) {
        await BlockManager.update(block, data.data, data.tunes);
      }
    }

    // 3. Add new blocks
    for (const { data, index } of blocksToAdd) {
      BlockManager.insert({
        id: data.id,
        tool: data.type,
        data: data.data,
        index,
        needToFocus: false,
      });
    }

    // 4. Reorder blocks if needed
    await this.reorderBlocks(targetBlocks);
  }

  /**
   * Reorder blocks to match target order
   */
  private async reorderBlocks(targetBlocks: OutputBlockData[]): Promise<void> {
    const { BlockManager } = this.Blok;

    // Create target order map
    const targetOrder = new Map<string, number>();

    targetBlocks.forEach((block, index) => {
      if (block.id) {
        targetOrder.set(block.id, index);
      }
    });

    // Get current blocks and their indices
    const currentBlocks = BlockManager.blocks;

    // Check if reordering is needed by comparing positions
    const needsReorder = currentBlocks.some((block, i) => {
      const targetIndex = targetOrder.get(block.id);

      return targetIndex !== undefined && targetIndex !== i;
    });

    if (!needsReorder) {
      return;
    }

    // Apply moves to get blocks in correct order
    // We iterate from the end to avoid index shifting issues
    targetBlocks.forEach((targetBlock, targetIndex) => {
      const targetBlockId = targetBlock.id;

      if (!targetBlockId) {
        return;
      }

      const currentIndex = BlockManager.blocks.findIndex(b => b.id === targetBlockId);

      if (currentIndex !== -1 && currentIndex !== targetIndex) {
        BlockManager.move(targetIndex, currentIndex);
      }
    });
  }

  /**
   * Wait for a short cooldown period
   * This helps ignore late-firing events after state restore
   */
  private cooldown(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, RESTORE_COOLDOWN_TIME));
  }

  /**
   * Captures current caret position for later restoration
   *
   * IMPORTANT: This method determines the block from the actual DOM selection,
   * not from BlockManager.currentBlock. This is necessary because:
   * 1. BlockManager.currentBlock might be stale if the user moved the caret
   *    programmatically or via selection without triggering the UI events
   * 2. We need the most accurate position at the moment of capture
   *
   * @returns CaretPosition or undefined if caret is not in the editor
   */
  private getCaretPosition(): CaretPosition | undefined {
    const { BlockManager } = this.Blok;

    // Get the current selection
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return undefined;
    }

    const range = selection.getRangeAt(0);
    const anchorNode = range.startContainer;

    // Find the block containing the selection by traversing up the DOM
    // This is more reliable than using BlockManager.currentBlock which might be stale
    const block = BlockManager.getBlockByChildNode(anchorNode);

    if (!block) {
      return undefined;
    }

    // Find the input element containing the selection
    const inputElement = anchorNode instanceof HTMLElement
      ? anchorNode.closest('[contenteditable="true"]') as HTMLElement | null
      : anchorNode.parentElement?.closest('[contenteditable="true"]') as HTMLElement | null;

    if (!inputElement) {
      return undefined;
    }

    // Get block index from the blocks array
    const blockIndex = BlockManager.getBlockIndex(block);
    const inputIndex = block.inputs.indexOf(inputElement);
    const offset = this.getCaretOffset(inputElement, false);
    const endOffset = this.getCaretOffset(inputElement, true);

    return {
      blockId: block.id,
      blockIndex: blockIndex >= 0 ? blockIndex : 0,
      inputIndex: inputIndex >= 0 ? inputIndex : 0,
      offset,
      // Only include endOffset if selection is not collapsed
      ...(endOffset !== offset ? { endOffset } : {}),
    };
  }

  /**
   * Gets caret offset within an input element
   * @param input - the input element
   * @param useEnd - if true, get the end offset of the selection; if false, get the start offset
   * @returns character offset
   */
  private getCaretOffset(input: HTMLElement, useEnd = false): number {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return 0;
    }

    const range = selection.getRangeAt(0);

    // Check if selection is within this input
    if (!input.contains(range.startContainer)) {
      return 0;
    }

    // For native inputs, use selectionStart/selectionEnd
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      return (useEnd ? input.selectionEnd : input.selectionStart) ?? 0;
    }

    // For contenteditable, calculate offset by creating a range from start to caret
    try {
      const preCaretRange = document.createRange();

      preCaretRange.selectNodeContents(input);

      if (useEnd) {
        preCaretRange.setEnd(range.endContainer, range.endOffset);
      } else {
        preCaretRange.setEnd(range.startContainer, range.startOffset);
      }

      return preCaretRange.toString().length;
    } catch {
      return 0;
    }
  }

  /**
   * Restores caret to a previously saved position
   * @param caretPosition - the position to restore
   * @param fallbackBlockIndex - optional block index to use when caret block no longer exists
   * @param fallbackCaretPosition - optional caret position to use when the target state has no caret position
   */
  private restoreCaretPosition(
    caretPosition: CaretPosition | undefined,
    fallbackBlockIndex?: number,
    fallbackCaretPosition?: CaretPosition
  ): void {
    // If no caret position but have fallback caret position, use it
    if (!caretPosition && fallbackCaretPosition) {
      // Try to use the fallback caret position's block index and input index
      // The block ID might not exist in the restored state, so we use the index as fallback
      this.focusBlockAtIndexWithInput(
        fallbackCaretPosition.blockIndex,
        fallbackCaretPosition.inputIndex,
        fallbackCaretPosition.offset
      );

      return;
    }

    // If no caret position but have fallback block index, use it
    if (!caretPosition && fallbackBlockIndex !== undefined) {
      this.focusBlockAtIndex(fallbackBlockIndex);

      return;
    }

    // No saved caret position and no fallback, focus first available block
    if (!caretPosition) {
      this.focusFirstAvailableBlock();

      return;
    }

    const { BlockManager } = this.Blok;

    // Look up block by ID. Note: we need to look up the block again after waiting
    // because the block instance might have been replaced during state restoration
    // (e.g., BlockManager.update creates a new block with the same ID)
    const block = BlockManager.getBlockById(caretPosition.blockId);

    if (!block) {
      // Block no longer exists, use fallback index (preceding block) or saved index
      const indexToUse = fallbackBlockIndex !== undefined ? fallbackBlockIndex : caretPosition.blockIndex;

      this.focusBlockAtIndex(indexToUse);

      return;
    }

    // Wait for block to be ready (in case it was just rendered)
    // Then look up the block again by ID to get the current instance
    // This is necessary because the block might have been replaced during rendering
    void block.ready.then(() => {
      // Re-lookup the block by ID to get the current instance
      // The original block reference might be stale if the block was replaced
      const currentBlock = BlockManager.getBlockById(caretPosition.blockId);

      if (!currentBlock) {
        // Block was removed during rendering, use fallback
        const indexToUse = fallbackBlockIndex !== undefined ? fallbackBlockIndex : caretPosition.blockIndex;

        this.focusBlockAtIndex(indexToUse);

        return;
      }

      // If the block was replaced, wait for the new block to be ready
      if (currentBlock !== block) {
        void currentBlock.ready.then(() => {
          this.setCaretToBlockInput(currentBlock, caretPosition);
        });

        return;
      }

      this.setCaretToBlockInput(currentBlock, caretPosition);
    });
  }

  /**
   * Focuses the first available focusable block in the editor
   */
  private focusFirstAvailableBlock(): void {
    const { BlockManager, Caret } = this.Blok;
    const firstBlock = BlockManager.firstBlock;

    if (firstBlock?.focusable) {
      Caret.setToBlock(firstBlock, Caret.positions.END);
    }
  }

  /**
   * Focuses the block at the given index, or the last available block if index is out of bounds
   * @param index - the target block index
   */
  private focusBlockAtIndex(index: number): void {
    const { BlockManager, Caret } = this.Blok;
    const blocksCount = BlockManager.blocks.length;

    if (blocksCount === 0) {
      return;
    }

    // Use the block at the saved index, or the last block if index is out of bounds
    const targetIndex = Math.min(index, blocksCount - 1);
    const targetBlock = BlockManager.getBlockByIndex(targetIndex);

    if (targetBlock?.focusable) {
      Caret.setToBlock(targetBlock, Caret.positions.END);

      return;
    }

    // Fallback to last block if target is not focusable
    const lastBlock = BlockManager.lastBlock;

    if (lastBlock?.focusable) {
      Caret.setToBlock(lastBlock, Caret.positions.END);
    }
  }

  /**
   * Focuses the block at the given index with a specific input and offset
   * Used when restoring caret position from a fallback that has input/offset info
   * @param blockIndex - the target block index
   * @param inputIndex - the target input index within the block
   * @param offset - the character offset within the input
   */
  private focusBlockAtIndexWithInput(blockIndex: number, inputIndex: number, offset: number): void {
    const { BlockManager, Caret } = this.Blok;
    const blocksCount = BlockManager.blocks.length;

    if (blocksCount === 0) {
      return;
    }

    // Check if the block index is out of bounds
    const isOutOfBounds = blockIndex >= blocksCount;

    // Use the block at the saved index, or the last block if index is out of bounds
    const targetIndex = Math.min(blockIndex, blocksCount - 1);
    const targetBlock = BlockManager.getBlockByIndex(targetIndex);

    if (!targetBlock?.focusable) {
      this.focusFirstAvailableBlock();

      return;
    }

    // If the block index was out of bounds, set caret to the END of the block
    // because the original block no longer exists
    if (isOutOfBounds) {
      void targetBlock.ready.then(() => {
        Caret.setToBlock(targetBlock, Caret.positions.END);
      });

      return;
    }

    // Create a synthetic caret position to use with setCaretToBlockInput
    const syntheticCaretPosition: CaretPosition = {
      blockId: targetBlock.id,
      blockIndex: targetIndex,
      inputIndex,
      offset,
    };

    // Wait for block to be ready and set caret
    void targetBlock.ready.then(() => {
      this.setCaretToBlockInput(targetBlock, syntheticCaretPosition);
    });
  }

  /**
   * Sets caret to a specific input within a block
   * @param block - the block to set caret in
   * @param caretPosition - the saved caret position
   */
  private setCaretToBlockInput(block: Block, caretPosition: CaretPosition): void {
    const { BlockManager, Caret } = this.Blok;

    // Use requestAnimationFrame to ensure the DOM has been updated
    // This is necessary because the block's inputs might not be available immediately
    // after the block is rendered, especially for complex tools like lists
    requestAnimationFrame(() => {
      const inputs = block.inputs;
      const targetInputIndex = Math.min(caretPosition.inputIndex, inputs.length - 1);
      const targetInput = inputs[targetInputIndex];

      if (!targetInput) {
        // No inputs, just select the block
        Caret.setToBlock(block, Caret.positions.END);

        return;
      }

      // Set current block
      BlockManager.currentBlock = block;

      // Check if we need to restore a selection range (not just a cursor)
      const hasSelection = caretPosition.endOffset !== undefined && caretPosition.endOffset !== caretPosition.offset;

      if (hasSelection && caretPosition.endOffset !== undefined) {
        // Restore selection range
        this.setSelectionRange(targetInput, caretPosition.offset, caretPosition.endOffset);
      } else {
        // Try to set exact offset, fall back to end if offset is out of bounds
        try {
          Caret.setToInput(targetInput, Caret.positions.DEFAULT, caretPosition.offset);
        } catch {
          Caret.setToInput(targetInput, Caret.positions.END);
        }
      }
    });
  }

  /**
   * Sets a selection range within an input element
   * @param input - the input element
   * @param startOffset - start offset in text characters
   * @param endOffset - end offset in text characters
   */
  private setSelectionRange(input: HTMLElement, startOffset: number, endOffset: number): void {
    // Focus the input first
    input.focus();

    // For native inputs, use setSelectionRange
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const maxLength = input.value.length;
      const clampedStart = Math.min(startOffset, maxLength);
      const clampedEnd = Math.min(endOffset, maxLength);

      input.setSelectionRange(clampedStart, clampedEnd);

      return;
    }

    // For contenteditable, we need to find the nodes at the given offsets
    try {
      const startNodeInfo = $.getNodeByOffset(input, startOffset);
      const endNodeInfo = $.getNodeByOffset(input, endOffset);

      if (!startNodeInfo.node || !endNodeInfo.node) {
        return;
      }

      const range = document.createRange();

      range.setStart(startNodeInfo.node, startNodeInfo.offset);
      range.setEnd(endNodeInfo.node, endNodeInfo.offset);

      const selection = window.getSelection();

      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch {
      // If setting range fails, just focus the input
      input.focus();
    }
  }

  /**
   * Clears the debounce timeout
   */
  private clearDebounce(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
  }

  /**
   * Preserves the current caret position by re-focusing the current input
   * Used when undo/redo has nothing to do but we want to prevent caret from moving
   */
  private preserveCaretPosition(): void {
    const { BlockManager, Caret } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock?.focusable) {
      return;
    }

    const currentInput = currentBlock.currentInput;

    if (currentInput) {
      // Re-focus the current input to ensure caret stays in place
      currentInput.focus();
    } else {
      // Fallback to setting caret to the block
      Caret.setToBlock(currentBlock, Caret.positions.END);
    }
  }

  /**
   * Emits history state changed event
   */
  private emitStateChanged(): void {
    this.eventsDispatcher.emit(HistoryStateChanged, {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
  }

  /**
   * Cleans up history module resources
   * Removes shortcuts and clears state
   */
  public destroy(): void {
    this.clearDebounce();

    // Remove registered shortcuts
    for (const { name, element } of this.registeredShortcuts) {
      Shortcuts.remove(element, name);
    }
    this.registeredShortcuts = [];

    // Remove keydown handler (must use capture: true to match registration)
    const redactor = this.Blok.UI?.nodes?.redactor;

    if (this.keydownHandler && redactor) {
      redactor.removeEventListener('keydown', this.keydownHandler, { capture: true });
    }
    this.keydownHandler = null;

    // Remove selection change handler
    if (this.selectionChangeHandler) {
      document.removeEventListener('selectionchange', this.selectionChangeHandler);
    }
    this.selectionChangeHandler = null;
    this.pendingCaretPosition = undefined;
    this.hasCapturedGroupPosition = false;

    // Clear active instance if it's this one
    if (History.activeInstance === this) {
      History.activeInstance = null;
    }

    // Clear stacks and smart grouping
    this.undoStack = [];
    this.redoStack = [];
    this.initialStateCaptured = false;
    this.smartGrouping.clearContext();
  }
}
