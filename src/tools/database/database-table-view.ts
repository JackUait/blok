import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from './types';

export interface DatabaseTableViewOptions {
  readOnly: boolean;
  i18n: I18n;
  view: DatabaseViewConfig;
  schema: PropertyDefinition[];
  rows: DatabaseRow[];
  titlePropertyId: string;
}

/**
 * Placeholder table: one line per row title. The table renderer replaces the
 * internals; the root attribute `data-blok-database-table` and the
 * `data-row-id` on each row are what the tool looks up.
 */
export class DatabaseTableView implements DatabaseViewRenderer {
  private readonly rows: DatabaseRow[];
  private readonly titlePropertyId: string;

  constructor({ rows, titlePropertyId }: DatabaseTableViewOptions) {
    this.rows = rows;
    this.titlePropertyId = titlePropertyId;
  }

  createView(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-database-table', '');

    for (const row of this.rows) {
      this.appendRow(wrapper, row);
    }

    return wrapper;
  }

  appendRow(container: HTMLElement, row: DatabaseRow): void {
    const rowEl = document.createElement('div');

    rowEl.setAttribute('data-blok-database-table-row', '');
    rowEl.setAttribute('data-row-id', row.id);
    rowEl.textContent = this.titleOf(row);
    container.appendChild(rowEl);
  }

  removeRow(wrapper: HTMLElement, rowId: string): void {
    this.findRow(wrapper, rowId)?.remove();
  }

  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const rowEl = this.findRow(wrapper, rowId);

    if (rowEl !== null) {
      rowEl.textContent = title;
    }
  }

  private titleOf(row: DatabaseRow): string {
    const title = row.properties[this.titlePropertyId];

    return typeof title === 'string' ? title : '';
  }

  private findRow(wrapper: HTMLElement, rowId: string): HTMLElement | null {
    return [...wrapper.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')]
      .find((el) => el.getAttribute('data-row-id') === rowId) ?? null;
  }
}
