import type { I18n } from '../../../types';
import { IconDotsHorizontal, IconTrash } from '../../components/icons';
import { isReadOnlyType, readPropertyValue } from './property-values';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from './types';

export interface SelectionBarOptions {
  count: number;
  /** The view's visible properties; the bar offers the editable ones. */
  properties: PropertyDefinition[];
  i18n: Pick<I18n, 't'>;
  onEdit: (propertyId: string, anchor: HTMLElement) => void;
  onDelete: () => void;
  onMore: (anchor: HTMLElement) => void;
}

/** Properties a bulk edit can write: no title, nothing computed. */
export const bulkEditableProperties = (properties: PropertyDefinition[]): PropertyDefinition[] =>
  properties.filter((property) => property.type !== 'title' && !isReadOnlyType(property.type));

/**
 * What a bulk editor opens on. A date or a text: the first selected row's
 * (research/21 §6, research/35 §3). `rows` come in view order: first is the top row. Else empty, so no row's value shows as if
 * all had it. A text editor closed with its text unchanged writes nothing.
 */
export const bulkStartValue = (property: PropertyDefinition, rows: Array<DatabaseRow | undefined>): PropertyValue => {
  const values = rows.map((row) => (row === undefined ? null : readPropertyValue(row, property) ?? null));

  if (property.type === 'date' || property.type === 'text') return values[0] ?? null;

  return null;
};

/**
 * Records the key that closes a bulk editor. Add it before the editor opens:
 * the editor's own window listener stops the key, but not for an earlier one.
 */
export const watchBulkCloseKey = (): { key: () => string | null; stop: () => void } => {
  const state: { key: string | null } = { key: null };
  const record = (event: KeyboardEvent): void => {
    state.key = event.key;
    setTimeout(() => {
      state.key = null;
    }, 0);
  };

  window.addEventListener('keydown', record, true);

  return { key: () => state.key, stop: () => window.removeEventListener('keydown', record, true) };
};

/**
 * After a write: any close of a Text bulk edit (Escape, Enter, a press outside),
 * Enter on a URL and Enter on a Select pick clear the selection (research/31 §4b,
 * research/35 §3). A Date's or Number's Escape and a Select's click keep it.
 * Other closes are unmeasured and keep it.
 */
export const bulkCloseClearsSelection = (type: PropertyDefinition['type'], key: string | null, written: boolean): boolean =>
  written && (type === 'text' || ((type === 'select' || type === 'url') && key === 'Enter'));

/**
 * The board and list selection bar: "N selected", one button per editable
 * property, trash and "…" (research/08). Same attributes as the table's bar,
 * so one stylesheet draws both.
 */
export const createSelectionBar = (options: SelectionBarOptions): HTMLElement => {
  const { i18n } = options;
  const bar = document.createElement('div');
  const count = document.createElement('span');
  const trash = document.createElement('button');
  const more = document.createElement('button');

  bar.setAttribute('data-blok-database-table-selection-bar', '');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', i18n.t('tools.database.tableSelectionActions'));
  count.setAttribute('data-blok-database-table-selection-count', '');
  count.setAttribute('aria-live', 'polite');
  count.textContent = i18n.t('tools.database.tableSelectedCount', { count: options.count });

  const propertyButtons = bulkEditableProperties(options.properties).map((property) => {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('data-blok-database-table-selection-property', '');
    button.setAttribute('data-property-id', property.id);
    button.textContent = property.name;
    button.addEventListener('click', () => options.onEdit(property.id, button));

    return button;
  });

  trash.type = 'button';
  trash.setAttribute('data-blok-database-table-selection-delete', '');
  trash.setAttribute('aria-label', i18n.t('tools.database.tableMoveToTrash'));
  trash.innerHTML = IconTrash;
  trash.addEventListener('click', () => options.onDelete());
  more.type = 'button';
  more.setAttribute('data-blok-database-table-selection-more', '');
  more.setAttribute('aria-label', i18n.t('tools.database.tableMoreActions'));
  more.innerHTML = IconDotsHorizontal;
  more.addEventListener('click', () => options.onMore(more));
  bar.append(count, ...propertyButtons, trash, more);

  return bar;
};
