/**
 * @module HistoryAPI
 * @copyright <CodeX> 2018
 *
 * Provides public methods for undo/redo operations
 */
import type { History, HistoryStep, HistoryValue, HistoryValueChange, HistoryValueData } from '../../../../types/api';
import { Module } from '../../__module';
import type { CaretHistoryEntry } from '../yjs/types';

/**
 * @class HistoryAPI
 */
export class HistoryAPI extends Module {
  /** One handle per entry, so a step taken twice compares equal. */
  private readonly handles = new WeakMap<CaretHistoryEntry, HistoryStep>();
  private readonly entries = new WeakMap<HistoryStep, CaretHistoryEntry>();

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
      latestStep: (): HistoryStep | undefined => this.latestStep(),
      undoStep: (step: HistoryStep): boolean => this.undoStep(step),
      track: <T extends HistoryValueData>(key: string, onChange: (value: T | undefined, change: HistoryValueChange) => void): HistoryValue<T> =>
        this.track(key, onChange),
    };
  }

  /**
   * Keep a value the host owns, like a page title outside the editor, in the
   * editor's undo history.
   * @param key - names the value; tracking a key again replaces its callback
   * @param onChange - called when undo, redo or a peer changes the value
   * @returns a handle to read and write the value
   */
  public track<T extends HistoryValueData>(key: string, onChange: (value: T | undefined, change: HistoryValueChange) => void): HistoryValue<T> {
    const { YjsManager } = this.Blok;

    // Yjs stores what the host wrote, so a value it hands back is a T.
    YjsManager.trackValue(key, (value, source) => onChange(value as T | undefined, { source }));

    return {
      get: (): T | undefined => YjsManager.getValue(key) as T | undefined,
      set: (value, options): void => YjsManager.setValue(key, value, options),
    };
  }

  /**
   * Undo the last operation. Does nothing while read-only, like Cmd+Z.
   */
  public undo(): void {
    if (this.Blok.ReadOnly.isEnabled) {
      return;
    }
    this.Blok.YjsManager.undo();
  }

  /**
   * Redo the last undone operation. Does nothing while read-only, like Cmd+Shift+Z.
   */
  public redo(): void {
    if (this.Blok.ReadOnly.isEnabled) {
      return;
    }
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

  /**
   * @returns a handle on the newest undo step, or undefined when there is none
   */
  public latestStep(): HistoryStep | undefined {
    const { YjsManager } = this.Blok;

    // Buffered typing joins the step it belongs to before we look.
    YjsManager.flushPendingBlockWrites();
    const entry = YjsManager.topUndoToken();

    if (entry === undefined) {
      return undefined;
    }
    const known = this.handles.get(entry);

    if (known !== undefined) {
      return known;
    }
    // The brand exists only in the published type; the handle is an empty object.
    const handle = Object.freeze({}) as HistoryStep;

    this.handles.set(entry, handle);
    this.entries.set(handle, entry);

    return handle;
  }

  /**
   * Undo this step only while it is still the newest. Does nothing while read-only.
   * @param step - a handle from {@link latestStep}
   * @returns true when the step was undone
   */
  public undoStep(step: HistoryStep): boolean {
    const entry = this.entries.get(step);

    if (entry === undefined || this.Blok.ReadOnly.isEnabled) {
      return false;
    }
    this.Blok.YjsManager.flushPendingBlockWrites();

    return this.Blok.YjsManager.undoStep(entry);
  }
}
