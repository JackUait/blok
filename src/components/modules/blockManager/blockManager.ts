/**
 * @class BlockManager
 * @classdesc Manage blok`s blocks storage and appearance (Orchestrator)
 * @module BlockManager
 * @version 2.0.0
 */
import type { BlockToolData, OutputBlockData, PasteEvent } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { BlockMutationEventMap, BlockMutationType } from '../../../../types/events/block';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import { Module } from '../../__module';
import type { Block } from '../../block';
import { BlockAPI } from '../../block/api';
import { Blocks } from '../../blocks';
import { DATA_ATTR } from '../../constants';
import { BlockChanged } from '../../events';
import { generateBlockId, logLabeled } from '../../utils';
import { assertHierarchy, validateHierarchy } from '../../utils/hierarchy-invariant';
import * as Y from 'yjs';

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
   * Returns next visible Block instance (skips hidden blocks)
   * @returns {Block|null}
   */
  public get nextVisibleBlock(): Block | null {
    return this.operations?.nextVisibleBlock ?? null;
  }

  /**
   * Returns previous visible Block instance (skips hidden blocks)
   * @returns {Block|null}
   */
  public get previousVisibleBlock(): Block | null {
    return this.operations?.previousVisibleBlock ?? null;
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
   * Returns true when a Yjs sync operation (undo/redo) is in progress.
   * Used by the Blocks API to expose sync state to tools.
   */
  public get isSyncingFromYjs(): boolean {
    return this.yjsSync.isSyncingFromYjs;
  }

  /**
   * When true, suppresses DOM-mutation-triggered Yjs syncs.
   * Set by the table tool's cell-selection handler during a pointer drag
   * to prevent cross-cell browser DOM mutations from corrupting Yjs state.
   */
  private _isPointerDragActive = false;

  /**
   * Sets whether a pointer drag interaction is currently active.
   * While true, `syncBlockDataToYjs` is suppressed so that any incidental
   * DOM mutations caused by the browser during a drag do not corrupt Yjs.
   */
  public setPointerDragActive(active: boolean): void {
    this._isPointerDragActive = active;
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
   * Set of parent block IDs awaiting deferred Yjs sync.
   * Batched via queueMicrotask to avoid multiple syncs during batch operations.
   */
  private parentsSyncScheduled = new Set<string>();

  /**
   * Tracks the in-flight promise from flushParentSyncs so that transactForTool
   * can chain stopCapturing after all parent data has been written to Yjs.
   */
  private pendingParentSyncPromise: Promise<void> | null = null;

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
      shouldHandleEvent: (event: Event) => {
        const target = event.target;

        if (target instanceof Element) {
          const closestEditor = target.closest('[data-blok-testid="blok-editor"]');

          return closestEditor === null || closestEditor === this.Blok.UI.nodes.wrapper;
        }

        return true;
      },
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

    // Initialize hierarchy with callback to sync parent data to Yjs
    this.hierarchy = new BlockHierarchy(this.repository, (parentId) => {
      if (!this.yjsSync.isSyncingFromYjs) {
        this.scheduleParentSync(parentId);
      }
    });

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
        setBlockParent: (block, parentId) => {
          this.hierarchy.setBlockParent(block, parentId);
        },
        replaceBlock: (index, newBlock) => {
          this.blocksStore.replace(index, newBlock);
        },
        onBlockRemoved: (block, index) => {
          this.blockDidMutated(BlockRemovedMutationType, block, { index });
        },
        onBlockAdded: (block, index) => {
          this.blockDidMutated(BlockAddedMutationType, block, { index });
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
    lastEditedAt?: number;
    lastEditedBy?: string | null;
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
    const blockById = new Map<string, Block>();

    for (const block of blocks) {
      blockById.set(block.id, block);
    }

    this.reconcileChildrenToParents(blocks, blockById);
    this.reconcileParentsToChildren(blocks, blockById);
    this.assertInsertManyHierarchy(blocks);

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

    // Wrap in atomic operation so that RENDERED lifecycle hooks (which may
    // create nested blocks, e.g. table cell paragraphs, or call setBlockParent)
    // run with isSyncingFromYjs = true. This prevents:
    // 1. operations.insert() from syncing duplicate blocks to Yjs
    // 2. scheduleParentSync from writing back data already in Yjs
    // Both would create 'local' origin transactions that pollute the undo stack.
    this.yjsSync.withAtomicOperation(() => {
      this.blocksStore.insertMany(blocks, index);
    }, { extendThroughRAF: true });

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
  public insertDefaultBlockAtIndex(
    index: number,
    needToFocus = false,
    skipYjsSync = false,
    forceTopLevel = false
  ): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.insertDefaultBlockAtIndex(index, needToFocus, skipYjsSync, this.blocksStore, forceTopLevel);
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
   * Execute a function with stopCapturing suppressed.
   * All block operations within fn are kept in the same undo group.
   * Used by tools that perform multi-step structural operations
   * (e.g., table add row = multiple block inserts).
   */
  public transactForTool(fn: () => void): void {
    this.Blok.YjsManager.stopCapturing();

    const prevSuppress = this.operations.suppressStopCapturing;

    this.operations.suppressStopCapturing = true;

    try {
      fn();
    } finally {
      // Closing boundary uses two nested queueMicrotask calls to ensure correct ordering.
      //
      // Microtask ordering after fn() returns:
      //   [D1..D4 continuations, C (schedulePendingCellCheck), T (outer)]
      //
      // C runs BEFORE T (outer). During C, ensureCellHasBlock inserts fire, and
      // scheduleParentSync queues P2 (flushParentSyncs). P2 is appended to the queue
      // AFTER T (outer), so when T (outer) runs, P2 hasn't run yet.
      //
      // By queueing T_inner from inside T (outer), T_inner lands AFTER P2 in the queue:
      //   After C runs: [T (outer), P2]
      //   T (outer) runs, queues T_inner: [P2, T_inner]
      //   P2 runs: sets pendingParentSyncPromise
      //   T_inner runs: finds pendingParentSyncPromise set → waits for it → stopCapturing()
      //
      // This ensures the parent sync's updateBlockData fires inside the same undo group
      // as the structural operation (deletes + empty cell inserts + table data update).
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (this.pendingParentSyncPromise !== null) {
            void this.pendingParentSyncPromise.then(() => {
              this.Blok.YjsManager.stopCapturing();
              this.operations.suppressStopCapturing = prevSuppress;
            });
          } else {
            this.Blok.YjsManager.stopCapturing();
            this.operations.suppressStopCapturing = prevSuppress;
          }
        });
      });
    }
  }

  /**
   * Insert a new paragraph block as a child of the given parent, atomically.
   * Block creation and parent assignment are grouped into a single undo entry.
   *
   * @param parentId - id of the parent block
   * @param insertIndex - flat block index where the new block should appear
   * @returns the newly created child block
   */
  public insertInsideParent(parentId: string, insertIndex: number): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.insertInsideParent(parentId, insertIndex, this.blocksStore);
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
   * Walks up the parentId chain and returns the top-level (root) block.
   * If the block has no parent, returns it as-is.
   * @param block - the block to resolve
   * @returns {Block} the root ancestor block
   */
  public resolveToRootBlock(block: Block): Block {
    return this.repository.resolveToRootBlock(block);
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
   *
   * Fix 1: the Yjs-side contentIds Y.Arrays on the old and new parents must be
   * updated in the SAME transaction as the child's parentId write. Previously,
   * only `yblock.set('parentId', …)` was synced to Yjs, so:
   *   - Two concurrent peers reparenting siblings would drift on both parents
   *     because neither ever learned the move through CRDT.
   *   - Undo snapshots captured the parentId change but left stale contentIds
   *     on the old/new parents, so redo could restore a child that no parent
   *     actually claimed.
   * The companion writes keep the persistent Yjs store consistent with the
   * in-memory hierarchy at every transaction boundary.
   * @param block - the block to reparent
   * @param newParentId - the new parent block id, or null for root level
   */
  public setBlockParent(block: Block, newParentId: string | null): void {
    // Capture the old parent id BEFORE hierarchy.setBlockParent mutates it —
    // we need it to remove the child from the old parent's Yjs contentIds.
    const oldParentId = block.parentId;

    this.hierarchy.setBlockParent(block, newParentId);

    // Sync the child block's parentId to Yjs so undo/redo can restore the relationship.
    // Without this, blocks created via insertDefaultBlockAtIndex + setBlockParent (e.g.,
    // pressing Enter in a child paragraph) lose their parentId on redo because the
    // initial addBlock wrote to Yjs before setBlockParent was called.
    // Skip during Yjs sync operations (undo/redo handler already has correct state).
    if (this.yjsSync.isSyncingFromYjs) {
      return;
    }

    const yblock = this.Blok.YjsManager.getBlockById(block.id);

    if (yblock === undefined) {
      return;
    }

    // Drag-reparent path: when a move group is open (DragController wraps
    // its drop handler in `YjsManager.transactMoves`), route the Yjs write
    // through `transactWithoutCapture` so Y.UndoManager does not record it
    // as a separate stack item. Attach the parent change to the in-flight
    // move entry instead — on undo/redo we rewind both atomically.
    if (this.Blok.YjsManager.isInMoveGroup) {
      this.Blok.YjsManager.transactWithoutCapture(() => {
        if (newParentId !== null) {
          yblock.set('parentId', newParentId);
        } else {
          yblock.delete('parentId');
        }

        this.syncParentContentIdsToYjs(block.id, oldParentId, newParentId);
      });
      this.Blok.YjsManager.recordParentChangeForPendingMove(
        block.id,
        oldParentId,
        newParentId
      );

      return;
    }

    // Wrap parentId + parent contentIds updates in a single Yjs transaction so
    // they land atomically on remote peers and in the undo stack.
    this.Blok.YjsManager.transact(() => {
      if (newParentId !== null) {
        yblock.set('parentId', newParentId);
      } else {
        yblock.delete('parentId');
      }

      this.syncParentContentIdsToYjs(block.id, oldParentId, newParentId);
    });
  }

  /**
   * Reparent a block in response to UndoHistory replaying a drag move.
   *
   * The replay path has ALREADY written the new parentId to Yjs under
   * `transactWithoutCapture`. This method exists so UndoHistory has a
   * stable entry point for the in-memory reparent that:
   *   - routes through `BlockHierarchy.setBlockParent` so contentIds, DOM
   *     placement, and indentation all stay consistent
   *   - does NOT re-write Yjs (that would double-emit or re-enter capture)
   * @param block - the block being reparented during move-undo/move-redo
   * @param newParentId - the parent id to restore
   */
  public reparentFromHistoryReplay(block: Block, newParentId: string | null): void {
    // Run inside withAtomicOperation so `isSyncingFromYjs` is true for the
    // duration of the hierarchy update. This suppresses:
    //   - `onParentChanged` → `scheduleParentSync` → a fresh Yjs write that
    //     would land on Y.UndoManager (polluting the undo stack)
    //   - any DOM mutation observer write-back into Yjs
    this.yjsSync.withAtomicOperation(() => {
      this.hierarchy.setBlockParent(block, newParentId);
    });
  }

  /**
   * Fix 1 helper: update the old and new parents' Yjs `contentIds` Y.Arrays
   * so the persistent store mirrors the in-memory hierarchy after a reparent.
   * Extracted from {@link setBlockParent} to keep block nesting shallow.
   * @param childId - id of the block being reparented
   * @param oldParentId - parent id before the reparent (may be null)
   * @param newParentId - parent id after the reparent (may be null)
   */
  private syncParentContentIdsToYjs(
    childId: string,
    oldParentId: string | null,
    newParentId: string | null
  ): void {
    if (oldParentId !== null && oldParentId !== newParentId) {
      this.removeChildFromParentYContent(oldParentId, childId);
    }
    if (newParentId !== null) {
      this.appendChildToParentYContent(newParentId, childId);
    }
  }

  /**
   * Fix 1 helper: remove a child id from a parent block's Yjs `contentIds`
   * Y.Array if it is present. No-op when the parent or its contentIds are
   * missing from Yjs.
   * @param parentId - parent block id
   * @param childId - child block id to remove
   */
  private removeChildFromParentYContent(parentId: string, childId: string): void {
    const parentYBlock = this.Blok.YjsManager.getBlockById(parentId);

    if (parentYBlock === undefined) {
      return;
    }
    const content = parentYBlock.get('contentIds');

    if (!(content instanceof Y.Array)) {
      return;
    }
    const idx = (content.toArray() as string[]).indexOf(childId);

    if (idx !== -1) {
      content.delete(idx, 1);
    }
  }

  /**
   * Fix 1 helper: append a child id to a parent block's Yjs `contentIds`
   * Y.Array, creating the Y.Array on the parent yblock if missing. Inserts at
   * the index the child occupies in the in-memory parent so remote peers see
   * the same ordering as the local editor.
   * @param parentId - parent block id
   * @param childId - child block id to append
   */
  private appendChildToParentYContent(parentId: string, childId: string): void {
    const parentYBlock = this.Blok.YjsManager.getBlockById(parentId);

    if (parentYBlock === undefined) {
      return;
    }
    const existing = parentYBlock.get('contentIds');
    const content: Y.Array<string> = existing instanceof Y.Array
      ? (existing as Y.Array<string>)
      : new Y.Array<string>();

    if (!(existing instanceof Y.Array)) {
      parentYBlock.set('contentIds', content);
    }
    if ((content.toArray()).includes(childId)) {
      return;
    }
    const parentBlock = this.repository.getBlockById(parentId);
    const memoryIndex = parentBlock !== undefined ? parentBlock.contentIds.indexOf(childId) : -1;
    const insertAt = memoryIndex === -1 ? content.length : Math.min(memoryIndex, content.length);

    content.insert(insertAt, [childId]);
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
  public move(toIndex: number, fromIndex: number = this.currentBlockIndex, skipDOM = false, skipMovedHook = false): void {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.move(toIndex, fromIndex, skipDOM, this.blocksStore, skipMovedHook);
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
    /**
     * Layer 21: block move shortcuts while a drag is in progress.
     *
     * Regression: "wrong block dropped" family. Cmd/Ctrl+Shift+ArrowUp routes
     * through BlockShortcuts → this method → BlockOperations.moveCurrentBlockUp,
     * which mutates the flat blocks array. If DragController is mid-drag (it
     * holds live source/target Block references captured on dragstart), the
     * array reshuffle leaves its stored indices pointing at the wrong rows
     * and handleDrop silently drops an unrelated block.
     *
     * Mirrors the Cmd+Z-during-drag guard (layer 18) and the paste-during-drag
     * guard (layer 20): swallow the shortcut so the drag completes cleanly,
     * then the user can retry the move.
     */
    if (this.Blok.DragManager?.isDragging) {
      return;
    }

    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.moveCurrentBlockUp(this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
  }

  /**
   * Moves the current block down by one position
   */
  public moveCurrentBlockDown(): void {
    // Layer 21: see moveCurrentBlockUp above for rationale.
    if (this.Blok.DragManager?.isDragging) {
      return;
    }

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
    // Skip if we're currently syncing from Yjs (undo/redo) to avoid corrupting the undo stack.
    // Also skip if a pointer drag is active — the browser can mutate contenteditable DOM across
    // cell boundaries during a drag, and we must not write that corrupted state to Yjs.
    if (mutationType === BlockChangedMutationType && !this.yjsSync.isSyncingFromYjs && !this._isPointerDragActive) {
      void this.syncBlockDataToYjs(block);
    }

    return block;
  }

  /**
   * insertMany helper: fills parent.contentIds from child.parentId.
   *
   * Hierarchical input JSON may carry `parent` on children without a matching
   * `content` on the parent (valid hierarchical data, but leaves the parent's
   * contentIds empty after composeBlock). Downstream code treats
   * `parent.contentIds` as the authoritative child list, so reconciling here
   * makes the invariant `child.parentId ⇒ parent.contentIds.includes(child.id)`
   * hold from the moment blocks enter the editor.
   *
   * If a child's parentId points to a block id that is not in the input, the
   * parentId is cleared — matching the editor's pre-existing permissive
   * behaviour of dropping dangling cross-references so the subsequent Fix 3
   * `assertHierarchy` pass can run on a consistent snapshot.
   * @param blocks - blocks being inserted
   * @param blockById - id→block lookup built from `blocks`
   */
  private reconcileChildrenToParents(blocks: Block[], blockById: Map<string, Block>): void {
    for (const block of blocks) {
      if (block.parentId === null) {
        continue;
      }
      const parent = blockById.get(block.parentId);

      if (parent === undefined) {
        // Dangling parentId: the referenced parent is missing from the input.
        // Clear the orphan reference so the block becomes root-level instead
        // of carrying a stale pointer into the editor state.
        block.parentId = null;

        continue;
      }
      if (!parent.contentIds.includes(block.id)) {
        parent.contentIds.push(block.id);
      }
    }
  }

  /**
   * Fix 2: inverse reconcile — sanitise parent.contentIds against the children.
   *
   * The symmetric case: a parent with `content: ['c1']` whose child c1 has no
   * `parent` field (or points at a different parent). Child is the source of
   * truth, because the block physically carries the back-pointer downstream.
   * For every parent→child claim:
   *   - child missing from the input: drop the dangling id from parent.contentIds
   *   - child has no parentId: set child.parentId = parent.id (keep the claim)
   *   - child has a different parentId: trust the child, sanitise the parent
   * @param blocks - blocks being inserted
   * @param blockById - id→block lookup built from `blocks`
   */
  private reconcileParentsToChildren(blocks: Block[], blockById: Map<string, Block>): void {
    for (const block of blocks) {
      if (block.contentIds.length === 0) {
        continue;
      }
      block.contentIds = block.contentIds.filter((childId) =>
        this.resolveChildForParent(block, childId, blockById)
      );
    }
  }

  /**
   * Fix 2 helper: decide whether a parent.contentIds entry should be kept.
   *
   * Side effect: when a child exists and has no parentId, its parentId is set
   * to the claiming parent id (keeping the entry in the parent's contentIds).
   * @param parent - the parent block whose contentIds we are sanitising
   * @param childId - candidate child id from parent.contentIds
   * @param blockById - id→block lookup built from the insertMany input
   * @returns true when the child id should remain in parent.contentIds
   */
  private resolveChildForParent(
    parent: Block,
    childId: string,
    blockById: Map<string, Block>
  ): boolean {
    const child = blockById.get(childId);

    if (child === undefined) {
      return false;
    }
    if (child.parentId === null) {
      child.parentId = parent.id;

      return true;
    }

    return child.parentId === parent.id;
  }

  /**
   * Fix 3: assert the hierarchy invariant before handing the blocks off to Yjs.
   *
   * Matches the saver pattern (`saver.ts:287-295`): in test and development
   * builds, any residual drift throws loudly so the regression is caught at
   * the point of introduction; in production we only log, so an edge-case
   * drift never breaks user loads.
   * @param blocks - the fully reconciled blocks about to be handed to Yjs
   */
  private assertInsertManyHierarchy(blocks: Block[]): void {
    const snapshot: OutputBlockData<string, Record<string, unknown>>[] = blocks.map((block) => ({
      id: block.id,
      type: block.name,
      data: {},
      ...(block.parentId !== null && { parent: block.parentId }),
      ...(block.contentIds.length > 0 && { content: block.contentIds }),
    }));
    const env = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

    if (env === 'test' || env === 'development') {
      assertHierarchy(snapshot, 'BlockManager.insertMany');

      return;
    }
    const violations = validateHierarchy(snapshot);

    if (violations.length === 0) {
      return;
    }
    const summary = violations.map((v) => v.message).join('; ');

    logLabeled(`BlockManager.insertMany produced output with hierarchy drift: ${summary}`, 'error');
  }

  /**
   * Schedule a deferred sync of a parent block's data to Yjs.
   * Uses queueMicrotask to batch multiple parent changes (e.g. when initializing
   * all cells in a new table row) into a single flush.
   */
  private scheduleParentSync(parentId: string): void {
    if (this.parentsSyncScheduled.size === 0) {
      queueMicrotask(() => this.flushParentSyncs());
    }
    this.parentsSyncScheduled.add(parentId);
  }

  /**
   * Flush all scheduled parent syncs to Yjs.
   * Called from the microtask scheduled by scheduleParentSync.
   */
  private flushParentSyncs(): void {
    const promises: Promise<void>[] = [];

    for (const parentId of this.parentsSyncScheduled) {
      const parent = this.repository.getBlockById(parentId);

      if (parent !== undefined) {
        promises.push(this.syncBlockDataToYjs(parent));
      }
    }
    this.parentsSyncScheduled.clear();

    if (promises.length > 0) {
      this.pendingParentSyncPromise = Promise.all(promises).then(() => {
        this.pendingParentSyncPromise = null;
      });
    }
  }

  /**
   * Sync block data to Yjs after DOM mutation.
   *
   * Only writes metadata (lastEditedAt / lastEditedBy) if at least one data field
   * actually changed. This preserves the invariant "no data change → no Yjs write →
   * no undo entry." Without this guard, a spurious metadata-only transaction lands
   * on the Yjs undo stack after every user operation, causing a single CMD+Z to pop
   * only the metadata entry instead of the actual data change.
   */
  private async syncBlockDataToYjs(block: Block): Promise<void> {
    const savedData = await block.save();

    if (savedData === undefined) {
      return;
    }

    // Wrap data + metadata writes into a single Yjs transaction. Without this,
    // each updateBlockData / updateBlockMetadata call opens its own transaction
    // and fires a stack-item-added event, which runs caret capture that may
    // trigger stopCapturing() as a side effect — splitting a single logical
    // save across multiple undo groups (so a single CMD+Z only reverts the
    // metadata bump instead of the data change).
    const dataChangedRef = { value: false };

    this.Blok.YjsManager.transact(() => {
      for (const [key, value] of Object.entries(savedData.data)) {
        if (this.Blok.YjsManager.updateBlockData(block.id, key, value)) {
          dataChangedRef.value = true;
        }
      }

      if (!dataChangedRef.value) {
        return;
      }

      // Bump edit metadata only when data actually changed, so we don't add
      // a spurious metadata-only entry to the Yjs undo stack.
      // eslint-disable-next-line no-param-reassign
      block.lastEditedAt = Date.now();
      // eslint-disable-next-line no-param-reassign
      block.lastEditedBy = this.config.user?.id ?? null;

      this.Blok.YjsManager.updateBlockMetadata(block.id, block.lastEditedAt, block.lastEditedBy);
    });
  }
}
