import * as Y from 'yjs';

import type { YBlockSerializer, YjsOutputBlockData } from './serializer';
import type { TransactionOrigin } from './types';

// Re-export YjsOutputBlockData as DocumentStoreBlockData for consistency
type DocumentStoreBlockData = YjsOutputBlockData;

/**
 * DocumentStore manages the Yjs document and provides atomic block operations.
 *
 * Responsibilities:
 * - Owns the Y.Doc and Y.Array instances
 * - Provides CRUD operations for blocks
 * - Wraps operations in transactions with proper origins
 */
export class DocumentStore {
  /**
   * Yjs document instance
   */
  public readonly ydoc: Y.Doc = new Y.Doc();

  /**
   * Yjs array containing all blocks
   */
  public readonly yblocks: Y.Array<Y.Map<unknown>> = this.ydoc.getArray('blocks');

  /**
   * Serializer for converting between Yjs and DocumentStoreBlockData formats
   */
  private serializer: YBlockSerializer;

  constructor(serializer: YBlockSerializer) {
    this.serializer = serializer;
  }

  /**
   * Load blocks from JSON data.
   * Clears existing blocks and replaces them with the provided data.
   * Uses 'load' origin which is not tracked by undo manager.
   */
  public fromJSON(blocks: DocumentStoreBlockData[]): void {
    this.ydoc.transact(() => {
      this.yblocks.delete(0, this.yblocks.length);

      for (const block of blocks) {
        const yblock = this.serializer.outputDataToYBlock(block);
        this.yblocks.push([yblock]);
      }
    }, 'load');
  }

  /**
   * Serialize blocks to JSON format.
   */
  public toJSON(): DocumentStoreBlockData[] {
    return this.yblocks.toArray().map((yblock) => this.serializer.yBlockToOutputData(yblock));
  }

  /**
   * Add a new block.
   * @param blockData - Block data to add
   * @param index - Optional index to insert at (defaults to end)
   * @returns The created Y.Map
   */
  public addBlock(blockData: DocumentStoreBlockData, index?: number): Y.Map<unknown> {
    const yblock = this.serializer.outputDataToYBlock(blockData);

    this.transact(() => {
      const insertIndex = Math.max(0, Math.min(index ?? this.yblocks.length, this.yblocks.length));
      this.yblocks.insert(insertIndex, [yblock]);
    }, 'local');

    return yblock;
  }

  /**
   * Remove a block by id.
   * @param id - Block id to remove
   */
  public removeBlock(id: string): void {
    const index = this.findBlockIndex(id);

    if (index === -1) {
      return;
    }

    this.transact(() => {
      this.yblocks.delete(index, 1);
    }, 'local');
  }

  /**
   * Move a block to a new index.
   * @param id - Block id to move
   * @param toIndex - Target index (the final position where the block should end up)
   * @param origin - Transaction origin
   */
  public moveBlock(id: string, toIndex: number, origin: TransactionOrigin): void {
    const fromIndex = this.findBlockIndex(id);

    if (fromIndex === -1) {
      return;
    }

    // Skip if no actual movement needed
    if (fromIndex === toIndex) {
      return;
    }

    // Use the origin for the transaction:
    // - 'local' for user-initiated moves (we use 'move' so Yjs UndoManager doesn't track them)
    // - 'move-undo' / 'move-redo' for our custom undo/redo (maps to 'undo'/'redo' for DOM sync)
    const transactionOrigin = origin === 'local' ? 'move' : origin;

    this.transact(() => {
      const yblock = this.yblocks.get(fromIndex);

      // Clone the block data before deletion since Y.Map can't be reinserted after deletion
      const blockData = this.serializer.yBlockToOutputData(yblock);

      this.yblocks.delete(fromIndex, 1);

      // Clamp toIndex to valid range after deletion shortened the array.
      // An out-of-bounds toIndex means the caller had stale state — clamp
      // to array bounds rather than letting Yjs throw "Length exceeded!".
      const clampedToIndex = Math.max(0, Math.min(toIndex, this.yblocks.length));
      this.yblocks.insert(clampedToIndex, [this.serializer.outputDataToYBlock(blockData)]);
    }, transactionOrigin);
  }

  /**
   * Get block Y.Map by id.
   * @param id - Block id
   * @returns Y.Map or undefined if not found
   */
  public getBlockById(id: string): Y.Map<unknown> | undefined {
    const index = this.findBlockIndex(id);

    if (index === -1) {
      return undefined;
    }

    return this.yblocks.get(index);
  }

  /**
   * Update a property in block data.
   * @param id - Block id
   * @param key - Data property key
   * @param value - New value
   */
  public updateBlockData(id: string, key: string, value: unknown): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    const ydata = yblock.get('data') as Y.Map<unknown>;
    const currentValue = ydata.get(key);

    // Skip if value hasn't changed - this prevents creating unnecessary undo entries
    // when block data is synced after mutations that don't actually change data
    // (e.g., marker updates in list items during undo/redo)
    if (currentValue === value) {
      return;
    }

    this.transact(() => {
      ydata.set(key, value);
    }, 'local');
  }

  /**
   * Update a tune in block tunes.
   * @param id - Block id
   * @param tuneName - Tune name
   * @param tuneData - Tune data value
   */
  public updateBlockTune(id: string, tuneName: string, tuneData: unknown): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    this.transact(() => {
      const ytunes = this.getOrCreateTunesMap(yblock);
      ytunes.set(tuneName, tuneData);
    }, 'local');
  }

  /**
   * Find block index by id.
   * @param id - Block id to find
   * @returns Index or -1 if not found
   */
  public findBlockIndex(id: string): number {
    return this.yblocks.toArray().findIndex((yblock) => yblock.get('id') === id);
  }

  /**
   * Execute multiple Yjs operations as a single atomic transaction.
   * All operations within the callback will be grouped into one undo entry.
   * @param fn - Function containing Yjs operations to execute atomically
   * @param origin - Transaction origin
   */
  public transact(fn: () => void, origin: TransactionOrigin): void {
    this.ydoc.transact(fn, origin);
  }

  /**
   * Get existing tunes Y.Map or create a new one.
   * @param yblock - The block Y.Map
   * @returns The tunes Y.Map
   */
  private getOrCreateTunesMap(yblock: Y.Map<unknown>): Y.Map<unknown> {
    const existing = yblock.get('tunes') as Y.Map<unknown> | undefined;

    if (existing !== undefined) {
      return existing;
    }

    const newTunes = new Y.Map<unknown>();
    yblock.set('tunes', newTunes);

    return newTunes;
  }

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    this.ydoc.destroy();
  }
}
