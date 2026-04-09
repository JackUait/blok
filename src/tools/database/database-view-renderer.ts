import type { DatabaseRow, SelectOption } from './types';

/**
 * Shared contract for all database view renderers (board, list, etc.).
 * Each implementation receives its data through the constructor and renders via createView().
 */
export interface DatabaseViewRenderer {
  /** Creates the full view DOM. Data is bound at construction time. */
  createView(): HTMLDivElement;

  /** Appends a row element to the appropriate container within the view. */
  appendRow(container: HTMLElement, row: DatabaseRow): void;

  /** Removes a row element from the view by its row ID. */
  removeRow(wrapper: HTMLElement, rowId: string): void;

  /** Updates the visible title of a row element found by its row ID. */
  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void;

  /** Appends a group container (board: column, list: group section). Optional — not all views support it. */
  appendGroup?(wrapper: HTMLElement, option: SelectOption): void;

  /** Removes a group container by its option ID. Optional. */
  removeGroup?(wrapper: HTMLElement, optionId: string): void;
}
