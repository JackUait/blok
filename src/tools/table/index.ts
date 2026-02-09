import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  HTMLPasteEvent,
  PasteConfig,
  ToolboxConfig,
} from '../../../types';
import type { ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { DATA_ATTR } from '../../components/constants';
import { IconTable } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';

import { TableAddControls } from './table-add-controls';
import { TableCellBlocks } from './table-cell-blocks';
import { TableCellSelection } from './table-cell-selection';
import { TableGrid } from './table-core';
import {
  applyPixelWidths,
  computeHalfAvgWidth,
  computeInsertColumnWidths,
  deleteColumnWithBlockCleanup,
  deleteRowWithBlockCleanup,
  enableScrollOverflow,
  getBlockIdsInColumn,
  getBlockIdsInRow,
  isColumnEmpty,
  isRowEmpty,
  mountCellBlocksReadOnly,
  normalizeTableData,
  populateNewCells,
  readPixelWidths,
  setupKeyboardNavigation,
  syncColWidthsAfterMove,
  updateHeadingColumnStyles,
  updateHeadingStyles,
} from './table-operations';
import { TableResize } from './table-resize';
import { TableRowColControls } from './table-row-col-controls';
import type { RowColAction } from './table-row-col-controls';
import type { TableData, TableConfig } from './types';

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

const WRAPPER_CLASSES = [
  'my-2',
  'pr-5',
];

const WRAPPER_EDIT_CLASSES = [
  'relative',
];

/**
 * Table block tool for the Blok Editor.
 * Renders a 2D grid of contentEditable cells.
 */
export class Table implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private config: TableConfig;
  private data: TableData;
  private grid: TableGrid;
  private resize: TableResize | null = null;
  private addControls: TableAddControls | null = null;
  private rowColControls: TableRowColControls | null = null;
  private cellBlocks: TableCellBlocks | null = null;
  private cellSelection: TableCellSelection | null = null;
  private element: HTMLDivElement | null = null;
  private blockId: string | undefined;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<TableData, TableConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config ?? {};
    this.data = normalizeTableData(data, config ?? {});
    this.grid = new TableGrid({ readOnly });
    this.blockId = block?.id;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconTable,
      title: 'Table',
      titleKey: 'tools.table.title',
      searchTerms: ['table', 'grid', 'spreadsheet'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get enableLineBreaks(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['TABLE', 'TR', 'TH', 'TD'],
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      content: {
        br: true,
        b: true,
        i: true,
        a: { href: true },
        input: { type: true, checked: true },
      },
    };
  }

  public render(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge(WRAPPER_CLASSES, !this.readOnly && WRAPPER_EDIT_CLASSES, this.data.colWidths && 'overflow-x-auto');
    wrapper.setAttribute(DATA_ATTR.tool, 'table');

    if (this.readOnly) {
      wrapper.setAttribute('data-blok-table-readonly', '');
    }

    const rows = this.data.content.length || this.config.rows || DEFAULT_ROWS;
    const cols = this.data.content[0]?.length || this.config.cols || DEFAULT_COLS;

    const gridEl = this.grid.createGrid(rows, cols, this.data.colWidths);

    if (this.data.content.length > 0) {
      this.grid.fillGrid(gridEl, this.data.content);
    }

    if (this.data.colWidths) {
      applyPixelWidths(gridEl, this.data.colWidths);
    }

    wrapper.appendChild(gridEl);
    this.element = wrapper;

    if (this.data.withHeadings) {
      updateHeadingStyles(this.element, this.data.withHeadings);
    }

    if (this.data.withHeadingColumn) {
      updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
    }

    if (!this.readOnly) {
      this.initCellBlocks(gridEl);
      setupKeyboardNavigation(gridEl, this.cellBlocks);
    }

    return wrapper;
  }

  public rendered(): void {
    if (!this.element) {
      return;
    }

    const gridEl = this.element.firstElementChild as HTMLElement;

    if (!gridEl) {
      return;
    }

    if (this.readOnly) {
      mountCellBlocksReadOnly(gridEl, this.data.content, this.api);

      return;
    }

    this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;

    this.initResize(gridEl);
    this.initAddControls(gridEl);
    this.initRowColControls(gridEl);
    this.initCellSelection(gridEl);
  }

  public save(blockContent: HTMLElement): TableData {
    const gridEl = blockContent.firstElementChild as HTMLElement;
    const colWidths = this.data.colWidths;
    const content = this.readOnly
      ? this.data.content
      : this.grid.getData(gridEl);

    return {
      withHeadings: this.data.withHeadings,
      withHeadingColumn: this.data.withHeadingColumn,
      stretched: this.data.stretched,
      content,
      ...(colWidths ? { colWidths } : {}),
    };
  }

  public validate(savedData: TableData): boolean {
    return savedData.content.length > 0;
  }

  public renderSettings(): MenuConfig {
    return [
      {
        icon: IconTable,
        title: this.api.i18n.t(this.data.withHeadings
          ? 'tools.table.withoutHeadings'
          : 'tools.table.withHeadings'),
        onActivate: (): void => {
          this.data.withHeadings = !this.data.withHeadings;
          updateHeadingStyles(this.element, this.data.withHeadings);
        },
        closeOnActivate: true,
        isActive: this.data.withHeadings,
      },
    ];
  }

  public onPaste(event: HTMLPasteEvent): void {
    const content = event.detail.data;
    const rows = content.querySelectorAll('tr');
    const tableContent: string[][] = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td, th');
      const rowData: string[] = [];

      cells.forEach(cell => {
        rowData.push(cell.innerHTML);
      });

      if (rowData.length > 0) {
        tableContent.push(rowData);
      }
    });

    const hasTheadHeadings = content.querySelector('thead') !== null;
    const hasThHeadings = rows[0]?.querySelector('th') !== null;
    const withHeadings = hasTheadHeadings || hasThHeadings;

    this.data = {
      withHeadings,
      withHeadingColumn: this.data.withHeadingColumn,
      stretched: this.data.stretched,
      content: tableContent,
    };

    if (!this.element?.parentNode) {
      return;
    }

    const newElement = this.render();

    this.element.parentNode.replaceChild(newElement, this.element);
    this.element = newElement;

    const gridEl = this.element.firstElementChild as HTMLElement;

    if (!this.readOnly && gridEl) {
      this.initResize(gridEl);
      this.initAddControls(gridEl);
      this.initRowColControls(gridEl);
    }
  }

  public destroy(): void {
    this.resize?.destroy();
    this.resize = null;
    this.addControls?.destroy();
    this.addControls = null;
    this.rowColControls?.destroy();
    this.rowColControls = null;
    this.cellBlocks?.destroy();
    this.cellBlocks = null;
    this.cellSelection?.destroy();
    this.cellSelection = null;
    this.element = null;
  }

  public deleteRowWithCleanup(rowIndex: number): void {
    const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

    if (gridEl) {
      deleteRowWithBlockCleanup(gridEl, rowIndex, this.grid, this.cellBlocks);
    }
  }

  public deleteColumnWithCleanup(colIndex: number): void {
    const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

    if (gridEl) {
      this.data.colWidths = deleteColumnWithBlockCleanup(gridEl, colIndex, this.data.colWidths, this.grid, this.cellBlocks);
    }
  }

  public getBlockIdsInRow(rowIndex: number): string[] {
    return getBlockIdsInRow(this.element, this.cellBlocks, rowIndex);
  }

  public getBlockIdsInColumn(colIndex: number): string[] {
    return getBlockIdsInColumn(this.element, this.cellBlocks, colIndex);
  }

  private initAddControls(gridEl: HTMLElement): void {
    this.addControls?.destroy();

    if (!this.element) {
      return;
    }

    this.addControls = new TableAddControls({
      wrapper: this.element,
      grid: gridEl,
      onAddRow: () => {
        this.grid.addRow(gridEl);
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingStyles(this.element, this.data.withHeadings);
        updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
        this.initResize(gridEl);
        this.addControls?.syncRowButtonWidth();
        this.rowColControls?.refresh();
      },
      onAddColumn: () => {
        const colWidths = this.data.colWidths ?? readPixelWidths(gridEl);
        const halfAvgWidth = computeHalfAvgWidth(colWidths);

        this.grid.addColumn(gridEl, undefined, colWidths);
        this.data.colWidths = [...colWidths, halfAvgWidth];
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
        this.initResize(gridEl);
        this.addControls?.syncRowButtonWidth();
        this.rowColControls?.refresh();
      },
      onDragStart: () => {
        if (this.resize) {
          this.resize.enabled = false;
        }
        this.rowColControls?.hideAllGrips();
        this.rowColControls?.setGripsDisplay(false);
      },
      onDragAddRow: () => {
        this.grid.addRow(gridEl);
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingStyles(this.element, this.data.withHeadings);
        updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
      },
      onDragRemoveRow: () => {
        const rowCount = this.grid.getRowCount(gridEl);

        if (rowCount > 1 && isRowEmpty(gridEl, rowCount - 1)) {
          deleteRowWithBlockCleanup(gridEl, rowCount - 1, this.grid, this.cellBlocks);
        }
      },
      onDragAddCol: () => {
        const colWidths = this.data.colWidths ?? readPixelWidths(gridEl);
        const halfAvgWidth = computeHalfAvgWidth(colWidths);

        this.grid.addColumn(gridEl, undefined, colWidths);
        this.data.colWidths = [...colWidths, halfAvgWidth];
        applyPixelWidths(gridEl, this.data.colWidths);
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
        this.initResize(gridEl);
      },
      onDragRemoveCol: () => {
        const colCount = this.grid.getColumnCount(gridEl);

        if (colCount <= 1 || !isColumnEmpty(gridEl, colCount - 1)) {
          return;
        }

        this.data.colWidths = deleteColumnWithBlockCleanup(gridEl, colCount - 1, this.data.colWidths, this.grid, this.cellBlocks);

        if (this.data.colWidths) {
          applyPixelWidths(gridEl, this.data.colWidths);
        }

        this.initResize(gridEl);
      },
      onDragEnd: () => {
        this.initResize(gridEl);
        this.addControls?.syncRowButtonWidth();
        this.rowColControls?.refresh();

        if (this.element) {
          this.element.scrollLeft = 0;
        }
      },
    });
  }

  private initRowColControls(gridEl: HTMLElement): void {
    this.rowColControls?.destroy();

    if (!this.element) {
      return;
    }

    this.rowColControls = new TableRowColControls({
      grid: gridEl,
      getColumnCount: () => this.grid.getColumnCount(gridEl),
      getRowCount: () => this.grid.getRowCount(gridEl),
      isHeadingRow: () => this.data.withHeadings,
      isHeadingColumn: () => this.data.withHeadingColumn,
      onAction: (action: RowColAction) => this.handleRowColAction(gridEl, action),
      onDragStateChange: (isDragging: boolean) => {
        if (this.resize) {
          this.resize.enabled = !isDragging;
        }

        this.addControls?.setDisplay(!isDragging);

        if (isDragging) {
          this.api.toolbar.close({ setExplicitlyClosed: false });
        }
      },
    });
  }

  private handleRowColAction(gridEl: HTMLElement, action: RowColAction): void {
    switch (action.type) {
      case 'insert-row-above':
        this.grid.addRow(gridEl, action.index);
        populateNewCells(gridEl, this.cellBlocks);
        break;
      case 'insert-row-below':
        this.grid.addRow(gridEl, action.index + 1);
        populateNewCells(gridEl, this.cellBlocks);
        break;
      case 'insert-col-left':
        this.data.colWidths = computeInsertColumnWidths(gridEl, action.index, this.data, this.grid);
        populateNewCells(gridEl, this.cellBlocks);
        break;
      case 'insert-col-right':
        this.data.colWidths = computeInsertColumnWidths(gridEl, action.index + 1, this.data, this.grid);
        populateNewCells(gridEl, this.cellBlocks);
        break;
      case 'move-row':
        this.grid.moveRow(gridEl, action.fromIndex, action.toIndex);
        break;
      case 'move-col':
        this.grid.moveColumn(gridEl, action.fromIndex, action.toIndex);
        this.data.colWidths = syncColWidthsAfterMove(this.data.colWidths, action.fromIndex, action.toIndex);
        break;
      case 'delete-row':
        deleteRowWithBlockCleanup(gridEl, action.index, this.grid, this.cellBlocks);
        break;
      case 'delete-col':
        this.data.colWidths = deleteColumnWithBlockCleanup(gridEl, action.index, this.data.colWidths, this.grid, this.cellBlocks);
        break;
      case 'toggle-heading':
        this.data.withHeadings = !this.data.withHeadings;
        break;
      case 'toggle-heading-column':
        this.data.withHeadingColumn = !this.data.withHeadingColumn;
        break;
    }

    updateHeadingStyles(this.element, this.data.withHeadings);
    updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();
  }

  private initResize(gridEl: HTMLElement): void {
    this.resize?.destroy();

    const isPercentMode = this.data.colWidths === undefined;
    const widths = this.data.colWidths ?? readPixelWidths(gridEl);

    if (!isPercentMode) {
      enableScrollOverflow(this.element);
    }

    this.resize = new TableResize(
      gridEl,
      widths,
      (newWidths: number[]) => {
        this.data.colWidths = newWidths;
        enableScrollOverflow(this.element);
        this.rowColControls?.positionGrips();
      },
      () => {
        this.rowColControls?.hideAllGrips();
      },
      () => {
        this.addControls?.syncRowButtonWidth();
      },
      isPercentMode,
    );
  }

  private initCellBlocks(gridEl: HTMLElement): void {
    this.cellBlocks = new TableCellBlocks({
      api: this.api,
      gridElement: gridEl,
      tableBlockId: this.blockId ?? '',
    });
  }

  private initCellSelection(gridEl: HTMLElement): void {
    this.cellSelection?.destroy();
    this.cellSelection = new TableCellSelection({
      grid: gridEl,
      onSelectingChange: (isSelecting) => {
        if (this.resize) {
          this.resize.enabled = !isSelecting;
        }

        this.addControls?.setInteractive(!isSelecting);
        this.rowColControls?.setGripsDisplay(!isSelecting);
      },
    });
  }
}
