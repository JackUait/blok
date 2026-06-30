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
import { blocksToMarkdown } from '../../markdown/blocks-to-markdown';
import { SelectionUtils } from '../selection/index';
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
      mark: {
        style: true,
      },
    };

    return composeSanitizerConfig(this.config.sanitizer as SanitizerConfig, baseConfig);
  }

  /**
   * Flag that identifies all Blocks selection
   * @returns {boolean}
   */
  public get allBlocksSelected(): boolean {
    const { BlockManager } = this.Blok;

    return BlockManager.blocks.every((block) => block.selected);
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
      this.anyBlockSelectedCache = BlockManager.blocks.some((block) => block.selected);
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
   * Flag used to define the container-scoped intermediate stage.
   * When the working Block is nested inside a container (column/toggle/callout),
   * the first escalation selects the container's siblings; the next selects all
   * Blocks. This flag records that the container stage has already happened.
   * @type {boolean}
   */
  private containerBlocksSelected = false;

  /**
   * Flag used to define the subtree-scoped intermediate stage (Notion parity).
   * When the working Block owns nested descendants (its `contentIds` is
   * non-empty), the escalation after the single-Block stage selects the working
   * Block PLUS its entire subtree before climbing to the container/all-Blocks
   * stages. This flag records that the subtree stage has already happened so a
   * further Cmd+A keeps escalating.
   * @type {boolean}
   */
  private subtreeBlocksSelected = false;

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
    this.containerBlocksSelected = false;
    this.subtreeBlocksSelected = false;

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

    /**
     * Build custom Blok MIME_TYPE data synchronously using preserved data.
     * This ensures clipboardData.setData() is called synchronously during the event handler,
     * which is required for clipboard operations to work reliably across all browsers.
     *
     * Using preservedData (cached from last save) instead of calling async block.save()
     * because setData() must be called synchronously in the clipboard event handler.
     *
     * Child blocks of selected blocks are included even when not explicitly selected
     * (e.g. when a collapsed toggle is copied — its hidden children must travel with it
     * so paste can restore the full toggle with its children).
     */
    const savedData = this.serializeBlocksForClipboard(this.selectedBlocks);

    this.selectedBlocks.forEach((block) => {
      const cleanHTML = clean(block.holder.innerHTML, this.sanitizerConfig);
      const wrapper = $.make('div');

      wrapper.innerHTML = cleanHTML;

      const textContent = wrapper.textContent ?? '';

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

    /**
     * The text/plain flavor carries Markdown — headings as `#`, bold as `**`,
     * lists as `- `/`1. `, and to-dos as `- [x]`/`- [ ]` with structural
     * indentation — matching Notion's default Cmd+C, which puts marker-bearing
     * Markdown (not stripped text) into text/plain so structure survives in
     * plain-text-only targets. The explicit "Copy as Markdown" command
     * ({@link copySelectedBlocksAsMarkdown}, bound to Cmd/Ctrl+Shift+C) emits the
     * same Markdown but writes it via navigator.clipboard.writeText.
     */
    const textPlain = blocksToMarkdown(savedData);
    const textHTML = fakeClipboard.innerHTML;

    /**
     * Set all clipboard data types synchronously.
     * This MUST happen synchronously within the event handler for clipboard operations
     * to work reliably across all browsers (especially Firefox).
     */
    clipboardData.setData('text/plain', textPlain);
    clipboardData.setData('text/html', textHTML);

    try {
      clipboardData.setData(this.Blok.Paste.MIME_TYPE, JSON.stringify(savedData));
    } catch (error) {
      /**
       * Some browsers may throw when setting custom MIME types.
       * The text/plain and text/html fallback should still work.
       */
      if (error instanceof Error) {
        // Log the error but don't fail the entire copy operation
        console.warn('Failed to set custom clipboard data:', error.message);
      }
    }
  }

  /**
   * Copy the selected Blocks (or, if none are selected, the current Block) to the
   * clipboard as Markdown. Mirrors Notion's "Copy as Markdown" (Cmd/Ctrl+Shift+C),
   * which is the only Notion copy path that emits Markdown — the default Cmd+C
   * copies stripped plain text (see {@link copySelectedBlocks}).
   * @returns {Promise<void>}
   */
  public async copySelectedBlocksAsMarkdown(): Promise<void> {
    const blocks = this.anyBlockSelected ? this.selectedBlocks : [this.Blok.BlockManager.currentBlock].filter((block): block is Block => block != null);

    if (blocks.length === 0) {
      return;
    }

    const savedData = this.serializeBlocksForClipboard(blocks);
    const markdown = blocksToMarkdown(savedData);

    const { clipboard } = navigator;

    if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(markdown);
    }
  }

  /**
   * Serialize Blocks (and any nested children not explicitly in the list) into the
   * plain shape used for clipboard payloads. Children of selected blocks are
   * included even when not explicitly selected (e.g. a collapsed toggle's hidden
   * children must travel with it so paste can restore the full subtree).
   * @param blocks - the blocks to serialize
   * @returns serialized block data in document order
   */
  private serializeBlocksForClipboard(blocks: Block[]): Array<{ id: string; tool: string; data: Record<string, unknown>; tunes: Record<string, unknown>; parentId: string | null; contentIds: string[]; indent: number }> {
    const collected: Block[] = [];
    const seen = new Set<string>();

    const collect = (block: Block): void => {
      if (seen.has(block.id)) {
        return;
      }
      seen.add(block.id);
      collected.push(block);

      for (const childId of block.contentIds) {
        const child = this.Blok.BlockManager.getBlockById(childId);

        if (child !== undefined && !seen.has(child.id)) {
          collect(child);
        }
      }
    };

    for (const block of blocks) {
      collect(block);
    }

    return collected.map((block) => ({
      id: block.id,
      tool: block.name,
      data: block.preservedData,
      tunes: block.preservedTunes,
      parentId: block.parentId,
      contentIds: block.contentIds,
      indent: this.Blok.BlockManager.getBlockDepth(block),
    }));
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

    /**
     * Prime the Cmd+A escalation state so a block selected via any path
     * (caret, rectangle selection, public API, or the Cmd+A handler itself)
     * escalates on the next Cmd+A — to the container's siblings when nested,
     * otherwise to all Blocks — instead of dropping back to the text stage.
     */
    this.readyToBlockSelection = true;
    this.needToSelectAll = true;

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
     * Remove navigation marker from current block
     */
    if (focusedBlock) {
      focusedBlock.holder.removeAttribute('data-blok-navigation-focused');
    }

    this._navigationModeEnabled = false;

    /**
     * Clear the REAL block selection that backed navigation mode (the focused
     * block plus any Shift+Arrow extension). Done before setting the caret so
     * editing resumes on a clean, unselected block.
     */
    for (const selected of this.selectedBlocks) {
      selected.selected = false;
    }
    this.clearCache();

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
     * Remove the navigation marker from the previously focused block
     */
    const previousBlock = this.navigationFocusedBlock;

    if (previousBlock) {
      previousBlock.holder.removeAttribute('data-blok-navigation-focused');
    }

    /**
     * Navigation mode is a REAL single-block selection that moves with the arrow
     * keys (Notion parity). Collapse any existing selection — the previously
     * focused block plus any blocks a Shift+Arrow extension added — down to the
     * newly focused block so plain Arrow navigation stays single-selection while
     * Backspace/Delete, Cmd+C and Shift+Arrow keep operating on the selection.
     */
    for (const selected of this.selectedBlocks) {
      if (selected !== block) {
        selected.selected = false;
      }
    }

    /**
     * Remove the native text selection and blur the caret BEFORE selecting the
     * block for real, mirroring {@link selectBlock} — so the selection setter's
     * fake-cursor logic doesn't drop a stray cursor into the now-selected block.
     */
    const selection = SelectionUtils.get();

    selection?.removeAllRanges();

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    /**
     * Update focus index, mark the new block, and select it for real so
     * anyBlockSelected becomes true (gates deletion/copy/extension).
     */
    this.navigationFocusIndex = index;
    BlockManager.currentBlockIndex = index;
    block.holder.setAttribute('data-blok-navigation-focused', 'true');
    block.selected = true;
    this.clearCache();

    /**
     * Prime the Cmd+A escalation state, mirroring {@link selectBlock}, so a Cmd+A
     * after Escape escalates to all Blocks instead of dropping back to the text
     * stage.
     */
    this.readyToBlockSelection = true;
    this.needToSelectAll = true;

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

    /**
     * Once every Block is selected, further Cmd+A is a terminal no-op — Notion
     * stays at "all selected" until the selection is cleared (typing, click,
     * arrows, Escape) rather than looping back to text selection.
     */
    if (this.allBlocksSelected) {
      event.preventDefault();

      return;
    }

    /**
     * First Cmd+A: allow the native selection of the Block's content (text).
     * The next press escalates to block-level selection. This mirrors Notion's
     * three-stage Cmd+A — text → this block → all blocks — for both single-input
     * and multi-input tools (single-input tools previously skipped the per-block
     * stage and jumped straight to all-blocks).
     */
    if (!this.readyToBlockSelection) {
      /**
       * An empty block has no text to select natively, and a block whose text is
       * already fully selected has nothing left to escalate at the text stage —
       * both jump straight to block-level selection so the press count matches
       * Notion (two presses to all-blocks instead of three).
       */
      if (workingBlock.isEmpty || this.isBlockFullySelected(workingBlock)) {
        event.preventDefault();
        this.selectBlock(workingBlock);
        this.needToSelectAll = true;
        this.readyToBlockSelection = true;

        return;
      }

      this.readyToBlockSelection = true;

      return;
    }

    if (this.needToSelectAll) {
      /**
       * Prevent default selection
       */
      event.preventDefault();

      /**
       * Subtree-scoped intermediate stage (Notion parity): when the working
       * Block owns nested descendants (Tab-nested children, etc.), the first
       * escalation selects the working Block PLUS its entire subtree before
       * climbing to the container/all-Blocks stages. This is the only stage that
       * fires for a root-level parent (parentId === null) whose children were
       * nested via Tab — previously it jumped straight to all-Blocks, never
       * selecting the subtree it owns.
       */
      if (workingBlock.contentIds.length > 0 && !this.subtreeBlocksSelected) {
        this.selectSubtree(workingBlock);
        this.subtreeBlocksSelected = true;

        return;
      }

      /**
       * Container-scoped intermediate stage (Notion parity): when the working
       * Block is nested inside a container, the next escalation selects the
       * container's sibling Blocks; only the press after that selects every
       * Block in the document.
       */
      if (workingBlock.parentId !== null && !this.containerBlocksSelected) {
        this.selectContainerBlocks(workingBlock);
        this.containerBlocksSelected = true;

        return;
      }

      this.selectAllBlocks();

      /**
       * Disable any selection after all Blocks selected
       */
      this.needToSelectAll = false;
      this.readyToBlockSelection = false;
      this.containerBlocksSelected = false;
      this.subtreeBlocksSelected = false;

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
  /**
   * Whether the current native selection already spans the whole of the given
   * block's text. Used so the first Cmd+A promotes straight to block selection
   * when there is nothing left to select at the text stage (Notion parity).
   * @param block - the block whose content to compare against the selection
   */
  private isBlockFullySelected(block: Block): boolean {
    const selection = SelectionUtils.get();

    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
    const selectedText = normalize(selection.toString());
    const blockText = normalize(block.pluginsContent.textContent ?? '');

    return blockText.length > 0 && selectedText === blockText;
  }

  /**
   * Select the working Block plus its entire nested subtree (a DFS over
   * `contentIds`). Used by the Cmd+A escalation as the stage that selects an
   * item together with the descendants it owns — including a root-level parent
   * whose children were nested via Tab.
   * @param block - the Block whose subtree to select
   */
  private selectSubtree(block: Block): void {
    const { BlockManager } = this.Blok;

    /**
     * Save selection — will be restored when closeSelection fires
     */
    this.selection.save();

    const selection = SelectionUtils.get();

    selection?.removeAllRanges();

    const select = (current: Block): void => {
      current.selected = true;

      for (const childId of current.contentIds) {
        const child = BlockManager.getBlockById(childId);

        if (child !== undefined) {
          select(child);
        }
      }
    };

    select(block);

    this.clearCache();

    /** close InlineToolbar when we selected the subtree */
    this.Blok.InlineToolbar.close();

    /**
     * Show toolbar for multi-block selection
     */
    this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
  }

  /**
   * Select the sibling Blocks that share the working Block's container.
   * Used by the Cmd+A escalation as the intermediate stage between selecting
   * the single Block and selecting every Block in the document.
   * @param block - a Block nested inside the container whose siblings to select
   */
  private selectContainerBlocks(block: Block): void {
    const { BlockManager } = this.Blok;
    const { parentId } = block;

    if (parentId === null) {
      return;
    }

    const parent = BlockManager.getBlockById(parentId);

    if (parent === undefined) {
      return;
    }

    /**
     * Save selection — will be restored when closeSelection fires
     */
    this.selection.save();

    const selection = SelectionUtils.get();

    selection?.removeAllRanges();

    for (const childId of parent.contentIds) {
      const child = BlockManager.getBlockById(childId);

      if (child !== undefined) {
        child.selected = true;
      }
    }

    this.clearCache();

    /** close InlineToolbar when we selected the container's Blocks */
    this.Blok.InlineToolbar.close();

    /**
     * Show toolbar for multi-block selection
     */
    this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
  }

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
