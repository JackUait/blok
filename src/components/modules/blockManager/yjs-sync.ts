/**
 * @class BlockYjsSync
 * @classdesc Handles Yjs synchronization for blocks
 * @module BlockYjsSync
 */
import type { Map as YMap } from 'yjs';

import type { Block } from '../../block';
import type { YjsManager } from '../yjs';
import type { BlockChangeEvent } from '../yjs/types';

import type { BlockFactory } from './factory';
import type { BlockOperations } from './operations';
import type { BlockRepository } from './repository';
import type { BlocksStore } from './types';


/**
 * Dependencies needed by BlockYjsSync
 */
export interface BlockYjsSyncDependencies {
  /** YjsManager instance */
  YjsManager: YjsManager;
  /** BlockOperations instance for suppressing stopCapturing during atomic operations */
  operations?: BlockOperations;
}

/**
 * Sync handler callbacks for DOM updates
 */
export interface SyncHandlers {
  /** Called when a block needs to be added to DOM */
  addToDom: (block: Block, index: number) => void;
  /** Called when a block needs to be removed from DOM */
  removeFromDom: (index: number) => void;
  /** Called when blocks need to be reordered */
  moveInDom: (toIndex: number, fromIndex: number) => void;
  /** Called to get current block index */
  getBlockIndex: (block: Block) => number;
  /** Called to insert a default block */
  insertDefaultBlock: (skipYjsSync: boolean) => Block;
  /** Called to update block indentation */
  updateIndentation: (block: Block) => void;
  /** Called to replace a block at a specific index with a new block instance */
  replaceBlock: (index: number, newBlock: Block) => void;
  /** Called when a block is removed during undo/redo (before DOM removal) */
  onBlockRemoved: (block: Block, index: number) => void;
  /** Called when a block is added during undo/redo (after insertion) */
  onBlockAdded: (block: Block, index: number) => void;
}

/**
 * BlockYjsSync handles synchronization between DOM blocks and Yjs document
 */
export class BlockYjsSync {
  private readonly dependencies: BlockYjsSyncDependencies;
  private readonly repository: BlockRepository;
  private readonly factory: BlockFactory;
  private readonly handlers: SyncHandlers;

  /**
   * Counter to track active Yjs sync operations (undo/redo) to prevent re-syncing back.
   * Uses a counter instead of boolean to handle overlapping async operations safely.
   */
  private yjsSyncCount = 0;

  /**
   * Returns true if any Yjs sync operation is in progress
   */
  public get isSyncingFromYjs(): boolean {
    return this.yjsSyncCount > 0;
  }

  /**
   * Flag to prevent multiple move syncs in the same event batch
   */
  private moveSyncScheduled = false;

  /**
   * Blocks store access
   */
  private blocksStore: BlocksStore;

  /**
   * @param dependencies - YjsManager and other dependencies
   * @param repository - BlockRepository for block lookups
   * @param factory - BlockFactory for creating blocks
   * @param handlers - Callbacks for DOM updates
   * @param blocksStore - The blocks store
   */
  constructor(
    dependencies: BlockYjsSyncDependencies,
    repository: BlockRepository,
    factory: BlockFactory,
    handlers: SyncHandlers,
    blocksStore: BlocksStore
  ) {
    this.dependencies = dependencies;
    this.repository = repository;
    this.factory = factory;
    this.handlers = handlers;
    this.blocksStore = blocksStore;
  }

  /**
   * Execute a function within a sync context where:
   * - Yjs auto-sync is suppressed (DOM changes won't trigger sync back to Yjs)
   * - stopCapturing is suppressed (block index changes won't break undo grouping)
   *
   * Use this for operations that need to update both Yjs and DOM atomically.
   *
   * @param fn - Function to execute
   * @param options - Options for controlling the atomic operation behavior
   */
  public withAtomicOperation<T>(fn: () => T, options?: { extendThroughRAF?: boolean }): T {
    this.yjsSyncCount++;
    const operations = this.dependencies.operations;
    const shouldExtend = options?.extendThroughRAF === true;

    if (operations) {
      operations.suppressStopCapturing = true;
    }

    const decrementSyncCount = (): void => {
      this.yjsSyncCount--;
      if (operations && this.yjsSyncCount === 0) {
        operations.suppressStopCapturing = false;
      }
    };

    try {
      const result = fn();

      // If extendThroughRAF is true, delay decrementing yjsSyncCount until after requestAnimationFrame callbacks
      // This ensures that DOM updates scheduled by rendered() hooks don't trigger
      // block data sync to Yjs, which would create new undo entries and clear the redo stack
      if (shouldExtend) {
        requestAnimationFrame(decrementSyncCount);
      } else {
        decrementSyncCount();
      }

      return result;
    } catch (error) {
      // If an error occurs, decrement immediately
      decrementSyncCount();
      throw error;
    }
  }

  /**
   * Subscribe to Yjs changes for undo/redo DOM synchronization
   * @returns unsubscribe function
   */
  public subscribe(): () => void {
    return this.dependencies.YjsManager.onBlocksChanged((event: BlockChangeEvent) => {
      if (event.origin === 'undo' || event.origin === 'redo') {
        this.syncBlockFromYjs(event);
      }
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
    const block = this.repository.getBlockById(blockId);
    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (block === undefined || yblock === undefined) {
      return;
    }

    const data = this.dependencies.YjsManager.yMapToObject(yblock.get('data') as YMap<unknown>);
    const ytunes = yblock.get('tunes') as YMap<unknown> | undefined;
    const tunes = ytunes !== undefined ? this.dependencies.YjsManager.yMapToObject(ytunes) : {};

    // Check if tunes have changed - if so, we need to recreate the block
    // because tunes are instantiated during block construction
    const currentTunes = block.preservedTunes;
    const tuneKeys = Object.keys(tunes);
    const currentKeys = Object.keys(currentTunes);
    const tunesChanged = tuneKeys.length !== currentKeys.length ||
      tuneKeys.some(key => tunes[key] !== currentTunes[key]);

    if (tunesChanged) {
      // Recreate block with updated tunes
      const blockIndex = this.handlers.getBlockIndex(block);
      const newBlock = this.factory.composeBlock({
        id: block.id,
        tool: block.name,
        data,
        tunes,
        bindEventsImmediately: true,
      });

      // Increment counter to prevent syncing back to Yjs during undo/redo
      this.yjsSyncCount++;
      try {
        this.handlers.replaceBlock(blockIndex, newBlock);
      } finally {
        this.yjsSyncCount--;
      }
    } else {
      // Just update data
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
    if (this.repository.getBlockById(blockId) !== undefined) {
      return;
    }

    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (yblock === undefined) {
      return;
    }

    const toolName = yblock.get('type') as string;
    const data = this.dependencies.YjsManager.yMapToObject(yblock.get('data') as YMap<unknown>);
    const parentId = yblock.get('parentId') as string | undefined;

    // Find the index of this block in Yjs to insert at correct position
    const yjsBlocks = this.dependencies.YjsManager.toJSON();
    const targetIndex = yjsBlocks.findIndex((b) => b.id === blockId);

    if (targetIndex === -1) {
      return;
    }

    // Wrap all operations in atomic context to prevent DOM updates from syncing back to Yjs
    // This is critical for preserving the redo stack during undo operations
    // Use extendThroughRAF to handle DOM updates scheduled by rendered() hooks
    this.withAtomicOperation(() => {
      // Create the block with immediate event binding for undo/redo responsiveness
      const block = this.factory.composeBlock({
        id: blockId,
        tool: toolName,
        data,
        parentId: parentId ?? undefined,
        bindEventsImmediately: true,
      });

      // Insert into blocks store at correct position - caller must handle this
      // This is a limitation - we need the blocksStore.insert method
      this.blocksStore.insert(targetIndex, block);

      // Apply indentation if needed
      if (parentId !== undefined) {
        this.handlers.updateIndentation(block);
      }
    }, { extendThroughRAF: true });
  }

  /**
   * Handle block remove from Yjs (undo/redo - removing a previously added block)
   */
  private handleYjsRemove(blockId: string): void {
    const block = this.repository.getBlockById(blockId);

    if (block === undefined) {
      return;
    }

    const index = this.handlers.getBlockIndex(block);

    if (index === -1) {
      return;
    }

    // Emit block-removed event BEFORE removal so listeners can inspect
    // the block's DOM position (e.g., which table cell it's in)
    this.handlers.onBlockRemoved(block, index);

    // Remove from DOM
    this.blocksStore.remove(index);

    // If all blocks removed, insert a default block
    if (this.blocksStore.length === 0) {
      this.handlers.insertDefaultBlock(true);
    }
  }

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
    const yjsBlocks = this.dependencies.YjsManager.toJSON();

    // Build id→block map for O(1) lookups instead of O(n) getBlockById calls
    const blockById = new Map<string, Block>();

    for (const block of this.repository.blocks) {
      blockById.set(block.id, block);
    }

    // Reorder DOM blocks to match Yjs order
    yjsBlocks.forEach((yjsBlock, targetIndex) => {
      const blockId = yjsBlock.id;

      if (blockId === undefined) {
        return;
      }

      const block = blockById.get(blockId);

      if (block === undefined) {
        return;
      }

      const currentIndex = this.handlers.getBlockIndex(block);

      if (currentIndex !== targetIndex) {
        this.blocksStore.move(targetIndex, currentIndex);
      }
    });
  }

  /**
   * Update the blocks store (used when blocks store changes)
   * @param blocksStore - New blocks store
   */
  public updateBlocksStore(blocksStore: BlocksStore): void {
    this.blocksStore = blocksStore;
  }

  /**
   * Handle block data update from DOM mutation
   * @param block - the block whose data should be synced
   * @param savedData - the saved block data
   */
  public async syncBlockDataToYjs(block: Block, savedData: { data: Record<string, unknown> }): Promise<void> {
    if (savedData === undefined) {
      return;
    }

    for (const [key, value] of Object.entries(savedData.data)) {
      this.dependencies.YjsManager.updateBlockData(block.id, key, value);
    }
  }

  /**
   * Check if block data is different from Yjs data
   * @param blockId - Block id
   * @param key - Data key
   * @param value - New value
   * @returns true if value is different
   */
  public isBlockDataChanged(blockId: string, key: string, value: unknown): boolean {
    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (yblock === undefined) {
      return true;
    }

    const ydata = yblock.get('data') as YMap<unknown>;
    const currentValue = ydata.get(key);

    return currentValue !== value;
  }
}
