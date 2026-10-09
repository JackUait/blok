import type { I18n } from '../../../../types';
import type { PropertyDefinition, PropertyValue, SelectOption } from '../types';

/**
 * What every cell renderer and editor needs from its host: the table, a board
 * card, a list row or the row drawer.
 */
export interface CellContext {
  i18n: Pick<I18n, 't'>;
  /** A read-only cell renders, but `openCellEditor` does nothing (checkbox included). */
  readOnly: boolean;
  /**
   * Options of a select or multi-select property. Pass the saved list, not a
   * localized copy: the editor writes this list back through `onOptionsChange`.
   * Falls back to `property.config.options`.
   */
  options?: SelectOption[];
  /**
   * Receives the whole new option list after a create, rename, recolor, delete
   * or reorder. Each option keeps a unique `id`; `position` is a fractional key.
   * Without it, the select editor cannot create or edit options.
   */
  onOptionsChange?: (options: SelectOption[]) => void;
  /** BCP 47 tag for date text and the calendar. Defaults to `navigator.language`. */
  locale?: string;
  /** First day of the week, 0 = Sunday … 6 = Saturday. Defaults to the locale's. */
  weekStart?: number;
  /** 12- or 24-hour time. Defaults to the locale's. */
  hourCycle?: 'h12' | 'h23';
}

/**
 * Editor callbacks. They go in with the call, not onto the handle, because a
 * checkbox commits before `openCellEditor` returns.
 */
export interface CellEditorCallbacks {
  /**
   * The new value. Text, url, number and single select commit once and close.
   * Multi-select and date commit live, so this can fire several times while the
   * editor is open; each call carries the whole new value, not a delta.
   */
  onCommit: (value: PropertyValue) => void;
  /** The editor closed with nothing committed (Escape, or an invalid number). */
  onCancel?: () => void;
  /** The editor closed, after any commit or cancel. Hosts restore focus here. */
  onClose?: () => void;
}

export type CellEditorContext = CellContext & CellEditorCallbacks;

export interface CellEditorHandle {
  /** False once the editor closed, and from the start for checkbox and read-only. */
  readonly isOpen: boolean;
  /** Closes the editor as an outside click does: a pending text draft commits. */
  close(): void;
  /** Closes the editor and drops a pending text draft. Live commits already made stay. */
  cancel(): void;
}

export type CellRenderer = (property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext) => HTMLElement;
