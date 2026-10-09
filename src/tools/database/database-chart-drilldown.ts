import type { I18n } from '../../../types';
import { IconCross } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';
import type { DatabaseRow, PropertyDefinition } from './types';

export interface ChartDrilldownOptions {
  /** The clicked group's label. */
  title: string;
  rows: DatabaseRow[];
  /** Localized columns, title first. */
  columns: PropertyDefinition[];
  titlePropertyId: string;
  cellText: (property: PropertyDefinition, row: DatabaseRow) => string;
  i18n: Pick<I18n, 't'>;
  openRow: (rowId: string) => void;
  directionSource?: Element | null;
}

const counter = { next: 0 };

/**
 * A chart group's rows, as a read-only table (H-charts: drilldowns are
 * table-only, and you cannot add pages or edit from one).
 */
export const openChartDrilldown = (options: ChartDrilldownOptions): { close: () => void } => {
  const { i18n } = options;
  const backdrop = document.createElement('div');
  const panel = document.createElement('div');
  const header = document.createElement('div');
  const title = document.createElement('div');
  const count = document.createElement('div');
  const close = document.createElement('button');
  const scroller = document.createElement('div');
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const body = document.createElement('tbody');

  backdrop.setAttribute('data-blok-database-drilldown', '');
  panel.setAttribute('data-blok-database-drilldown-panel', '');
  header.setAttribute('data-blok-database-drilldown-header', '');
  title.setAttribute('data-blok-database-drilldown-title', '');
  count.setAttribute('data-blok-database-drilldown-count', '');
  close.setAttribute('data-blok-database-drilldown-close', '');
  scroller.setAttribute('data-blok-database-drilldown-scroller', '');
  counter.next += 1;
  title.id = `blok-database-drilldown-${counter.next}`;
  title.textContent = options.title;
  count.textContent = i18n.t('tools.database.chartDrilldownCount', { count: options.rows.length });
  close.type = 'button';
  close.innerHTML = IconCross;
  close.setAttribute('aria-label', i18n.t('tools.database.chartDrilldownClose'));

  const headRow = document.createElement('tr');

  for (const column of options.columns) {
    const th = document.createElement('th');

    th.scope = 'col';
    th.textContent = column.name;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);

  const state: { handle: ModalDialogHandle | null } = { handle: null };
  const dismiss = (): void => state.handle?.close();

  const cell = (column: PropertyDefinition, row: DatabaseRow): HTMLTableCellElement => {
    const td = document.createElement('td');
    const text = options.cellText(column, row);

    if (column.id !== options.titlePropertyId) {
      td.textContent = text;

      return td;
    }
    const open = document.createElement('button');

    open.type = 'button';
    open.setAttribute('data-blok-database-drilldown-open', '');
    open.setAttribute('data-row-id', row.id);
    open.textContent = text === '' ? i18n.t('tools.database.cardTitlePlaceholder') : text;
    if (text === '') open.setAttribute('data-empty', '');
    open.addEventListener('click', () => {
      dismiss();
      options.openRow(row.id);
    });
    td.appendChild(open);

    return td;
  };

  for (const row of options.rows) {
    const tr = document.createElement('tr');

    tr.append(...options.columns.map((column) => cell(column, row)));
    body.appendChild(tr);
  }

  close.addEventListener('click', dismiss);
  table.append(head, body);
  scroller.appendChild(table);
  header.append(title, count, close);
  panel.append(header, scroller);
  backdrop.appendChild(panel);
  state.handle = openModalDialog({
    content: backdrop,
    surface: panel,
    role: 'dialog',
    labelledBy: title.id,
    initialFocus: () => close,
    directionSource: options.directionSource ?? null,
    onDismiss: dismiss,
  });

  return { close: dismiss };
};
