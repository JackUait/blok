import type { I18n } from '../../../types';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from './types';
import type { DatabaseViewRenderer } from './database-view-renderer';

interface DatabaseListViewOptions {
  readOnly: boolean;
  i18n: I18n;
  rows: DatabaseRow[];
  titlePropertyId: string;
  schema: PropertyDefinition[];
  visiblePropertyIds: string[];
}

/**
 * DOM rendering layer for the flat list view.
 * Renders rows as a flat list with optional property badges.
 * All interactive elements use data-blok-database-* attributes for test selectors and event delegation.
 */
export class DatabaseListView implements DatabaseViewRenderer {
  private readonly readOnly: boolean;
  private readonly i18n: I18n;
  private readonly rows: DatabaseRow[];
  private readonly titlePropertyId: string;
  private readonly schema: PropertyDefinition[];
  private readonly visiblePropertyIds: string[];

  constructor({ readOnly, i18n, rows, titlePropertyId, schema, visiblePropertyIds }: DatabaseListViewOptions) {
    this.readOnly = readOnly;
    this.i18n = i18n;
    this.rows = rows;
    this.titlePropertyId = titlePropertyId;
    this.schema = schema;
    this.visiblePropertyIds = visiblePropertyIds;
  }

  /**
   * Creates the full list DOM from row data.
   */
  createView(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-database-list', '');
    wrapper.setAttribute('role', 'list');
    wrapper.setAttribute('aria-label', 'List view');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';

    for (const row of this.rows) {
      const rowEl = this.createRowElement(row);

      wrapper.appendChild(rowEl);
    }

    if (!this.readOnly) {
      const addRowBtn = this.createAddRowButton();

      wrapper.appendChild(addRowBtn);
    }

    return wrapper;
  }

  /**
   * Creates a row element and inserts it before the add-row button (if present), else appends.
   */
  appendRow(container: HTMLElement, row: DatabaseRow): void {
    const rowEl = this.createRowElement(row);
    const addRowBtn = container.querySelector('[data-blok-database-add-row]');

    if (addRowBtn !== null) {
      container.insertBefore(rowEl, addRowBtn);
    } else {
      container.appendChild(rowEl);
    }
  }

  /**
   * Removes a row element from the wrapper by its data-row-id.
   */
  removeRow(wrapper: HTMLElement, rowId: string): void {
    const rowEl = wrapper.querySelector(`[data-row-id="${rowId}"]`);

    rowEl?.remove();
  }

  /**
   * Updates the visible title of a row element found by its data-row-id.
   */
  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const rowEl = wrapper.querySelector(`[data-row-id="${rowId}"]`);
    const titleEl = rowEl?.querySelector('[data-blok-database-list-row-title]');

    if (titleEl === null || titleEl === undefined) {
      return;
    }

    if (title) {
      titleEl.textContent = title;
      titleEl.removeAttribute('data-placeholder');
    } else {
      titleEl.textContent = this.i18n.t('tools.database.rowTitlePlaceholder');
      titleEl.setAttribute('data-placeholder', '');
    }
  }

  /**
   * Creates a single row element.
   */
  private createRowElement(row: DatabaseRow): HTMLDivElement {
    const rowEl = document.createElement('div');
    const title = (row.properties[this.titlePropertyId] as string) ?? '';

    rowEl.setAttribute('data-blok-database-list-row', '');
    rowEl.setAttribute('data-row-id', row.id);
    rowEl.setAttribute('role', 'listitem');
    rowEl.style.display = 'flex';
    rowEl.style.alignItems = 'center';
    rowEl.style.cursor = 'pointer';
    rowEl.style.position = 'relative';
    rowEl.style.padding = '6px 8px';
    rowEl.style.borderRadius = '4px';
    rowEl.style.gap = '8px';

    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-list-row-title', '');
    titleEl.style.flex = '1';
    titleEl.style.overflow = 'hidden';
    titleEl.style.textOverflow = 'ellipsis';
    titleEl.style.whiteSpace = 'nowrap';

    if (title) {
      titleEl.textContent = title;
    } else {
      titleEl.textContent = this.i18n.t('tools.database.rowTitlePlaceholder');
      titleEl.setAttribute('data-placeholder', '');
    }

    rowEl.appendChild(titleEl);

    const propertiesEl = this.createPropertiesElement(row);

    rowEl.appendChild(propertiesEl);

    if (!this.readOnly) {
      const deleteBtn = document.createElement('button');

      deleteBtn.setAttribute('data-blok-database-delete-row', '');
      deleteBtn.setAttribute('data-row-id', row.id);
      deleteBtn.setAttribute('aria-label', this.i18n.t('tools.database.deleteRow'));
      deleteBtn.style.position = 'absolute';
      deleteBtn.style.top = '4px';
      deleteBtn.style.right = '4px';
      deleteBtn.textContent = '\u00d7';
      rowEl.appendChild(deleteBtn);
    }

    return rowEl;
  }

  /**
   * Creates the properties container with badges and open button.
   */
  private createPropertiesElement(row: DatabaseRow): HTMLDivElement {
    const propertiesEl = document.createElement('div');

    propertiesEl.setAttribute('data-blok-database-list-row-properties', '');
    propertiesEl.style.display = 'flex';
    propertiesEl.style.alignItems = 'center';
    propertiesEl.style.gap = '6px';
    propertiesEl.style.flexShrink = '0';

    for (const propId of this.visiblePropertyIds) {
      const propDef = this.schema.find(p => p.id === propId);

      if (propDef === undefined) {
        continue;
      }

      const value = row.properties[propId];
      const badge = this.createPropertyBadge(propDef, value);

      if (badge !== null) {
        propertiesEl.appendChild(badge);
      }
    }

    const openBtn = document.createElement('button');

    openBtn.setAttribute('data-blok-database-list-row-open', '');
    openBtn.setAttribute('aria-label', this.i18n.t('tools.database.openRow'));
    propertiesEl.appendChild(openBtn);

    return propertiesEl;
  }

  /**
   * Creates a property badge span for a given property definition and value.
   * Returns null if the value is undefined/null or if the select option is not found.
   */
  private createPropertyBadge(propDef: PropertyDefinition, value: PropertyValue): HTMLSpanElement | null {
    if (value === undefined || value === null) {
      return null;
    }

    const badge = document.createElement('span');

    badge.setAttribute('data-blok-database-list-row-property', '');
    badge.setAttribute('data-property-id', propDef.id);

    if (propDef.type === 'select') {
      const options = propDef.config?.options ?? [];
      const option = options.find(o => o.id === value);

      if (option === undefined) {
        return null;
      }

      badge.textContent = option.label;

      if (option.color !== undefined) {
        badge.style.backgroundColor = `var(--blok-color-${option.color}-bg)`;
        badge.style.color = `var(--blok-color-${option.color}-text)`;
      }
    } else if (propDef.type === 'checkbox') {
      const checkbox = document.createElement('input');

      checkbox.type = 'checkbox';
      checkbox.checked = value === true;
      badge.appendChild(checkbox);
    } else if (typeof value === 'string' || typeof value === 'number') {
      badge.textContent = String(value);
    } else {
      return null;
    }

    return badge;
  }

  /**
   * Creates the "+ New" add-row button.
   */
  private createAddRowButton(): HTMLButtonElement {
    const addRowBtn = document.createElement('button');

    addRowBtn.setAttribute('data-blok-database-add-row', '');
    addRowBtn.setAttribute('aria-label', this.i18n.t('tools.database.addRow'));
    addRowBtn.textContent = '+ ' + this.i18n.t('tools.database.newRow');

    return addRowBtn;
  }
}
