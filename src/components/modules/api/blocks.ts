import type { BlockToolData, LooseOutputBlockData, LooseOutputData, OutputBlockData, OutputData, ToolConfig } from '../../../../types';
import type { BlockAPI as BlockAPIInterface, Blocks } from '../../../../types/api';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import { blocksToMarkdown } from '../../../markdown/blocks-to-markdown';
import type { MarkdownImportConfig } from '../../../markdown/types';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import { Module } from '../../__module';
import { Block } from '../../block';
import { BlockAPI } from '../../block/api';
import { ToolNotFoundError } from '../../errors/tool-not-found';
import { capitalize } from '../../utils';
import { announce } from '../../utils/announcer';
import { cloneOutputBlocks } from '../../utils/clone-output-blocks';
import { normalizeTableChildParents } from '../../utils/data-model-transform';
import { equalsOutputData, normalizeOutputBlocks } from '../../../shared/output-data';
import { highlightBlockArrival } from '../../utils/highlight-block-arrival';

import { logLabeled } from './../../utils';


/**
 * @class BlocksAPI
 * provides with methods working with Block
 */
export class BlocksAPI extends Module {
  /**
   * Available methods
   * @returns {Blocks}
   */
  public get methods(): Blocks {
    const blocksAPI = this;

    return {
      get isSyncingFromYjs(): boolean {
        return blocksAPI.Blok.BlockManager.isSyncingFromYjs;
      },
      get isPointerDragActive(): boolean {
        return blocksAPI.Blok.BlockManager.isPointerDragActive;
      },
      clear: (): Promise<void> => this.clear(),
      render: (data: OutputData): Promise<void> => this.render(data),
      renderFromHTML: (data: string): Promise<void> => this.renderFromHTML(data),
      importMarkdown: (md: string, options?: MarkdownImportConfig): Promise<OutputData> => this.importMarkdown(md, options),
      exportMarkdown: (): Promise<string> => this.exportMarkdown(),
      delete: (index?: number, setCaret?: boolean): Promise<void> => this.delete(index, setCaret),
      move: (toIndex: number, fromIndex?: number): void => this.move(toIndex, fromIndex),
      getBlockByIndex: (index: number): BlockAPIInterface | undefined => this.getBlockByIndex(index),
      getById: (id: string): BlockAPIInterface | null => this.getById(id),
      getCurrentBlockIndex: (): number => this.getCurrentBlockIndex(),
      getBlockIndex: (id: string): number | undefined => this.getBlockIndex(id),
      getBlocksCount: (): number => this.getBlocksCount(),
      getBlockByElement: (element: HTMLElement) => this.getBlockByElement(element),
      getChildren: (parentId: string): BlockAPIInterface[] => this.getChildren(parentId),
      insert: this.insert,
      insertMany: this.insertMany,
      update: this.update,
      composeBlockData: this.composeBlockData,
      convert: this.convert,
      setBlockParent: (blockId: string, parentId: string | null): void => this.setBlockParent(blockId, parentId),
      stopBlockMutationWatching: (index: number): void => this.stopBlockMutationWatching(index),
      startBlockMutationWatching: (blockId: string): void => this.startBlockMutationWatching(blockId),
      splitBlock: this.splitBlock,
      insertInsideParent: this.insertInsideParent,
      transact: (fn: () => void): void => this.transact(fn),
      transactWithoutCapture: (fn: () => void): void => this.transactWithoutCapture(fn),
      setPointerDragActive: (active: boolean): void => this.setPointerDragActive(active),
      scrollToBlock: (id: string): void => this.scrollToBlock(id),
    };
  }

  /**
   * Returns Blocks count
   * @returns {number}
   */
  public getBlocksCount(): number {
    return this.Blok.BlockManager.blocks.length;
  }

  /**
   * Returns current block index
   * @returns {number}
   */
  public getCurrentBlockIndex(): number {
    return this.Blok.BlockManager.currentBlockIndex;
  }

  /**
   * Returns the index of Block by id;
   * @param id - block id
   */
  public getBlockIndex(id: string): number | undefined {
    const block = this.Blok.BlockManager.getBlockById(id);

    if (!block) {
      logLabeled('There is no block with id `' + id + '`', 'warn');

      return;
    }

    return this.Blok.BlockManager.getBlockIndex(block);
  }

  /**
   * Returns BlockAPI object by Block index
   * @param {number} index - index to get
   */
  public getBlockByIndex(index: number): BlockAPIInterface | undefined {
    const block = this.Blok.BlockManager.getBlockByIndex(index);

    if (block === undefined) {
      logLabeled('There is no block at index `' + index + '`', 'warn');

      return;
    }

    return new BlockAPI(block);
  }

  /**
   * Returns BlockAPI object by Block id
   * @param id - id of block to get
   */
  public getById(id: string): BlockAPIInterface | null {
    const block = this.Blok.BlockManager.getBlockById(id);

    if (block === undefined) {
      logLabeled('There is no block with id `' + id + '`', 'warn');

      return null;
    }

    return new BlockAPI(block);
  }

  /**
   * Get Block API object by any child html element
   * @param element - html element to get Block by
   */
  public getBlockByElement(element: HTMLElement): BlockAPIInterface | undefined {
    const block = this.Blok.BlockManager.getBlock(element);

    if (block === undefined) {
      logLabeled(`There is no block corresponding to element <${element.tagName?.toLowerCase() ?? 'unknown'}>`, 'warn');

      return;
    }

    return new BlockAPI(block);
  }

  /**
   * Returns all child blocks of a parent container block
   * @param parentId - id of the parent block
   */
  public getChildren(parentId: string): BlockAPIInterface[] {
    const children = this.Blok.BlockManager.blocks.filter(
      (block) => block.parentId === parentId
    );

    return children.map((block) => new BlockAPI(block));
  }


  /**
   * Move block from one index to another
   * @param {number} toIndex - index to move to
   * @param {number} fromIndex - index to move from
   */
  public move(toIndex: number, fromIndex?: number): void {
    this.Blok.BlockManager.move(toIndex, fromIndex);
  }

  /**
   * Deletes Block
   * @param {number} blockIndex - index of Block to delete
   * @param {boolean} setCaret - whether to move the caret to the surviving current
   *   block after deletion. Defaults to `true` (interactive delete). Pass `false`
   *   for programmatic deletion (e.g. React `useBlocks.remove`) so the user's
   *   caret is not stolen from wherever they are typing.
   */
  public async delete(
    blockIndex: number = this.Blok.BlockManager.currentBlockIndex,
    setCaret = true
  ): Promise<void> {
    const block = this.Blok.BlockManager.getBlockByIndex(blockIndex);

    if (block === undefined) {
      logLabeled(`There is no block at index \`${blockIndex}\``, 'warn');

      return;
    }

    try {
      await this.Blok.BlockManager.removeBlock(block);
    } catch (error: unknown) {
      logLabeled(error as string, 'warn');

      return;
    }

    /**
     * Note: default-block insertion when the store is empty is handled
     * synchronously by removeBlock(block, addLastBlock=true).
     * A redundant async check here would race with clear()/render()
     * and could insert a spurious paragraph after the store has been
     * repopulated by Renderer.
     */

    /**
     * After Block deletion currentBlock is updated
     */
    if (setCaret && this.Blok.BlockManager.currentBlock) {
      this.Blok.Caret.setToBlock(this.Blok.BlockManager.currentBlock, this.Blok.Caret.positions.END);
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Clear Blok's area
   */
  public async clear(): Promise<void> {
    await this.Blok.BlockManager.clear(true);
    this.Blok.InlineToolbar.close();
  }

  /**
   * Fills Blok with Blocks data
   * @param {OutputData} data — Saved Blok data
   */
  public async render(data: OutputData | LooseOutputData): Promise<void> {
    if (data === undefined || data.blocks === undefined) {
      throw new Error('Incorrect data passed to the render() method');
    }

    /**
     * Echo-safety: render() is a full clear-and-rebuild that destroys the
     * caret/selection. When a consumer round-trips editor output through
     * their state (data → render → onSave → setState → data), the echoed
     * document is structurally identical to the current content — rebuilding
     * would clobber the caret for zero visual change. Compare against the
     * current saved state and no-op on equality (time/version are ignored).
     */
    const currentContent = await this.Blok.Saver.save();

    if (currentContent !== undefined && equalsOutputData(currentContent, data)) {
      this.processPendingHashScroll();

      return;
    }

    /**
     * Semantic meaning of the "render" method: "Display the new document over the existing one that stays unchanged"
     * So we need to disable modifications observer temporarily
     */
    this.Blok.ModificationsObserver.disable();
    this.Blok.Renderer.markRenderStart();

    try {
      await this.Blok.BlockManager.clear();
      // The caller owns `data` (often frozen store state): normalize the
      // loose wire shape, then deep-clone at this boundary so the editor
      // never mutates or retains their objects.
      await this.Blok.Renderer.render(cloneOutputBlocks(normalizeOutputBlocks(data.blocks)));
    } finally {
      this.Blok.Renderer.markRenderEnd();
    }

    this.Blok.ModificationsObserver.enable();

    this.processPendingHashScroll();
  }

  /**
   * Render passed HTML string
   * @param {string} data - HTML string to render
   * @returns {Promise<void>}
   */
  public async renderFromHTML(data: string): Promise<void> {
    this.Blok.Renderer.markRenderStart();

    try {
      await this.Blok.BlockManager.clear();

      return this.Blok.Paste.processText(data, true);
    } finally {
      this.Blok.Renderer.markRenderEnd();
    }
  }

  /**
   * Import Markdown string as blocks.
   * Lazy-loads the markdown converter on first call.
   * @param md - Markdown source string
   * @param options - Optional configuration for tool mapping and extensions
   */
  public async importMarkdown(md: string, options?: MarkdownImportConfig): Promise<OutputData> {
    const { markdownToBlocks } = await import('../../../markdown/index');
    const blocks = await markdownToBlocks(md, options);
    const data: OutputData = { blocks };

    await this.render(data);

    return data;
  }

  /**
   * Export the current document as a Markdown string — the outbound twin of
   * {@link importMarkdown}. Blocks are read through the Saver, so the output
   * reflects the saved (validated) document rather than raw DOM.
   *
   * Blocks owned by a table cell are serialized INSIDE the pipe table and are not
   * repeated as loose lines (see `blocksToMarkdown`).
   * @returns the document as Markdown ('' when there is nothing to save)
   */
  public async exportMarkdown(): Promise<string> {
    const output = await this.Blok.Saver.save();

    if (output === undefined) {
      return '';
    }

    const parentOf = new Map<string, string | null>();

    for (const block of output.blocks) {
      if (block.id !== undefined) {
        parentOf.set(block.id, block.parent ?? null);
      }
    }

    /**
     * Structural nesting depth of a block (its parentId-chain length).
     * @param id - block id
     * @returns the depth, 0 for root-level blocks
     */
    const depthOf = (id: string | undefined, seen: Set<string> = new Set()): number => {
      if (id === undefined || seen.has(id)) {
        return 0;
      }

      const parent = parentOf.get(id);

      if (typeof parent !== 'string') {
        return 0;
      }

      seen.add(id);

      return 1 + depthOf(parent, seen);
    };

    return blocksToMarkdown(output.blocks.map((block) => ({
      id: block.id,
      tool: block.type,
      data: block.data,
      parentId: block.parent ?? null,
      indent: depthOf(block.id),
    })));
  }

  /**
   * Insert new Block and returns it's API
   * @param {string} type — Tool name
   * @param {BlockToolData} data — Tool data to insert
   * @param {ToolConfig} _config — Tool config
   * @param {number?} index — index where to insert new Block
   * @param {boolean?} needToFocus - flag to focus inserted Block
   * @param replace - pass true to replace the Block existed under passed index
   * @param {string} id — An optional id for the new block. If omitted then the new id will be generated
   * @param tunes — optional block tune data to apply at creation, keyed by tune name
   */
  public insert = (
    type?: string,
    data: BlockToolData = {},
    _config: ToolConfig = {},
    index?: number,
    needToFocus?: boolean,
    replace?: boolean,
    id?: string,
    tunes?: { [name: string]: BlockTuneData }
  ): BlockAPIInterface => {
    const defaultTool = type ?? (this.config.defaultBlock);
    const tool = (() => {
      if (!defaultTool) {
        return defaultTool;
      }

      const targetIndex = index ?? this.Blok.BlockManager.currentBlockIndex;
      /**
       * A negative index carries no table-cell context: `currentBlockIndex` is -1
       * when nothing is focused, and `getBlockByIndex(-1)` is the repository's
       * legacy "give me the LAST block" shorthand. Feeding it -1 made the guard
       * inspect the document's last block, so a restricted tool inserted into a
       * document that merely ENDS with a table was silently demoted to a paragraph.
       */
      const targetBlock = targetIndex >= 0
        ? this.Blok.BlockManager.getBlockByIndex(targetIndex)
        : undefined;

      if (targetBlock !== undefined && isInsideTableCell(targetBlock) && isRestrictedInTableCell(defaultTool)) {
        return 'paragraph';
      }

      return defaultTool;
    })();

    const insertedBlock = this.Blok.BlockManager.insert({
      id,
      tool,
      data,
      index,
      needToFocus,
      replace,
      tunes,
    });

    return new BlockAPI(insertedBlock);
  };

  /**
   * Creates data of an empty block with a passed type.
   * @param toolName - block tool name
   */
  public composeBlockData = async (toolName: string): Promise<BlockToolData> => {
    const tool = this.Blok.Tools.blockTools.get(toolName);

    if (tool === undefined) {
      throw new ToolNotFoundError(toolName, `Block Tool with type "${toolName}" not found`);
    }

    const block = new Block({
      tool,
      api: this.Blok.API,
      readOnly: true,
      data: {},
      tunesData: {},
    });

    return block.data;
  };

  /**
   * Updates block data by id
   * @param id - id of the block to update
   * @param data - (optional) the new data
   * @param tunes - (optional) tune data
   */
  public update = async (id: string, data?: Partial<BlockToolData>, tunes?: {[name: string]: BlockTuneData}): Promise<BlockAPIInterface> => {
    const { BlockManager } = this.Blok;
    const block = BlockManager.getBlockById(id);

    if (block === undefined) {
      throw new Error(`Block with id "${id}" not found`);
    }

    const updatedBlock = await BlockManager.update(block, data, tunes);

    return new BlockAPI(updatedBlock);
  };

  /**
   * Converts block to another type. Both blocks should provide the conversionConfig.
   * @param id - id of the existing block to convert. Should provide 'conversionConfig.export' method
   * @param newType - new block type. Should provide 'conversionConfig.import' method
   * @param dataOverrides - optional data overrides for the new block
   * @throws Error if conversion is not possible
   */
  private convert = async (id: string, newType: string, dataOverrides?: BlockToolData): Promise<BlockAPIInterface> => {
    const { BlockManager, Tools } = this.Blok;
    const blockToConvert = BlockManager.getBlockById(id);

    if (!blockToConvert) {
      throw new Error(`Block with id "${id}" not found`);
    }

    const originalBlockTool = Tools.blockTools.get(blockToConvert.name);
    const targetBlockTool = Tools.blockTools.get(newType);

    if (!targetBlockTool) {
      throw new ToolNotFoundError(newType, `Block Tool with type "${newType}" not found`);
    }

    const originalBlockConvertable = originalBlockTool?.conversionConfig?.export !== undefined;
    const targetBlockConvertable = targetBlockTool.conversionConfig?.import !== undefined;

    if (originalBlockConvertable && targetBlockConvertable) {
      const newBlock = await BlockManager.convert(blockToConvert, newType, dataOverrides);

      return new BlockAPI(newBlock);
    } else {
      const unsupportedBlockTypes = [
        !originalBlockConvertable ? capitalize(blockToConvert.name) : false,
        !targetBlockConvertable ? capitalize(newType) : false,
      ].filter(Boolean).join(' and ');

      throw new Error(`Conversion from "${blockToConvert.name}" to "${newType}" is not possible. ${unsupportedBlockTypes} tool(s) should provide a "conversionConfig"`);
    }
  };


  /**
   * Inserts several Blocks to a specified index
   *
   * The default index appends PAST the end of the flat store. It used to be
   * `length - 1` — the slot before the flat tail — which, for a document ending in
   * a nested-block tool (table/columns/toggle keep their children at the tail of
   * the same flat array), wedged the new blocks in between that container's
   * children instead of appending them to the document.
   * @param blocks - blocks data to insert
   * @param index - index to insert the blocks at. Defaults to the end of the document.
   */
  private insertMany = (
    blocks: OutputBlockData[] | LooseOutputBlockData[],
    index: number = this.Blok.BlockManager.blocks.length
  ): BlockAPIInterface[] => {
    this.validateIndex(index);

    // Backfill `parent` on children referenced by table cells so that
    // alternative load paths (any consumer of the public API) get the
    // same hierarchical correctness as Renderer.render(). Without this,
    // flat-array article shapes lose their cell→child relationship and
    // children render as detached top-level blocks. The loose wire shape
    // (null data/ids) is normalized first.
    const normalizedBlocks = normalizeTableChildParents(normalizeOutputBlocks(blocks));

    const blocksToInsert = normalizedBlocks.map(({ id, type, data, tunes, parent, content, lastEditedAt, lastEditedBy }) => {
      return this.Blok.BlockManager.composeBlock({
        id,
        tool: type || (this.config.defaultBlock as string),
        data: data,
        tunes,
        parentId: parent,
        contentIds: content,
        lastEditedAt,
        lastEditedBy,
      });
    });
    
    // notify: a programmatic bulk insert through the public API must emit a
    // BlockChanged mutation (mirroring single insert) so reactive consumers like
    // the React useBlocks hook re-render. Renderer.render() bypasses this wrapper
    // and calls BlockManager.insertMany directly, so initial render stays silent.
    this.Blok.BlockManager.insertMany(blocksToInsert, index, { notify: true });

    return blocksToInsert.map((block) => new BlockAPI(block));
  };

  /**
   * Insert a new paragraph block as a child of the given parent block, atomically.
   * The block creation and parent assignment are grouped into a single undo entry,
   * so a single CMD+Z removes the new block completely.
   *
   * @param parentId - id of the parent block
   * @param insertIndex - flat block index where the new block should appear
   * @returns BlockAPI for the newly created child block
   */
  private insertInsideParent = (parentId: string, insertIndex: number, childData?: BlockToolData): BlockAPIInterface => {
    // Force new undo group so this insertion is separate from previous typing,
    // UNLESS an enclosing atomic operation (e.g. tool conversion) has asked the
    // block manager to suppress stopCapturing so everything merges into a
    // single undo entry.
    if (!this.Blok.BlockManager.suppressStopCapturing) {
      this.Blok.YjsManager.stopCapturing();
    }

    const newBlock = this.Blok.BlockManager.insertInsideParent(parentId, insertIndex, childData);

    // NOTE: Do NOT call stopCapturing in a trailing microtask. The operations layer
    // uses extendThroughRAF on its atomic wrapper to keep isSyncingFromYjs true
    // through the next RAF, suppressing any stray mutation-observer-driven Yjs
    // writes from deferred DOM callbacks. A trailing stopCapturing would force
    // those late writes into a SEPARATE undo group, splitting the insertion
    // across two CMD+Z pops.

    return new BlockAPI(newBlock);
  };

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   * @param blockId - id of the block to reparent
   * @param parentId - id of the new parent block, or null for root level
   */
  private setBlockParent(blockId: string, parentId: string | null): void {
    const block = this.Blok.BlockManager.getBlockById(blockId);

    if (block === undefined) {
      logLabeled('There is no block with id `' + blockId + '`', 'warn');

      return;
    }

    this.Blok.BlockManager.setBlockParent(block, parentId);
  }

  /**
   * Stops mutation watching on a block at the specified index.
   * This is used to prevent spurious block-changed events during block replacement.
   * @param index - index of the block to stop watching
   */
  private stopBlockMutationWatching(index: number): void {
    const block = this.Blok.BlockManager.getBlockByIndex(index);

    if (block !== undefined) {
      block.unwatchBlockMutations();
    }
  }

  /**
   * Re-arms mutation watching on a block previously silenced via
   * stopBlockMutationWatching. Takes an id (not an index) because inserts
   * and replacements between the stop and the start shift indexes; a block
   * that no longer exists (e.g. replaced in place) is silently skipped —
   * its successor was constructed with its own watcher.
   * @param blockId - id of the block to resume watching
   */
  private startBlockMutationWatching(blockId: string): void {
    this.Blok.BlockManager.getBlockById(blockId)?.watchBlockMutations();
  }

  /**
   * Atomically splits a block by updating the current block's data and inserting a new block.
   * Both operations are grouped into a single undo entry.
   *
   * @param currentBlockId - id of the block to update
   * @param currentBlockData - new data for the current block (typically truncated content)
   * @param newBlockType - tool type for the new block
   * @param newBlockData - data for the new block (typically extracted content)
   * @param insertIndex - index where to insert the new block
   * @returns the newly created block
   */
  private splitBlock = (
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number
  ): BlockAPIInterface => {
    // Force new undo group so block split is separate from previous typing.
    this.Blok.YjsManager.stopCapturing();

    const newBlock = this.Blok.BlockManager.splitBlockWithData(
      currentBlockId,
      currentBlockData,
      newBlockType,
      newBlockData,
      insertIndex
    );

    // Use queueMicrotask to delay stopCapturing until after MutationObserver callbacks
    // have been processed. This ensures any DOM sync operations from the split complete first,
    // keeping them in the same undo entry as the split itself.
    queueMicrotask(() => {
      this.Blok.YjsManager.stopCapturing();
    });

    return new BlockAPI(newBlock);
  };

  /**
   * Execute a function within a transaction, grouping all block operations
   * into a single undo entry.
   */
  private transact(fn: () => void): void {
    this.Blok.BlockManager.transactForTool(fn);
  }

  /**
   * Execute a function without adding any block operations to the undo history.
   * Useful for auto-repair operations that should never appear in undo history.
   */
  private transactWithoutCapture(fn: () => void): void {
    this.Blok.YjsManager.transactWithoutCapture(fn);
  }

  /**
   * Notify BlockManager that a pointer drag interaction has started or ended.
   * While active, DOM-mutation-triggered Yjs syncs are suppressed to prevent
   * cross-cell browser DOM mutations from corrupting Yjs state.
   */
  private setPointerDragActive(active: boolean): void {
    this.Blok.BlockManager.setPointerDragActive(active);
  }

  /**
   * Validated block index and throws an error if it's invalid
   * @param index - index to validate
   */
  private validateIndex(index: unknown): void {
    if (typeof index !== 'number') {
      throw new Error('Index should be a number');
    }

    if (index < 0) {
      throw new Error(`Index should be greater than or equal to 0`);
    }
  }

  /**
   * Scrolls the block with the given id into view, selects it, highlights its
   * arrival and announces the navigation to assistive tech. No-op when no block
   * element with that id is present in the document.
   *
   * Public counterpart of the URL-hash scroll performed at boot. Adapters that
   * mount the editor into a DETACHED holder (React/Vue/Angular) render their
   * seeded content before the holder joins the document, so the boot-time
   * hash scroll — which queries the live document — finds nothing and defers.
   * Those adapters can drain that deferred navigation by calling this once the
   * holder connects, instead of hand-rolling a DOM-polling hook.
   * @param id - target block id
   */
  public scrollToBlock(id: string): void {
    const el = document.querySelector(`[data-blok-id="${CSS.escape(id)}"]`);

    if (el === null) {
      return;
    }

    /**
     * A public scroll to this exact block consumes any deferred boot-time hash
     * scroll for it, so a later render()-driven drain can't re-fire the same
     * navigation. An unrelated pending hash is left untouched.
     */
    if (this.Blok.Renderer.pendingHashScroll === id) {
      this.Blok.Renderer.pendingHashScroll = null;
    }

    const topOffset = this.config.scrollToBlock?.topOffset ?? 0;
    const y = el.getBoundingClientRect().top + window.scrollY - topOffset;

    window.scrollTo({ top: y, behavior: 'smooth' });

    const block = this.Blok.BlockManager.getBlockById(id);

    if (block !== undefined) {
      this.Blok.BlockSelection.selectBlock(block);
    }

    highlightBlockArrival(el);

    announce(this.Blok.I18n.t('a11y.navigatedToBlock'));
  }

  /**
   * If Renderer.pendingHashScroll is set (hash-based scroll was deferred because the
   * target block did not exist at init time), attempt to scroll to and select the block now.
   * Always clears the pending hash afterward (one-shot).
   */
  private processPendingHashScroll(): void {
    const hash = this.Blok.Renderer.pendingHashScroll;

    if (hash === null) {
      return;
    }

    this.Blok.Renderer.pendingHashScroll = null;

    this.scrollToBlock(hash);
  }
}
