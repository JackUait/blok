import type { I18n } from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, DateReminderOffset, NumberDisplay, OpenPagesIn, PropertyDefinition, PropertyValue, SelectOption, CalculationFn } from './types';
import type { ViewChanges } from './database-model';
import { bindFileNameHint, renderCellValue, createOptionPill, openCellEditor } from './cells';
import { rowCellContext } from './reminders';
import type { CellContext, CellEditorHandle } from './cells';
import { isReadOnlyType, readPropertyValue } from './property-values';
import { editorLocale, formatDateText, resolveLocale } from './cells/date-format';
import type { DateDisplayChange } from './cells/date-format';
import { formatNumberValue } from './cells/number-format';
import { computeCalculation } from './database-calculations';
import type { CalculationResult } from './database-calculations';
import {
  resolveCalculations,
  resolveCountCaps,
  resolveFrozenColumnCount,
  resolveLoadLimit,
  resolveShowVerticalLines,
  resolveViewProperties,
  withCalculation,
  withCalculationCap,
  withPropertyOrder,
  withPropertySetting,
} from './view-settings';
import { DatabaseTableGrid, createTableState } from './database-table-grid';
import { SELECTION_BAR_SEGMENTS, bulkCloseClearsSelection, bulkStartValue, selectionPropertyButton, watchBulkCloseKey } from './database-selection-bar';
import { cellText } from './database-table-clipboard';
import type { CellChange, TableState } from './database-table-grid';
import { fileChipIcon, pageIconElement, pagePlaceholderIcon, showsPageIcon } from './page-icon';

import { CALCULATION_LABEL_KEYS, calculationItems, headerViewItems, moveTargetItems, openMenu, rowMenuFooter, rowMenuItems } from './database-table-menus';
import type { CountCap, OpenMenuOptions, RowFavorite } from './database-table-menus';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { DatabaseTableColumnResize } from './database-table-resize';
import { DatabaseTableColumnDrag } from './database-table-column-drag';
import { DatabaseTableRowDrag } from './database-table-row-drag';
import type { TableRowDropResult } from './database-table-row-drag';
import { offHover, onHover } from '../../components/utils/tooltip';
import { propertyHint } from './property-hint';
import { syncCommentBadge } from './database-comment-badge';
import type { CommentBadges } from './database-comment-badge';
import { propertyTypeMeta } from './database-property-types';
import type { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import {
  IconChevronDown,
  IconChevronRight,
  IconMenu,
  IconPlus,
  IconSplitView,
  IconTrash,
  IconDotsHorizontal,
  IconCopy,
  IconMessage,
  IconPencilLine,
  IconWand,
  IconWarning,
  IconInfo,
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
  /** A date's Remind choice, null for None. Without it the date picker has no Remind row. */
  commitReminder?: (rowId: string, propertyId: string, reminder: DateReminderOffset | null) => void;
  /** The bulk date picker's Remind. `picked` false: the property default, for rows with none. Returns the rows it wrote. */
  commitBulkReminder?: (rowIds: string[], propertyId: string, reminder: DateReminderOffset | null, picked: boolean) => string[];
  /** An editor closed or a clear finished: the tool may redraw now. */
  editEnded: () => void;
  /** Adds a row to a group ('' or null when ungrouped), after `afterRowId` when given. Returns its id. */
  addRow: (groupKey: string | null, afterRowId?: string) => string | null;
  /** `byKey`: Delete or Backspace on selected rows, which shows the Trash toast. */
  deleteRows: (rowIds: string[], byKey?: boolean) => void;
  duplicateRow: (rowId: string) => void;
  /** Opens a row page, in `mode` when the row menu's "Open in" names one. */
  openRow: (rowId: string, mode?: OpenPagesIn) => void;
  copyRowLink: (rowId: string) => void;
  /** Other databases of this document a row can move to. */
  moveTargets?: () => Array<{ id: string; title: string }>;
  /** "Move to": the row leaves for another database. */
  moveRowTo?: (rowId: string, databaseId: string) => void;
  editRowIcon: (rowId: string) => void;
  updateView: (changes: ViewChanges) => void;
  openPropertyMenu: (propertyId: string, anchor: HTMLElement) => void;
  addProperty: (anchor: HTMLElement, placement?: { propertyId: string; side: 'left' | 'right' }) => void;
  viewAction: (action: 'filter' | 'sort' | 'group', propertyId: string, anchor: HTMLElement) => void;
  moveRow: (result: TableRowDropResult) => void;
  /** A drop in a sorted view. Notion asks to remove the sort (D7); the tool decides. */
  sortedRowDrop: (result: TableRowDropResult) => void;
  bulkEdit: (rowIds: string[], anchor: HTMLElement) => void;
  /** A paste, fill or bulk edit: cell writes, then new rows. One undo step. `whenIdle`: redraw once the view is idle. */
  commitCells: (changes: CellChange[], newRows: Array<Record<string, PropertyValue>>, whenIdle?: boolean) => void;
  editFilters: (anchor: HTMLElement) => void;
  /** Whether a search is on: an empty result then offers "Clear search". */
  searching?: () => boolean;
  clearSearch?: () => void;
  /** A group was folded or opened. The tool saves it in the view. */
  groupToggled?: (key: string, collapsed: boolean) => void;
  /** Redraw from the model, keeping the table state. */
  rerender: () => void;
  optionsChange?: (propertyId: string, options: SelectOption[]) => void;
  /** A cell editor's "Edit property": open that column's property menu. */
  editProperty?: (propertyId: string) => void;
  /** A click on a formula cell opens "Edit formula" at the cell. */
  editFormula?: (propertyId: string, cell: HTMLElement) => void;
  /** A rollup cell's "Configure rollup" hover button. Without it the button is not shown. */
  configureRollup?: (propertyId: string, cell: HTMLElement) => void;
  /** The date picker's format rows. Returns undefined where the property may not change. Drawn on editEnded. */
  dateDisplayChanger?: (propertyId: string) => ((change: DateDisplayChange) => void) | undefined;
}

/** Sub-items "Nested in toggle": what the table asks about each shown row. */
export interface TableNesting {
  info: (rowId: string) => { depth: number; hasChildren: boolean; expanded: boolean } | undefined;
  toggle: (rowId: string) => void;
  /** "+ New sub-item" under an open parent. */
  addSubItem?: (parentId: string) => void;
}

export interface DatabaseTableViewOptions {
  /** Opens a row page without any write handler: what a read-only viewer gets. */
  openRow?: (rowId: string) => void;
  /** The row shown in the side peek, if any, and how to close it: its OPEN reads CLOSE (notion-spec-2 §25.3). */
  peek?: { rowId: () => string | null; close: () => void };
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
  /** What cells need from the host: relation titles, computed result types. */
  cellContext?: Partial<CellContext>;
  nesting?: TableNesting;
  /** The host's comments for a row or a cell. Works in read-only too. */
  comment?: (rowId: string, propertyId: string | undefined, anchor: HTMLElement) => void;
  /** The host's comment counts. Without it there are no badges. */
  commentBadges?: CommentBadges;
  /** The host's favorites. Without it the row menu has no Add to Favorites. */
  favorite?: (rowId: string) => RowFavorite | undefined;
  /** Where the selection bar goes: the view toolbar row, which it replaces (research/08). Else the table's top. */
  selectionBarSlot?: () => HTMLElement | null;
  /** AI Autofill run actions. The tool leaves it out when read-only, locked or without `config.ai.autofill`. */
  autofill?: TableAutofill;
  /** Shows a toast: "Copied property to clipboard". */
  notify?: (message: string) => void;
  /** A button property with an action that cannot run: its header shows a warning. */
  buttonError?: (property: PropertyDefinition) => boolean;
}

/** The cell "Autofill" button and the header sparkle of an autofill column (research/12 §2). */
export interface TableAutofill {
  filling: (rowId: string, propertyId: string) => boolean;
  run: (rowId: string, propertyId: string) => void;
  open: (propertyId: string, anchor: HTMLElement) => void;
}

interface Column {
  property: PropertyDefinition;
  width: number;
  wrap: boolean;
  /** Inline-start offset when frozen. */
  frozenAt?: number;
}

/** A footer cell's content: "Calculate" when no function is set, else its label and result. The timeline's table panel shares it. */
export const fillCalculationCell = (cell: HTMLElement, { fn, property, shown, rows, i18n, locale, capCounts = false }: {
  fn: CalculationFn | undefined;
  property: PropertyDefinition;
  /** `property` as its result type (formula, rollup). */
  shown: PropertyDefinition;
  rows: DatabaseRow[];
  i18n: Pick<I18n, 't'>;
  locale: string | undefined;
  /** "Show large counts as 99+". */
  capCounts?: boolean;
}): void => {
  // research/08: a button column has no Calculate.
  if (property.type === 'button') {
    return;
  }
  if (fn === undefined) {
    const placeholder = document.createElement('span');

    cell.setAttribute('data-empty', '');
    placeholder.setAttribute('data-blok-database-table-calc-placeholder', '');
    placeholder.textContent = i18n.t('tools.database.tableCalculate');
    cell.appendChild(placeholder);

    return;
  }

  const label = document.createElement('span');
  const value = document.createElement('span');

  label.setAttribute('data-blok-database-table-calc-label', '');
  label.textContent = i18n.t(CALCULATION_LABEL_KEYS[fn]);
  value.setAttribute('data-blok-database-table-calc-value', '');
  value.textContent = calculationText(fn, rows, property, shown, locale, capCounts);
  cell.append(label, value);
};

/** One calculation over `rows`, formatted as the footer shows it. The board's group calculation shares it. */
export const calculationText = (
  fn: CalculationFn,
  rows: DatabaseRow[],
  property: PropertyDefinition,
  shown: PropertyDefinition,
  locale: string | undefined,
  capCounts = false
): string => formatCalculation(computeCalculation(fn, rows.map((row) => readPropertyValue(row, property)), shown), locale, {
  ...(NUMBER_RESULT_FNS.has(fn) && shown.type === 'number' ? { number: shown.number ?? {} } : {}),
  capCounts: capCounts && COUNT_RESULT_FNS.has(fn),
});

/** Functions whose result is a value of the column, shown in its number format. Unverified against Notion. */
const NUMBER_RESULT_FNS: ReadonlySet<CalculationFn> = new Set<CalculationFn>(['sum', 'average', 'median', 'min', 'max', 'range']);

/** Functions whose result is a count, which "Show large counts as 99+" caps. */
const COUNT_RESULT_FNS: ReadonlySet<CalculationFn> = new Set<CalculationFn>(['count', 'count_values', 'unique', 'empty', 'not_empty', 'checked', 'unchecked']);

const MAX_SHOWN_COUNT = 99;

/** Cells whose value is a link: a click on it follows it, and a hover shows the action pill. */
const LINK_TYPES: ReadonlySet<string> = new Set(['url', 'email', 'phone']);
/** notion-spec-2 §18.2, §19.6, §19.20, §20.11: filled cells whose hover shows Comment + Copy. */
const COPY_PILL_TYPES: ReadonlySet<string> = new Set([...LINK_TYPES, 'text', 'number', 'formula', 'date', 'place']);
/** notion-spec-2 §18.2: filled cells whose hover shows Comment alone. */
const COMMENT_ONLY_TYPES: ReadonlySet<string> = new Set(['select', 'multiSelect', 'status', 'person', 'files', 'relation']);
/** notion-spec-2 §18.2, §20.1: cells whose hover shows Copy alone. */
const COPY_ONLY_TYPES: ReadonlySet<string> = new Set(['uniqueId', 'createdTime', 'lastEditedTime']);

/** notion-spec-2 §18.3, §20.1: a click on these selects the whole row. */
const ROW_SELECT_TYPES: ReadonlySet<string> = new Set(['uniqueId', 'createdTime', 'createdBy', 'lastEditedTime', 'lastEditedBy']);

type CellAction = [action: string, key: string, icon: string];

const tableIds = { next: 0 };

/** A DOM id from row and property ids, which may hold any character. */
const idPart = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}`);

const CALC_NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, useGrouping: false });

export const formatCalculation = (
  result: CalculationResult,
  locale: string | undefined,
  options: { number?: NumberDisplay; capCounts?: boolean } = {}
): string => {
  switch (result.kind) {
    case 'number':
      if (options.capCounts === true && result.value > MAX_SHOWN_COUNT) {
        return `${MAX_SHOWN_COUNT}+`;
      }

      return options.number === undefined ? CALC_NUMBER.format(result.value) : formatNumberValue(result.value, options.number, resolveLocale(locale));
    case 'percent':
      return `${CALC_NUMBER.format(result.value)}%`;
    case 'date':
      return formatDateText(result.value, resolveLocale(locale)) ?? result.value;
    case 'dateRange': {
      const span = Date.parse(result.end) - Date.parse(result.start);
      const days = Math.round(span / 86_400_000);
      // Notion shows "8 days", and "0 minutes" for one item (research/22 §5).
      // Spans under a day in hours or minutes are unmeasured; minutes it is.
      const [value, unit] = days >= 1 ? [days, 'day'] : [Math.round(span / 60_000), 'minute'];

      return new Intl.NumberFormat(resolveLocale(locale), { style: 'unit', unit, unitDisplay: 'long' }).format(value);
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
  /** A menu opened from the selection bar: a redraw would close it and replace the bar. */
  private barMenu: PopoverDesktop | null = null;

  constructor(options: DatabaseTableViewOptions) {
    this.options = options;
    this.state = options.state ?? createTableState();
    this.columns = this.resolveColumns();
    for (const row of this.allRows()) {
      this.rowMap.set(row.id, row);
    }
  }

  /** The row checkbox clicked last: a shift-click selects from it. */
  private lastToggledRowId: string | null = null;

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
      ...(this.options.cellContext !== undefined ? { cellContext: this.options.cellContext } : {}),
      callbacks: {
        commitCell: (rowId, propertyId, value) => this.handlers?.commitCell(rowId, propertyId, value),
        ...(this.handlers?.commitReminder !== undefined
          ? { commitReminder: (rowId: string, propertyId: string, reminder: DateReminderOffset | null) => this.handlers?.commitReminder?.(rowId, propertyId, reminder) }
          : {}),
        editEnded: () => this.handlers?.editEnded(),
        deleteRows: (...args) => this.handlers?.deleteRows(...args),
        duplicateRows: (rowIds) => rowIds.forEach((rowId) => this.handlers?.duplicateRow(rowId)),
        selectionChanged: () => this.syncSelectionChrome(),
        commitCells: (changes, newRows) => this.handlers?.commitCells(changes, newRows),
        bulkEdit: (rowIds) => this.openBulkPicker(rowIds),
        rowCommand: (rowId, command) => this.rowCommand(rowId, command),
        ...(this.handlers?.optionsChange !== undefined
          ? { optionsChange: (propertyId: string, next: SelectOption[]) => this.handlers?.optionsChange?.(propertyId, next) }
          : {}),
        ...(this.handlers?.editProperty !== undefined
          ? { editProperty: (propertyId: string) => this.handlers?.editProperty?.(propertyId) }
          : {}),
        ...(this.handlers?.editFormula !== undefined
          ? { editFormula: (propertyId: string, cell: HTMLElement) => this.handlers?.editFormula?.(propertyId, cell) }
          : {}),
        dateDisplayChanger: (propertyId: string) => this.handlers?.dateDisplayChanger?.(propertyId),
      },
    });
    gridEl.addEventListener('click', this.handleNestingClick, true);
    gridEl.addEventListener('click', this.handleClick);
    if (this.options.comment !== undefined) {
      gridEl.setAttribute(DATA_ATTR.contextMenuOwner, '');
      gridEl.addEventListener('contextmenu', this.handleContextMenu);
    }
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

  /** notion-spec-2 §25.3: OPEN reads CLOSE, with the hint "Close side peek" above it (62-close-hover.png), while its row is in the side peek. */
  private paintOpen(button: HTMLElement, rowId: string): void {
    const peeked = this.options.peek?.rowId() === rowId;
    const label = button.lastElementChild;

    button.toggleAttribute('data-peeked', peeked);
    if (label !== null) label.textContent = this.t(peeked ? 'tools.database.close' : 'tools.database.tableOpen');
    if (peeked) {
      onHover(button, this.t('tools.database.closeSidePeek'), { placement: 'top' });
    } else {
      offHover(button);
    }
  }

  /** The tool calls it when a row page opens in a peek. */
  rowPageOpened(): void {
    this.repaintOpen();
  }

  /** The tool calls it when the row's peek closes. */
  rowPageClosed(): void {
    this.repaintOpen();
  }

  private repaintOpen(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-blok-database-table-open]').forEach((button) => {
      const rowId = button.closest('[data-row-id]')?.getAttribute('data-row-id');

      if (typeof rowId === 'string') this.paintOpen(button, rowId);
    });
  }

  /** CLOSE on the peeked row closes the peek; OPEN opens the row. */
  private pressOpen(button: Element, rowId: string, open: (rowId: string) => void): void {
    if (button.hasAttribute('data-peeked') && this.options.peek !== undefined) {
      this.options.peek.close();
    } else {
      open(rowId);
    }
  }

  destroy(): void {
    const bulkEditor = this.bulkEditor;

    // Its close must not ask for a redraw: this view is going.
    this.bulkGeneration++;
    this.bulkEditor = null;
    this.bulkEditing = false;
    bulkEditor?.cancel();
    this.menu?.destroy();
    this.menu = null;
    this.grid?.destroy();
    this.resize?.destroy();
    this.columnDrag?.destroy();
    this.rowDrag?.destroy();
    this.handleRelease();
    this.removeSelectionBar();
  }

  /**
   * True while an editor, a resize, a drag or a press runs. A redraw during a
   * press replaces the pressed cell, and its click never arrives.
   */
  get interacting(): boolean {
    return this.state.editing || this.state.busy || this.pressing || this.bulkEditing
      || (this.menu !== null && this.menu === this.barMenu);
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
      add.innerHTML = IconPlus;
      // Notion labels the "+" while the title is the only property.
      if (this.options.schema.every((property) => property.type === 'title')) {
        add.setAttribute('data-labelled', '');
        add.append(this.t('tools.database.tableAddProperty'));
      } else {
        add.setAttribute('aria-label', this.t('tools.database.tableAddProperty'));
      }
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
    if (property.icon !== undefined && property.icon !== '') {
      icon.textContent = property.icon;
    } else {
      icon.innerHTML = propertyTypeMeta(property.type).icon;
    }

    const name = document.createElement('span');

    name.setAttribute('data-blok-database-table-column-name', '');
    name.textContent = property.name;
    button.append(icon, name);
    cell.appendChild(button);
    // research/33 §1: a header without a description has no hint.
    if (property.description !== undefined && property.description !== '') {
      const info = document.createElement('span');

      // research/30 X2: an (i) after the name.
      info.setAttribute('data-blok-database-table-column-icon', '');
      info.setAttribute('data-blok-database-table-column-description', '');
      // Hidden so the description stays out of the header's accessible name.
      info.setAttribute('aria-hidden', 'true');
      info.innerHTML = IconInfo;
      button.appendChild(info);
      cell.setAttribute('aria-description', property.description);
      // research/31 §1: the whole cell carries one hint, left edges aligned, 6px above.
      onHover(cell, propertyHint(property.name, property.description), { placement: 'top', align: 'start', gap: 6, bare: true });
    }
    if (property.type === 'button' && this.options.buttonError?.(property) === true) {
      const warning = document.createElement('span');
      const label = this.t('tools.database.buttonError');

      // Takes the type icon's size and ink from its attribute: no rule of its own.
      warning.setAttribute('data-blok-database-table-column-icon', '');
      warning.setAttribute('data-blok-database-button-error', '');
      warning.setAttribute('role', 'img');
      warning.setAttribute('aria-label', label);
      warning.innerHTML = IconWarning;
      button.appendChild(warning);
      onHover(warning, label);
    }
    if (this.options.autofill !== undefined && property.autofill !== undefined) {
      const sparkle = document.createElement('button');

      sparkle.type = 'button';
      sparkle.tabIndex = -1;
      sparkle.setAttribute('data-blok-database-table-autofill-open', '');
      sparkle.setAttribute('aria-label', this.t('tools.database.aiAutofillProperty', { name: property.name }));
      sparkle.innerHTML = IconWand;
      // Beside the header button, not in it: a button in a button, and its label would join the header's name.
      cell.appendChild(sparkle);
    }

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
    // Open parents waiting for their "+ New sub-item" line, deepest last.
    const open: Array<{ id: string; depth: number }> = [];
    const closeTo = (depth: number): void => {
      while (open.length > 0 && open[open.length - 1].depth >= depth) {
        const parent = open.pop();

        if (parent !== undefined) body.appendChild(this.createAddSubItem(parent.id, parent.depth + 1));
      }
    };

    for (const row of rows.slice(0, shown)) {
      const info = this.options.nesting?.info(row.id);

      closeTo(info?.depth ?? 0);
      body.appendChild(this.createRow(row, groupKey));
      if (info?.expanded === true && this.editable && this.options.nesting?.addSubItem !== undefined) {
        open.push({ id: row.id, depth: info.depth });
      }
    }
    closeTo(0);
    fragment.appendChild(body);

    if (rows.length === 0 && group === undefined && (this.options.view.filters.length > 0 || this.handlers?.searching?.() === true)) {
      fragment.appendChild(this.createEmptyState());

      return fragment;
    }
    if (rows.length === 0 && group === undefined) {
      if (this.editable) {
        fragment.appendChild(this.createBlankLine(this.createAddRow(groupKey)));
      }
      fragment.append(this.createBlankLine(null), this.createBlankLine(null));
      fragment.appendChild(this.createFooter(rows));

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

  /**
   * One line of Notion's empty grid: column-sized blank cells with the grid
   * lines. Not a row, so the keyboard, selection and row count skip it.
   */
  private createBlankLine(content: HTMLElement | null): HTMLElement {
    const line = document.createElement('div');

    line.setAttribute('data-blok-database-table-blank-row', '');
    if (content === null) {
      line.setAttribute('aria-hidden', 'true');
    }
    this.columns.forEach((column, index) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-database-table-blank-cell', '');
      this.sizeCell(cell, column);
      if (index === 0 && content !== null) {
        cell.appendChild(content);
      } else if (content !== null) {
        cell.setAttribute('aria-hidden', 'true');
      }
      line.appendChild(cell);
    });
    line.appendChild(this.createFiller());

    return line;
  }

  private createAddSubItem(parentId: string, depth: number): HTMLElement {
    const line = document.createElement('div');
    const add = document.createElement('button');
    const icon = document.createElement('span');

    const cell = document.createElement('div');

    // A row of the grid's rowgroup, so the grid's children stay rows; the
    // grid's own keyboard reads only data-blok-database-table-row.
    line.setAttribute('role', 'row');
    line.setAttribute('data-blok-database-add-subitem', '');
    line.setAttribute('data-parent-id', parentId);
    line.style.setProperty('--blok-database-subitem-depth', String(depth));
    cell.setAttribute('role', 'gridcell');
    add.type = 'button';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = IconPlus;
    add.append(icon, this.t('tools.database.subItemsNew'));
    cell.appendChild(add);
    line.appendChild(cell);

    return line;
  }

  private createEmptyState(): HTMLElement {
    const empty = document.createElement('div');

    empty.setAttribute('data-blok-database-table-empty', '');
    const edit = document.createElement('button');
    const searching = this.handlers?.searching?.() === true;

    edit.type = 'button';
    edit.setAttribute(searching ? 'data-blok-database-table-clear-search' : 'data-blok-database-table-edit-filters', '');
    edit.textContent = this.t(searching ? 'tools.database.searchClear' : 'tools.database.tableEditFilters');
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
    const nested = this.options.nesting?.info(row.id);

    if (nested !== undefined) {
      rowEl.setAttribute('data-subitem-depth', String(nested.depth));
      rowEl.style.setProperty('--blok-database-subitem-depth', String(nested.depth));
    }

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
    const value = renderCellValue(column.property, readPropertyValue(row, column.property), {
      ...this.options.cellContext,
      i18n: this.options.i18n,
      readOnly: this.options.readOnly,
      followLinks: true,
      shortUrls: true,
      ...rowCellContext(row, column.property.id),
      ...(this.options.locale !== undefined ? { locale: this.options.locale } : {}),
    });

    const fillHandle = cell.querySelector('[data-blok-database-table-fill-handle]');

    cell.replaceChildren(value);
    if (column.property.type === 'files') {
      value.querySelectorAll<HTMLElement>('[data-blok-database-file-chip]').forEach((chip) => {
        chip.prepend(fileChipIcon());
        const link = chip.querySelector<HTMLAnchorElement>('[data-blok-database-cell-link]');

        if (link !== null) {
          // Owned: core shows no link card and opens nothing on a plain click; Cmd/Ctrl-click follows target=_blank.
          link.setAttribute(DATA_ATTR.linkOwner, '');
        }
        bindFileNameHint(chip);
      });
    }

    const icon = column.property.type === 'title' && showsPageIcon(this.options.view) ? pageIconElement(row) ?? pagePlaceholderIcon() : null;

    if (icon !== null) {
      cell.insertBefore(icon, value);
    }
    const nested = column.property.type === 'title' ? this.options.nesting?.info(rowId) : undefined;

    if (nested !== undefined) {
      cell.insertBefore(this.createSubItemToggle(nested), cell.firstChild);
    }
    if (column.property.type === 'title' && this.options.commentBadges !== undefined) {
      syncCommentBadge(value, rowId, this.options.commentBadges, this.options.i18n, { tabIndex: -1 });
    }

    if (column.property.type === 'title' && (this.handlers !== undefined || this.options.openRow !== undefined)) {
      const open = document.createElement('button');

      open.type = 'button';
      open.setAttribute('data-blok-database-table-open', '');
      open.tabIndex = -1;
      // The grid points the selected cell's aria-describedby here; a repaint must keep the id.
      open.id = `${cell.id}-open`;
      const icon = document.createElement('span');

      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = IconSplitView;
      open.append(icon, document.createElement('span'));
      this.paintOpen(open, rowId);
      cell.appendChild(open);
    }
    const run = this.createAutofillButton(cell, column.property, rowId, value);
    // A checkbox never carries data-empty, so unchecked counts as unfilled here.
    const filled = cell.contains(value) && !value.hasAttribute('data-empty')
      && (column.property.type !== 'checkbox' || readPropertyValue(row, column.property) === true);

    // A title cell's corner belongs to OPEN, so its Autofill stays alone.
    if (run !== null && filled && column.property.type !== 'title') {
      cell.appendChild(this.createCellActions(this.hoverActions('text'), run));
    } else if (run !== null) {
      cell.appendChild(run);
    } else if (filled && !value.hasAttribute('data-formula-error')) {
      const entries = this.hoverActions(column.property.type);

      if (entries.length > 0) cell.appendChild(this.createCellActions(entries));
    }
    if (fillHandle !== null) cell.appendChild(fillHandle);
  }

  /** research/16 §4, notion-spec-2 §18.2: the buttons a filled cell's hover box holds, by type. */
  private hoverActions(type: string): CellAction[] {
    const comment: CellAction[] = this.options.comment === undefined ? [] : [['comment', 'tools.database.tableComment', IconMessage]];
    const copy: CellAction[] = [['copy', 'tools.database.cellCopy', IconCopy]];

    if (COPY_PILL_TYPES.has(type)) return [...comment, ...copy];
    if (COMMENT_ONLY_TYPES.has(type)) return comment;
    if (COPY_ONLY_TYPES.has(type)) return copy;
    if (type !== 'rollup') return [];
    const configure: CellAction[] = this.options.readOnly || this.handlers?.configureRollup === undefined
      ? []
      : [['configure', 'tools.database.rollupConfigure', IconPencilLine]];

    return [...configure, ...copy];
  }

  /** research/12 §2: a filled autofill cell puts its Autofill button first. */
  private createCellActions(entries: CellAction[], autofill?: HTMLElement): HTMLElement {
    const pill = document.createElement('span');

    pill.setAttribute('data-blok-database-table-cell-actions', autofill === undefined ? '' : 'autofill');
    if (autofill !== undefined) pill.appendChild(autofill);
    for (const [action, key, icon] of entries) {
      const button = document.createElement('button');

      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('data-blok-database-table-cell-action', action);
      button.setAttribute('aria-label', this.t(key));
      button.innerHTML = icon;
      onHover(button, this.t(key));
      pill.appendChild(button);
    }

    return pill;
  }

  /** A link click follows the link; a pill button acts. Either way the cell neither selects nor edits. */
  private clickCellAction(target: Element): boolean {
    const cellEl = target.closest<HTMLElement>('[role="gridcell"]');
    const rowId = cellEl?.closest('[data-row-id]')?.getAttribute('data-row-id');

    if (cellEl === null || cellEl === undefined || rowId === null || rowId === undefined) {
      return false;
    }
    const propertyId = cellEl.getAttribute('data-property-id') ?? '';
    const action = target.closest('[data-blok-database-table-cell-action]')?.getAttribute('data-blok-database-table-cell-action');

    if (action === 'comment') {
      this.options.comment?.(rowId, propertyId, cellEl);
    } else if (action === 'copy') {
      this.copyCellValue(rowId, propertyId);
    } else if (action === 'configure') {
      this.handlers?.configureRollup?.(propertyId, cellEl);
    }

    return action !== undefined
      || (LINK_TYPES.has(cellEl.getAttribute('data-type') ?? '') && target.closest('a[data-blok-database-cell-link]') !== null);
  }

  private copyCellValue(rowId: string, propertyId: string): void {
    const property = this.columns.find((column) => column.property.id === propertyId)?.property;
    const row = this.rowMap.get(rowId);
    const text = property === undefined || row === undefined ? '' : cellText(property, readPropertyValue(row, property), this.options.cellContext);

    if (text === '') return;
    void navigator.clipboard?.writeText(text).then(
      () => this.options.notify?.(this.t('tools.database.cellCopied')),
      () => undefined
    );
  }

  /** Swaps in Thinking… while a run is in flight; otherwise returns the cell's Autofill button, not yet placed. */
  private createAutofillButton(cell: HTMLElement, property: PropertyDefinition, rowId: string, value: HTMLElement): HTMLElement | null {
    const autofill = this.options.autofill;

    if (autofill === undefined || property.autofill === undefined) return null;
    if (autofill.filling(rowId, property.id)) {
      const thinking = document.createElement('span');

      thinking.setAttribute('data-blok-database-table-autofill-thinking', '');
      thinking.textContent = this.t('tools.database.aiAutofillThinking');
      value.replaceWith(thinking);

      return null;
    }
    const run = document.createElement('button');

    run.type = 'button';
    run.tabIndex = -1;
    run.setAttribute('data-blok-database-table-autofill', '');
    run.id = `${cell.id}-autofill`;
    run.setAttribute('aria-label', this.t('tools.database.aiAutofillCell'));
    run.innerHTML = IconWand;
    onHover(run, this.t('tools.database.aiAutofillCell'));

    return run;
  }

  private createSubItemToggle(nested: { hasChildren: boolean; expanded: boolean }): HTMLElement {
    const toggle = document.createElement('button');

    toggle.type = 'button';
    toggle.tabIndex = -1;
    toggle.setAttribute('data-blok-database-subitem-toggle', '');
    toggle.setAttribute('aria-expanded', String(nested.expanded));
    toggle.setAttribute('aria-label', this.t(nested.expanded ? 'tools.database.subItemsCollapse' : 'tools.database.subItemsExpand'));
    toggle.toggleAttribute('data-empty', !nested.hasChildren);
    toggle.innerHTML = IconChevronRight;

    return toggle;
  }

  /** Capture: a toggle or "+ New sub-item" press must not select or edit the cell under it. */
  private readonly handleNestingClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest('[data-blok-database-subitem-toggle]') ?? null;
    const add = target?.closest('[data-blok-database-add-subitem]') ?? null;
    const nesting = this.options.nesting;

    if (nesting === undefined || (toggle === null && add === null)) return;
    event.stopPropagation();
    event.preventDefault();
    const rowId = toggle?.closest('[data-row-id]')?.getAttribute('data-row-id');
    const parentId = add?.getAttribute('data-parent-id');

    if (typeof rowId === 'string') {
      nesting.toggle(rowId);
    } else if (typeof parentId === 'string') {
      nesting.addSubItem?.(parentId);
    }
  };

  private readonly handleRepaint = (event: Event): void => {
    const cell = event.target;
    const rowId = cell instanceof HTMLElement ? cell.closest('[data-row-id]')?.getAttribute('data-row-id') : null;

    if (!(cell instanceof HTMLElement) || typeof rowId !== 'string') return;
    const update = event instanceof CustomEvent ? (event.detail as { propertyId?: unknown; value?: PropertyValue } | null) : null;
    const row = this.rowMap.get(rowId);

    // Only the one property: the row may hold computed values the store lacks.
    if (row !== undefined && typeof update?.propertyId === 'string' && update.value !== undefined) {
      this.rowMap.set(rowId, { ...row, properties: { ...row.properties, [update.propertyId]: update.value } });
    }
    this.fillCell(cell, rowId);
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

  /** A formula or rollup as its result type, for calculations; any other property as is. */
  private shown(property: PropertyDefinition): PropertyDefinition {
    return this.options.cellContext?.valueProperty?.(property) ?? property;
  }

  private shownSchema(): PropertyDefinition[] {
    return this.options.schema.map((property) => this.shown(property));
  }

  // ─── Footer ───

  private createFooter(rows: DatabaseRow[]): HTMLElement {
    const footer = document.createElement('div');
    const calculations = resolveCalculations(this.options.view, this.shownSchema());
    const caps = resolveCountCaps(this.options.view);

    footer.setAttribute('data-blok-database-table-footer', '');
    if (this.editable) {
      footer.appendChild(this.createGutter());
    }
    for (const column of this.columns) {
      const fn = calculations.get(column.property.id);
      const cell = document.createElement(this.editable && column.property.type !== 'button' ? 'button' : 'div');

      cell.setAttribute('data-blok-database-table-calc', '');
      cell.setAttribute('data-property-id', column.property.id);
      cell.setAttribute('data-type', column.property.type);
      if (cell instanceof HTMLButtonElement) {
        cell.type = 'button';
      }
      this.sizeCell(cell, column);

      fillCalculationCell(cell, {
        fn, property: column.property, shown: this.shown(column.property), rows, i18n: this.options.i18n, locale: this.options.locale, capCounts: caps.has(column.property.id),
      });
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
      this.removeSelectionBar();

      return;
    }
    if (this.bar === null) {
      const slot = this.options.selectionBarSlot?.() ?? null;

      this.bar = this.createSelectionBar();
      if (slot === null) {
        root.insertBefore(this.bar, root.firstChild);
      } else {
        slot.appendChild(this.bar);
        slot.setAttribute('data-blok-database-selecting', 'table');
      }
    }
    const count = this.bar.querySelector('[data-blok-database-table-selection-count]');

    if (count !== null) {
      count.textContent = this.t('tools.database.tableSelectedCount', { count: rowIds.length });
    }
  }

  /** The bar can live outside the table root, so it never leaves with it. */
  private removeSelectionBar(): void {
    this.bar?.parentElement?.removeAttribute('data-blok-database-selecting');
    this.bar?.remove();
    this.bar = null;
  }

  private createSelectionBar(): HTMLElement {
    const bar = document.createElement('div');

    bar.setAttribute('data-blok-database-table-selection-bar', '');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', this.t('tools.database.tableSelectionActions'));
    const count = document.createElement('span');

    count.setAttribute('data-blok-database-table-selection-count', '');
    count.setAttribute('aria-live', 'polite');

    const propertyButtons = this.bulkProperties().slice(0, SELECTION_BAR_SEGMENTS).map(selectionPropertyButton);
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

    bar.append(count, ...propertyButtons, trash, more);
    // A press here closes an open bulk picker; its redraw must wait for the click.
    bar.addEventListener('pointerdown', this.handlePress);
    bar.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const rowIds = this.grid?.selectedRowIds() ?? [];
      const propertyButton = target?.closest<HTMLElement>('[data-blok-database-table-selection-property]');

      if (propertyButton !== null && propertyButton !== undefined) {
        this.openBulkEditor(rowIds, propertyButton.getAttribute('data-property-id') ?? '', propertyButton);
      } else if (target?.closest('[data-blok-database-table-selection-delete]') != null) {
        this.state.selection = null;
        this.handlers?.deleteRows(rowIds);
        this.grid?.paint();
      } else if (target?.closest('[data-blok-database-table-selection-more]') != null) {
        this.openSelectionMenu(rowIds, more);
      }
    });

    return bar;
  }

  // ─── Bulk edit ───

  /** Visible properties a bulk edit can write: no title, nothing computed. */
  private bulkProperties(): PropertyDefinition[] {
    return this.columns.map((c) => c.property).filter((property) => property.type !== 'title' && !isReadOnlyType(property.type));
  }

  private bulkEditor: CellEditorHandle | null = null;
  private bulkEditing = false;
  /** Bumped per bulk picker: a replaced or torn-down picker's close changes nothing. */
  private bulkGeneration = 0;

  /** One property's cell editor, anchored on its bar button; the value lands on every selected row. */
  private openBulkEditor(rowIds: string[], propertyId: string, anchor: HTMLElement): void {
    const property = this.columns.find((c) => c.property.id === propertyId)?.property;
    const handlers = this.handlers;

    if (property === undefined || handlers === undefined || rowIds.length === 0) {
      return;
    }
    const generation = ++this.bulkGeneration;

    // The table redraws only once the picker closes: a redraw would take its bar button away.
    this.bulkEditing = true;
    this.bulkEditor?.close();
    const written = { any: false };
    const closeKey = watchBulkCloseKey();
    const before = rowIds.map((rowId) => this.rowMap.get(rowId));
    const showDraft = (text: string): void => {
      rowIds.forEach((rowId) => {
        const row = this.rowMap.get(rowId);

        if (row !== undefined) this.rowMap.set(rowId, { ...row, properties: { ...row.properties, [propertyId]: text } });
      });
      repaint();
    };
    const repaint = (): void => rowIds.forEach((rowId) => this.root
      ?.querySelector(`[data-blok-database-table-row][data-row-id="${CSS.escape(rowId)}"] [role="gridcell"][data-property-id="${CSS.escape(propertyId)}"]`)
      ?.dispatchEvent(new CustomEvent('blok-database-table-repaint', { bubbles: true })));
    const changeDisplay = property.type === 'date' ? handlers.dateDisplayChanger?.(propertyId) : undefined;
    const handle = openCellEditor(property, bulkStartValue(property, rowIds.map((rowId) => this.rowMap.get(rowId))), anchor, {
      ...this.options.cellContext,
      i18n: this.options.i18n,
      readOnly: false,
      options: property.config?.options ?? [],
      ...(this.options.locale !== undefined ? { locale: this.options.locale } : {}),
      ...(handlers.optionsChange !== undefined
        ? { onOptionsChange: (next: SelectOption[]) => handlers.optionsChange?.(propertyId, next) }
        : {}),
      ...(handlers.editProperty !== undefined ? { onEditProperty: () => handlers.editProperty?.(propertyId) } : {}),
      ...(property.type === 'date' ? { bulk: true } : {}),
      ...(changeDisplay !== undefined
        ? { onDateDisplayChange: (change: DateDisplayChange) => {
          written.any = true;
          changeDisplay(change);
        } }
        : {}),
      ...(property.type === 'date' && handlers.commitBulkReminder !== undefined
        ? { onReminderChange: (next: DateReminderOffset | null, picked: boolean) => {
          (handlers.commitBulkReminder?.(rowIds, propertyId, next, picked) ?? []).forEach((rowId) => {
            const row = this.rowMap.get(rowId);
            const { [propertyId]: _old, ...others } = row?.reminders ?? {};

            if (row !== undefined) this.rowMap.set(rowId, { ...row, reminders: next === null ? others : { ...others, [propertyId]: { remind: next } } });
          });
          repaint();
        } }
        : {}),
      // research/31 §4b: the cells show each key; the write waits for the close, so it is one undo step.
      ...(property.type === 'text' ? { onDraft: showDraft } : {}),
      onCommit: (value) => {
        written.any = true;
        rowIds.forEach((rowId) => {
          const row = this.rowMap.get(rowId);

          if (row !== undefined) this.rowMap.set(rowId, { ...row, properties: { ...row.properties, [propertyId]: value } });
        });
        handlers.commitCells(rowIds.map((rowId) => ({ rowId, propertyId, value })), [], true);
        repaint();
      },
      onClose: () => {
        closeKey.stop();
        if (generation !== this.bulkGeneration) return;
        if (!written.any && property.type === 'text') {
          before.forEach((row) => { if (row !== undefined) this.rowMap.set(row.id, row); });
          repaint();
        }
        this.bulkEditing = false;
        this.bulkEditor = null;
        if (bulkCloseClearsSelection(property.type, closeKey.key(), written.any)) {
          this.state.selection = null;
          this.grid?.paint();
        }
        if (written.any) handlers.editEnded();
      },
    });

    this.bulkEditor = handle.isOpen ? handle : null;
    if (!handle.isOpen) closeKey.stop();
  }

  /** Cmd/Ctrl+/: the properties to edit on every selected row. */
  private openBulkPicker(rowIds: string[]): void {
    const anchor = this.bar ?? this.gridEl;

    if (anchor === null || rowIds.length === 0) {
      return;
    }
    this.showMenu(anchor, this.bulkProperties().map((property) => ({
      name: `database-bulk-edit-${property.id}`,
      title: property.name,
      icon: propertyTypeMeta(property.type).icon,
      closeOnActivate: true,
      onActivate: () => {
        const button = this.bar?.querySelector<HTMLElement>(`[data-blok-database-table-selection-property][data-property-id="${property.id}"]`);

        this.openBulkEditor(rowIds, property.id, button ?? anchor);
      },
    })), { searchable: true });
    this.barMenu = this.menu;
  }

  /** The bar's "…": Duplicate and Move to Trash. */
  private openSelectionMenu(rowIds: string[], anchor: HTMLElement): void {
    const handlers = this.handlers;

    if (handlers === undefined) {
      return;
    }
    // The properties past the bar's segments are edited from here.
    const rest = this.bulkProperties().slice(SELECTION_BAR_SEGMENTS).map((property): PopoverItemParams => ({
      name: `database-table-selection-edit-${property.id}`,
      title: property.name,
      icon: propertyTypeMeta(property.type).icon,
      closeOnActivate: true,
      onActivate: () => this.openBulkEditor(rowIds, property.id, anchor),
    }));

    this.showMenu(anchor, [
      ...rest,
      ...(rest.length > 0 ? [{ type: PopoverItemType.Separator } as const] : []),
      {
        name: 'database-table-selection-duplicate',
        title: this.t('tools.database.tableDuplicate'),
        icon: IconCopy,
        closeOnActivate: true,
        onActivate: () => rowIds.forEach((rowId) => handlers.duplicateRow(rowId)),
      },
      {
        name: 'database-table-selection-delete',
        title: this.t('tools.database.tableMoveToTrash'),
        icon: IconTrash,
        closeOnActivate: true,
        onActivate: () => {
          this.state.selection = null;
          handlers.deleteRows(rowIds);
          this.grid?.paint();
        },
      },
    ]);
    this.barMenu = this.menu;
  }

  // ─── Clicks ───

  /** A right-click on a cell opens its comments. It stops here so core's block menu does not replace it. */
  private readonly handleContextMenu = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest<HTMLElement>('[data-blok-database-table-cell]');
    const rowId = cell?.closest('[data-row-id]')?.getAttribute('data-row-id');

    if (cell === null || cell === undefined || rowId === null || rowId === undefined || this.options.comment === undefined) return;
    event.preventDefault();
    this.options.comment(rowId, cell.getAttribute('data-property-id') ?? undefined, cell);
  };

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const handlers = this.handlers;

    if (target === null) {
      return;
    }
    if (this.clickCellAction(target)) {
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
      if (this.options.readOnly) {
        this.clickReadOnlyCell(target, event);
      }

      return;
    }
    if (closest('[data-blok-database-table-clear-search]') !== null) {
      handlers.clearSearch?.();

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

    const openButton = target.closest('[data-blok-database-table-open]');

    if (openButton !== null && typeof rowId === 'string') {
      this.pressOpen(openButton, rowId, (id) => (this.handlers?.openRow ?? this.options.openRow)?.(id));

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
    const calc = closest('button[data-blok-database-table-calc]');

    if (calc !== null) {
      this.openCalculationMenu(calc);

      return;
    }
    const sparkle = closest('[data-blok-database-table-autofill-open]');

    if (sparkle !== null) {
      this.options.autofill?.open(closest('[data-blok-database-table-column-header]')?.getAttribute('data-property-id') ?? '', sparkle);

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
      if (event.shiftKey && this.lastToggledRowId !== null) {
        this.grid?.selectRowRange(this.lastToggledRowId, rowId);
      } else {
        this.grid?.toggleRow(rowId);
      }
      this.lastToggledRowId = rowId;

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
      this.pressOpen(closest('[data-blok-database-table-open]') as HTMLElement, rowId, (id) => handlers.openRow(id));

      return;
    }
    const run = closest('[data-blok-database-table-autofill]');

    if (run !== null) {
      this.options.autofill?.run(rowId, closest('[role="gridcell"]')?.getAttribute('data-property-id') ?? '');

      return;
    }
    const cellEl = closest('[role="gridcell"]');
    const propertyId = cellEl?.getAttribute('data-property-id');

    if (ROW_SELECT_TYPES.has(cellEl?.getAttribute('data-type') ?? '') && !event.shiftKey) {
      this.grid?.selectRows([rowId]);

      return;
    }
    // notion-spec-2 §18.3, §20.11: a click opens the setup menu. Whether Notion also selects the cell is unmeasured.
    if (cellEl !== null && typeof propertyId === 'string' && cellEl.getAttribute('data-type') === 'rollup' && !event.shiftKey && handlers?.configureRollup !== undefined) {
      this.grid?.clickCell({ rowId, propertyId }, false);
      handlers.configureRollup(propertyId, cellEl);

      return;
    }
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

  private showMenu(anchor: HTMLElement, items: PopoverItemParams[], options: Omit<OpenMenuOptions, 'onClose'> = {}): void {
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
    const current = resolveCalculations(this.options.view, this.shownSchema()).get(propertyId);

    this.showMenu(anchor, calculationItems(this.shown(property), current, this.options.i18n, (fn: CalculationFn | null) => {
      this.handlers?.updateView({ calculations: withCalculation(this.options.view, propertyId, fn) });
    }, this.countCap(propertyId)));
  }

  private countCap(propertyId: string): CountCap {
    return {
      capCounts: resolveCountCaps(this.options.view).has(propertyId),
      onCapCounts: (cap) => this.handlers?.updateView({ calculations: withCalculationCap(this.options.view, propertyId, cap) }),
    };
  }

  /** ⌘⇧M and ⌘⇧P on one selected row: what the row menu's Comment and Move to do. */
  private rowCommand(rowId: string, command: 'comment' | 'moveTo'): boolean {
    const handlers = this.handlers;
    const anchor = this.root?.querySelector<HTMLElement>(`[data-blok-database-table-row][data-row-id="${CSS.escape(rowId)}"]`);
    const comment = this.options.comment;

    if (anchor === null || anchor === undefined || handlers === undefined) return false;
    if (command === 'comment') {
      if (comment === undefined) return false;
      comment(rowId, undefined, anchor);

      return true;
    }
    const targets = handlers.moveRowTo === undefined || this.options.readOnly ? [] : handlers.moveTargets?.() ?? [];

    if (targets.length === 0) return false;
    this.showMenu(anchor, moveTargetItems(this.options.i18n, targets, (databaseId) => handlers.moveRowTo?.(rowId, databaseId)), { searchable: true });

    return true;
  }

  private openRowMenu(anchor: HTMLElement, rowId: string): void {
    const handlers = this.handlers;

    if (handlers === undefined) {
      return;
    }
    this.grid?.selectRows([rowId]);
    const favorite = this.options.favorite?.(rowId);

    this.showMenu(anchor, rowMenuItems({
      i18n: this.options.i18n,
      ...(favorite !== undefined ? { favorite } : {}),
      properties: this.columns.map((c) => c.property).filter((p) => p.type !== 'title'),
      onEditIcon: () => handlers.editRowIcon(rowId),
      onEditProperty: (propertyId) => {
        const ref = { rowId, propertyId };

        this.state.selection = { kind: 'cell', anchor: ref, focus: ref };
        this.grid?.paint();
        this.grid?.openEditor(ref);
      },
      onOpenIn: (mode) => handlers.openRow(rowId, mode),
      onCopyLink: () => handlers.copyRowLink(rowId),
      onDuplicate: () => handlers.duplicateRow(rowId),
      ...(handlers.moveRowTo !== undefined ? { moveTargets: handlers.moveTargets?.() ?? [], onMoveTo: (databaseId: string) => handlers.moveRowTo?.(rowId, databaseId) } : {}),
      ...rowMenuFooter({
        row: this.allRows().find((row) => row.id === rowId),
        titlePropertyId: this.options.titlePropertyId,
        // "Today at {time}" is in the editor's language, so its time is too.
        locale: this.options.locale ?? editorLocale(this.options.i18n),
        ...(this.options.cellContext?.people !== undefined ? { people: this.options.cellContext.people } : {}),
        ...(this.options.cellContext?.now !== undefined ? { now: this.options.cellContext.now } : {}),
        ...(this.options.cellContext?.hourCycle !== undefined ? { hourCycle: this.options.cellContext.hourCycle } : {}),
        i18n: this.options.i18n,
      }),
      ...(this.options.comment !== undefined ? { onComment: () => this.options.comment?.(rowId, undefined, anchor) } : {}),
      onDelete: () => {
        this.state.selection = null;
        handlers.deleteRows([rowId]);
      },
    }), { searchable: true, searchPlaceholder: this.t('tools.database.searchActions'), kind: 'row' });
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
      property: this.shown(column.property),
      frozenHere: frozen === index + 1,
      wrapped: column.wrap,
      showPageIcon: showsPageIcon(view),
      calculation: resolveCalculations(view, this.shownSchema()).get(propertyId),
      countCap: this.countCap(propertyId),
      onFilter: () => handlers.viewAction('filter', propertyId, anchor),
      onSort: () => handlers.viewAction('sort', propertyId, anchor),
      onGroup: () => handlers.viewAction('group', propertyId, anchor),
      onCalculate: (fn) => handlers.updateView({ calculations: withCalculation(view, propertyId, fn) }),
      onFreeze: () => handlers.updateView({ frozenColumnCount: index + 1 }),
      onUnfreeze: () => handlers.updateView({ frozenColumnCount: 0 }),
      onHide: () => handlers.updateView({ properties: withPropertySetting(view, schema, propertyId, { visible: false }) }),
      onWrap: (wrap) => handlers.updateView({ properties: withPropertySetting(view, schema, propertyId, { wrap }) }),
      onShowPageIcon: (showPageIcon) => handlers.updateView({ showPageIcon }),
      onInsert: (side) => handlers.addProperty(anchor, { propertyId, side }),
    });
  }

  openHeaderMenu(propertyId: string, anchor: HTMLElement): void {
    const items = this.headerItems(propertyId, anchor);

    if (items.length > 0) {
      this.showMenu(anchor, items, { kind: 'header' });
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
    // The header button fills its column, so its current width is never less
    // than the column. Its max-content width is what the content needs.
    const contentWidth = (el: HTMLElement): number => {
      const { style } = el;
      const width = style.width;

      style.width = 'max-content';
      const measured = el.getBoundingClientRect().width;

      style.width = width;
      // The AI Autofill sparkle sits beside the header button, not in it.
      const sparkle = el.parentElement?.querySelector<HTMLElement>(':scope > [data-blok-database-table-autofill-open]');

      return sparkle === null || sparkle === undefined
        ? measured
        : measured + sparkle.getBoundingClientRect().width + (parseFloat(getComputedStyle(sparkle).marginInlineEnd) || 0);
    };
    // Cell padding is 8px a side.
    const widest = Math.max(0, ...cells.map(contentWidth)) + 16;

    return Math.max(MIN_COLUMN_WIDTH, Math.ceil(widest));
  }
}
