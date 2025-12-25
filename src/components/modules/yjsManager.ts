import * as Y from 'yjs';
import { Module } from '../__module';
import type { OutputBlockData } from '../../../types/data-formats/output-data';

/**
 * @class YjsManager
 * @classdesc Manages Yjs document and block synchronization
 * @module YjsManager
 */
export class YjsManager extends Module {
  /**
   * Yjs document instance
   */
  private ydoc: Y.Doc = new Y.Doc();

  /**
   * Yjs array containing all blocks
   */
  private yblocks: Y.Array<Y.Map<unknown>> = this.ydoc.getArray('blocks');

  /**
   * Undo manager for history operations
   */
  private undoManager: Y.UndoManager = new Y.UndoManager(this.yblocks, {
    captureTimeout: 500,
    trackedOrigins: new Set(['local']),
  });

  /**
   * Load blocks from JSON data
   * @param blocks - Array of block data to load
   */
  public fromJSON(blocks: OutputBlockData[]): void {
    this.ydoc.transact(() => {
      this.yblocks.delete(0, this.yblocks.length);

      for (const block of blocks) {
        const yblock = new Y.Map<unknown>();

        yblock.set('id', block.id);
        yblock.set('type', block.type);
        yblock.set('data', this.objectToYMap(block.data));

        if (block.tunes !== undefined) {
          yblock.set('tunes', this.objectToYMap(block.tunes));
        }

        if (block.parent !== undefined) {
          yblock.set('parentId', block.parent);
        }

        if (block.content !== undefined) {
          yblock.set('contentIds', Y.Array.from(block.content));
        }

        this.yblocks.push([yblock]);
      }
    }, 'load');
  }

  /**
   * Serialize blocks to JSON format
   * @returns Array of block data
   */
  public toJSON(): OutputBlockData[] {
    const blocks: OutputBlockData[] = [];

    for (let i = 0; i < this.yblocks.length; i++) {
      const yblock = this.yblocks.get(i);
      const block: OutputBlockData = {
        id: yblock.get('id') as string,
        type: yblock.get('type') as string,
        data: this.yMapToObject(yblock.get('data') as Y.Map<unknown>),
      };

      const tunes = yblock.get('tunes') as Y.Map<unknown> | undefined;

      if (tunes !== undefined && tunes.size > 0) {
        block.tunes = this.yMapToObject(tunes);
      }

      const parentId = yblock.get('parentId') as string | undefined;

      if (parentId !== undefined) {
        block.parent = parentId;
      }

      const contentIds = yblock.get('contentIds') as Y.Array<string> | undefined;

      if (contentIds !== undefined && contentIds.length > 0) {
        block.content = contentIds.toArray();
      }

      blocks.push(block);
    }

    return blocks;
  }

  /**
   * Add a new block
   * @param blockData - Block data to add
   * @param index - Optional index to insert at
   * @returns The created Y.Map
   */
  public addBlock(blockData: OutputBlockData, index?: number): Y.Map<unknown> {
    const yblock = new Y.Map<unknown>();

    this.ydoc.transact(() => {
      yblock.set('id', blockData.id);
      yblock.set('type', blockData.type);
      yblock.set('data', this.objectToYMap(blockData.data));

      if (blockData.tunes !== undefined) {
        yblock.set('tunes', this.objectToYMap(blockData.tunes));
      }

      if (blockData.parent !== undefined) {
        yblock.set('parentId', blockData.parent);
      }

      const insertIndex = index ?? this.yblocks.length;

      this.yblocks.insert(insertIndex, [yblock]);
    }, 'local');

    return yblock;
  }

  /**
   * Remove a block by id
   * @param id - Block id to remove
   */
  public removeBlock(id: string): void {
    const index = this.findBlockIndex(id);

    if (index === -1) {
      return;
    }

    this.ydoc.transact(() => {
      this.yblocks.delete(index, 1);
    }, 'local');
  }

  /**
   * Move a block to a new index
   * @param id - Block id to move
   * @param toIndex - Target index
   */
  public moveBlock(id: string, toIndex: number): void {
    const fromIndex = this.findBlockIndex(id);

    if (fromIndex === -1) {
      return;
    }

    this.ydoc.transact(() => {
      const yblock = this.yblocks.get(fromIndex);

      // Clone the block data before deletion since Y.Map can't be reinserted after deletion
      const blockData = this.yBlockToOutputData(yblock);

      this.yblocks.delete(fromIndex, 1);

      const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

      // Create a new Y.Map with the cloned data
      const newYblock = new Y.Map<unknown>();

      newYblock.set('id', blockData.id);
      newYblock.set('type', blockData.type);
      newYblock.set('data', this.objectToYMap(blockData.data));

      if (blockData.tunes !== undefined) {
        newYblock.set('tunes', this.objectToYMap(blockData.tunes));
      }

      if (blockData.parent !== undefined) {
        newYblock.set('parentId', blockData.parent);
      }

      if (blockData.content !== undefined) {
        newYblock.set('contentIds', Y.Array.from(blockData.content));
      }

      this.yblocks.insert(adjustedIndex, [newYblock]);
    }, 'local');
  }

  /**
   * Convert a Y.Map block to OutputBlockData
   */
  private yBlockToOutputData(yblock: Y.Map<unknown>): OutputBlockData {
    const block: OutputBlockData = {
      id: yblock.get('id') as string,
      type: yblock.get('type') as string,
      data: this.yMapToObject(yblock.get('data') as Y.Map<unknown>),
    };

    const tunes = yblock.get('tunes') as Y.Map<unknown> | undefined;

    if (tunes !== undefined && tunes.size > 0) {
      block.tunes = this.yMapToObject(tunes);
    }

    const parentId = yblock.get('parentId') as string | undefined;

    if (parentId !== undefined) {
      block.parent = parentId;
    }

    const contentIds = yblock.get('contentIds') as Y.Array<string> | undefined;

    if (contentIds !== undefined && contentIds.length > 0) {
      block.content = contentIds.toArray();
    }

    return block;
  }

  /**
   * Get block Y.Map by id
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
   * Update a property in block data
   * @param id - Block id
   * @param key - Data property key
   * @param value - New value
   */
  public updateBlockData(id: string, key: string, value: unknown): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    this.ydoc.transact(() => {
      const ydata = yblock.get('data') as Y.Map<unknown>;

      ydata.set(key, value);
    }, 'local');
  }

  /**
   * Find block index by id
   */
  private findBlockIndex(id: string): number {
    for (let i = 0; i < this.yblocks.length; i++) {
      if (this.yblocks.get(i).get('id') === id) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Convert plain object to Y.Map
   */
  private objectToYMap(obj: Record<string, unknown>): Y.Map<unknown> {
    const ymap = new Y.Map<unknown>();

    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        ymap.set(key, this.objectToYMap(value as Record<string, unknown>));
      } else {
        ymap.set(key, value);
      }
    }

    return ymap;
  }

  /**
   * Convert Y.Map to plain object
   */
  private yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    ymap.forEach((value, key) => {
      if (value instanceof Y.Map) {
        obj[key] = this.yMapToObject(value);
      } else {
        obj[key] = value;
      }
    });

    return obj;
  }

  /**
   * Cleanup on destroy
   */
  public destroy(): void {
    this.undoManager.destroy();
    this.ydoc.destroy();
  }
}
