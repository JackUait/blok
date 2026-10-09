import type { I18n } from '../../../types';
import { IconDotsHorizontal, IconTrash } from '../../components/icons';
import { isReadOnlyType } from './property-values';
import type { PropertyDefinition } from './types';

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
