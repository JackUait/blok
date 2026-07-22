import type { Marks, MarkSnapshot, MarkSpec } from '../../../../types/api';
import { Module } from '../../__module';
import {
  applyMark,
  findMark,
  hasMark,
  readMark,
  removeMark,
  toggleMark,
} from '../../marks/mark-engine';

/**
 * @class MarksAPI
 * Range-aware inline-mark operations — the public face of the mark engine.
 * Every method defaults to the live selection's first range.
 */
export class MarksAPI extends Module {
  /**
   * Available methods
   * @returns {Marks}
   */
  public get methods(): Marks {
    return {
      has: <State>(spec: MarkSpec<State>, range?: Range): boolean => this.has(spec, range),
      find: <State>(spec: MarkSpec<State>, from?: Node): HTMLElement | null => this.find(spec, from),
      read: <State>(spec: MarkSpec<State>, range?: Range): MarkSnapshot | null => this.read(spec, range),
      apply: <State>(spec: MarkSpec<State>, state?: State, range?: Range): HTMLElement[] => this.apply(spec, state, range),
      remove: <State>(spec: MarkSpec<State>, range?: Range): HTMLElement[] => this.remove(spec, range),
      toggle: <State>(spec: MarkSpec<State>, state?: State, range?: Range): boolean => this.toggle(spec, state, range),
    };
  }

  /**
   * Whether every text node in the range is covered by the mark
   * @param spec - mark description
   * @param range - range to check; defaults to the current selection
   */
  public has<State>(spec: MarkSpec<State>, range?: Range): boolean {
    const resolved = this.resolveRange(range);

    return resolved !== null && hasMark(spec, resolved);
  }

  /**
   * Nearest ancestor element matching the spec
   * @param spec - mark description
   * @param from - node to search from; defaults to the selection's start
   */
  public find<State>(spec: MarkSpec<State>, from?: Node): HTMLElement | null {
    const start = from ?? this.resolveRange(undefined)?.startContainer ?? null;

    return findMark(spec, start);
  }

  /**
   * Read current values of the spec's declared properties
   * @param spec - mark description
   * @param range - range to read from; defaults to the current selection
   */
  public read<State>(spec: MarkSpec<State>, range?: Range): MarkSnapshot | null {
    const resolved = this.resolveRange(range);

    return resolved === null ? null : readMark(spec, resolved);
  }

  /**
   * Wrap the range in the mark, or update matching wrappers in place
   * @param spec - mark description
   * @param state - value for the spec's function-form properties
   * @param range - range to format; defaults to the current selection
   */
  public apply<State>(spec: MarkSpec<State>, state?: State, range?: Range): HTMLElement[] {
    const resolved = this.resolveRange(range);

    return resolved === null ? [] : applyMark(spec, state, resolved);
  }

  /**
   * Remove the mark from the range, unwrapping wrappers left bare
   * @param spec - mark description
   * @param range - range to deformat; defaults to the current selection
   */
  public remove<State>(spec: MarkSpec<State>, range?: Range): HTMLElement[] {
    const resolved = this.resolveRange(range);

    return resolved === null ? [] : removeMark(spec, resolved);
  }

  /**
   * Toggle the mark; returns true when the mark is now applied
   * @param spec - mark description
   * @param state - value for the spec's function-form properties
   * @param range - range to toggle; defaults to the current selection
   */
  public toggle<State>(spec: MarkSpec<State>, state?: State, range?: Range): boolean {
    const resolved = this.resolveRange(range);

    return resolved !== null && toggleMark(spec, state, resolved);
  }

  /**
   * The explicit range, or the live selection's first range
   * @param range - explicitly passed range, if any
   */
  private resolveRange(range?: Range): Range | null {
    if (range) {
      return range;
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    return selection.getRangeAt(0);
  }
}
