import SelectionUtils from '../selection';

import Module from '../__module';
/**
 *
 */
export default class DragNDrop extends Module {
  /**
   * If drag has been started at editor, we save it
   *
   * @type {boolean}
   * @private
   */
  private isStartedAtEditor = false;

  /**
   * Holds listener identifiers that prevent native drops in read-only mode
   */
  private guardListenerIds: string[] = [];

  /**
   * Toggle read-only state
   *
   * if state is true:
   *  - disable all drag-n-drop event handlers
   *
   * if state is false:
   *  - restore drag-n-drop event handlers
   *
   * @param {boolean} readOnlyEnabled - "read only" state
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (readOnlyEnabled) {
      this.disableModuleBindings();
      this.bindPreventDropHandlers();
    } else {
      this.clearGuardListeners();
      this.enableModuleBindings();
    }
  }

  /**
   * Add drag events listeners to editor zone
   */
  private enableModuleBindings(): void {
    const { UI } = this.Editor;

    this.readOnlyMutableListeners.on(UI.nodes.holder, 'drop', (dropEvent: Event) => {
      void this.processDrop(dropEvent as DragEvent);
    }, true);

    this.readOnlyMutableListeners.on(UI.nodes.holder, 'dragstart', () => {
      this.processDragStart();
    });

    /**
     * Prevent default browser behavior to allow drop on non-contenteditable elements
     */
    this.readOnlyMutableListeners.on(UI.nodes.holder, 'dragover', (dragEvent: Event) => {
      this.processDragOver(dragEvent as DragEvent);
    }, true);
  }

  /**
   * Unbind drag-n-drop event handlers
   */
  private disableModuleBindings(): void {
    this.readOnlyMutableListeners.clearAll();
    this.clearGuardListeners();
  }

  /**
   * Prevents native drag-and-drop insertions while editor is locked
   */
  private bindPreventDropHandlers(): void {
    const { UI } = this.Editor;

    this.addGuardListener(UI.nodes.holder, 'dragover', this.preventNativeDrop, true);
    this.addGuardListener(UI.nodes.holder, 'drop', this.preventNativeDrop, true);
  }

  /**
   * Cancels browser default drag/drop behavior
   *
   * @param event - drag-related event dispatched on the holder
   */
  private preventNativeDrop = (event: Event): void => {
    event.preventDefault();

    if (event instanceof DragEvent) {
      event.stopPropagation();
      event.dataTransfer?.clearData();
    }
  };

  /**
   * Registers a listener to be cleaned up when unlocking editor
   *
   * @param element - target to bind listener to
   * @param eventType - event type to listen for
   * @param handler - event handler
   * @param options - listener options
   */
  private addGuardListener(
    element: EventTarget,
    eventType: string,
    handler: (event: Event) => void,
    options: boolean | AddEventListenerOptions = false
  ): void {
    const listenerId = this.listeners.on(element, eventType, handler, options);

    if (listenerId) {
      this.guardListenerIds.push(listenerId);
    }
  }

  /**
   * Removes guard listeners bound for read-only mode
   */
  private clearGuardListeners(): void {
    this.guardListenerIds.forEach((id) => {
      this.listeners.offById(id);
    });
    this.guardListenerIds = [];
  }

  /**
   * Handle drop event
   *
   * @param {DragEvent} dropEvent - drop event
   */
  private async processDrop(dropEvent: DragEvent): Promise<void> {
    const {
      BlockManager,
      Paste,
      Caret,
    } = this.Editor;

    dropEvent.preventDefault();

    if (this.Editor.ReadOnly?.isEnabled) {
      this.preventNativeDrop(dropEvent);

      return;
    }

    for (const block of BlockManager.blocks) {
      block.dropTarget = false;
    }

    const blockSelection = this.Editor.BlockSelection;
    const hasBlockSelection = Boolean(blockSelection?.anyBlockSelected);
    const hasTextSelection = SelectionUtils.isAtEditor && !SelectionUtils.isCollapsed;

    if (this.isStartedAtEditor && (hasTextSelection || hasBlockSelection)) {
      this.removeDraggedSelection();
    }

    this.isStartedAtEditor = false;

    /**
     * Try to set current block by drop target.
     * If drop target is not part of the Block, set last Block as current.
     */
    const target = dropEvent.target;
    const targetBlock = target instanceof Node
      ? BlockManager.setCurrentBlockByChildNode(target)
      : undefined;

    const lastBlock = BlockManager.lastBlock;
    const fallbackBlock = lastBlock
      ? BlockManager.setCurrentBlockByChildNode(lastBlock.holder) ?? lastBlock
      : undefined;
    const blockForCaret = targetBlock ?? fallbackBlock;

    if (blockForCaret) {
      this.Editor.Caret.setToBlock(blockForCaret, Caret.positions.END);
    }

    const { dataTransfer } = dropEvent;

    if (!dataTransfer) {
      return;
    }

    await Paste.processDataTransfer(dataTransfer, true);
  }

  /**
   * Removes currently selected content when drag originated from Editor
   */
  private removeDraggedSelection(): void {
    const { BlockSelection, BlockManager } = this.Editor;

    if (!BlockSelection?.anyBlockSelected) {
      this.removeTextSelection();

      return;
    }

    const removedIndex = BlockManager.removeSelectedBlocks();

    if (removedIndex === undefined) {
      return;
    }

    BlockSelection.clearSelection();
  }

  /**
   * Removes current text selection produced within the editor
   */
  private removeTextSelection(): void {
    const selection = SelectionUtils.get();

    if (!selection) {
      return;
    }

    if (selection.rangeCount === 0) {
      this.deleteCurrentSelection(selection);

      return;
    }

    const range = selection.getRangeAt(0);

    if (!range.collapsed) {
      range.deleteContents();

      return;
    }

    this.deleteCurrentSelection(selection);
  }

  /**
   * Removes current selection using browser API if available
   *
   * @param selection - current document selection
   */
  private deleteCurrentSelection(selection: Selection): void {
    if (typeof selection.deleteFromDocument === 'function') {
      selection.deleteFromDocument();
    }
  }

  /**
   * Handle drag start event
   */
  private processDragStart(): void {
    if (SelectionUtils.isAtEditor && !SelectionUtils.isCollapsed) {
      this.isStartedAtEditor = true;
    }

    this.Editor.InlineToolbar.close();
  }

  /**
   * @param {DragEvent} dragEvent - drag event
   */
  private processDragOver(dragEvent: DragEvent): void {
    dragEvent.preventDefault();
  }
}
