import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, PropertyValue, SelectOption, CalculationFn } from './types';
import type { ViewChanges } from './database-model';
import { renderCellValue, createOptionPill } from './cells';
import { formatDateText, resolveLocale } from './cells/date-format';
import { computeCalculation } from './database-calculations';
import type { CalculationResult } from './database-calculations';
import {
  resolveCalculations,
  resolveFrozenColumnCount,
  resolveLoadLimit,
  resolveShowVerticalLines,
  resolveViewProperties,
  withCalculation,
  withPropertyOrder,
  withPropertySetting,
} from './view-settings';
import { DatabaseTableGrid, createTableState } from './database-table-grid';
import type { TableState } from './database-table-grid';
import { CALCULATION_LABEL_KEYS, calculationItems, headerViewItems, openMenu, rowMenuItems } from './database-table-menus';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { DatabaseTableColumnResize } from './database-table-resize';
import { DatabaseTableColumnDrag } from './database-table-column-drag';
import { DatabaseTableRowDrag } from './database-table-row-drag';
import type { TableRowDropResult } from './database-table-row-drag';
import { onHover } from '../../components/utils/tooltip';
import { propertyTypeMeta } from './database-property-types';
import type { PopoverDesktop } from '../../components/utils/popover';
import {
  IconChevronDown,
  IconMenu,
  IconPlus,
  IconSplitView,
  IconTrash,
  IconDotsHorizontal,
} from '../../components/icons';

export { createTableState };
export type { TableState };

/** Observed Notion widths (research/07): title 280, other columns 200. Unverified as defaults. */
export const DEFAULT_TITLE_WIDTH = 280;
export const DEFAULT_COLUMN_WIDTH = 200;
export const MIN_COLUMN_WIDTH = 32;


export interface TableGroup {
  /** Group key; the model's no-value key for "No ⟨property⟩". */
  key: string;
  label: string;
  /** The option behind the group, for its pill. Absent on the no-value group. */
  option?: SelectOption;
  rows: DatabaseRow[];
}

/**
 * Everything the table asks of its host. The tool owns the document; the
 * table only reports what the user did.
 */
export interface TableHandlers {
  /** One cell's new value. Live editors (multi-select, date) call it while open. */
  commitCell: (rowId: string, propertyId: string, value: PropertyValue) => void;
  /** An editor closed or a clear finished: the tool may redraw now. */
  editEnded: () => void;
  /** Adds a row to a group ('' or null when ungrouped), after `afterRowId` when given. Returns its id. */
  addRow: (groupKey: string | null, afterRowId?: string) => string | null;
  deleteRows: (rowIds: string[]) => void;
  duplicateRow: (rowId: string) => void;
  openRow: (rowId: string) => void;
  copyRowLink: (rowId: string) => void;
  editRowIcon: (rowId: string) => void;
  updateView: (changes: ViewChanges) => void;
  openPropertyMenu: (propertyId: string, anchor: HTMLElement) => void;
  addProperty: (anchor: HTMLElement, placement?: { propertyId: string; side: 'left' | 'right' }) => void;
  viewAction: (action: 'filter' | 'sort' | 'group', propertyId: string, anchor: HTMLElement) => void;
  moveRow: (result: TableRowDropResult) => void;
  /** A drop in a sorted view. Notion asks to remove the sort (D7); the tool decides. */
  sortedRowDrop: (result: TableRowDropResult) => void;
  bulkEdit: (rowIds: string[], anchor: HTMLElement) => void;
  editFilters: (anchor: HTMLElement) => void;
  /** A group was folded or opened. The tool saves it in the view. */
  groupToggled?: (key: string, collapsed: boolean) => void;
  /** Redraw from the model, keeping the table state. */
  rerender: () => void;
  optionsChange?: (propertyId: string, options: SelectOption[]) => void;
}

export interface DatabaseTableViewOptions {
  readOnly: boolean;
  i18n: I18n;
  view: DatabaseViewConfig;
  /** Localized schema, for names and option labels. */
  schema: PropertyDefinition[];
  /** Rows of an ungrouped table, in view order. */
  rows: DatabaseRow[];
  /** Groups of a grouped table, in order. Overrides `rows`. */
  groups?: TableGroup[];
  titlePropertyId: string;
  state?: TableState;
  handlers?: TableHandlers;
  locale?: string;
}

interface Column {
  property: PropertyDefinition;
  width: number;
  wrap: boolean;
  /** Inline-start offset when frozen. */
  frozenAt?: number;
}

const tableIds = { next: 0 };

/** A DOM id from row and property ids, which may hold any character. */
const idPart = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}`);

const CALC_NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, useGrouping: false });

export const formatCalculation = (result: CalculationResult, locale: string | undefined): string => {
  switch (result.kind) {
    case 'number':
      return CALC_NUMBER.format(result.value);
    case 'percent':
      return `${CALC_NUMBER.format(result.value)}%`;
    case 'date':
      return formatDateText(result.value, resolveLocale(locale)) ?? result.value;
    case 'dateRange': {
      const days = Math.round((Date.parse(result.end) - Date.parse(result.start)) / 86_400_000);

      return String(days);
    }
    case 'none':
      return '';
  }
};

/**
 * The Notion table view. Builds the grid DOM and wires its gestures; the cell
 * keyboard model lives in DatabaseTableGrid. The root keeps
 * `data-blok-database-table` and each row `data-row-id`: the tool finds both.
 */
export class DatabaseTableView implements DatabaseViewRenderer {
  private readonly options: DatabaseTableViewOptions;
  private readonly state: TableState;
  private readonly columns: Column[];
  private readonly rowMap = new Map<string, DatabaseRow>();
  private grid: DatabaseTableGrid | null = null;
  private resize: DatabaseTableColumnResize | null = null;
  private columnDrag: DatabaseTableColumnDrag | null = null;
  private rowDrag: DatabaseTableRowDrag | null = null;
  private root: HTMLDivElement | null = null;
  private gridEl: HTMLDivElement | null = null;
  /** A pointer is down in the grid. */
  private pressing = false;
  private bar: HTMLElement | null = null;
  /** Unique per table, so two tables on a page never share a cell id. */
  private readonly idPrefix = `blok-database-table-${++tableIds.next}`;
  /** The menu this table opened. Its anchor dies with a redraw, so the menu must too. */
  private menu: PopoverDesktop | null = null;

  constructor(options: DatabaseTableViewOptions) {
    this.options = options;
    this.state = options.state ?? createTableState();
    this.columns = this.resolveColumns();
    for (const row of this.allRows()) {
      this.rowMap.set(row.id, row);
    }
  }

  private get handlers(): TableHandlers | undefined {
    return this.options.handlers;
  }

  private get editable(): boolean {
    return !this.options.readOnly && this.handlers !== undefined;
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.options.i18n.t(key, vars);
  }

  private allRows(): DatabaseRow[] {
    return this.options.groups !== undefined ? this.options.groups.flatMap((group) => group.rows) : this.options.rows;
  }

  private resolveColumns(): Column[] {
    const { view, schema } = this.options;
    const byId = new Map(schema.map((p) => [p.id, p]));
    const visible = resolveViewProperties(view, schema).filter((p) => p.visible && byId.has(p.id));
    const frozen = resolveFrozenColumnCount(view);
    const sized = visible.map((setting) => {
      const property = byId.get(setting.id) as PropertyDefinition;

      return { property, wrap: setting.wrap, width: setting.width ?? (property.type === 'title' ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH) };
    });

    return sized.map((column, index) => {
      const frozenAt = sized.slice(0, index).reduce((sum, c) => sum + c.width, 0);

      return index < frozen ? { ...column, frozenAt } : column;
    });
  }

  // ─── Renderer contract ───

  createView(): HTMLDivElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-table', '');
    this.root = root;

    const scroller = document.createElement('div');

    scroller.setAttribute('data-blok-database-table-scroller', '');

    const gridEl = document.createElement('div');

    gridEl.setAttribute('role', 'grid');
    gridEl.setAttribute('data-blok-database-table-grid', '');
    gridEl.setAttribute('data-blok-keyboard-owner', '');
    gridEl.setAttribute('aria-label', this.t('tools.database.tableLabel'));
    gridEl.setAttribute('aria-rowcount', String(this.allRows().length + 1));
    gridEl.setAttribute('aria-colcount', String(this.columns.length));
    gridEl.setAttribute('aria-multiselectable', 'true');
    gridEl.setAttribute('data-vertical-lines', String(resolveShowVerticalLines(this.options.view)));
    if (this.options.readOnly) {
      gridEl.setAttribute('aria-readonly', 'true');
    }
    gridEl.tabIndex = 0;
    this.gridEl = gridEl;

    gridEl.appendChild(this.createHeader());
    if (this.options.groups !== undefined) {
      for (const group of this.options.groups) {
        gridEl.appendChild(this.createGroup(group));
      }
    } else {
      gridEl.appendChild(this.createBody(this.options.rows, ''));
    }

    scroller.appendChild(gridEl);
    root.appendChild(scroller);

    this.grid = new DatabaseTableGrid({
      root: gridEl,
      readOnly: this.options.readOnly || this.handlers === undefined,
      i18n: this.options.i18n,
      state: this.state,
      columns: this.columns.map((c) => c.property),
      rows: this.rowMap,
      titlePropertyId: this.options.titlePropertyId,
      callbacks: {
        commitCell: (rowId, propertyId, value) => this.handlers?.commitCell(rowId, propertyId, value),
        editEnded: () => this.handlers?.editEnded(),
        deleteRows: (rowIds) => this.handlers?.deleteRows(rowIds),
        duplicateRows: (rowIds) => rowIds.forEach((rowId) => this.handlers?.duplicateRow(rowId)),
        selectionChanged: () => this.syncSelectionChrome(),
        ...(this.handlers?.optionsChange !== undefined
          ? { optionsChange: (propertyId: string, next: SelectOption[]) => this.handlers?.optionsChange?.(propertyId, next) }
          : {}),
      },
    });
    gridEl.addEventListener('click', this.handleClick);
    // Bubble on the grid runs before the popover registry's document listener,
    // whose outside press closes the open editor and asks for a redraw.
    gridEl.addEventListener('pointerdown', this.handlePress);
    gridEl.addEventListener('blok-database-table-repaint', this.handleRepaint);

    if (this.editable) {
      this.resize = new DatabaseTableColumnResize({
        grid: gridEl,
        state: this.state,
        onCommit: (propertyId, width) => this.commitWidth(propertyId, width),
        measure: (propertyId) => this.measureContent(propertyId),
      });
      this.columnDrag = new DatabaseTableColumnDrag({
        grid: gridEl,
        state: this.state,
        onDrop: (propertyId, beforeId) => this.handlers?.updateView({
          properties: withPropertyOrder(this.options.view, this.options.schema, propertyId, beforeId),
        }),
      });
      this.rowDrag = new DatabaseTableRowDrag({
        grid: gridEl,
        state: this.state,
        onDrop: (result) => {
          if (this.options.view.sorts.length > 0) {
            this.handlers?.sortedRowDrop(result);
          } else {
            this.handlers?.moveRow(result);
          }
        },
      });
    }

    // The grid paints once it is in the page; a pending edit needs a placed anchor.
    queueMicrotask(() => {
      if (root.isConnected) {
        this.grid?.restore();
      }
    });
    this.grid.paint();

    return root;
  }

  appendRow(container: HTMLElement, row: DatabaseRow): void {
    const body = container.querySelector<HTMLElement>('[data-blok-database-table-body]') ?? container;

    this.rowMap.set(row.id, row);
    body.appendChild(this.createRow(row, ''));
  }

  removeRow(wrapper: HTMLElement, rowId: string): void {
    this.findRow(wrapper, rowId)?.remove();
    this.rowMap.delete(rowId);
  }

  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const row = this.rowMap.get(rowId);

    if (row !== undefined) {
      this.rowMap.set(rowId, { ...row, properties: { ...row.properties, [this.options.titlePropertyId]: title } });
    }
    const cell = this.findRow(wrapper, rowId)?.querySelector<HTMLElement>(`[role="gridcell"][data-property-id="${CSS.escape(this.options.titlePropertyId)}"]`);

    if (cell !== null && cell !== undefined) {
      this.fillCell(cell, rowId);
    }
  }

  destroy(): void {
    this.menu?.destroy();
    this.menu = null;
    this.grid?.destroy();
    this.resize?.destroy();
    this.columnDrag?.destroy();
    this.rowDrag?.destroy();
    this.handleRelease();
  }

  /**
   * True while an editor, a resize, a drag or a press runs. A redraw during a
   * press replaces the pressed cell, and its click never arrives.
   */
  get interacting(): boolean {
    return this.state.editing || this.state.busy || this.pressing;
  }

  private readonly handlePress = (): void => {
    this.pressing = true;
    window.addEventListener('pointerup', this.handleRelease, true);
    window.addEventListener('pointercancel', this.handleRelease, true);
  };

  private readonly handleRelease = (): void => {
    this.pressing = false;
    window.removeEventListener('pointerup', this.handleRelease, true);
    window.removeEventListener('pointercancel', this.handleRelease, true);
  };

  private findRow(wrapper: HTMLElement, rowId: string): HTMLElement | null {
    return [...wrapper.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')]
      .find((el) => el.getAttribute('data-row-id') === rowId) ?? null;
  }

  // ─── Header ───

  private createHeader(): HTMLElement {
    const header = document.createElement('div');

    header.setAttribute('role', 'row');
    header.setAttribute('data-blok-database-table-header', '');
    header.setAttribute('aria-rowindex', '1');

    if (this.editable) {
      const gutter = this.createGutter();
      const all = this.createCheckbox('data-blok-database-table-select-all', this.t('tools.database.tableSelectAll'));

      gutter.appendChild(all);
      header.appendChild(gutter);
    }

    this.columns.forEach((column, index) => {
      header.appendChild(this.createHeaderCell(column, index));
    });

    if (this.editable) {
      const add = document.createElement('button');

      add.type = 'button';
      add.setAttribute('data-blok-database-table-add-property', '');
      add.setAttribute('aria-label', this.t('tools.database.tableAddProperty'));
      add.innerHTML = IconPlus;
      header.appendChild(add);
    }
    header.appendChild(this.createFiller());

    return header;
  }

  private createHeaderCell(column: Column, index: number): HTMLElement {
    const { property } = column;
    const cell = document.createElement('div');

    cell.setAttribute('role', 'columnheader');
    cell.setAttribute('data-blok-database-table-column-header', '');
    cell.setAttribute('data-property-id', property.id);
    cell.setAttribute('aria-colindex', String(index + 1));
    this.sizeCell(cell, column);

    const button = document.createElement('div');

    button.setAttribute('data-blok-database-table-column-button', '');
    if (this.editable) {
      button.setAttribute('role', 'button');
      button.tabIndex = -1;
    }
    const icon = document.createElement('span');

    icon.setAttribute('data-blok-database-table-column-icon', '');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = propertyTypeMeta(property.type).icon;

    const name = document.createElement('span');

    name.setAttribute('data-blok-database-table-column-name', '');
    name.textContent = property.name;
    button.append(icon, name);
    cell.appendChild(button);
    onHover(cell, property.name);

    if (this.editable) {
      const handle = document.createElement('div');

      handle.setAttribute('data-blok-database-table-resize', '');
      handle.setAttribute('aria-hidden', 'true');
      cell.appendChild(handle);
    }

    return cell;
  }

  private sizeCell(cell: HTMLElement, column: Column): void {
    const { style } = cell;

    style.width = `${column.width}px`;
    if (column.frozenAt !== undefined) {
      cell.setAttribute('data-frozen', '');
      style.insetInlineStart = `${column.frozenAt}px`;
    }
  }

  private createFiller(): HTMLElement {
    const filler = document.createElement('div');

    filler.setAttribute('data-blok-database-table-filler', '');
    filler.setAttribute('aria-hidden', 'true');

    return filler;
  }

  private createGutter(): HTMLElement {
    const gutter = document.createElement('div');

    gutter.setAttribute('data-blok-database-table-gutter', '');

    return gutter;
  }

  private createCheckbox(attribute: string, label: string): HTMLElement {
    const box = document.createElement('span');

    box.setAttribute(attribute, '');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', 'false');
    box.setAttribute('aria-label', label);
    box.tabIndex = -1;

    return box;
  }

  // ─── Body ───

  private visibleCount(groupKey: string, total: number): number {
    return Math.min(total, this.state.loaded.get(groupKey) ?? resolveLoadLimit(this.options.view));
  }

  private createBody(rows: DatabaseRow[], groupKey: string, group?: TableGroup): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const body = document.createElement('div');

    body.setAttribute('role', 'rowgroup');
    body.setAttribute('data-blok-database-table-body', '');
    const shown = this.visibleCount(groupKey, rows.length);

    for (const row of rows.slice(0, shown)) {
      body.appendChild(this.createRow(row, groupKey));
    }
    fragment.appendChild(body);

    if (rows.length === 0 && group === undefined && this.options.view.filters.length > 0) {
      fragment.appendChild(this.createEmptyState());

      return fragment;
    }
    if (shown < rows.length) {
      const more = document.createElement('button');

      more.type = 'button';
      more.setAttribute('data-blok-database-table-load-more', '');
      more.setAttribute('data-group-key', groupKey);
      more.textContent = this.t('tools.database.tableLoadMore');
      fragment.appendChild(more);
    }
    if (this.editable) {
      fragment.appendChild(this.createAddRow(groupKey));
    }
    fragment.appendChild(this.createFooter(rows));

    return fragment;
  }

  private createAddRow(groupKey: string): HTMLElement {
    const add = document.createElement('button');

    add.type = 'button';
    add.setAttribute('data-blok-database-table-add-row', '');
    add.setAttribute('data-group-key', groupKey);
    const icon = document.createElement('span');

    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = IconPlus;
    add.append(icon, this.t('tools.database.tableNewPage'));

    return add;
  }

  private createEmptyState(): HTMLElement {
    const empty = document.createElement('div');

    empty.setAttribute('data-blok-database-table-empty', '');
    const edit = document.createElement('button');

    edit.type = 'button';
    edit.setAttribute('data-blok-database-table-edit-filters', '');
    edit.textContent = this.t('tools.database.tableEditFilters');
    empty.appendChild(edit);
    if (this.editable) {
      empty.appendChild(this.createAddRow(''));
    }

    return empty;
  }

  private createRow(row: DatabaseRow, groupKey: string): HTMLElement {
    const rowEl = document.createElement('div');

    rowEl.setAttribute('role', 'row');
    rowEl.setAttribute('data-blok-database-table-row', '');
    rowEl.setAttribute('data-row-id', row.id);
    rowEl.setAttribute('data-group-key', groupKey);
    rowEl.setAttribute('aria-selected', 'false');

    if (this.editable) {
      const gutter = this.createGutter();
      const add = document.createElement('button');

      add.type = 'button';
      add.setAttribute('data-blok-database-table-row-add', '');
      add.setAttribute('aria-label', this.t('tools.database.tableAddBelow'));
      add.tabIndex = -1;
      add.innerHTML = IconPlus;

      const handle = document.createElement('button');

      handle.type = 'button';
      handle.setAttribute('data-blok-database-table-row-handle', '');
      handle.setAttribute('aria-label', this.t('tools.database.tableDragHandle'));
      handle.tabIndex = -1;
      handle.innerHTML = IconMenu;

      gutter.append(add, handle, this.createCheckbox('data-blok-database-table-row-checkbox', this.t('tools.database.tableSelectRow')));
      rowEl.appendChild(gutter);
    }

    this.columns.forEach((column, index) => {
      const cell = document.createElement('div');

      cell.setAttribute('role', 'gridcell');
      cell.id = `${this.idPrefix}-${idPart(row.id)}-${idPart(column.property.id)}`;
      cell.setAttribute('data-blok-database-table-cell', '');
      cell.setAttribute('data-property-id', column.property.id);
      cell.setAttribute('data-type', column.property.type);
      cell.setAttribute('aria-colindex', String(index + 1));
      cell.setAttribute('aria-selected', 'false');
      cell.tabIndex = -1;
      if (column.wrap) {
        cell.setAttribute('data-wrap', '');
      }
      this.sizeCell(cell, column);
      rowEl.appendChild(cell);
      this.fillCell(cell, row.id);
    });
    rowEl.appendChild(this.createFiller());

    return rowEl;
  }

  private fillCell(cell: HTMLElement, rowId: string): void {
    const propertyId = cell.getAttribute('data-property-id') ?? '';
    const column = this.columns.find((c) => c.property.id === propertyId);
    const row = this.rowMap.get(rowId);

    if (column === undefined || row === undefined) {
      return;
    }
    const value = renderCellValue(column.property, row.properties[propertyId], {
      i18n: this.options.i18n,
      readOnly: this.options.readOnly,
      ...(this.options.locale !== undefined ? { locale: this.options.locale } : {}),
    });

    cell.replaceChildren(value);

    if (column.property.type === 'title' && this.handlers !== undefined) {
      const open = document.createElement('button');

      open.type = 'button';
      open.setAttribute('data-blok-database-table-open', '');
      open.tabIndex = -1;
      const icon = document.createElement('span');

      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = IconSplitView;
      const label = document.createElement('span');

      label.textContent = this.t('tools.database.tableOpen');
      open.append(icon, label);
      cell.appendChild(open);
    }
  }

  private readonly handleRepaint = (event: Event): void => {
    const cell = event.target;
    const rowId = cell instanceof HTMLElement ? cell.closest('[data-row-id]')?.getAttribute('data-row-id') : null;

    if (cell instanceof HTMLElement && typeof rowId === 'string') {
      this.fillCell(cell, rowId);
    }
  };

  // ─── Groups ───

  private createGroup(group: TableGroup): HTMLElement {
    const section = document.createElement('div');
    const collapsed = this.state.collapsed.has(group.key);

    section.setAttribute('data-blok-database-table-group', '');
    section.setAttribute('data-group-key', group.key);
    section.toggleAttribute('data-collapsed', collapsed);

    const header = document.createElement('div');

    header.setAttribute('data-blok-database-table-group-header', '');
    const caret = document.createElement('button');

    caret.type = 'button';
    caret.setAttribute('data-blok-database-table-group-toggle', '');
    caret.setAttribute('aria-expanded', String(!collapsed));
    caret.setAttribute('aria-label', this.t(collapsed ? 'tools.database.tableExpandGroup' : 'tools.database.tableCollapseGroup'));
    caret.innerHTML = IconChevronDown;

    const label = document.createElement('span');

    label.setAttribute('data-blok-database-table-group-label', '');
    if (group.option !== undefined) {
      label.appendChild(createOptionPill(group.option));
    } else {
      label.textContent = group.label;
    }
    const count = document.createElement('span');

    count.setAttribute('data-blok-database-table-group-count', '');
    count.textContent = String(group.rows.length);
    header.append(caret, label, count);
    section.appendChild(header);

    const content = document.createElement('div');

    content.setAttribute('data-blok-database-table-group-content', '');
    // Rows mount and unmount at once (research/08); only the caret turns.
    if (!collapsed) {
      content.appendChild(this.createBody(group.rows, group.key, group));
    }
    section.appendChild(content);

    return section;
  }

  private toggleGroup(section: HTMLElement): void {
    const key = section.getAttribute('data-group-key') ?? '';
    const group = this.options.groups?.find((g) => g.key === key);
    const content = section.querySelector<HTMLElement>('[data-blok-database-table-group-content]');
    const caret = section.querySelector<HTMLElement>('[data-blok-database-table-group-toggle]');

    if (group === undefined || content === null) {
      return;
    }
    const collapse = !this.state.collapsed.has(key);

    if (collapse) {
      this.state.collapsed.add(key);
      content.replaceChildren();
    } else {
      this.state.collapsed.delete(key);
      content.replaceChildren(this.createBody(group.rows, key, group));
    }
    section.toggleAttribute('data-collapsed', collapse);
    caret?.setAttribute('aria-expanded', String(!collapse));
    caret?.setAttribute('aria-label', this.t(collapse ? 'tools.database.tableExpandGroup' : 'tools.database.tableCollapseGroup'));
    this.grid?.paint();
    this.handlers?.groupToggled?.(key, collapse);
  }

  // ─── Footer ───

  private createFooter(rows: DatabaseRow[]): HTMLElement {
    const footer = document.createElement('div');
    const calculations = resolveCalculations(this.options.view, this.options.schema);

    footer.setAttribute('data-blok-database-table-footer', '');
    if (this.editable) {
      footer.appendChild(this.createGutter());
    }
    for (const column of this.columns) {
      const fn = calculations.get(column.property.id);
      const cell = document.createElement(this.editable ? 'button' : 'div');

      cell.setAttribute('data-blok-database-table-calc', '');
      cell.setAttribute('data-property-id', column.property.id);
      cell.setAttribute('data-type', column.property.type);
      if (cell instanceof HTMLButtonElement) {
        cell.type = 'button';
      }
      this.sizeCell(cell, column);

      if (fn === undefined) {
        cell.setAttribute('data-empty', '');
        const placeholder = document.createElement('span');

        placeholder.setAttribute('data-blok-database-table-calc-placeholder', '');
        placeholder.textContent = this.t('tools.database.tableCalculate');
        cell.appendChild(placeholder);
      } else {
        const result = computeCalculation(fn, rows.map((row) => row.properties[column.property.id]), column.property);
        const label = document.createElement('span');
        const value = document.createElement('span');

        label.setAttribute('data-blok-database-table-calc-label', '');
        label.textContent = this.t(CALCULATION_LABEL_KEYS[fn]);
        value.setAttribute('data-blok-database-table-calc-value', '');
        value.textContent = formatCalculation(result, this.options.locale);
        cell.append(label, value);
      }
      footer.appendChild(cell);
    }
    footer.appendChild(this.createFiller());

    return footer;
  }

  // ─── Selection chrome ───

  private syncSelectionChrome(): void {
    const gridEl = this.gridEl;
    const root = this.root;

    if (gridEl === null || root === null) {
      return;
    }
    const selection = this.state.selection;
    const rowIds = selection?.kind === 'rows' ? selection.rowIds : [];
    const total = gridEl.querySelectorAll('[data-blok-database-table-row]').length;
    const all = gridEl.querySelector('[data-blok-database-table-select-all]');
    const someState = rowIds.length >= total ? 'true' : 'mixed';

    all?.setAttribute('aria-checked', rowIds.length > 0 ? someState : 'false');

    if (rowIds.length === 0) {
      this.bar?.remove();
      this.bar = null;

      return;
    }
    if (this.bar === null) {
      this.bar = this.createSelectionBar();
      root.insertBefore(this.bar, root.firstChild);
    }
    const count = this.bar.querySelector('[data-blok-database-table-selection-count]');

    if (count !== null) {
      count.textContent = this.t('tools.database.tableSelectedCount', { count: rowIds.length });
    }
  }

  private createSelectionBar(): HTMLElement {
    const bar = document.createElement('div');

    bar.setAttribute('data-blok-database-table-selection-bar', '');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', this.t('tools.database.tableSelectionActions'));
    const count = document.createElement('span');

    count.setAttribute('data-blok-database-table-selection-count', '');
    count.setAttribute('aria-live', 'polite');

    const trash = document.createElement('button');

    trash.type = 'button';
    trash.setAttribute('data-blok-database-table-selection-delete', '');
    trash.setAttribute('aria-label', this.t('tools.database.tableMoveToTrash'));
    trash.innerHTML = IconTrash;

    const more = document.createElement('button');

    more.type = 'button';
    more.setAttribute('data-blok-database-table-selection-more', '');
    more.setAttribute('aria-label', this.t('tools.database.tableMoreActions'));
    more.innerHTML = IconDotsHorizontal;

    bar.append(count, trash, more);
    bar.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const rowIds = this.grid?.selectedRowIds() ?? [];

      if (target?.closest('[data-blok-database-table-selection-delete]') != null) {
        this.state.selection = null;
        this.handlers?.deleteRows(rowIds);
        this.grid?.paint();
      } else if (target?.closest('[data-blok-database-table-selection-more]') != null) {
        this.handlers?.bulkEdit(rowIds, more);
      }
    });

    return bar;
  }

  // ─── Clicks ───

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const handlers = this.handlers;

    if (target === null) {
      return;
    }
    const closest = (selector: string): HTMLElement | null => target.closest<HTMLElement>(selector);
    const rowEl = closest('[data-blok-database-table-row]');
    const rowId = rowEl?.getAttribute('data-row-id') ?? null;
    const groupKey = (closest('[data-group-key]')?.getAttribute('data-group-key') ?? '');

    if (closest('[data-blok-database-table-group-toggle]') !== null) {
      const section = closest('[data-blok-database-table-group]');

      if (section !== null) {
        this.toggleGroup(section);
      }

      return;
    }
    if (closest('[data-blok-database-table-load-more]') !== null) {
      const total = this.options.groups?.find((g) => g.key === groupKey)?.rows.length ?? this.options.rows.length;

      this.state.loaded.set(groupKey, this.visibleCount(groupKey, total) + resolveLoadLimit(this.options.view));
      handlers?.rerender();

      return;
    }
    if (handlers === undefined) {
      return;
    }
    if (closest('[data-blok-database-table-edit-filters]') !== null) {
      handlers.editFilters(closest('[data-blok-database-table-edit-filters]') as HTMLElement);

      return;
    }
    if (this.options.readOnly) {
      this.clickReadOnlyCell(target, event);

      return;
    }
    this.clickEditable(target, event, rowId, groupKey);
  };

  private clickReadOnlyCell(target: Element, event: MouseEvent): void {
    const cellEl = target.closest<HTMLElement>('[role="gridcell"]');
    const rowId = cellEl?.closest('[data-row-id]')?.getAttribute('data-row-id');
    const propertyId = cellEl?.getAttribute('data-property-id');

    if (target.closest('[data-blok-database-table-open]') !== null && typeof rowId === 'string') {
      this.handlers?.openRow(rowId);

      return;
    }
    if (typeof rowId === 'string' && typeof propertyId === 'string') {
      this.grid?.clickCell({ rowId, propertyId }, event.shiftKey);
    }
  }

  private clickEditable(target: Element, event: MouseEvent, rowId: string | null, groupKey: string): void {
    const handlers = this.handlers;
    const closest = (selector: string): HTMLElement | null => target.closest<HTMLElement>(selector);

    if (handlers === undefined) {
      return;
    }
    if (closest('[data-blok-database-table-add-row]') !== null) {
      this.addRow(groupKey);

      return;
    }
    if (closest('[data-blok-database-table-add-property]') !== null) {
      handlers.addProperty(closest('[data-blok-database-table-add-property]') as HTMLElement);

      return;
    }
    if (closest('[data-blok-database-table-select-all]') !== null) {
      this.grid?.toggleAll();

      return;
    }
    const calc = closest('[data-blok-database-table-calc]');

    if (calc !== null) {
      this.openCalculationMenu(calc);

      return;
    }
    const header = closest('[data-blok-database-table-column-header]');

    if (header !== null) {
      if (closest('[data-blok-database-table-resize]') === null && !this.state.busy) {
        handlers.openPropertyMenu(header.getAttribute('data-property-id') ?? '', header);
      }

      return;
    }
    if (rowId === null) {
      return;
    }
    if (closest('[data-blok-database-table-row-checkbox]') !== null) {
      this.grid?.toggleRow(rowId);

      return;
    }
    if (closest('[data-blok-database-table-row-add]') !== null) {
      this.addRow(groupKey, rowId);

      return;
    }
    if (closest('[data-blok-database-table-row-handle]') !== null) {
      this.openRowMenu(closest('[data-blok-database-table-row-handle]') as HTMLElement, rowId);

      return;
    }
    if (closest('[data-blok-database-table-open]') !== null) {
      handlers.openRow(rowId);

      return;
    }
    const cellEl = closest('[role="gridcell"]');
    const propertyId = cellEl?.getAttribute('data-property-id');

    if (typeof propertyId === 'string') {
      this.grid?.clickCell({ rowId, propertyId }, event.shiftKey);
    }
  }

  private addRow(groupKey: string, afterRowId?: string): void {
    const handlers = this.handlers;

    if (handlers === undefined) {
      return;
    }
    const key = this.options.groups === undefined ? null : groupKey;
    const newId = afterRowId === undefined ? handlers.addRow(key) : handlers.addRow(key, afterRowId);

    if (newId !== null) {
      this.state.freshRowId = newId;
      this.state.pendingEdit = { rowId: newId, propertyId: this.options.titlePropertyId };
      this.state.selection = null;
    }
  }

  private showMenu(anchor: HTMLElement, items: PopoverItemParams[], options: { searchable?: boolean } = {}): void {
    this.menu?.destroy();
    const menu = openMenu(anchor, items, {
      ...options,
      onClose: () => {
        if (this.menu === menu) {
          this.menu = null;
        }
      },
    });

    this.menu = menu;
  }

  private openCalculationMenu(anchor: HTMLElement): void {
    const propertyId = anchor.getAttribute('data-property-id') ?? '';
    const property = this.columns.find((c) => c.property.id === propertyId)?.property;

    if (property === undefined) {
      return;
    }
    const current = resolveCalculations(this.options.view, this.options.schema).get(propertyId);

    this.showMenu(anchor, calculationItems(property, current, this.options.i18n, (fn: CalculationFn | null) => {
      this.handlers?.updateView({ calculations: withCalculation(this.options.view, propertyId, fn) });
    }));
  }

  private openRowMenu(anchor: HTMLElement, rowId: string): void {
    const handlers = this.handlers;

    if (handlers === undefined) {
      return;
    }
    this.grid?.selectRows([rowId]);
    this.showMenu(anchor, rowMenuItems({
      i18n: this.options.i18n,
      properties: this.columns.map((c) => c.property).filter((p) => p.type !== 'title'),
      onEditIcon: () => handlers.editRowIcon(rowId),
      onEditProperty: (propertyId) => {
        const ref = { rowId, propertyId };

        this.state.selection = { kind: 'cell', anchor: ref, focus: ref };
        this.grid?.paint();
        this.grid?.openEditor(ref);
      },
      onOpenSidePeek: () => handlers.openRow(rowId),
      onCopyLink: () => handlers.copyRowLink(rowId),
      onDuplicate: () => handlers.duplicateRow(rowId),
      onDelete: () => {
        this.state.selection = null;
        handlers.deleteRows([rowId]);
      },
    }), { searchable: true });
  }

  // ─── Columns ───

  private commitWidth(propertyId: string, width: number): void {
    this.handlers?.updateView({ properties: withPropertySetting(this.options.view, this.options.schema, propertyId, { width }) });
  }

  /**
   * The view-level rows of a column header menu. The property menu shows
   * these after its own rows; until it exists the tool opens them alone.
   */
  headerItems(propertyId: string, anchor: HTMLElement): PopoverItemParams[] {
    const index = this.columns.findIndex((c) => c.property.id === propertyId);
    const column = this.columns[index];
    const handlers = this.handlers;

    if (column === undefined || handlers === undefined) {
      return [];
    }
    const { view, schema } = this.options;
    const frozen = resolveFrozenColumnCount(view);

    return headerViewItems({
      i18n: this.options.i18n,
      property: column.property,
      frozenHere: frozen === index + 1,
      wrapped: column.wrap,
      calculation: resolveCalculations(view, schema).get(propertyId),
      onFilter: () => handlers.viewAction('filter', propertyId, anchor),
      onSort: () => handlers.viewAction('sort', propertyId, anchor),
      onGroup: () => handlers.viewAction('group', propertyId, anchor),
      onCalculate: (fn) => handlers.updateView({ calculations: withCalculation(view, propertyId, fn) }),
      onFreeze: () => handlers.updateView({ frozenColumnCount: index + 1 }),
      onUnfreeze: () => handlers.updateView({ frozenColumnCount: 0 }),
      onHide: () => handlers.updateView({ properties: withPropertySetting(view, schema, propertyId, { visible: false }) }),
      onWrap: (wrap) => handlers.updateView({ properties: withPropertySetting(view, schema, propertyId, { wrap }) }),
      onInsert: (side) => handlers.addProperty(anchor, { propertyId, side }),
    });
  }

  openHeaderMenu(propertyId: string, anchor: HTMLElement): void {
    const items = this.headerItems(propertyId, anchor);

    if (items.length > 0) {
      this.showMenu(anchor, items);
    }
  }

  /** Widest content of a column, for a double-click auto-fit. */
  private measureContent(propertyId: string): number {
    const gridEl = this.gridEl;

    if (gridEl === null) {
      return DEFAULT_COLUMN_WIDTH;
    }
    const escaped = CSS.escape(propertyId);
    const cells = [
      ...gridEl.querySelectorAll<HTMLElement>(`[data-blok-database-table-column-header][data-property-id="${escaped}"] [data-blok-database-table-column-button]`),
      ...gridEl.querySelectorAll<HTMLElement>(`[role="gridcell"][data-property-id="${escaped}"] > [data-blok-database-cell]`),
    ];
    // Cell padding is 8px a side.
    const widest = Math.max(0, ...cells.map((el) => el.scrollWidth)) + 16;

    return Math.max(MIN_COLUMN_WIDTH, Math.ceil(widest));
  }
}
