/**
 * @class History
 * @classdesc Manages undo/redo functionality using state snapshots
 * @module History
 */
import Module from '../__module';
import type { OutputData, OutputBlockData } from '../../../types';
import { BlockChanged, HistoryStateChanged } from '../events';
import type { BlockMutationEvent } from '../../../types/events/block';
import Shortcuts from '../utils/shortcuts';
import type Block from '../block';

/**
 * Default maximum history stack size
 */
const DEFAULT_MAX_HISTORY_LENGTH = 30;

/**
 * Default debounce time for content changes (ms)
 */
const DEFAULT_DEBOUNCE_TIME = 200;

/**
 * Time to wait after restore before accepting new changes (ms)
 * This prevents late-firing events from corrupting history
 */
const RESTORE_COOLDOWN_TIME = 100;

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
   * Character offset within the input
   */
  offset: number;
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
export default class History extends Module {
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
   * Maximum number of entries in history stack
   */
  private get maxHistoryLength(): number {
    return (this.config as { maxHistoryLength?: number }).maxHistoryLength ?? DEFAULT_MAX_HISTORY_LENGTH;
  }

  /**
   * Debounce time for batching changes
   */
  private get debounceTime(): number {
    return (this.config as { historyDebounceTime?: number }).historyDebounceTime ?? DEFAULT_DEBOUNCE_TIME;
  }

  /**
   * Whether to use document-level shortcuts for undo/redo
   */
  private get globalUndoRedo(): boolean {
    return (this.config as { globalUndoRedo?: boolean }).globalUndoRedo ?? true;
  }

  /**
   * Module preparation
   * Sets up event listeners and keyboard shortcuts
   */
  public async prepare(): Promise<void> {
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
  }

  /**
   * Captures the initial document state
   * Should be called after rendering is complete
   */
  public async captureInitialState(): Promise<void> {
    if (this.initialStateCaptured) {
      return;
    }

    const state = await this.getCurrentState();

    if (state) {
      const caretPosition = this.getCaretPosition();

      this.undoStack = [{
        state,
        timestamp: Date.now(),
        caretPosition,
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

        await this.restoreState(previousEntry.state, previousEntry.caretPosition, fallbackIndex);
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
    this.emitStateChanged();
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
   * Handles block mutation events
   * Debounces rapid changes and records state snapshots
   */
  private handleBlockMutation(_event: BlockMutationEvent): void {
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

    // Clear existing debounce timeout
    this.clearDebounce();

    // Debounce to batch rapid changes
    this.debounceTimeout = setTimeout(() => {
      void this.recordState();
    }, this.debounceTime);
  }

  /**
   * Records the current state to history
   */
  private async recordState(): Promise<void> {
    // Double-check we're not in undo/redo mode
    if (this.isPerformingUndoRedo) {
      return;
    }

    const state = await this.getCurrentState();

    if (!state) {
      return;
    }

    // Capture caret position along with state
    const caretPosition = this.getCaretPosition();

    // Clear redo stack when new changes are made
    this.redoStack = [];

    // Add new entry
    this.undoStack.push({
      state,
      timestamp: Date.now(),
      caretPosition,
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
   * Restores document to a given state using smart diffing
   * Only updates blocks that have changed to preserve DOM state
   * @param state - the document state to restore
   * @param caretPosition - optional caret position to restore after state is applied
   * @param fallbackBlockIndex - optional block index to use when caret block no longer exists
   */
  private async restoreState(state: OutputData, caretPosition?: CaretPosition, fallbackBlockIndex?: number): Promise<void> {
    // Disable modifications observer during restore
    this.Blok.ModificationsObserver.disable();

    try {
      await this.applyStateDiff(state);
    } finally {
      this.Blok.ModificationsObserver.enable();
    }

    // Restore caret position after state is applied
    this.restoreCaretPosition(caretPosition, fallbackBlockIndex);
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
   * @returns CaretPosition or undefined if caret is not in the editor
   */
  private getCaretPosition(): CaretPosition | undefined {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return undefined;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return undefined;
    }

    const inputIndex = currentBlock.inputs.indexOf(currentInput);
    const offset = this.getCaretOffset(currentInput);
    const blockIndex = BlockManager.currentBlockIndex;

    return {
      blockId: currentBlock.id,
      blockIndex: blockIndex >= 0 ? blockIndex : 0,
      inputIndex: inputIndex >= 0 ? inputIndex : 0,
      offset,
    };
  }

  /**
   * Gets caret offset within an input element
   * @param input - the input element
   * @returns character offset
   */
  private getCaretOffset(input: HTMLElement): number {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return 0;
    }

    const range = selection.getRangeAt(0);

    // Check if selection is within this input
    if (!input.contains(range.startContainer)) {
      return 0;
    }

    // For native inputs, use selectionStart
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      return input.selectionStart ?? 0;
    }

    // For contenteditable, calculate offset by creating a range from start to caret
    try {
      const preCaretRange = document.createRange();

      preCaretRange.selectNodeContents(input);
      preCaretRange.setEnd(range.startContainer, range.startOffset);

      return preCaretRange.toString().length;
    } catch {
      return 0;
    }
  }

  /**
   * Restores caret to a previously saved position
   * @param caretPosition - the position to restore
   * @param fallbackBlockIndex - optional block index to use when caret block no longer exists
   */
  private restoreCaretPosition(caretPosition: CaretPosition | undefined, fallbackBlockIndex?: number): void {
    if (!caretPosition && fallbackBlockIndex !== undefined) {
      this.focusBlockAtIndex(fallbackBlockIndex);

      return;
    }

    if (!caretPosition) {
      // No saved caret position and no fallback, focus first available block
      this.focusFirstAvailableBlock();

      return;
    }

    const { BlockManager } = this.Blok;
    const block = BlockManager.getBlockById(caretPosition.blockId);

    if (!block) {
      // Block no longer exists, use fallback index (preceding block) or saved index
      const indexToUse = fallbackBlockIndex !== undefined ? fallbackBlockIndex : caretPosition.blockIndex;

      this.focusBlockAtIndex(indexToUse);

      return;
    }

    // Wait for block to be ready (in case it was just rendered)
    void block.ready.then(() => {
      this.setCaretToBlockInput(block, caretPosition);
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
   * Sets caret to a specific input within a block
   * @param block - the block to set caret in
   * @param caretPosition - the saved caret position
   */
  private setCaretToBlockInput(block: Block, caretPosition: CaretPosition): void {
    const { BlockManager, Caret } = this.Blok;
    const inputs = block.inputs;
    const targetInputIndex = Math.min(caretPosition.inputIndex, inputs.length - 1);
    const targetInput = inputs[targetInputIndex];

    if (!targetInput) {
      // No inputs, just select the block
      Caret.setToBlock(block, Caret.positions.END);

      return;
    }

    // Set current block and let Caret.setToInput handle the input assignment
    BlockManager.currentBlock = block;

    // Try to set exact offset, fall back to end if offset is out of bounds
    try {
      Caret.setToInput(targetInput, Caret.positions.DEFAULT, caretPosition.offset);
    } catch {
      Caret.setToInput(targetInput, Caret.positions.END);
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

    // Clear active instance if it's this one
    if (History.activeInstance === this) {
      History.activeInstance = null;
    }

    // Clear stacks
    this.undoStack = [];
    this.redoStack = [];
    this.initialStateCaptured = false;
  }
}
