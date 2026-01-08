/**
 * @class BlockManager
 * @classdesc Manage blok`s blocks storage and appearance
 * @module BlockManager
 * @version 2.0.0
 */
import { Block, BlockToolAPI } from '../block';
import { Module } from '../__module';
import { Dom as $ } from '../dom';
import { isEmpty, isObject, isString, log, generateBlockId } from '../utils';
import { Blocks } from '../blocks';
import type { BlockToolData, OutputBlockData, PasteEvent, SanitizerConfig } from '../../../types';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import { BlockAPI } from '../block/api';
import type { BlockMutationEventMap, BlockMutationType } from '../../../types/events/block';
import { BlockRemovedMutationType } from '../../../types/events/block/BlockRemoved';
import { BlockAddedMutationType } from '../../../types/events/block/BlockAdded';
import { BlockMovedMutationType } from '../../../types/events/block/BlockMoved';
import { BlockChangedMutationType } from '../../../types/events/block/BlockChanged';
import { BlockChanged } from '../events';
import { clean, composeSanitizerConfig, sanitizeBlocks } from '../utils/sanitizer';
import { convertStringToBlockData, isBlockConvertable } from '../utils/blocks';
import { DATA_ATTR, createSelector } from '../constants';
import { Shortcuts } from '../utils/shortcuts';
import { announce } from '../utils/announcer';
import type { BlockChangeEvent } from './yjsManager';
import type { Map as YMap } from 'yjs';

type BlocksStore = Blocks & {
  [index: number]: Block | undefined;
};

/**
 * @typedef {BlockManager} BlockManager
 * @property {number} currentBlockIndex - Index of current working block
 * @property {Proxy} _blocks - Proxy for Blocks instance {@link Blocks}
 */
export class BlockManager extends Module {
  /**
   * Returns current Block index
   * @returns {number}
   */
  public get currentBlockIndex(): number {
    return this._currentBlockIndex;
  }

  /**
   * Set current Block index and fire Block lifecycle callbacks
   * @param {number} newIndex - index of Block to set as current
   */
  public set currentBlockIndex(newIndex: number) {
    if (this._currentBlockIndex !== newIndex && !this.suppressStopCapturing) {
      this.Blok.YjsManager?.stopCapturing();
    }
    this._currentBlockIndex = newIndex;
  }

  /**
   * returns first Block
   * @returns {Block}
   */
  public get firstBlock(): Block | undefined {
    return this.blocksStore[0];
  }

  /**
   * returns last Block
   * @returns {Block}
   */
  public get lastBlock(): Block | undefined {
    return this.blocksStore[this.blocksStore.length - 1];
  }

  /**
   * Get current Block instance
   * @returns {Block}
   */
  public get currentBlock(): Block | undefined {
    return this.blocksStore[this.currentBlockIndex];
  }

  /**
   * Set passed Block as a current
   * @param block - block to set as a current
   */
  public set currentBlock(block: Block | undefined) {
    if (block === undefined) {
      this.unsetCurrentBlock();

      return;
    }

    this.currentBlockIndex = this.getBlockIndex(block);
  }

  /**
   * Returns next Block instance
   * @returns {Block|null}
   */
  public get nextBlock(): Block | null {
    const isLastBlock = this.currentBlockIndex === (this.blocksStore.length - 1);

    if (isLastBlock) {
      return null;
    }

    const nextBlock = this.blocksStore[this.currentBlockIndex + 1];

    return nextBlock ?? null;
  }

  /**
   * Return first Block with inputs after current Block
   * @returns {Block | undefined}
   */
  public get nextContentfulBlock(): Block | undefined {
    const nextBlocks = this.blocks.slice(this.currentBlockIndex + 1);

    return nextBlocks.find((block) => !!block.inputs.length);
  }

  /**
   * Return first Block with inputs before current Block
   * @returns {Block | undefined}
   */
  public get previousContentfulBlock(): Block | undefined {
    const previousBlocks = this.blocks.slice(0, this.currentBlockIndex).reverse();

    return previousBlocks.find((block) => !!block.inputs.length);
  }

  /**
   * Returns previous Block instance
   * @returns {Block|null}
   */
  public get previousBlock(): Block | null {
    const isFirstBlock = this.currentBlockIndex === 0;

    if (isFirstBlock) {
      return null;
    }

    const previousBlock = this.blocksStore[this.currentBlockIndex - 1];

    return previousBlock ?? null;
  }

  /**
   * Get array of Block instances
   * @returns {Block[]} {@link Blocks#array}
   */
  public get blocks(): Block[] {
    return this.blocksStore.array;
  }

  /**
   * Check if each Block is empty
   * @returns {boolean}
   */
  public get isBlokEmpty(): boolean {
    return this.blocks.every((block) => block.isEmpty);
  }

  /**
   * Index of current working block
   * @type {number}
   */
  private _currentBlockIndex = -1;

  /**
   * Proxy for Blocks instance {@link Blocks}
   * @type {Proxy}
   * @private
   */
  private _blocks: BlocksStore | null = null;

  /**
   * Counter to track active Yjs sync operations (undo/redo) to prevent re-syncing back.
   * Uses a counter instead of boolean to handle overlapping async operations safely.
   */
  private yjsSyncCount = 0;

  /**
   * Returns true if any Yjs sync operation is in progress
   */
  private get isSyncingFromYjs(): boolean {
    return this.yjsSyncCount > 0;
  }

  /**
   * Flag to suppress stopCapturing during atomic operations (like split)
   * This prevents breaking undo grouping when currentBlockIndex changes
   */
  private suppressStopCapturing = false;

  /**
   * Registered keyboard shortcut names for cleanup
   */
  private registeredShortcuts: string[] = [];

  /**
   * Should be called after Blok.UI preparation
   * Define this._blocks property
   */
  public prepare(): void {
    const blocks = new Blocks(this.Blok.UI.nodes.redactor);
    /**
     * We need to use Proxy to overload set/get [] operator.
     * So we can use array-like syntax to access blocks
     * @example
     * this._blocks[0] = new Block(...);
     *
     * block = this._blocks[0];
     * @todo proxy the enumerate method
     * @type {Proxy}
     * @private
     */
    this._blocks = new Proxy(blocks, {
      set: Blocks.set,
      get: Blocks.get,
    }) as BlocksStore;

    /** Copy event */
    this.listeners.on(
      document,
      'copy',
      (event: Event) => {
        this.Blok.BlockEvents.handleCommandC(event as ClipboardEvent);
      }
    );

    this.setupKeyboardShortcuts();

    // Subscribe to Yjs changes for undo/redo DOM synchronization
    this.Blok.YjsManager.onBlocksChanged((event: BlockChangeEvent) => {
      if (event.origin === 'undo' || event.origin === 'redo') {
        this.syncBlockFromYjs(event);
      }
    });
  }

  /**
   * Toggle read-only state
   *
   * If readOnly is true:
   * - Unbind event handlers from created Blocks
   *
   * if readOnly is false:
   * - Bind event handlers to all existing Blocks
   * @param {boolean} readOnlyEnabled - "read only" state
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      this.enableModuleBindings();
    } else {
      this.disableModuleBindings();
    }
  }

  /**
   * Creates Block instance by tool name
   * @param {object} options - block creation options
   * @param {string} options.tool - tools passed in blok config {@link BlokConfig#tools}
   * @param {string} [options.id] - unique id for this block
   * @param {BlockToolData} [options.data] - constructor params
   * @param {string} [options.parentId] - parent block id for hierarchical structure
   * @param {string[]} [options.contentIds] - array of child block ids
   * @returns {Block}
   */
  public composeBlock({
    tool: name,
    data = {},
    id = undefined,
    tunes: tunesData = {},
    parentId,
    contentIds,
    bindEventsImmediately = false,
  }: {
    tool: string;
    id?: string;
    data?: BlockToolData;
    tunes?: {[name: string]: BlockTuneData};
    parentId?: string;
    contentIds?: string[];
    /**
     * When true, bind all events immediately instead of deferring via requestIdleCallback.
     * This controls both Block-internal events (MutationObserver) and module-level events (keyboard handlers).
     */
    bindEventsImmediately?: boolean;
  }): Block {
    const readOnly = this.Blok.ReadOnly.isEnabled;
    const tool = this.Blok.Tools.blockTools.get(name);

    if (tool === undefined) {
      throw new Error(`Could not compose Block. Tool «${name}» not found.`);
    }

    const block = new Block({
      id,
      data,
      tool,
      api: this.Blok.API,
      readOnly,
      tunesData,
      parentId,
      contentIds,
      bindMutationWatchersImmediately: bindEventsImmediately,
    }, this.eventsDispatcher);

    if (readOnly) {
      return block;
    }

    if (bindEventsImmediately) {
      this.bindBlockEvents(block);
    } else {
      window.requestIdleCallback(() => {
        this.bindBlockEvents(block);
      }, { timeout: 2000 });
    }

    return block;
  }

  /**
   * Insert new block into _blocks
   * @param {object} options - insert options
   * @param {string} [options.id] - block's unique id
   * @param {string} [options.tool] - plugin name, by default method inserts the default block type
   * @param {object} [options.data] - plugin data
   * @param {number} [options.index] - index where to insert new Block
   * @param {boolean} [options.needToFocus] - flag shows if needed to update current Block index
   * @param {boolean} [options.replace] - flag shows if block by passed index should be replaced with inserted one
   * @param {boolean} [options.skipYjsSync] - if true, skip syncing to Yjs (caller handles sync separately)
   * @returns {Block}
   */
  public insert({
    id = undefined,
    tool,
    data,
    index,
    needToFocus = true,
    replace = false,
    tunes,
    skipYjsSync = false,
  }: {
    id?: string;
    tool?: string;
    data?: BlockToolData;
    index?: number;
    needToFocus?: boolean;
    replace?: boolean;
    tunes?: {[name: string]: BlockTuneData};
    skipYjsSync?: boolean;
  } = {}): Block {
    const targetIndex = index ?? this.currentBlockIndex + (replace ? 0 : 1);

    /**
     * If we're replacing a block, stop watching for mutations immediately to prevent
     * spurious block-changed events from DOM manipulations (like focus restoration)
     * that may occur before the block is fully replaced.
     */
    if (replace) {
      this.getBlockByIndex(targetIndex)?.unwatchBlockMutations();
    }
    const toolName = tool ?? this.config.defaultBlock;

    if (toolName === undefined) {
      throw new Error('Could not insert Block. Tool name is not specified.');
    }

    // Bind events immediately for user-created blocks so mutations are tracked right away
    const block = this.composeBlock({
      tool: toolName,
      bindEventsImmediately: true,
      ...(id !== undefined && { id }),
      ...(data !== undefined && { data }),
      ...(tunes !== undefined && { tunes }),
    });

    /**
     * In case of block replacing (Converting OR from Toolbox or Shortcut on empty block OR on-paste to empty block)
     * we need to dispatch the 'block-removing' event for the replacing block
     */
    const blockToReplace = replace ? this.getBlockByIndex(targetIndex) : undefined;

    if (replace && blockToReplace === undefined) {
      throw new Error(`Could not replace Block at index ${targetIndex}. Block not found.`);
    }

    if (replace && blockToReplace !== undefined) {
      this.blockDidMutated(BlockRemovedMutationType, blockToReplace, {
        index: targetIndex,
      });
    }

    this.blocksStore.insert(targetIndex, block, replace);

    /**
     * Force call of didMutated event on Block insertion
     */
    this.blockDidMutated(BlockAddedMutationType, block, {
      index: targetIndex,
    });

    /**
     * Sync to Yjs data layer (unless caller is handling sync separately)
     */
    if (!skipYjsSync) {
      this.Blok.YjsManager.addBlock({
        id: block.id,
        type: block.name,
        data: block.preservedData,
        parent: block.parentId ?? undefined,
      }, targetIndex);
    }

    if (needToFocus) {
      this.currentBlockIndex = targetIndex;
    }

    if (!needToFocus && targetIndex <= this.currentBlockIndex) {
      this.currentBlockIndex++;
    }

    return block;
  }

  /**
   * Inserts several blocks at once
   * Used during initial rendering of the editor
   * @param blocks - blocks to insert
   * @param index - index where to insert
   */
  public insertMany(blocks: Block[], index = 0): void {
    this.blocksStore.insertMany(blocks, index);

    // Load blocks into Yjs with 'load' origin (not tracked by undo manager)
    const blockDataArray: OutputBlockData[] = blocks.map(block => {
      const tunes = block.preservedTunes;

      return {
        id: block.id,
        type: block.name,
        data: block.preservedData,
        ...(Object.keys(tunes).length > 0 && { tunes }),
        ...(block.parentId !== null && { parent: block.parentId }),
        ...(block.contentIds.length > 0 && { content: block.contentIds }),
      };
    });

    this.Blok.YjsManager.fromJSON(blockDataArray);

    // Apply indentation for blocks with parentId (hierarchical structure)
    blocks.forEach(block => {
      if (block.parentId !== null) {
        this.updateBlockIndentation(block);
      }
    });
  }

  /**
   * Update Block data.
   *
   * Currently we don't have an 'update' method in the Tools API, so we just create a new block with the same id and type
   * Should not trigger 'block-removed' or 'block-added' events.
   *
   * If neither data nor tunes is provided, return the provided block instead.
   * @param block - block to update
   * @param data - (optional) new data
   * @param tunes - (optional) tune data
   */
  public async update(block: Block, data?: Partial<BlockToolData>, tunes?: {[name: string]: BlockTuneData}): Promise<Block> {
    if (!data && !tunes) {
      return block;
    }

    const existingData = await block.data;

    const newBlock = this.composeBlock({
      id: block.id,
      tool: block.name,
      data: Object.assign({}, existingData, data ?? {}),
      tunes: tunes ?? block.tunes,
      bindEventsImmediately: true,
    });

    const blockIndex = this.getBlockIndex(block);

    this.blocksStore.replace(blockIndex, newBlock);

    this.blockDidMutated(BlockChangedMutationType, newBlock, {
      index: blockIndex,
    });

    // Sync changed data to Yjs
    if (data !== undefined) {
      for (const [key, value] of Object.entries(data)) {
        this.Blok.YjsManager.updateBlockData(block.id, key, value);
      }
    }

    // Sync changed tunes to Yjs
    if (tunes !== undefined) {
      for (const [tuneName, tuneData] of Object.entries(tunes)) {
        this.Blok.YjsManager.updateBlockTune(block.id, tuneName, tuneData);
      }
    }

    return newBlock;
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - block to replace
   * @param newTool - new Tool name
   * @param data - new Tool data
   */
  public replace(block: Block, newTool: string, data: BlockToolData): Block {
    const blockIndex = this.getBlockIndex(block);
    const newBlockId = generateBlockId();

    // Atomic transaction: remove old block + add new block as single undo entry
    this.Blok.YjsManager.transact(() => {
      this.Blok.YjsManager.removeBlock(block.id);
      this.Blok.YjsManager.addBlock({
        id: newBlockId,
        type: newTool,
        data,
      }, blockIndex);
    });

    // DOM update (skip Yjs sync — already done above)
    return this.insert({
      id: newBlockId,
      tool: newTool,
      data,
      index: blockIndex,
      replace: true,
      skipYjsSync: true,
    });
  }

  /**
   * Returns the proxied Blocks storage ensuring it is initialized.
   * @throws {Error} if the storage is not prepared.
   */
  private get blocksStore(): BlocksStore {
    if (this._blocks === null) {
      throw new Error('BlockManager: blocks store is not initialized. Call prepare() before accessing blocks.');
    }

    return this._blocks;
  }

  /**
   * Insert pasted content. Call onPaste callback after insert.
   * Syncs final state to Yjs as single operation to ensure single undo entry.
   * @param {string} toolName - name of Tool to insert
   * @param {PasteEvent} pasteEvent - pasted data
   * @param {boolean} replace - should replace current block
   */
  public async paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false
  ): Promise<Block> {
    // Insert block without syncing to Yjs yet (we'll sync final state after onPaste)
    const block = this.insert({
      tool: toolName,
      replace,
      skipYjsSync: true,
    });

    // Suppress auto-sync during paste processing
    this.yjsSyncCount++;

    try {
      /**
       * We need to call onPaste after Block will be ready
       * because onPaste could change tool's root element, and we need to do that after block.watchBlockMutations() bound
       * to detect tool root element change
       * @todo make this.insert() awaitable and remove requestIdleCallback
       */
      await block.ready;
      block.call(BlockToolAPI.ON_PASTE, pasteEvent);

      /**
       * onPaste might cause the tool to replace its root element (e.g., Header changing level).
       * Since mutation observers are set up asynchronously via requestIdleCallback,
       * we need to manually refresh the tool element reference here.
       */
      block.refreshToolRootElement();
    } catch (e) {
      log(`${toolName}: onPaste callback call is failed`, 'error', e);
    } finally {
      this.yjsSyncCount--;
    }

    // Sync final state to Yjs as single operation
    const savedData = await block.save();

    if (savedData !== undefined) {
      this.Blok.YjsManager.addBlock({
        id: block.id,
        type: block.name,
        data: savedData.data,
      }, this.getBlockIndex(block));
    }

    return block;
  }

  /**
   * Insert new default block at passed index
   * @param {number} index - index where Block should be inserted
   * @param {boolean} needToFocus - if true, updates current Block index
   * @param {boolean} skipYjsSync - if true, skip syncing to Yjs (caller handles sync separately)
   * @returns {Block} inserted Block
   */
  public insertDefaultBlockAtIndex(index: number, needToFocus = false, skipYjsSync = false): Block {
    const defaultTool = this.config.defaultBlock;

    if (defaultTool === undefined) {
      throw new Error('Could not insert default Block. Default block tool is not defined in the configuration.');
    }

    return this.insert({
      tool: defaultTool,
      index,
      needToFocus,
      skipYjsSync,
    });
  }

  /**
   * Always inserts at the end
   * @returns {Block}
   */
  public insertAtEnd(): Block {
    /**
     * Define new value for current block index
     */
    this.currentBlockIndex = this.blocks.length - 1;

    /**
     * Insert the default typed block
     */
    return this.insert();
  }

  /**
   * Merge two blocks
   * @param {Block} targetBlock - previous block will be append to this block
   * @param {Block} blockToMerge - block that will be merged with target block
   * @returns {Promise} - the sequence that can be continued
   */
  public async mergeBlocks(targetBlock: Block, blockToMerge: Block): Promise<void> {
    /**
     * Complete the merge operation with the prepared data
     * Syncs to Yjs atomically, then updates DOM without re-syncing
     */
    const completeMerge = async (mergeData: BlockToolData): Promise<void> => {
      // Get current target data to compute merged result for Yjs
      const targetData = await targetBlock.data;
      const mergedData = { ...targetData, ...mergeData };

      // Sync to Yjs atomically: update target + remove source as single undo entry
      this.Blok.YjsManager.transact(() => {
        for (const [key, value] of Object.entries(mergedData)) {
          this.Blok.YjsManager.updateBlockData(targetBlock.id, key, value);
        }
        this.Blok.YjsManager.removeBlock(blockToMerge.id);
      });

      // DOM updates (skip Yjs sync — already done above)
      this.yjsSyncCount++;
      try {
        await targetBlock.mergeWith(mergeData);
        await this.removeBlock(blockToMerge, true, true);
      } finally {
        this.yjsSyncCount--;
      }

      this.currentBlockIndex = this.blocksStore.indexOf(targetBlock);
    };

    /**
     * We can merge:
     * 1) Blocks with the same Tool if tool provides merge method
     */
    const canMergeBlocksDirectly = targetBlock.name === blockToMerge.name && targetBlock.mergeable;
    const blockToMergeDataRaw = canMergeBlocksDirectly ? await blockToMerge.data : undefined;

    if (canMergeBlocksDirectly && isEmpty(blockToMergeDataRaw)) {
      console.error('Could not merge Block. Failed to extract original Block data.');

      return;
    }

    if (canMergeBlocksDirectly && blockToMergeDataRaw !== undefined) {
      const [ cleanBlock ] = sanitizeBlocks(
        [ { data: blockToMergeDataRaw,
          tool: blockToMerge.name } ],
        targetBlock.tool.sanitizeConfig,
        this.config.sanitizer as SanitizerConfig
      );

      await completeMerge(cleanBlock.data);

      return;
    }

    /**
     * 2) Blocks with different Tools if they provides conversionConfig
     */
    if (targetBlock.mergeable && isBlockConvertable(blockToMerge, 'export') && isBlockConvertable(targetBlock, 'import')) {
      const blockToMergeDataStringified = await blockToMerge.exportDataAsString();

      /**
       * Extract the field-specific sanitize rules for the field that will receive the imported content.
       */
      const importProp = targetBlock.tool.conversionConfig?.import;
      const fieldSanitizeConfig = isString(importProp) && isObject(targetBlock.tool.sanitizeConfig[importProp])
        ? targetBlock.tool.sanitizeConfig[importProp] as SanitizerConfig
        : targetBlock.tool.sanitizeConfig;

      const cleanData = clean(blockToMergeDataStringified, fieldSanitizeConfig);
      const blockToMergeData = convertStringToBlockData(cleanData, targetBlock.tool.conversionConfig);

      await completeMerge(blockToMergeData);
    }
  }

  /**
   * Remove passed Block
   * @param block - Block to remove
   * @param addLastBlock - if true, inserts a new default block when the last block is removed
   * @param skipYjsSync - if true, skip syncing to Yjs (caller handles sync separately)
   */
  public removeBlock(block: Block, addLastBlock = true, skipYjsSync = false): Promise<void> {
    return new Promise((resolve) => {
      const index = this.blocksStore.indexOf(block);

      /**
       * If index is not passed and there is no block selected, show a warning
       */
      if (!this.validateIndex(index)) {
        throw new Error('Can\'t find a Block to remove');
      }

      this.blocksStore.remove(index);

      /**
       * Force call of didMutated event on Block removal
       */
      this.blockDidMutated(BlockRemovedMutationType, block, {
        index,
      });

      /**
       * Sync to Yjs data layer (unless caller is handling sync separately)
       */
      if (!skipYjsSync) {
        this.Blok.YjsManager.removeBlock(block.id);
      }

      if (this.currentBlockIndex >= index) {
        this.currentBlockIndex--;
      }

      /**
       * If first Block was removed, insert new Initial Block and set focus on it`s first input
       */
      const noBlocksLeft = this.blocks.length === 0;

      if (noBlocksLeft) {
        this.unsetCurrentBlock();
      }

      if (noBlocksLeft && addLastBlock) {
        this.insert();
      }

      if (!noBlocksLeft && index === 0) {
        this.currentBlockIndex = 0;
      }

      resolve();
    });
  }

  /**
   * Delete all selected blocks and insert a replacement block at their position.
   * Only inserts a replacement block if all blocks were deleted.
   * @returns The inserted replacement block, or undefined if no blocks were selected or if blocks remain
   */
  public deleteSelectedBlocksAndInsertReplacement(): Block | undefined {
    // Collect selected blocks with their indices (sorted by index descending for safe removal)
    const selectedBlockEntries = this.blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.selected)
      .sort((a, b) => b.index - a.index);

    if (selectedBlockEntries.length === 0) {
      return undefined;
    }

    // Check if all blocks are being deleted
    const allBlocksDeleted = selectedBlockEntries.length === this.blocks.length;

    // Get insertion index (minimum index among selected blocks)
    const insertionIndex = selectedBlockEntries[selectedBlockEntries.length - 1].index;
    const blockIds = selectedBlockEntries.map(({ block }) => block.id);

    const defaultToolName = this.config.defaultBlock;

    if (defaultToolName === undefined) {
      throw new Error('Could not insert default Block. Default block tool is not defined in the configuration.');
    }

    // Generate new block ID upfront for the transaction (only if needed)
    const newBlockId = allBlocksDeleted ? generateBlockId() : undefined;

    // Single Yjs transaction for all removals + insertion (single undo entry)
    this.Blok.YjsManager.transact(() => {
      for (const id of blockIds) {
        this.Blok.YjsManager.removeBlock(id);
      }

      // Only insert replacement block if all blocks were deleted
      if (allBlocksDeleted && newBlockId !== undefined) {
        this.Blok.YjsManager.addBlock({
          id: newBlockId,
          type: defaultToolName,
          data: {},
        }, insertionIndex);
      }
    });

    // DOM cleanup - remove selected blocks (skip Yjs sync since we handled it above)
    // Iterate in reverse order (highest index first) to avoid index shifting issues
    for (const { block } of selectedBlockEntries) {
      void this.removeBlock(block, false, true);
    }

    // Insert replacement block only if all blocks were deleted (skip Yjs sync since we handled it above)
    if (allBlocksDeleted && newBlockId !== undefined) {
      return this.insert({
        id: newBlockId,
        tool: defaultToolName,
        index: insertionIndex,
        needToFocus: true,
        skipYjsSync: true,
      });
    }

    return undefined;
  }

  /**
   * Attention!
   * After removing insert the new default typed Block and focus on it
   * Removes all blocks
   */
  public removeAllBlocks(): void {
    // Create a copy of the blocks array
    const blocksToRemove = [ ...this.blocks ];
    const blockIds = blocksToRemove.map(block => block.id);

    // Single Yjs transaction for all removals (single undo entry)
    this.Blok.YjsManager.transact(() => {
      for (const id of blockIds) {
        this.Blok.YjsManager.removeBlock(id);
      }
    });

    // DOM cleanup - remove all blocks (from end to avoid index shifting)
    while (this.blocksStore.length > 0) {
      this.blocksStore.remove(this.blocksStore.length - 1);
    }

    this.unsetCurrentBlock();
    this.insert();
    const currentBlock = this.currentBlock;
    const firstInput = currentBlock?.firstInput;

    if (firstInput !== undefined) {
      firstInput.focus();
    }
  }

  /**
   * Split current Block
   * 1. Extract content from Caret position to the Block`s end
   * 2. Insert a new Block below current one with extracted content
   *
   * Uses atomic Yjs transaction to ensure split is a single undo entry.
   * @returns {Block}
   */
  public split(): Block {
    const currentBlock = this.currentBlock;

    if (currentBlock === undefined) {
      throw new Error('Cannot split: no current block');
    }

    // Generate new block ID upfront for the transaction
    const newBlockId = generateBlockId();
    const insertIndex = this.currentBlockIndex + 1;

    // Suppress auto-sync and stopCapturing during split to keep it atomic
    this.yjsSyncCount++;
    this.suppressStopCapturing = true;

    try {
      // Extract fragment (mutates DOM - removes text after caret)
      const extractedFragment = this.Blok.Caret.extractFragmentFromCaretPosition();
      const wrapper = $.make('div');

      wrapper.appendChild(extractedFragment as DocumentFragment);

      const extractedText = $.isEmpty(wrapper) ? '' : wrapper.innerHTML;

      // Get truncated text (what remains in original block after extraction)
      const truncatedText = currentBlock.holder
        .querySelector('[contenteditable="true"]')?.innerHTML ?? '';

      // Atomic Yjs transaction: update original + add new (single undo entry)
      this.Blok.YjsManager.transact(() => {
        this.Blok.YjsManager.updateBlockData(currentBlock.id, 'text', truncatedText);
        this.Blok.YjsManager.addBlock({
          id: newBlockId,
          type: currentBlock.name,
          data: { text: extractedText },
        }, insertIndex);
      });

      // Insert DOM block (skip Yjs sync - already done above)
      return this.insert({
        id: newBlockId,
        tool: currentBlock.name,
        data: { text: extractedText },
        skipYjsSync: true,
      });
    } finally {
      this.yjsSyncCount--;
      this.suppressStopCapturing = false;
    }
  }

  /**
   * Returns Block by passed index
   *
   * If we pass -1 as index, the last block will be returned
   * There shouldn't be a case when there is no blocks at all — at least one always should exist
   */
  public getBlockByIndex(index: -1): Block;

  /**
   * Returns Block by passed index.
   *
   * Could return undefined if there is no block with such index
   */
  public getBlockByIndex(index: number): Block | undefined;

  /**
   * Returns Block by passed index
   * @param {number} index - index to get. -1 to get last
   * @returns {Block}
   */
  public getBlockByIndex(index: number): Block | undefined {
    const targetIndex = index === -1
      ? this.blocksStore.length - 1
      : index;

    return this.blocksStore[targetIndex];
  }

  /**
   * Returns an index for passed Block
   * @param block - block to find index
   */
  public getBlockIndex(block: Block): number {
    return this.blocksStore.indexOf(block);
  }

  /**
   * Returns the Block by passed id
   * @param id - id of block to get
   * @returns {Block}
   */
  public getBlockById(id: string): Block | undefined {
    return this.blocksStore.array.find((block) => block.id === id);
  }

  /**
   * Returns the depth (nesting level) of a block in the hierarchy.
   * Root-level blocks have depth 0.
   * @param block - the block to get depth for
   * @returns {number} - depth level (0 for root, 1 for first level children, etc.)
   */
  public getBlockDepth(block: Block): number {
    const calculateDepth = (parentId: string | null, currentDepth: number): number => {
      if (parentId === null) {
        return currentDepth;
      }

      const parentBlock = this.getBlockById(parentId);

      if (parentBlock === undefined) {
        return currentDepth;
      }

      return calculateDepth(parentBlock.parentId, currentDepth + 1);
    };

    return calculateDepth(block.parentId, 0);
  }

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   * @param block - the block to reparent
   * @param newParentId - the new parent block id, or null for root level
   */
  public setBlockParent(block: Block, newParentId: string | null): void {
    const oldParentId = block.parentId;

    // Remove from old parent's contentIds
    const oldParent = oldParentId !== null ? this.getBlockById(oldParentId) : undefined;

    if (oldParent !== undefined) {
      oldParent.contentIds = oldParent.contentIds.filter(id => id !== block.id);
    }

    // Add to new parent's contentIds
    const newParent = newParentId !== null ? this.getBlockById(newParentId) : undefined;
    const shouldAddToNewParent = newParent !== undefined && !newParent.contentIds.includes(block.id);

    if (shouldAddToNewParent) {
      newParent.contentIds.push(block.id);
    }

    // Update block's parentId - parentId is a public mutable property on Block
    // eslint-disable-next-line no-param-reassign
    block.parentId = newParentId;

    // Update visual indentation
    this.updateBlockIndentation(block);
  }

  /**
   * Updates the visual indentation of a block based on its depth in the hierarchy.
   * @param block - the block to update indentation for
   */
  public updateBlockIndentation(block: Block): void {
    const depth = this.getBlockDepth(block);
    const indentationPx = depth * 24; // 24px per level
    const { holder } = block;

    holder.style.marginLeft = indentationPx > 0 ? `${indentationPx}px` : '';
    holder.setAttribute('data-blok-depth', depth.toString());
  }

  /**
   * Get Block instance by html element
   * @param {Node} element - html element to get Block by
   */
  public getBlock(element: HTMLElement): Block | undefined {
    const normalizedElement = (($.isElement(element) as boolean) ? element : element.parentNode) as HTMLElement | null;

    if (!normalizedElement) {
      return undefined;
    }

    const nodes = this.blocksStore.nodes;


    const firstLevelBlock = normalizedElement.closest(createSelector(DATA_ATTR.element));

    if (!firstLevelBlock) {
      return undefined;
    }

    const index = nodes.indexOf(firstLevelBlock as HTMLElement);

    if (index >= 0) {
      return this.blocksStore[index];
    }

    return undefined;
  }

  /**
   * 1) Find first-level Block from passed child Node
   * 2) Mark it as current
   * @param {Node} childNode - look ahead from this node.
   * @returns {Block | undefined} can return undefined in case when the passed child note is not a part of the current blok instance
   */
  public setCurrentBlockByChildNode(childNode: Node): Block | undefined {
    /**
     * If node is Text TextNode
     */
    const normalizedChildNode = ($.isElement(childNode) ? childNode : childNode.parentNode) as HTMLElement | null;

    if (!normalizedChildNode) {
      return undefined;
    }

    const parentFirstLevelBlock = normalizedChildNode.closest(createSelector(DATA_ATTR.element));

    if (!parentFirstLevelBlock) {
      return undefined;
    }

    /**
     * Support multiple Blok instances,
     * by checking whether the found block belongs to the current instance
     * @see {@link Ui#documentTouched}
     */
    const blokWrapper = parentFirstLevelBlock.closest(createSelector(DATA_ATTR.editor));
    const isBlockBelongsToCurrentInstance = blokWrapper?.isEqualNode(this.Blok.UI.nodes.wrapper);

    if (!isBlockBelongsToCurrentInstance) {
      return undefined;
    }

    /**
     * Update current Block's index
     * @type {number}
     */
    if (!(parentFirstLevelBlock instanceof HTMLElement)) {
      return undefined;
    }

    this.currentBlockIndex = this.blocksStore.nodes.indexOf(parentFirstLevelBlock);

    /**
     * Update current block active input
     */
    const currentBlock = this.currentBlock;

    currentBlock?.updateCurrentInput();

    return currentBlock;
  }

  /**
   * Return block which contents passed node
   * @param {Node} childNode - node to get Block by
   * @returns {Block}
   */
  public getBlockByChildNode(childNode: Node): Block | undefined {
    if (!(childNode instanceof Node)) {
      return undefined;
    }

    /**
     * If node is Text TextNode
     */
    const normalizedChildNode = ($.isElement(childNode) ? childNode : childNode.parentNode) as HTMLElement | null;

    if (!normalizedChildNode) {
      return undefined;
    }


    const firstLevelBlock = normalizedChildNode.closest(createSelector(DATA_ATTR.element));

    if (!firstLevelBlock) {
      return undefined;
    }

    return this.blocks.find((block) => block.holder === firstLevelBlock);
  }

  /**
   * Move a block to a new index
   * @param {number} toIndex - index where to move Block
   * @param {number} fromIndex - index of Block to move
   * @param {boolean} skipDOM - if true, do not manipulate DOM
   */
  public move(toIndex: number, fromIndex: number = this.currentBlockIndex, skipDOM = false): void {
    // make sure indexes are valid and within a valid range
    if (isNaN(toIndex) || isNaN(fromIndex)) {
      log(`Warning during 'move' call: incorrect indices provided.`, 'warn');

      return;
    }

    if (!this.validateIndex(toIndex) || !this.validateIndex(fromIndex)) {
      log(`Warning during 'move' call: indices cannot be lower than 0 or greater than the amount of blocks.`, 'warn');

      return;
    }

    // Suppress stopCapturing to keep DOM + Yjs move as single undo entry
    this.suppressStopCapturing = true;
    try {
      /** Move up current Block */
      this.blocksStore.move(toIndex, fromIndex, skipDOM);

      /** Now actual block moved so that current block index changed */
      this.currentBlockIndex = toIndex;
      const movedBlock = this.currentBlock;

      if (movedBlock === undefined) {
        throw new Error(`Could not move Block. Block at index ${toIndex} is not available.`);
      }

      /**
       * Force call of didMutated event on Block movement
       */
      this.blockDidMutated(BlockMovedMutationType, movedBlock, {
        fromIndex,
        toIndex,
      });

      // Sync to Yjs
      this.Blok.YjsManager.moveBlock(movedBlock.id, toIndex);
    } finally {
      this.suppressStopCapturing = false;
    }
  }

  /**
   * Converts passed Block to the new Tool
   * Uses Conversion Config
   * @param blockToConvert - Block that should be converted
   * @param targetToolName - name of the Tool to convert to
   * @param blockDataOverrides - optional new Block data overrides
   */
  public async convert(blockToConvert: Block, targetToolName: string, blockDataOverrides?: BlockToolData): Promise<Block> {
    /**
     * At first, we get current Block data
     */
    const savedBlock = await blockToConvert.save();

    if (!savedBlock || savedBlock.data === undefined) {
      throw new Error('Could not convert Block. Failed to extract original Block data.');
    }

    /**
     * Getting a class of the replacing Tool
     */
    const replacingTool = this.Blok.Tools.blockTools.get(targetToolName);

    if (!replacingTool) {
      throw new Error(`Could not convert Block. Tool «${targetToolName}» not found.`);
    }

    /**
     * Using Conversion Config "export" we get a stringified version of the Block data
     */
    const exportedData = await blockToConvert.exportDataAsString();

    /**
     * Clean exported data with replacing sanitizer config.
     * We need to extract the field-specific sanitize rules for the field that will receive the imported content.
     * The tool's sanitizeConfig has the format { fieldName: { tagRules } }, but clean() expects just { tagRules }.
     */
    const importProp = replacingTool.conversionConfig?.import;
    const fieldSanitizeConfig = isString(importProp) && isObject(replacingTool.sanitizeConfig[importProp])
      ? replacingTool.sanitizeConfig[importProp] as SanitizerConfig
      : replacingTool.sanitizeConfig;

    const cleanData: string = clean(
      exportedData,
      composeSanitizerConfig(this.config.sanitizer as SanitizerConfig, fieldSanitizeConfig)
    );

    /**
     * Now using Conversion Config "import" we compose a new Block data
     */
    const baseBlockData = convertStringToBlockData(cleanData, replacingTool.conversionConfig, replacingTool.settings);

    const newBlockData = blockDataOverrides
      ? Object.assign(baseBlockData, blockDataOverrides)
      : baseBlockData;

    return this.replace(blockToConvert, replacingTool.name, newBlockData);
  }

  /**
   * Sets current Block Index -1 which means unknown
   * and clear highlights
   */
  public unsetCurrentBlock(): void {
    this.currentBlockIndex = -1;
  }

  /**
   * Clears Blok
   * @param {boolean} needToAddDefaultBlock - 1) in internal calls (for example, in api.blocks.render)
   *                                             we don't need to add an empty default block
   *                                        2) in api.blocks.clear we should add empty block
   */
  public async clear(needToAddDefaultBlock = false): Promise<void> {
    // Create a copy of the blocks array to avoid issues with array modification during iteration
    const blocksToRemove = [ ...this.blocks ];
    const blockIds = blocksToRemove.map(block => block.id);

    // Generate ID for default block if needed (so we can include it in the transaction)
    const defaultBlockId = needToAddDefaultBlock ? generateBlockId() : undefined;
    const defaultToolName = this.config.defaultBlock;

    // Single Yjs transaction for all removals + default block add (single undo entry)
    this.Blok.YjsManager.transact(() => {
      for (const id of blockIds) {
        this.Blok.YjsManager.removeBlock(id);
      }

      // Include default block in transaction so undo removes it along with restoring original blocks
      if (needToAddDefaultBlock && defaultBlockId !== undefined && defaultToolName !== undefined) {
        this.Blok.YjsManager.addBlock({
          id: defaultBlockId,
          type: defaultToolName,
          data: {},
        }, 0);
      }
    });

    // DOM cleanup (skip Yjs sync — already done above)
    for (const block of blocksToRemove) {
      const index = this.getBlockIndex(block);

      if (index !== -1) {
        this.blocksStore.remove(index);

        // Emit BlockRemoved event so onChange gets notified
        this.blockDidMutated(BlockRemovedMutationType, block, {
          index,
        });
      }
    }

    this.unsetCurrentBlock();

    if (needToAddDefaultBlock && defaultBlockId !== undefined) {
      // Insert with skipYjsSync since we already synced in the transaction above
      this.insert({ id: defaultBlockId, skipYjsSync: true });
    }

    /**
     * Add empty modifier
     */
    this.Blok.UI.checkEmptiness();
  }

  /**
   * Moves the current block up by one position
   * Does nothing if the block is already at the top
   */
  public moveCurrentBlockUp(): void {
    const currentIndex = this.currentBlockIndex;

    if (currentIndex <= 0) {
      // Announce boundary condition
      announce(
        this.Blok.I18n.t('a11y.atTop'),
        { politeness: 'polite' }
      );

      return;
    }

    this.move(currentIndex - 1, currentIndex);
    this.refocusCurrentBlock();

    // Announce successful move (currentBlockIndex is now updated to new position)
    const newPosition = this.currentBlockIndex + 1; // Convert to 1-indexed for user
    const total = this.blocksStore.length;
    const message = this.Blok.I18n.t('a11y.movedUp', {
      position: newPosition,
      total,
    });

    announce(message, { politeness: 'assertive' });
  }

  /**
   * Moves the current block down by one position
   * Does nothing if the block is already at the bottom
   */
  public moveCurrentBlockDown(): void {
    const currentIndex = this.currentBlockIndex;

    if (currentIndex < 0 || currentIndex >= this.blocksStore.length - 1) {
      // Announce boundary condition
      announce(
        this.Blok.I18n.t('a11y.atBottom'),
        { politeness: 'polite' }
      );

      return;
    }

    this.move(currentIndex + 1, currentIndex);
    this.refocusCurrentBlock();

    // Announce successful move (currentBlockIndex is now updated to new position)
    const newPosition = this.currentBlockIndex + 1; // Convert to 1-indexed for user
    const total = this.blocksStore.length;
    const message = this.Blok.I18n.t('a11y.movedDown', {
      position: newPosition,
      total,
    });

    announce(message, { politeness: 'assertive' });
  }

  /**
   * Refocuses the current block at the end position
   * Used after block movement to allow consecutive moves
   */
  private refocusCurrentBlock(): void {
    const block = this.currentBlock;

    if (block !== undefined) {
      this.Blok.Caret.setToBlock(block, this.Blok.Caret.positions.END);
    }
  }

  /**
   * Sets up keyboard shortcuts for block movement
   * CMD+SHIFT+UP: Move current block up
   * CMD+SHIFT+DOWN: Move current block down
   */
  private setupKeyboardShortcuts(): void {
    // Wait for UI to be ready (same pattern as History module)
    setTimeout(() => {
      const shortcutNames = ['CMD+SHIFT+UP', 'CMD+SHIFT+DOWN'];

      // Clear any existing shortcuts to avoid duplicate registration errors
      shortcutNames.forEach(name => Shortcuts.remove(document, name));

      // Move block up: Cmd+Shift+ArrowUp (Mac) / Ctrl+Shift+ArrowUp (Windows/Linux)
      Shortcuts.add({
        name: 'CMD+SHIFT+UP',
        on: document,
        handler: (event: KeyboardEvent) => {
          if (!this.shouldHandleShortcut(event)) {
            return;
          }
          event.preventDefault();
          this.moveCurrentBlockUp();
        },
      });
      this.registeredShortcuts.push('CMD+SHIFT+UP');

      // Move block down: Cmd+Shift+ArrowDown (Mac) / Ctrl+Shift+ArrowDown (Windows/Linux)
      Shortcuts.add({
        name: 'CMD+SHIFT+DOWN',
        on: document,
        handler: (event: KeyboardEvent) => {
          if (!this.shouldHandleShortcut(event)) {
            return;
          }
          event.preventDefault();
          this.moveCurrentBlockDown();
        },
      });
      this.registeredShortcuts.push('CMD+SHIFT+DOWN');
    }, 0);
  }

  /**
   * Determines whether the block movement shortcut should be handled
   * Only handles shortcuts when focus is inside the editor
   * @param event - the keyboard event
   * @returns true if the shortcut should be handled
   */
  private shouldHandleShortcut(event: KeyboardEvent): boolean {
    const target = event.target;

    return target instanceof HTMLElement &&
      this.Blok.UI?.nodes?.wrapper?.contains(target) === true;
  }

  /**
   * Cleans up all the block tools' resources
   * This is called when blok is destroyed
   */
  public async destroy(): Promise<void> {
    // Remove registered keyboard shortcuts
    for (const name of this.registeredShortcuts) {
      Shortcuts.remove(document, name);
    }
    this.registeredShortcuts = [];

    await Promise.all(this.blocks.map((block) => {
      return block.destroy();
    }));
  }

  /**
   * Bind Block events
   * @param {Block} block - Block to which event should be bound
   */
  private bindBlockEvents(block: Block): void {
    const { BlockEvents } = this.Blok;

    this.readOnlyMutableListeners.on(block.holder, 'keydown', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        BlockEvents.keydown(event);
      }
    });

    this.readOnlyMutableListeners.on(block.holder, 'keyup', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        BlockEvents.keyup(event);
      }
    });

    this.readOnlyMutableListeners.on(block.holder, 'input', (event: Event) => {
      if (event instanceof InputEvent) {
        BlockEvents.input(event);
      }
    });

    block.on('didMutated', (affectedBlock: Block) => {
      return this.blockDidMutated(BlockChangedMutationType, affectedBlock, {
        index: this.getBlockIndex(affectedBlock),
      });
    });
  }

  /**
   * Disable mutable handlers and bindings
   */
  private disableModuleBindings(): void {
    this.readOnlyMutableListeners.clearAll();
  }

  /**
   * Enables all module handlers and bindings for all Blocks
   */
  private enableModuleBindings(): void {
    /** Cut event */
    this.readOnlyMutableListeners.on(
      document,
      'cut',
      (event: Event) => {
        this.Blok.BlockEvents.handleCommandX(event as ClipboardEvent);
      }
    );

    this.blocks.forEach((block: Block) => {
      this.bindBlockEvents(block);
    });
  }

  /**
   * Sync a block from Yjs data after undo/redo
   * @param event - the block change event from YjsManager
   */
  private syncBlockFromYjs(event: BlockChangeEvent): void {
    const { blockId, type: changeType } = event;

    if (changeType === 'update') {
      this.handleYjsUpdate(blockId);

      return;
    }

    if (changeType === 'move') {
      this.handleYjsMove();

      return;
    }

    if (changeType === 'add') {
      this.handleYjsAdd(blockId);

      return;
    }

    if (changeType === 'remove') {
      this.handleYjsRemove(blockId);
    }
  }

  /**
   * Handle block update from Yjs (undo/redo)
   */
  private handleYjsUpdate(blockId: string): void {
    const block = this.getBlockById(blockId);
    const yblock = this.Blok.YjsManager.getBlockById(blockId);

    if (block === undefined || yblock === undefined) {
      return;
    }

    const data = this.Blok.YjsManager.yMapToObject(yblock.get('data') as YMap<unknown>);
    const ytunes = yblock.get('tunes') as YMap<unknown> | undefined;
    const tunes = ytunes !== undefined ? this.Blok.YjsManager.yMapToObject(ytunes) : {};

    // Check if tunes have changed - if so, we need to recreate the block
    // because tunes are instantiated during block construction
    const currentTunes = block.preservedTunes;
    const tuneKeys = Object.keys(tunes);
    const currentKeys = Object.keys(currentTunes);
    const tunesChanged = tuneKeys.length !== currentKeys.length ||
      tuneKeys.some(key => tunes[key] !== currentTunes[key]);

    if (tunesChanged) {
      // Recreate block with updated tunes
      const blockIndex = this.getBlockIndex(block);
      const newBlock = this.composeBlock({
        id: block.id,
        tool: block.name,
        data,
        tunes,
        bindEventsImmediately: true,
      });

      // Increment counter to prevent syncing back to Yjs during undo/redo
      this.yjsSyncCount++;
      try {
        this.blocksStore.replace(blockIndex, newBlock);
      } finally {
        this.yjsSyncCount--;
      }
    } else {
      // Just update data
      // Increment counter to prevent syncing back to Yjs during undo/redo
      this.yjsSyncCount++;
      void block.setData(data).finally(() => {
        this.yjsSyncCount--;
      });
    }
  }

  /**
   * Handle block add from Yjs (undo/redo - restoring a removed block)
   */
  private handleYjsAdd(blockId: string): void {
    // Block already exists in DOM, no need to add
    if (this.getBlockById(blockId) !== undefined) {
      return;
    }

    const yblock = this.Blok.YjsManager.getBlockById(blockId);

    if (yblock === undefined) {
      return;
    }

    const toolName = yblock.get('type') as string;
    const data = this.Blok.YjsManager.yMapToObject(yblock.get('data') as YMap<unknown>);
    const parentId = yblock.get('parentId') as string | undefined;

    // Find the index of this block in Yjs to insert at correct position
    const yjsBlocks = this.Blok.YjsManager.toJSON();
    const targetIndex = yjsBlocks.findIndex((b) => b.id === blockId);

    if (targetIndex === -1) {
      return;
    }

    // Create the block with immediate event binding for undo/redo responsiveness
    const block = this.composeBlock({
      id: blockId,
      tool: toolName,
      data,
      parentId: parentId ?? undefined,
      bindEventsImmediately: true,
    });

    // Insert into blocks store at correct position
    this.blocksStore.insert(targetIndex, block);

    // Apply indentation if needed
    if (parentId !== undefined) {
      this.updateBlockIndentation(block);
    }
  }

  /**
   * Handle block remove from Yjs (undo/redo - removing a previously added block)
   */
  private handleYjsRemove(blockId: string): void {
    const block = this.getBlockById(blockId);

    if (block === undefined) {
      return;
    }

    const index = this.getBlockIndex(block);

    if (index === -1) {
      return;
    }

    this.blocksStore.remove(index);

    // If all blocks removed, insert a default block
    // Use skipYjsSync to prevent corrupting undo stack during undo/redo
    if (this.blocksStore.length === 0) {
      this.insert({ skipYjsSync: true });
    }
  }

  /**
   * Flag to prevent multiple move syncs in the same event batch
   */
  private moveSyncScheduled = false;

  /**
   * Handle block move from Yjs (undo/redo - repositioning a moved block)
   * Uses microtask scheduling to batch multiple move events into a single sync
   */
  private handleYjsMove(): void {
    // Only schedule one sync per microtask to handle batched move events
    if (this.moveSyncScheduled) {
      return;
    }

    this.moveSyncScheduled = true;

    // Use queueMicrotask to defer sync until all move events are processed
    queueMicrotask(() => {
      this.moveSyncScheduled = false;
      this.syncBlockOrderFromYjs();
    });
  }

  /**
   * Re-syncs the entire block order from Yjs to handle multiple simultaneous moves correctly
   */
  private syncBlockOrderFromYjs(): void {
    // Get the authoritative order from Yjs
    const yjsBlocks = this.Blok.YjsManager.toJSON();

    // Build id→block map for O(1) lookups instead of O(n) getBlockById calls
    const blockById = new Map<string, Block>();

    for (const block of this.blocks) {
      blockById.set(block.id, block);
    }

    // Reorder DOM blocks to match Yjs order
    // Process each Yjs block and ensure it's at the correct position
    yjsBlocks.forEach((yjsBlock, targetIndex) => {
      const blockId = yjsBlock.id;

      if (blockId === undefined) {
        return;
      }

      const block = blockById.get(blockId);

      if (block === undefined) {
        return;
      }

      const currentIndex = this.getBlockIndex(block);

      if (currentIndex !== targetIndex) {
        this.blocksStore.move(targetIndex, currentIndex);
      }
    });
  }

  /**
   * Validates that the given index is not lower than 0 or higher than the amount of blocks
   * @param {number} index - index of blocks array to validate
   * @returns {boolean}
   */
  private validateIndex(index: number): boolean {
    return !(index < 0 || index >= this.blocksStore.length);
  }

  /**
   * Block mutation callback
   * @param mutationType - what happened with block
   * @param block - mutated block
   * @param detailData - additional data to pass with change event
   */
  private blockDidMutated<Type extends BlockMutationType>(mutationType: Type, block: Block, detailData: BlockMutationEventDetailWithoutTarget<Type>): Block {
    const eventDetail = {
      target: new BlockAPI(block),
      ...detailData as BlockMutationEventDetailWithoutTarget<Type>,
    };

    const event = new CustomEvent(mutationType, {
      detail: {
        ...eventDetail,
      },
    });

    /**
     * The CustomEvent#type getter is not enumerable by default, so it gets lost during structured cloning.
     * Define it explicitly to keep the type available for consumers like Playwright tests.
     */
    if (!Object.prototype.propertyIsEnumerable.call(event, 'type')) {
      Object.defineProperty(event, 'type', {
        value: mutationType,
        enumerable: true,
        configurable: true,
      });
    }

    /**
     * CustomEvent#detail is also non-enumerable, so preserve it for consumers outside of the browser context.
     */
    if (!Object.prototype.propertyIsEnumerable.call(event, 'detail')) {
      Object.defineProperty(event, 'detail', {
        value: eventDetail,
        enumerable: true,
        configurable: true,
      });
    }

    this.eventsDispatcher.emit(BlockChanged, {
      event: event as BlockMutationEventMap[Type],
    });

    // Sync content changes to Yjs for undo/redo support
    // Skip if we're currently syncing from Yjs (undo/redo) to avoid corrupting the undo stack
    if (mutationType === BlockChangedMutationType && !this.isSyncingFromYjs) {
      void this.syncBlockDataToYjs(block);
    }

    return block;
  }

  /**
   * Sync block data to Yjs after DOM mutation
   * Extracts current data from block and updates Yjs document
   * @param block - the block whose data should be synced
   */
  private async syncBlockDataToYjs(block: Block): Promise<void> {
    const savedData = await block.save();

    if (savedData === undefined) {
      return;
    }

    for (const [key, value] of Object.entries(savedData.data)) {
      this.Blok.YjsManager.updateBlockData(block.id, key, value);
    }
  }
}

/**
 * Type alias for Block Mutation event without 'target' field, used in 'blockDidMutated' method
 */
type BlockMutationEventDetailWithoutTarget<Type extends BlockMutationType> = Omit<BlockMutationEventMap[Type]['detail'], 'target'>;
