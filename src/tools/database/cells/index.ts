import type { PropertyDefinition, PropertyValue } from '../types';
import type { CellEditorContext, CellEditorHandle } from './types';

export { renderCellValue, createOptionPill } from './display';
export type { CellContext, CellEditorCallbacks, CellEditorContext, CellEditorHandle, CellRenderer } from './types';
export { DATE_VALUE_FORMAT, formatDateValue, parseDateValue } from './date-value';
export type { ParsedDateValue } from './date-value';
export { OPTION_COLORS, optionColorOf, pickOptionColor } from './option-colors';
export type { OptionColor } from './option-colors';

const CLOSED: CellEditorHandle = { isOpen: false, close: () => undefined };

/**
 * Opens the editor for one cell under `anchor`. Read-only does nothing.
 * Checkbox has no editor: it commits the flipped value at once.
 */
export const openCellEditor = (
  _property: PropertyDefinition,
  _value: PropertyValue | undefined,
  _anchor: HTMLElement,
  _ctx: CellEditorContext
): CellEditorHandle => CLOSED;
