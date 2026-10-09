import type { PropertyDefinition, PropertyValue } from '../types';
import { openDateEditor } from './date-editor';
import { openSelectEditor } from './select-editor';
import { openTextEditor } from './text-editor';
import type { CellEditorContext, CellEditorHandle } from './types';

export { renderCellValue, createOptionPill } from './display';
export type { CellContext, CellEditorCallbacks, CellEditorContext, CellEditorHandle, CellRenderer } from './types';
export { DATE_VALUE_FORMAT, formatDateValue, parseDateValue } from './date-value';
export type { ParsedDateValue } from './date-value';
export { OPTION_COLORS, optionColorOf, pickOptionColor } from './option-colors';
export type { OptionColor } from './option-colors';

const CLOSED: CellEditorHandle = { isOpen: false, close: () => undefined, cancel: () => undefined };

/**
 * Opens the editor for one cell under `anchor`. Read-only does nothing.
 * Checkbox has no editor: it commits the flipped value at once.
 */
export const openCellEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => {
  if (ctx.readOnly) {
    return CLOSED;
  }

  switch (property.type) {
    case 'checkbox':
      ctx.onCommit(value !== true);
      ctx.onClose?.();

      return CLOSED;
    case 'select':
    case 'multiSelect':
    case 'status':
      return openSelectEditor(property, value, anchor, ctx);
    case 'date':
      return openDateEditor(property, value, anchor, ctx);
    case 'title':
    case 'text':
    case 'number':
    case 'url':
    case 'richText':
    case 'email':
    case 'phone':
      return openTextEditor(property, value, anchor, ctx);
    case 'person':
    case 'files':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'uniqueId':
      return CLOSED;
    default:
      // A type from a newer client has no editor.
      return CLOSED;
  }
};
