/**
 * @module HistoryAPI
 * @copyright <CodeX> 2018
 *
 * Provides public methods for undo/redo operations
 */
import type { History } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * @class HistoryAPI
 */
export class HistoryAPI extends Module {
  /**
   * Available methods
   * @returns {History}
   */
  public get methods(): History {
    return {
      undo: (): void => this.undo(),
      redo: (): void => this.redo(),
      canUndo: (): boolean => this.canUndo(),
      canRedo: (): boolean => this.canRedo(),
      clear: (): void => this.clear(),
    };
  }

  /**
   * Undo the last operation
   */
  public undo(): void {
    this.Blok.YjsManager.undo();
  }

  /**
   * Redo the last undone operation
   */
  public redo(): void {
    this.Blok.YjsManager.redo();
  }

  /**
   * Check if undo is available
   * @returns {boolean} true if undo is available
   */
  public canUndo(): boolean {
    return this.Blok.YjsManager.canUndo();
  }

  /**
   * Check if redo is available
   * @returns {boolean} true if redo is available
   */
  public canRedo(): boolean {
    return this.Blok.YjsManager.canRedo();
  }

  /**
   * Clear all history
   */
  public clear(): void {
    this.Blok.YjsManager.clear();
  }
}
