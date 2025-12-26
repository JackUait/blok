import * as Y from 'yjs';
import { Module } from '../__module';
import type { OutputBlockData } from '../../../types/data-formats/output-data';

/**
 * Event emitted when blocks change
 */
export interface BlockChangeEvent {
  type: 'add' | 'remove' | 'update';
  blockId: string;
  origin: 'local' | 'undo' | 'redo' | 'load' | 'remote';
}

type BlockChangeCallback = (event: BlockChangeEvent) => void;

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
   * Callbacks for block changes
   */
  private changeCallbacks: BlockChangeCallback[] = [];

  /**
   * Constructor - sets up change observers
   */
  constructor(params: ConstructorParameters<typeof Module>[0]) {
    super(params);
    this.setupObservers();
  }

  /**
   * Set up Yjs observers for change tracking
   */
  private setupObservers(): void {
    this.yblocks.observeDeep((events, transaction) => {
      const origin = this.mapTransactionOrigin(transaction.origin);

      for (const event of events) {
        this.handleYjsEvent(event, origin);
      }
    });
  }

  /**
   * Handle a single Yjs event
   */
  private handleYjsEvent(event: Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>, origin: BlockChangeEvent['origin']): void {
    if (event.target === this.yblocks) {
      this.handleArrayEvent(event as Y.YArrayEvent<Y.Map<unknown>>, origin);

      return;
    }

    if (event.target instanceof Y.Map) {
      this.handleMapEvent(event.target, origin);
    }
  }

  /**
   * Handle array-level changes (add/remove)
   */
  private handleArrayEvent(yArrayEvent: Y.YArrayEvent<Y.Map<unknown>>, origin: BlockChangeEvent['origin']): void {
    yArrayEvent.changes.added.forEach((item) => {
      const yblock = item.content.getContent()[0] as Y.Map<unknown>;

      this.emitChange({
        type: 'add',
        blockId: yblock.get('id') as string,
        origin,
      });
    });

    yArrayEvent.changes.deleted.forEach((item) => {
      const blockId = this.extractBlockIdFromDeletedItem(item);

      if (blockId === undefined) {
        return;
      }

      this.emitChange({
        type: 'remove',
        blockId,
        origin,
      });
    });
  }

  /**
   * Extract block id from a deleted Y.Map item
   */
  private extractBlockIdFromDeletedItem(item: Y.Item): string | undefined {
    const content = item.content.getContent();

    if (content.length === 0) {
      return undefined;
    }

    const yblock = content[0] as Y.Map<unknown>;
    // Access the internal _map to get the id since the Y.Map is deleted
    const idEntry = yblock._map.get('id');

    return idEntry?.content?.getContent()[0] as string | undefined;
  }

  /**
   * Handle map-level changes (data update)
   */
  private handleMapEvent(ymap: Y.Map<unknown>, origin: BlockChangeEvent['origin']): void {
    const yblock = this.findParentBlock(ymap);

    if (yblock === undefined) {
      return;
    }

    this.emitChange({
      type: 'update',
      blockId: yblock.get('id') as string,
      origin,
    });
  }

  /**
   * Map transaction origin to event origin
   */
  private mapTransactionOrigin(origin: unknown): BlockChangeEvent['origin'] {
    if (origin === 'local') {
      return 'local';
    }

    if (origin === 'load') {
      return 'load';
    }

    if (origin === this.undoManager) {
      return this.undoManager.undoing ? 'undo' : 'redo';
    }

    return 'remote';
  }

  /**
   * Find the parent block Y.Map for a nested Y.Map (data or tunes)
   */
  private findParentBlock(ymap: Y.Map<unknown>): Y.Map<unknown> | undefined {
    return this.yblocks.toArray().find((yblock) => {
      const ydata = yblock.get('data');
      const ytunes = yblock.get('tunes');

      return ydata === ymap || ytunes === ymap;
    });
  }

  /**
   * Register callback for block changes
   * @param callback - Function to call on changes
   * @returns Unsubscribe function
   */
  public onBlocksChanged(callback: BlockChangeCallback): () => void {
    this.changeCallbacks.push(callback);

    return (): void => {
      const index = this.changeCallbacks.indexOf(callback);

      if (index !== -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit change event to all callbacks
   */
  private emitChange(event: BlockChangeEvent): void {
    for (const callback of this.changeCallbacks) {
      callback(event);
    }
  }

  /**
   * Load blocks from JSON data
   * @param blocks - Array of block data to load
   */
  public fromJSON(blocks: OutputBlockData[]): void {
    this.ydoc.transact(() => {
      this.yblocks.delete(0, this.yblocks.length);

      for (const block of blocks) {
        const yblock = this.outputDataToYBlock(block);

        this.yblocks.push([yblock]);
      }
    }, 'load');
  }

  /**
   * Serialize blocks to JSON format
   * @returns Array of block data
   */
  public toJSON(): OutputBlockData[] {
    return this.yblocks.toArray().map((yblock) => this.yBlockToOutputData(yblock));
  }

  /**
   * Add a new block
   * @param blockData - Block data to add
   * @param index - Optional index to insert at
   * @returns The created Y.Map
   */
  public addBlock(blockData: OutputBlockData, index?: number): Y.Map<unknown> {
    const yblock = this.outputDataToYBlock(blockData);

    this.ydoc.transact(() => {
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
      const newYblock = this.outputDataToYBlock(blockData);

      this.yblocks.insert(adjustedIndex, [newYblock]);
    }, 'local');
  }

  /**
   * Convert OutputBlockData to Y.Map
   */
  private outputDataToYBlock(blockData: OutputBlockData): Y.Map<unknown> {
    const yblock = new Y.Map<unknown>();

    yblock.set('id', blockData.id);
    yblock.set('type', blockData.type);
    yblock.set('data', this.objectToYMap(blockData.data));

    if (blockData.tunes !== undefined) {
      yblock.set('tunes', this.objectToYMap(blockData.tunes));
    }

    if (blockData.parent !== undefined) {
      yblock.set('parentId', blockData.parent);
    }

    if (blockData.content !== undefined) {
      yblock.set('contentIds', Y.Array.from(blockData.content));
    }

    return yblock;
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
    return this.yblocks.toArray().findIndex((yblock) => yblock.get('id') === id);
  }

  /**
   * Undo the last operation
   */
  public undo(): void {
    this.undoManager.undo();
  }

  /**
   * Redo the last undone operation
   */
  public redo(): void {
    this.undoManager.redo();
  }

  /**
   * Stop capturing changes into current undo group
   * Call this to force next change into a new undo entry
   */
  public stopCapturing(): void {
    this.undoManager.stopCapturing();
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
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
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
