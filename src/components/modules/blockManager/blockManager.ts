/**
 * @class BlockManager
 * @classdesc Manage blok`s blocks storage and appearance (Orchestrator)
 * @module BlockManager
 * @version 2.0.0
 */
import type { BlockToolData, OutputBlockData, PasteEvent } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { BlockMutationEventMap, BlockMutationType } from '../../../../types/events/block';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import { Module } from '../../__module';
import type { Block } from '../../block';
import { BlockAPI } from '../../block/api';
import { Blocks } from '../../blocks';
import { DATA_ATTR } from '../../constants';
import { BlockChanged } from '../../events';
import { generateBlockId } from '../../utils';

// Imported modules
import { BlockEventBinder } from './event-binder';
import { BlockFactory } from './factory';
import { BlockHierarchy } from './hierarchy';
import { BlockOperations } from './operations';
import { BlockRepository } from './repository';
import { BlockShortcuts } from './shortcuts';
import type { BlocksStore, BlockMutationEventDetailWithoutTarget } from './types';
import { BlockYjsSync } from './yjs-sync';

type BlocksStoreProxy = BlocksStore & {
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
    if (this.operations) {
      this.operations.currentBlockIndexValue = newIndex;
    }
    this._currentBlockIndex = newIndex;
  }

  /**
   * Returns first Block
   * @returns {Block}
   */
  public get firstBlock(): Block | undefined {
    return this.repository.firstBlock;
  }

  /**
   * Returns last Block
   * @returns {Block}
   */
  public get lastBlock(): Block | undefined {
    return this.repository.lastBlock;
  }

  /**
   * Get current Block instance
   * @returns {Block}
   */
  public get currentBlock(): Block | undefined {
    return this.operations?.currentBlock;
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

    this.currentBlockIndex = this.repository.getBlockIndex(block);
  }

  /**
   * Returns next Block instance
   * @returns {Block|null}
   */
  public get nextBlock(): Block | null {
    return this.operations?.nextBlock ?? null;
  }

  /**
   * Return first Block with inputs after current Block
   * @returns {Block | undefined}
   */
  public get nextContentfulBlock(): Block | undefined {
    return this.repository.getNextContentfulBlock(this.currentBlockIndex);
  }

  /**
   * Return first Block with inputs before current Block
   * @returns {Block | undefined}
   */
  public get previousContentfulBlock(): Block | undefined {
    return this.repository.getPreviousContentfulBlock(this.currentBlockIndex);
  }

  /**
   * Returns previous Block instance
   * @returns {Block|null}
   */
  public get previousBlock(): Block | null {
    return this.operations?.previousBlock ?? null;
  }

  /**
   * Get array of Block instances
   * @returns {Block[]} {@link Blocks#array}
   */
  public get blocks(): Block[] {
    return this.repository.blocks;
  }

  /**
   * Check if each Block is empty
   * @returns {boolean}
   */
  public get isBlokEmpty(): boolean {
    return this.repository.isBlokEmpty();
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
  private _blocks: BlocksStoreProxy | null = null;

  /**
   * Event binder for block-level events
   */
  private eventBinder!: BlockEventBinder;

  /**
   * Keyboard shortcuts handler
   */
  private shortcuts!: BlockShortcuts;

  /**
   * Repository for block queries
   */
  private repository!: BlockRepository;

  /**
   * Factory for creating blocks
   */
  private factory!: BlockFactory;

  /**
   * Hierarchy manager for parent/child relationships
   */
  private hierarchy!: BlockHierarchy;

  /**
   * Yjs synchronization handler
   */
  private yjsSync!: BlockYjsSync;

  /**
   * Operations handler for state changes
   */
  private operations!: BlockOperations;

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
    }) as BlocksStoreProxy;

    // Initialize services
    this.initializeServices();

    /** Copy event */
    this.listeners.on(
      document,
      'copy',
      (event: Event) => {
        this.Blok.BlockEvents.handleCommandC(event as ClipboardEvent);
      }
    );

    // Register keyboard shortcuts
    this.shortcuts.register();

    // Subscribe to Yjs changes for undo/redo DOM synchronization
    this.yjsSync.subscribe();
  }

  /**
   * Initialize all service modules
   */
  private initializeServices(): void {
    // Initialize repository
    this.repository = new BlockRepository();
    this.repository.initialize(this.blocksStore);

    // Initialize event binder
    this.eventBinder = new BlockEventBinder({
      blockEvents: this.Blok.BlockEvents,
      listeners: this.readOnlyMutableListeners,
      eventsDispatcher: this.eventsDispatcher,
      getBlockIndex: (block) => this.repository.getBlockIndex(block),
      onBlockMutated: this.blockDidMutated.bind(this),
    });

    // Initialize factory
    this.factory = new BlockFactory(
      {
        API: this.Blok.API,
        eventsDispatcher: this.eventsDispatcher,
        tools: this.Blok.Tools.blockTools,
        moduleInstances: this.Blok,
      },
      this.bindBlockEvents.bind(this)
    );

    // Initialize hierarchy
    this.hierarchy = new BlockHierarchy(this.repository);

    // Initialize operations first (before yjsSync) to allow circular dependency resolution
    this.operations = new BlockOperations(
      {
        config: this.config,
        YjsManager: this.Blok.YjsManager,
        Caret: this.Blok.Caret,
        I18n: this.Blok.I18n,
        eventsDispatcher: this.eventsDispatcher,
      },
      this.repository,
      this.factory,
      this.hierarchy,
      this.blockDidMutated.bind(this),
      this._currentBlockIndex
    );

    // Initialize yjs sync with reference to operations for suppressStopCapturing
    this.yjsSync = new BlockYjsSync(
      {
        YjsManager: this.Blok.YjsManager,
        operations: this.operations,
      },
      this.repository,
      this.factory,
      {
        addToDom: (block, index) => {
          this.blocksStore.insert(index, block);
        },
        removeFromDom: (index) => {
          this.blocksStore.remove(index);
        },
        moveInDom: (toIndex, fromIndex) => {
          this.blocksStore.move(toIndex, fromIndex);
        },
        getBlockIndex: (block) => this.repository.getBlockIndex(block),
        insertDefaultBlock: (skipYjsSync) => {
          return this.insert({ skipYjsSync });
        },
        updateIndentation: (block) => {
          this.hierarchy.updateBlockIndentation(block);
        },
        replaceBlock: (index, newBlock) => {
          this.blocksStore.replace(index, newBlock);
        },
      },
      this.blocksStore
    );

    // Set yjsSync on operations to complete circular dependency
    this.operations.setYjsSync(this.yjsSync);

    // Initialize shortcuts
    this.shortcuts = new BlockShortcuts(
      this.Blok.UI.nodes.wrapper,
      {
        onMoveUp: this.moveCurrentBlockUp.bind(this),
        onMoveDown: this.moveCurrentBlockDown.bind(this),
      }
    );
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
      this.eventBinder.enableBindings(this.blocks);
    } else {
      this.eventBinder.disableBindings();
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
  public composeBlock(options: {
    tool: string;
    id?: string;
    data?: BlockToolData;
    tunes?: { [name: string]: BlockTuneData };
    parentId?: string;
    contentIds?: string[];
    bindEventsImmediately?: boolean;
  }): Block {
    return this.factory.composeBlock(options);
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
  public insert(options: {
    id?: string;
    tool?: string;
    data?: BlockToolData;
    index?: number;
    needToFocus?: boolean;
    replace?: boolean;
    tunes?: { [name: string]: BlockTuneData };
    skipYjsSync?: boolean;
  } = {}): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.insert(options, this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Inserts several blocks at once
   * Used during initial rendering of the editor
   * @param blocks - blocks to insert
   * @param index - index where to insert
   */
  public insertMany(blocks: Block[], index = 0): void {
    // Load blocks into Yjs BEFORE adding to the store.
    // blocksStore.insertMany() triggers rendered() on each block, which may
    // create nested blocks (e.g., table cell paragraphs) via api.blocks.insert().
    // Those nested inserts sync to Yjs. If fromJSON() ran after, it would wipe
    // them (fromJSON replaces the entire Yjs array). Running fromJSON first
    // ensures nested blocks created during rendered() persist in Yjs.
    const blockDataArray: OutputBlockData<string, Record<string, unknown>>[] = blocks.map(block => {
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

    this.blocksStore.insertMany(blocks, index);

    // Apply indentation for blocks with parentId (hierarchical structure)
    blocks.forEach(block => {
      if (block.parentId !== null) {
        this.updateBlockIndentation(block);
      }
    });
  }

  /**
   * Update Block data
   * @param block - block to update
   * @param data - (optional) new data
   * @param tunes - (optional) tune data
   */
  public async update(block: Block, data?: Partial<BlockToolData>, tunes?: { [name: string]: BlockTuneData }): Promise<Block> {
    return this.operations.update(block, this.blocksStore, data, tunes);
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - block to replace
   * @param newTool - new Tool name
   * @param data - new Tool data
   */
  public replace(block: Block, newTool: string, data: BlockToolData): Block {
    return this.operations.replace(block, newTool, data, this.blocksStore);
  }

  /**
   * Insert pasted content. Call onPaste callback after insert.
   * @param {string} toolName - name of Tool to insert
   * @param {PasteEvent} pasteEvent - pasted data
   * @param {boolean} replace - should replace current block
   */
  public async paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false
  ): Promise<Block> {
    return this.operations.paste(toolName, pasteEvent, replace, this.blocksStore);
  }

  /**
   * Insert new default block at passed index
   * @param {number} index - index where Block should be inserted
   * @param {boolean} needToFocus - if true, updates current Block index
   * @param {boolean} skipYjsSync - if true, skip syncing to Yjs (caller handles sync separately)
   * @returns {Block} inserted Block
   */
  public insertDefaultBlockAtIndex(index: number, needToFocus = false, skipYjsSync = false): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.insertDefaultBlockAtIndex(index, needToFocus, skipYjsSync, this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Always inserts at the end
   * @returns {Block}
   */
  public insertAtEnd(): Block {
    return this.operations.insertAtEnd(this.blocksStore);
  }

  /**
   * Merge two blocks
   * @param {Block} targetBlock - previous block will be append to this block
   * @param {Block} blockToMerge - block that will be merged with target block
   * @returns {Promise} - the sequence that can be continued
   */
  public async mergeBlocks(targetBlock: Block, blockToMerge: Block): Promise<void> {
    return this.operations.mergeBlocks(targetBlock, blockToMerge, this.blocksStore);
  }

  /**
   * Remove passed Block
   * @param block - Block to remove
   * @param addLastBlock - if true, inserts a new default block when the last block is removed
   * @param skipYjsSync - if true, skip syncing to Yjs (caller handles sync separately)
   */
  public removeBlock(block: Block, addLastBlock = true, skipYjsSync = false): Promise<void> {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.removeBlock(block, addLastBlock, skipYjsSync, this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Delete all selected blocks and insert a replacement block at their position.
   * Only inserts a replacement block if all blocks were deleted.
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
    const blocksToRemove = [...this.blocks];
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
   */
  public split(): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.split(this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Splits a block by updating the current block's data and inserting a new block.
   * Both operations are grouped into a single undo entry.
   */
  public splitBlockWithData(
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number
  ): Block {
    return this.operations.splitBlockWithData(
      currentBlockId,
      currentBlockData,
      newBlockType,
      newBlockData,
      insertIndex,
      this.blocksStore
    );
  }

  /**
   * Returns Block by passed index
   */
  public getBlockByIndex(index: number): Block | undefined {
    return this.repository.getBlockByIndex(index);
  }

  /**
   * Returns an index for passed Block
   * @param block - block to find index
   */
  public getBlockIndex(block: Block): number {
    return this.repository.getBlockIndex(block);
  }

  /**
   * Returns the Block by passed id
   * @param id - id of block to get
   * @returns {Block}
   */
  public getBlockById(id: string): Block | undefined {
    return this.repository.getBlockById(id);
  }

  /**
   * Returns the depth (nesting level) of a block in the hierarchy.
   * @param block - the block to get depth for
   * @returns {number} - depth level (0 for root, 1 for first level children, etc.)
   */
  public getBlockDepth(block: Block): number {
    return this.hierarchy.getBlockDepth(block);
  }

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   * @param block - the block to reparent
   * @param newParentId - the new parent block id, or null for root level
   */
  public setBlockParent(block: Block, newParentId: string | null): void {
    return this.hierarchy.setBlockParent(block, newParentId);
  }

  /**
   * Updates the visual indentation of a block based on its depth in the hierarchy.
   * @param block - the block to update indentation for
   */
  public updateBlockIndentation(block: Block): void {
    return this.hierarchy.updateBlockIndentation(block);
  }

  /**
   * Get Block instance by html element
   */
  public getBlock(element: HTMLElement): Block | undefined {
    return this.repository.getBlock(element);
  }

  /**
   * 1) Find first-level Block from passed child Node
   * 2) Mark it as current
   */
  public setCurrentBlockByChildNode(childNode: Node): Block | undefined {
    /**
     * Find the block whose holder contains this child node.
     * Uses the blocks array (not DOM children of the working area)
     * so that blocks inside table cells are found correctly.
     */
    const block = this.repository.getBlockByChildNode(childNode);

    if (!block) {
      return undefined;
    }

    /**
     * Support multiple Blok instances,
     * by checking whether the found block belongs to the current instance
     */
    const blokWrapper = block.holder.closest(`[${DATA_ATTR.editor}]`);
    const wrapper = this.Blok.UI.nodes.wrapper;
    const isBlockBelongsToCurrentInstance = blokWrapper?.isEqualNode(wrapper);

    if (!isBlockBelongsToCurrentInstance) {
      return undefined;
    }

    this.currentBlockIndex = this.repository.getBlockIndex(block);

    block.updateCurrentInput();

    return block;
  }

  /**
   * Return block which contents passed node
   */
  public getBlockByChildNode(childNode: Node): Block | undefined {
    return this.repository.getBlockByChildNode(childNode);
  }

  /**
   * Move a block to a new index
   */
  public move(toIndex: number, fromIndex: number = this.currentBlockIndex, skipDOM = false): void {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.move(toIndex, fromIndex, skipDOM, this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
  }

  /**
   * Converts passed Block to the new Tool
   */
  public async convert(block: Block, targetToolName: string, blockDataOverrides?: BlockToolData): Promise<Block> {
    return this.operations.convert(block, targetToolName, this.blocksStore, blockDataOverrides);
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
   */
  public async clear(needToAddDefaultBlock = false): Promise<void> {
    // Create a copy of the blocks array to avoid issues with array modification during iteration
    const blocksToRemove = [...this.blocks];
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
   */
  public moveCurrentBlockUp(): void {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.moveCurrentBlockUp(this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
  }

  /**
   * Moves the current block down by one position
   */
  public moveCurrentBlockDown(): void {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.moveCurrentBlockDown(this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
  }

  /**
   * Cleans up all the block tools' resources
   */
  public async destroy(): Promise<void> {
    // Unregister keyboard shortcuts
    this.shortcuts.unregister();

    await Promise.all(this.blocks.map((block) => {
      return block.destroy();
    }));
  }

  /**
   * Bind Block events
   */
  private bindBlockEvents(block: Block): void {
    this.eventBinder.bindBlockEvents(block);
  }

  /**
   * Block mutation callback
   */
  private blockDidMutated<Type extends BlockMutationType>(
    mutationType: Type,
    block: Block,
    detailData: BlockMutationEventDetailWithoutTarget<Type>
  ): Block {
    const eventDetail = {
      target: new BlockAPI(block),
      ...detailData,
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
    if (mutationType === BlockChangedMutationType && !this.yjsSync.isSyncingFromYjs) {
      void this.syncBlockDataToYjs(block);
    }

    return block;
  }

  /**
   * Sync block data to Yjs after DOM mutation
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
