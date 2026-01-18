/**
 * @class BlockSelection
 * @classdesc Manages Block selection with shortcut CMD+A
 * @module BlockSelection
 * @version 1.0.0
 */
import type { SanitizerConfig } from '../../../types/configs';
import { Module } from '../__module';
import type { Block } from '../block';
import { Dom as $ } from '../dom';
import { SelectionUtils } from '../selection';
import { delay } from '../utils';
import { clean, composeSanitizerConfig } from '../utils/sanitizer';
import { Shortcuts } from '../utils/shortcuts';

/**
 *
 */
export class BlockSelection extends Module {
  /**
   * Sometimes .anyBlockSelected can be called frequently,
   * for example at ui@selectionChange (to clear native browser selection in CBS)
   * We use cache to prevent multiple iterations through all the blocks
   * @private
   */
  private anyBlockSelectedCache: boolean | null = null;

  /**
   * Flag indicating whether navigation mode is active.
   * In navigation mode, user can navigate between blocks using arrow keys
   * and press Enter to start editing the focused block.
   */
  private _navigationModeEnabled = false;

  /**
   * Index of the currently focused block in navigation mode
   */
  private navigationFocusIndex = -1;

  /**
   * Sanitizer Config
   * @returns {SanitizerConfig}
   */
  private get sanitizerConfig(): SanitizerConfig {
    const baseConfig: SanitizerConfig = {
      p: {},
      h1: {},
      h2: {},
      h3: {},
      h4: {},
      h5: {},
      h6: {},
      ol: {},
      ul: {},
      li: {},
      br: true,
      img: {
        src: true,
        width: true,
        height: true,
      },
      a: {
        href: true,
      },
      b: {},
      i: {},
      u: {},
    };

    return composeSanitizerConfig(this.config.sanitizer as SanitizerConfig, baseConfig);
  }

  /**
   * Flag that identifies all Blocks selection
   * @returns {boolean}
   */
  public get allBlocksSelected(): boolean {
    const { BlockManager } = this.Blok;

    return BlockManager.blocks.every((block) => block.selected === true);
  }

  /**
   * Set selected all blocks
   * @param {boolean} state - state to set
   */
  public set allBlocksSelected(state: boolean) {
    const { BlockManager } = this.Blok;

    for (const block of BlockManager.blocks) {
      block.selected = state;
    }

    this.clearCache();
  }

  /**
   * Flag that identifies any Block selection
   * @returns {boolean}
   */
  public get anyBlockSelected(): boolean {
    const { BlockManager } = this.Blok;

    if (this.anyBlockSelectedCache === null) {
      this.anyBlockSelectedCache = BlockManager.blocks.some((block) => block.selected === true);
    }

    return this.anyBlockSelectedCache;
  }

  /**
   * Return selected Blocks array
   * @returns {Block[]}
   */
  public get selectedBlocks(): Block[] {
    return this.Blok.BlockManager.blocks.filter((block: Block) => block.selected);
  }

  /**
   * Returns true if navigation mode is currently active
   * @returns {boolean}
   */
  public get navigationModeEnabled(): boolean {
    return this._navigationModeEnabled;
  }

  /**
   * Returns the currently focused block in navigation mode
   * @returns {Block | undefined}
   */
  public get navigationFocusedBlock(): Block | undefined {
    if (!this._navigationModeEnabled || this.navigationFocusIndex < 0) {
      return undefined;
    }

    return this.Blok.BlockManager.getBlockByIndex(this.navigationFocusIndex);
  }

  /**
   * Flag used to define block selection
   * First CMD+A defines it as true and then second CMD+A selects all Blocks
   * @type {boolean}
   */
  private needToSelectAll = false;

  /**
   * Flag used to define native input selection
   * In this case we allow double CMD+A to select Block
   * @type {boolean}
   */
  private nativeInputSelected = false;

  /**
   * Flag identifies any input selection
   * That means we can select whole Block
   * @type {boolean}
   */
  private readyToBlockSelection = false;

  /**
   * SelectionUtils instance
   * @type {SelectionUtils}
   */
  private selection: SelectionUtils = new SelectionUtils();

  /**
   * Module Preparation
   * Registers Shortcuts CMD+A and CMD+C
   * to select all and copy them
   */
  public prepare(): void {
    /**
     * Re-create SelectionUtils instance to ensure fresh state.
     */
    this.selection = new SelectionUtils();

    /**
     * CMD/CTRL+A selection shortcut
     */
    Shortcuts.add({
      name: 'CMD+A',
      handler: (event: KeyboardEvent) => {
        const { BlockManager, ReadOnly } = this.Blok;

        /**
         * We use Blok's Block selection on CMD+A ShortCut instead of Browsers
         */
        if (ReadOnly.isEnabled) {
          event.preventDefault();
          this.selectAllBlocks();

          return;
        }

        /**
         * When one page consist of two or more Blok instances
         * Shortcut module tries to handle all events.
         * Thats why Blok's selection works inside the target Blok, but
         * for others error occurs because nothing to select.
         *
         * Prevent such actions if focus is not inside the Blok
         */
        if (!BlockManager.currentBlock) {
          return;
        }

        this.handleCommandA(event);
      },
      on: this.Blok.UI.nodes.redactor,
    });
  }

  /**
   * Toggle read-only state
   *
   *  - Remove all ranges
   *  - Unselect all Blocks
   */
  public toggleReadOnly(): void {
    const selection = SelectionUtils.get();

    selection?.removeAllRanges();

    this.allBlocksSelected = false;
  }

  /**
   * Remove selection of Block
   * @param {number?} index - Block index according to the BlockManager's indexes
   */
  public unSelectBlockByIndex(index?: number): void {
    const { BlockManager } = this.Blok;

    const block = typeof index === 'number'
      ? BlockManager.getBlockByIndex(index)
      : BlockManager.currentBlock;

    if (!block) {
      return;
    }

    block.selected = false;

    this.clearCache();
  }

  /**
   * Clear selection from Blocks
   * @param {Event} reason - event caused clear of selection
   * @param {boolean} restoreSelection - if true, restore saved selection
   */
  public clearSelection(reason?: Event, restoreSelection = false): void {
    const { RectangleSelection } = this.Blok;

    this.needToSelectAll = false;
    this.nativeInputSelected = false;
    this.readyToBlockSelection = false;

    /**
     * Disable navigation mode when selection is cleared
     */
    if (this._navigationModeEnabled) {
      this.disableNavigationMode();
    }

    const isKeyboard = reason && (reason instanceof KeyboardEvent);
    const keyboardEvent = reason as KeyboardEvent;
    const isPrintableKey = isKeyboard && keyboardEvent.key && keyboardEvent.key.length === 1;

    /**
     * If reason caused clear of the selection was printable key and any block is selected,
     * remove selected blocks and insert pressed key
     */
    if (this.anyBlockSelected && isKeyboard && isPrintableKey && !SelectionUtils.isSelectionExists) {
      this.replaceSelectedBlocksWithPrintableKey(reason);
    }

    this.Blok.CrossBlockSelection.clear(reason);

    /**
     * Restore selection when Block is already selected
     * but someone tries to write something.
     */
    if (restoreSelection) {
      this.selection.restore();
    }

    /**
     * Always clear rectangle selection state
     */
    if (RectangleSelection.isRectActivated()) {
      this.Blok.RectangleSelection.clearSelection();
    }

    if (!this.anyBlockSelected) {
      return;
    }

    /** Now all blocks cleared */
    this.allBlocksSelected = false;
  }

  /**
   * Reduce each Block and copy its content
   * @param {ClipboardEvent} e - copy/cut event
   * @returns {Promise<void>}
   */
  public async copySelectedBlocks(e: ClipboardEvent): Promise<void> {
    /**
     * Prevent default copy
     */
    e.preventDefault();

    const clipboardData = e.clipboardData;

    if (!clipboardData) {
      return;
    }

    const fakeClipboard = $.make('div');
    const textPlainChunks: string[] = [];

    this.selectedBlocks.forEach((block) => {
      const cleanHTML = clean(block.holder.innerHTML, this.sanitizerConfig);
      const wrapper = $.make('div');

      wrapper.innerHTML = cleanHTML;

      const textContent = wrapper.textContent ?? '';

      textPlainChunks.push(textContent);

      const hasElementChildren = Array.from(wrapper.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE);
      const shouldWrapWithParagraph = !hasElementChildren && textContent.trim().length > 0;

      if (shouldWrapWithParagraph) {
        const paragraph = $.make('p');

        paragraph.innerHTML = wrapper.innerHTML;
        fakeClipboard.appendChild(paragraph);
      } else {
        while (wrapper.firstChild) {
          fakeClipboard.appendChild(wrapper.firstChild);
        }
      }
    });

    const textPlain = textPlainChunks.join('\n\n');
    const textHTML = fakeClipboard.innerHTML;

    clipboardData.setData('text/plain', textPlain);
    clipboardData.setData('text/html', textHTML);

    try {
      const savedData = await Promise.all(this.selectedBlocks.map((block) => block.save()));

      clipboardData.setData(this.Blok.Paste.MIME_TYPE, JSON.stringify(savedData));
    } catch {
      // In Firefox we can't set data in async function
    }
  }

  /**
   * Select Block by its index
   * @param {number?} index - Block index according to the BlockManager's indexes
   */
  public selectBlockByIndex(index: number): void {
    const { BlockManager } = this.Blok;

    const block = BlockManager.getBlockByIndex(index);

    if (block === undefined) {
      return;
    }

    this.selectBlock(block);
  }

  /**
   * Select passed Block
   * @param {Block} block - Block to select
   */
  public selectBlock(block: Block): void {
    /** Save selection */
    this.selection.save();
    const selection = SelectionUtils.get();

    selection?.removeAllRanges();

    const blockToSelect = block;

    blockToSelect.selected = true;

    this.clearCache();

    /** close InlineToolbar when we selected any Block */
    this.Blok.InlineToolbar.close();
  }

  /**
   * Remove selection from passed Block
   * @param {Block} block - Block to unselect
   */
  public unselectBlock(block: Block): void {
    const blockToUnselect = block;

    blockToUnselect.selected = false;

    this.clearCache();
  }

  /**
   * Clear anyBlockSelected cache
   */
  public clearCache(): void {
    this.anyBlockSelectedCache = null;
  }

  /**
   * Enables navigation mode starting from the current block.
   * In this mode, user can navigate between blocks using arrow keys.
   */
  public enableNavigationMode(): void {
    const { BlockManager } = this.Blok;

    if (this._navigationModeEnabled) {
      return;
    }

    this._navigationModeEnabled = true;

    /**
     * Start navigation from current block or first block
     */
    const startIndex = BlockManager.currentBlockIndex >= 0
      ? BlockManager.currentBlockIndex
      : 0;

    this.setNavigationFocus(startIndex);
  }

  /**
   * Disables navigation mode and optionally focuses the block for editing
   * @param {boolean} focusForEditing - if true, set caret to the focused block
   */
  public disableNavigationMode(focusForEditing = false): void {
    if (!this._navigationModeEnabled) {
      return;
    }

    const focusedBlock = this.navigationFocusedBlock;

    /**
     * Remove navigation highlight from current block
     */
    if (focusedBlock) {
      focusedBlock.holder.removeAttribute('data-blok-navigation-focused');
    }

    this._navigationModeEnabled = false;

    /**
     * If requested, focus the block for editing
     */
    if (focusForEditing && focusedBlock) {
      const { Caret, BlockManager } = this.Blok;

      BlockManager.currentBlockIndex = this.navigationFocusIndex;
      Caret.setToBlock(focusedBlock, Caret.positions.END);
    }

    this.navigationFocusIndex = -1;
  }

  /**
   * Navigate to the next block in navigation mode
   * @returns {boolean} - true if navigation was successful
   */
  public navigateNext(): boolean {
    if (!this._navigationModeEnabled) {
      return false;
    }

    const { BlockManager } = this.Blok;
    const nextIndex = this.navigationFocusIndex + 1;

    if (nextIndex >= BlockManager.blocks.length) {
      return false;
    }

    this.setNavigationFocus(nextIndex);

    return true;
  }

  /**
   * Navigate to the previous block in navigation mode
   * @returns {boolean} - true if navigation was successful
   */
  public navigatePrevious(): boolean {
    if (!this._navigationModeEnabled) {
      return false;
    }

    const prevIndex = this.navigationFocusIndex - 1;

    if (prevIndex < 0) {
      return false;
    }

    this.setNavigationFocus(prevIndex);

    return true;
  }

  /**
   * Sets navigation focus to a specific block index
   * @param {number} index - block index to focus
   */
  private setNavigationFocus(index: number): void {
    const { BlockManager } = this.Blok;
    const block = BlockManager.getBlockByIndex(index);

    if (!block) {
      return;
    }

    /**
     * Remove highlight from previous block
     */
    const previousBlock = this.navigationFocusedBlock;

    if (previousBlock) {
      previousBlock.holder.removeAttribute('data-blok-navigation-focused');
    }

    /**
     * Update focus index and highlight new block
     */
    this.navigationFocusIndex = index;
    block.holder.setAttribute('data-blok-navigation-focused', 'true');

    /**
     * Remove text selection and blur active element to hide caret
     */
    const selection = SelectionUtils.get();

    selection?.removeAllRanges();

    /**
     * Blur the active element to remove caret from contenteditable
     */
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    /**
     * Scroll block into view if needed
     */
    block.holder.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }

  /**
   * Module destruction
   * De-registers Shortcut CMD+A
   */
  public destroy(): void {
    /** Selection shortcut */
    Shortcuts.remove(this.Blok.UI.nodes.redactor, 'CMD+A');
  }

  /**
   * First CMD+A selects all input content by native behaviour,
   * next CMD+A keypress selects all blocks
   * @param {KeyboardEvent} event - keyboard event
   */
  private handleCommandA(event: KeyboardEvent): void {
    this.Blok.RectangleSelection.clearSelection();

    /** allow default selection on native inputs */
    if ($.isNativeInput(event.target) && !this.readyToBlockSelection) {
      this.readyToBlockSelection = true;

      return;
    }

    const workingBlock = this.Blok.BlockManager.getBlock(event.target as HTMLElement);

    if (!workingBlock) {
      return;
    }

    const inputs = workingBlock.inputs;

    /**
     * If Block has more than one editable element allow native selection
     * Second cmd+a will select whole Block
     */
    if (inputs.length > 1 && !this.readyToBlockSelection) {
      this.readyToBlockSelection = true;

      return;
    }

    if (inputs.length === 1 && !this.needToSelectAll) {
      this.needToSelectAll = true;

      return;
    }

    if (this.needToSelectAll) {
      /**
       * Prevent default selection
       */
      event.preventDefault();

      this.selectAllBlocks();

      /**
       * Disable any selection after all Blocks selected
       */
      this.needToSelectAll = false;
      this.readyToBlockSelection = false;

      return;
    }

    if (!this.readyToBlockSelection) {
      return;
    }

    /**
     * prevent default selection when we use custom selection
     */
    event.preventDefault();

    /**
     * select working Block
     */
    this.selectBlock(workingBlock);

    /**
     * Enable all Blocks selection if current Block is selected
     */
    this.needToSelectAll = true;
  }

  /**
   * Select All Blocks
   * Each Block has selected setter that makes Block copyable
   */
  private selectAllBlocks(): void {
    /**
     * Save selection
     * Will be restored when closeSelection fired
     */
    this.selection.save();

    /**
     * Remove Ranges from Selection
     */
    const selection = SelectionUtils.get();

    selection?.removeAllRanges();

    this.allBlocksSelected = true;

    /** close InlineToolbar if we selected all Blocks */
    this.Blok.InlineToolbar.close();

    /**
     * Show toolbar for multi-block selection
     */
    this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
  }

  /**
   * Remove selected blocks and insert pressed printable key
   * @param event - keyboard event that triggers replacement
   */
  private replaceSelectedBlocksWithPrintableKey(event: KeyboardEvent): void {
    const { BlockManager, Caret } = this.Blok;

    const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

    if (insertedBlock) {
      Caret.setToBlock(insertedBlock);
    }

    delay(() => {
      const eventKey = event.key;

      /**
       * If event.key length >1 that means key is special (e.g. Enter or Dead or Unidentified).
       * So we use empty string
       * @see https://developer.mozilla.org/ru/docs/Web/API/KeyboardEvent/key
       */
      Caret.insertContentAtCaretPosition(eventKey.length > 1 ? '' : eventKey);

    }, 20)();
  }
}
