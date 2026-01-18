import type * as Y from 'yjs';

import type { OutputBlockData } from '../../../../types/data-formats/output-data';
import type { BlokModules } from '../../../types-internal/blok-modules';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';


import { BlockObserver } from './block-observer';
import { DocumentStore } from './document-store';
import { YBlockSerializer, isBoundaryCharacter } from './serializer';
import type { BlockChangeCallback, CaretSnapshot } from './types';
import { UndoHistory } from './undo-history';

/**
 * @class YjsManager
 * @classdesc Manages Yjs document and block synchronization
 * @module YjsManager
 *
 * This is a facade that coordinates:
 * - DocumentStore: Y.Doc management and block CRUD
 * - UndoHistory: Undo/redo with move tracking, caret tracking, and smart grouping
 * - BlockObserver: Yjs event observation and domain event emission
 * - YBlockSerializer: Data conversion between Yjs and OutputBlockData formats
 */
export class YjsManager extends Module {
  /**
   * Document store for Y.Doc management and block operations
   */
  private documentStore: DocumentStore;

  /**
   * Undo/redo history manager
   */
  private undoHistory: UndoHistory;

  /**
   * Serializer for Yjs ↔ OutputBlockData conversion
   */
  private serializer: YBlockSerializer;

  /**
   * Block observer for change events
   */
  private blockObserver: BlockObserver;

  /**
   * Flag to track if move group is active
   */
  private isMoveGroupActive = false;

  /**
   * Constructor - initializes all components
   */
  constructor(params: ModuleConfig) {
    super(params);

    // Initialize components
    this.serializer = new YBlockSerializer();
    this.documentStore = new DocumentStore(this.serializer);
    this.blockObserver = new BlockObserver();
    this.undoHistory = new UndoHistory(
      this.documentStore.yblocks,
      this.Blok
    );

    // Set up move callback for undo history
    this.undoHistory.setMoveCallback((blockId, toIndex, origin) => {
      this.documentStore.moveBlock(blockId, toIndex, origin);
    });

    // Set up observation
    this.blockObserver.observe(this.documentStore.yblocks, this.undoHistory.undoManager);
  }

  /**
   * Set Blok modules (called by Core after initialization)
   */
  public override set state(Blok: BlokModules) {
    super.state = Blok;
    this.undoHistory.setBlok(Blok);
  }

  // ========== Public API: CRUD ==========

  /**
   * Load blocks from JSON data.
   * Clears all history when loading new data.
   * @param blocks - Array of block data to load
   */
  public fromJSON(blocks: OutputBlockData[]): void {
    // Clear all history when loading new data
    this.undoHistory.clear();

    this.documentStore.fromJSON(blocks);
  }

  /**
   * Serialize blocks to JSON format.
   * @returns Array of block data
   */
  public toJSON(): OutputBlockData[] {
    return this.documentStore.toJSON();
  }

  /**
   * Add a new block.
   * @param blockData - Block data to add
   * @param index - Optional index to insert at
   * @returns The created Y.Map
   */
  public addBlock(blockData: OutputBlockData, index?: number): Y.Map<unknown> {
    this.undoHistory.markCaretBeforeChange();

    return this.documentStore.addBlock(blockData, index);
  }

  /**
   * Remove a block by id.
   * @param id - Block id to remove
   */
  public removeBlock(id: string): void {
    this.undoHistory.markCaretBeforeChange();

    this.documentStore.removeBlock(id);
  }

  /**
   * Move a block to a new index.
   * @param id - Block id to move
   * @param toIndex - Target index (the final position where the block should end up)
   */
  public moveBlock(id: string, toIndex: number): void {
    const fromIndex = this.documentStore.findBlockIndex(id);

    if (fromIndex === -1) {
      return;
    }

    // Record move for undo history
    this.undoHistory.recordMove(id, fromIndex, toIndex, this.isMoveGroupActive);

    // Perform the move
    this.documentStore.moveBlock(id, toIndex, 'local');
  }

  /**
   * Update a property in block data.
   * @param id - Block id
   * @param key - Data property key
   * @param value - New value
   */
  public updateBlockData(id: string, key: string, value: unknown): void {
    this.undoHistory.markCaretBeforeChange();

    this.documentStore.updateBlockData(id, key, value);
  }

  /**
   * Update a tune in block tunes.
   * @param id - Block id
   * @param tuneName - Tune name
   * @param tuneData - Tune data value
   */
  public updateBlockTune(id: string, tuneName: string, tuneData: unknown): void {
    this.documentStore.updateBlockTune(id, tuneName, tuneData);
  }

  /**
   * Get block Y.Map by id.
   * @param id - Block id
   * @returns Y.Map or undefined if not found
   */
  public getBlockById(id: string): Y.Map<unknown> | undefined {
    return this.documentStore.getBlockById(id);
  }

  // ========== Public API: Undo/Redo ==========

  /**
   * Undo the last operation.
   */
  public undo(): void {
    this.undoHistory.undo();
  }

  /**
   * Redo the last undone operation.
   */
  public redo(): void {
    this.undoHistory.redo();
  }

  /**
   * Stop capturing changes into current undo group.
   * Call this to force next change into a new undo entry.
   */
  public stopCapturing(): void {
    this.undoHistory.stopCapturing();
  }

  /**
   * Mark the caret position before a change starts.
   * Call this before any operation that might be undoable.
   */
  public markCaretBeforeChange(): void {
    this.undoHistory.markCaretBeforeChange();
  }

  /**
   * Capture the current caret position as a snapshot.
   * @returns CaretSnapshot or null if no block is focused
   */
  public captureCaretSnapshot(): CaretSnapshot | null {
    return this.undoHistory.captureCaretSnapshot();
  }

  /**
   * Update the "after" position of the most recent caret undo entry.
   */
  public updateLastCaretAfterPosition(): void {
    this.undoHistory.updateLastCaretAfterPosition();
  }

  /**
   * Execute multiple move operations as a single atomic undo group.
   * @param fn - Function containing move operations to execute atomically
   */
  public transactMoves(fn: () => void): void {
    this.isMoveGroupActive = true;
    this.undoHistory.transactMoves(fn);
    this.isMoveGroupActive = false;
  }

  /**
   * Execute multiple Yjs operations as a single atomic transaction.
   * All operations within the callback will be grouped into one undo entry.
   * @param fn - Function containing Yjs operations to execute atomically
   */
  public transact(fn: () => void): void {
    this.documentStore.transact(fn, 'local');
  }

  // ========== Public API: Smart Grouping ==========

  /**
   * Check if there is a pending boundary waiting for timeout.
   * @returns true if a boundary character was typed and hasn't timed out yet
   */
  public hasPendingBoundary(): boolean {
    return this.undoHistory.hasPendingBoundary();
  }

  /**
   * Mark that a boundary character (space, punctuation) was just typed.
   */
  public markBoundary(): void {
    this.undoHistory.markBoundary();
  }

  /**
   * Clear the pending boundary state without creating a checkpoint.
   */
  public clearBoundary(): void {
    this.undoHistory.clearBoundary();
  }

  /**
   * Check if a pending boundary has timed out and create a checkpoint if so.
   */
  public checkAndHandleBoundary(): void {
    this.undoHistory.checkAndHandleBoundary();
  }

  /**
   * Check if a character is a boundary character.
   * @param char - Single character to check
   * @returns true if the character is a boundary character
   */
  public static isBoundaryCharacter(char: string): boolean {
    return isBoundaryCharacter(char);
  }

  // ========== Public API: Events ==========

  /**
   * Register callback for block changes.
   * @param callback - Function to call on changes
   * @returns Unsubscribe function
   */
  public onBlocksChanged(callback: BlockChangeCallback): () => void {
    return this.blockObserver.onBlocksChanged(callback);
  }

  // ========== Internal Helpers (exposed for UndoHistory) ==========

  /**
   * Convert Y.Map to plain object.
   * Exposed for internal use.
   * @param ymap - Y.Map to convert
   * @returns Plain object representation
   */
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
    return this.serializer.yMapToObject(ymap);
  }

  // ========== Lifecycle ==========

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    this.blockObserver.destroy();
    this.undoHistory.destroy();
    this.documentStore.destroy();
  }
}

// Re-export types for consumers
export type { BlockChangeEvent, CaretSnapshot, TransactionOrigin } from './types';
