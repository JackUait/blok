/**
 * @class HistoryAPI
 * @classdesc Provides public API for history (undo/redo) functionality
 * @module HistoryAPI
 */
import Module from '../../__module';
import type { History as HistoryInterface } from '../../../../types/api';

/**
 * HistoryAPI provides methods for undo/redo operations
 */
export default class HistoryAPI extends Module {
  /**
   * Available methods for public API
   */
  public get methods(): HistoryInterface {
    return {
      undo: (): Promise<boolean> => this.undo(),
      redo: (): Promise<boolean> => this.redo(),
      canUndo: (): boolean => this.canUndo(),
      canRedo: (): boolean => this.canRedo(),
      clear: (): void => this.clear(),
    };
  }

  /**
   * Performs undo operation
   * @returns Promise resolving to true if undo was performed
   */
  private async undo(): Promise<boolean> {
    return this.Blok.History.undo();
  }

  /**
   * Performs redo operation
   * @returns Promise resolving to true if redo was performed
   */
  private async redo(): Promise<boolean> {
    return this.Blok.History.redo();
  }

  /**
   * Checks if undo is available
   * @returns true if there are states to undo
   */
  private canUndo(): boolean {
    return this.Blok.History.canUndo();
  }

  /**
   * Checks if redo is available
   * @returns true if there are states to redo
   */
  private canRedo(): boolean {
    return this.Blok.History.canRedo();
  }

  /**
   * Clears the history stacks
   */
  private clear(): void {
    this.Blok.History.clear();
  }
}
