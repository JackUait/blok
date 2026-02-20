import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  HTMLPasteEvent,
  PasteConfig,
  ToolboxConfig,
} from '../../../types';
import type { ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import { DATA_ATTR } from '../../components/constants';
import { IconTable } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';

import { TableAddControls } from './table-add-controls';
import { TableCellBlocks, CELL_BLOCKS_ATTR } from './table-cell-blocks';
import {
  serializeCellsToClipboard,
  buildClipboardHtml,
  buildClipboardPlainText,
  parseClipboardHtml,
  parseGenericHtmlTable,
} from './table-cell-clipboard';
import { TableCellSelection } from './table-cell-selection';
import { TableGrid, ROW_ATTR, CELL_ATTR } from './table-core';
import {
  applyPixelWidths,
  computeHalfAvgWidth,
  computeInitialColWidth,
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
  SCROLL_OVERFLOW_CLASSES,
  setupKeyboardNavigation,
  updateHeadingColumnStyles,
  updateHeadingStyles,
} from './table-operations';
import { TableResize } from './table-resize';
import { executeRowColAction } from './table-row-col-action-handler';
import type { PendingHighlight } from './table-row-col-action-handler';
import { TableRowColControls } from './table-row-col-controls';
import type { RowColAction } from './table-row-col-controls';
import { registerAdditionalRestrictedTools } from './table-restrictions';
import type { ClipboardBlockData, TableCellsClipboard, TableData, TableConfig } from './types';

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
  private pendingHighlight: PendingHighlight | null = null;
  private isNewTable = false;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<TableData, TableConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config ?? {};
    this.data = normalizeTableData(data, config ?? {});
    this.grid = new TableGrid({ readOnly });
    this.blockId = block?.id;

    if (this.config.restrictedTools !== undefined) {
      registerAdditionalRestrictedTools(this.config.restrictedTools);
    }
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

    wrapper.className = twMerge(WRAPPER_CLASSES, !this.readOnly && WRAPPER_EDIT_CLASSES, this.data.colWidths && SCROLL_OVERFLOW_CLASSES);
    wrapper.setAttribute(DATA_ATTR.tool, 'table');

    if (this.readOnly) {
      wrapper.setAttribute('data-blok-table-readonly', '');
    }

    this.isNewTable = this.data.content.length === 0;

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
      this.initReadOnlyCellSelection(gridEl);

      return;
    }

    this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;

    if (this.isNewTable) {
      populateNewCells(gridEl, this.cellBlocks);
    }

    if (this.data.initialColWidth === undefined) {
      const widths = this.data.colWidths ?? readPixelWidths(gridEl);

      this.data.initialColWidth = widths.length > 0
        ? computeInitialColWidth(widths)
        : undefined;
    }

    this.initResize(gridEl);
    this.initAddControls(gridEl);
    this.initRowColControls(gridEl);
    this.initCellSelection(gridEl);
    this.initGridPasteListener(gridEl);

    if (this.isNewTable) {
      const firstEditable = gridEl.querySelector<HTMLElement>('[contenteditable="true"]');

      firstEditable?.focus();
    }
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
      ...(this.data.initialColWidth !== undefined ? { initialColWidth: this.data.initialColWidth } : {}),
    };
  }

  public validate(savedData: TableData): boolean {
    return savedData.content.length > 0;
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

    this.cellBlocks?.deleteAllBlocks();
    this.cellBlocks?.destroy();

    const oldElement = this.element;

    if (!oldElement?.parentNode) {
      return;
    }

    const newElement = this.render();

    oldElement.parentNode.replaceChild(newElement, oldElement);

    const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

    if (!this.readOnly && gridEl) {
      this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;
      this.initResize(gridEl);
      this.initAddControls(gridEl);
      this.initRowColControls(gridEl);
    }
  }

  public destroy(): void {
    this.cellBlocks?.deleteAllBlocks();

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

    const dragState = { addedCols: 0 };

    this.addControls = new TableAddControls({
      wrapper: this.element,
      grid: gridEl,
      i18n: this.api.i18n,
      getNewColumnWidth: () => {
        const colWidths = this.data.colWidths ?? readPixelWidths(gridEl);

        return this.data.initialColWidth !== undefined
          ? Math.round((this.data.initialColWidth / 2) * 100) / 100
          : computeHalfAvgWidth(colWidths);
      },
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
        const halfWidth = this.data.initialColWidth !== undefined
          ? Math.round((this.data.initialColWidth / 2) * 100) / 100
          : computeHalfAvgWidth(colWidths);

        this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
        this.data.colWidths = [...colWidths, halfWidth];
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
        const halfWidth = this.data.initialColWidth !== undefined
          ? Math.round((this.data.initialColWidth / 2) * 100) / 100
          : computeHalfAvgWidth(colWidths);

        this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
        this.data.colWidths = [...colWidths, halfWidth];
        applyPixelWidths(gridEl, this.data.colWidths);
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
        this.initResize(gridEl);

        dragState.addedCols++;

        if (this.element) {
          this.element.scrollLeft = this.element.scrollWidth;
        }
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

        dragState.addedCols--;
      },
      onDragEnd: () => {
        this.initResize(gridEl);
        this.addControls?.syncRowButtonWidth();
        this.rowColControls?.refresh();

        if (this.element) {
          this.element.scrollLeft = dragState.addedCols > 0 ? this.element.scrollWidth : 0;
        }

        dragState.addedCols = 0;
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
      i18n: this.api.i18n,
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
      onGripClick: (type, index) => {
        if (type === 'row') {
          this.cellSelection?.selectRow(index);
        } else {
          this.cellSelection?.selectColumn(index);
        }
      },
      onGripPopoverClose: () => {
        if (this.pendingHighlight) {
          const { type, index } = this.pendingHighlight;

          this.pendingHighlight = null;

          // Lock the grip synchronously so the unlock listener is registered
          // before any external click can race with a deferred RAF
          this.rowColControls?.setActiveGrip(type, index);

          // Wait for layout so newly inserted cells have dimensions
          requestAnimationFrame(() => {
            if (type === 'row') {
              this.cellSelection?.selectRow(index);
            } else {
              this.cellSelection?.selectColumn(index);
            }
          });
        } else {
          this.cellSelection?.clearActiveSelection();
        }
      },
    });
  }

  private handleRowColAction(gridEl: HTMLElement, action: RowColAction): void {
    const result = executeRowColAction(
      gridEl,
      action,
      { grid: this.grid, data: this.data, cellBlocks: this.cellBlocks },
    );

    this.data.colWidths = result.colWidths;
    this.data.withHeadings = result.withHeadings;
    this.data.withHeadingColumn = result.withHeadingColumn;
    this.pendingHighlight = result.pendingHighlight;

    updateHeadingStyles(this.element, this.data.withHeadings);
    updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();

    if (!result.moveSelection) {
      return;
    }

    // After move operations, select the moved row/column to show where it landed
    const { type: moveType, index: moveIndex } = result.moveSelection;

    if (moveType === 'row') {
      this.cellSelection?.selectRow(moveIndex);
    } else {
      this.cellSelection?.selectColumn(moveIndex);
    }

    this.rowColControls?.setActiveGrip(moveType, moveIndex);
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

  private handleCellCopy(cells: HTMLElement[], clipboardData: DataTransfer): void {
    const entries = this.collectCellBlockData(cells);

    if (entries.length === 0) {
      return;
    }

    const payload = serializeCellsToClipboard(entries);

    clipboardData.setData('text/html', buildClipboardHtml(payload));
    clipboardData.setData('text/plain', buildClipboardPlainText(payload));
  }

  private collectCellBlockData(
    cells: HTMLElement[],
  ): Array<{ row: number; col: number; blocks: ClipboardBlockData[] }> {
    const gridEl = this.element?.firstElementChild;

    if (!gridEl) {
      return [];
    }

    const allRows = Array.from(gridEl.querySelectorAll(`[${ROW_ATTR}]`));

    return cells.map(cell => {
      const row = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

      if (!row) {
        return null;
      }

      const rowIndex = allRows.indexOf(row);
      const cellsInRow = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));
      const colIndex = cellsInRow.indexOf(cell);

      const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);
      const blocks: ClipboardBlockData[] = [];

      if (container) {
        container.querySelectorAll('[data-blok-id]').forEach(blockEl => {
          const blockId = blockEl.getAttribute('data-blok-id');

          if (!blockId) {
            return;
          }

          const blockIndex = this.api.blocks.getBlockIndex(blockId);

          if (blockIndex === undefined) {
            return;
          }

          const block = this.api.blocks.getBlockByIndex(blockIndex);

          if (!block) {
            return;
          }

          blocks.push({
            tool: block.name,
            data: block.preservedData,
            ...(Object.keys(block.preservedTunes).length > 0
              ? { tunes: block.preservedTunes }
              : {}),
          });
        });
      }

      return { row: rowIndex, col: colIndex, blocks };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  private initCellSelection(gridEl: HTMLElement): void {
    this.cellSelection?.destroy();

    // Get RectangleSelection from API
    const rectangleSelection = this.api.rectangleSelection;

    this.cellSelection = new TableCellSelection({
      grid: gridEl,
      rectangleSelection, // Pass reference
      i18n: this.api.i18n,
      onSelectionActiveChange: (hasSelection) => {
        if (this.resize) {
          this.resize.enabled = !hasSelection;
        }

        this.addControls?.setInteractive(!hasSelection);
        this.rowColControls?.setGripsDisplay(!hasSelection);
      },
      onClearContent: (cells) => {
        if (!this.cellBlocks) {
          return;
        }

        const blockIds = this.cellBlocks.getBlockIdsFromCells(cells);

        this.cellBlocks.deleteBlocks(blockIds);
      },
      onCopy: (cells, clipboardData) => {
        this.handleCellCopy(cells, clipboardData);
      },
      onCut: (cells, clipboardData) => {
        this.handleCellCopy(cells, clipboardData);
      },
    });
  }

  private initReadOnlyCellSelection(gridEl: HTMLElement): void {
    this.cellSelection?.destroy();

    const rectangleSelection = this.api.rectangleSelection;

    this.cellSelection = new TableCellSelection({
      grid: gridEl,
      rectangleSelection,
      i18n: this.api.i18n,
      onCopy: (cells, clipboardData) => {
        this.handleCellCopy(cells, clipboardData);
      },
    });
  }

  private initGridPasteListener(gridEl: HTMLElement): void {
    gridEl.addEventListener('paste', (e: ClipboardEvent) => {
      this.handleGridPaste(e, gridEl);
    });
  }

  private handleGridPaste(e: ClipboardEvent, gridEl: HTMLElement): void {
    if (this.readOnly || !e.clipboardData) {
      return;
    }

    const html = e.clipboardData.getData('text/html');
    const payload = parseClipboardHtml(html) ?? parseGenericHtmlTable(html);

    if (!payload) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement | null;

    if (!activeElement) {
      return;
    }

    const targetCell = activeElement.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!targetCell || !gridEl.contains(targetCell)) {
      return;
    }

    const targetRow = targetCell.closest<HTMLElement>(`[${ROW_ATTR}]`);

    if (!targetRow) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const rows = Array.from(gridEl.querySelectorAll(`[${ROW_ATTR}]`));
    const targetRowIndex = rows.indexOf(targetRow);
    const cellsInRow = Array.from(targetRow.querySelectorAll(`[${CELL_ATTR}]`));
    const targetColIndex = cellsInRow.indexOf(targetCell);

    this.pastePayloadIntoCells(gridEl, payload, targetRowIndex, targetColIndex);
  }

  private pastePayloadIntoCells(
    gridEl: HTMLElement,
    payload: TableCellsClipboard,
    startRow: number,
    startCol: number,
  ): void {
    this.expandGridForPaste(gridEl, startRow + payload.rows, startCol + payload.cols);

    // Paste block data into target cells
    const updatedRows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    Array.from({ length: payload.rows }, (_, r) => r).forEach((r) => {
      const row = updatedRows[startRow + r];

      if (!row) {
        return;
      }

      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      Array.from({ length: payload.cols }, (_, c) => c).forEach((c) => {
        const cell = cells[startCol + c] as HTMLElement | undefined;

        if (cell) {
          this.pasteCellPayload(cell, payload.cells[r][c]);
        }
      });
    });

    // Update table state after paste
    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();
  }

  /**
   * Expand the grid to have at least the required number of rows and columns.
   */
  private expandGridForPaste(gridEl: HTMLElement, neededRows: number, neededCols: number): void {
    const currentRowCount = this.grid.getRowCount(gridEl);
    const currentColCount = this.grid.getColumnCount(gridEl);

    // Auto-expand rows
    Array.from({ length: Math.max(0, neededRows - currentRowCount) }).forEach(() => {
      this.grid.addRow(gridEl);
      populateNewCells(gridEl, this.cellBlocks);
      updateHeadingStyles(this.element, this.data.withHeadings);
      updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
    });

    // Auto-expand columns
    Array.from({ length: Math.max(0, neededCols - currentColCount) }).forEach(() => {
      const colWidths = this.data.colWidths ?? readPixelWidths(gridEl);
      const halfWidth = this.data.initialColWidth !== undefined
        ? Math.round((this.data.initialColWidth / 2) * 100) / 100
        : computeHalfAvgWidth(colWidths);

      this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
      this.data.colWidths = [...colWidths, halfWidth];
      populateNewCells(gridEl, this.cellBlocks);
      updateHeadingColumnStyles(this.element, this.data.withHeadingColumn);
    });
  }

  /**
   * Replace the contents of a single cell with data from the clipboard payload.
   */
  private pasteCellPayload(
    cell: HTMLElement,
    payloadCell: { blocks: ClipboardBlockData[] },
  ): void {
    // Clear existing blocks in this cell
    if (this.cellBlocks) {
      const existingIds = this.cellBlocks.getBlockIdsFromCells([cell]);

      this.cellBlocks.deleteBlocks(existingIds);
    }

    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    if (payloadCell.blocks.length === 0) {
      this.cellBlocks?.ensureCellHasBlock(cell);

      return;
    }

    for (const blockData of payloadCell.blocks) {
      const block = this.api.blocks.insert(
        blockData.tool,
        blockData.data,
        {},
        this.api.blocks.getBlocksCount(),
        false,
      );

      container.appendChild(block.holder);
      this.api.blocks.setBlockParent(block.id, this.blockId ?? '');
    }
  }
}

export { isInsideTableCell, isRestrictedInTableCell, convertToParagraph } from './table-restrictions';
