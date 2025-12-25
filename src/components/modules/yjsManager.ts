import * as Y from 'yjs';
import { Module } from '../__module';

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
   * Cleanup on destroy
   */
  public destroy(): void {
    this.undoManager.destroy();
    this.ydoc.destroy();
  }
}
