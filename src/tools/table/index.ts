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
  syncColWidthsAfterDeleteColumn,
  updateHeadingColumnStyles,
  updateHeadingStyles,
} from './table-operations';
import { TableModel } from './table-model';
import { TableResize } from './table-resize';
import { executeRowColAction } from './table-row-col-action-handler';
import type { PendingHighlight } from './table-row-col-action-handler';
import { TableRowColControls } from './table-row-col-controls';
import type { RowColAction } from './table-row-col-controls';
import { registerAdditionalRestrictedTools } from './table-restrictions';
import type { ClipboardBlockData, LegacyCellContent, TableCellsClipboard, TableData, TableConfig } from './types';

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
  private initialContent: LegacyCellContent[][] | null = null;
  private grid: TableGrid;
  private model: TableModel;
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
    const normalized = normalizeTableData(data, this.config);

    this.initialContent = normalized.content;
    this.grid = new TableGrid({ readOnly });
    this.model = new TableModel(normalized);
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

    wrapper.className = twMerge(WRAPPER_CLASSES, !this.readOnly && WRAPPER_EDIT_CLASSES, this.model.colWidths && SCROLL_OVERFLOW_CLASSES);
    wrapper.setAttribute(DATA_ATTR.tool, 'table');

    if (this.readOnly) {
      wrapper.setAttribute('data-blok-table-readonly', '');
    }

    this.isNewTable = (this.initialContent?.length ?? 0) === 0;

    const rows = this.initialContent?.length || this.config.rows || DEFAULT_ROWS;
    const cols = this.initialContent?.[0]?.length || this.config.cols || DEFAULT_COLS;

    const gridEl = this.grid.createGrid(rows, cols, this.model.colWidths);

    if ((this.initialContent?.length ?? 0) > 0) {
      this.grid.fillGrid(gridEl, this.initialContent ?? []);
    }

    if (this.model.colWidths) {
      applyPixelWidths(gridEl, this.model.colWidths);
    }

    wrapper.appendChild(gridEl);
    this.element = wrapper;

    if (this.model.withHeadings) {
      updateHeadingStyles(this.element, this.model.withHeadings);
    }

    if (this.model.withHeadingColumn) {
      updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
    }

    if (!this.readOnly) {
      this.initCellBlocks(gridEl);
      setupKeyboardNavigation(gridEl, this.cellBlocks);
    }

    return wrapper;
  }

  public rendered(): void {
    if (!this.element || this.initialContent === null) {
      return;
    }

    const gridEl = this.element.firstElementChild as HTMLElement;

    if (!gridEl) {
      return;
    }

    const content = this.initialContent;

    this.initialContent = null;

    if (this.readOnly) {
      mountCellBlocksReadOnly(gridEl, content, this.api, this.blockId ?? '');
      this.initReadOnlyCellSelection(gridEl);

      return;
    }

    const initializedContent = this.cellBlocks?.initializeCells(content) ?? content;

    this.model.replaceAll({
      ...this.model.snapshot(),
      content: initializedContent,
    });

    if (this.isNewTable) {
      populateNewCells(gridEl, this.cellBlocks);
    }

    if (this.model.initialColWidth === undefined) {
      const widths = this.model.colWidths ?? readPixelWidths(gridEl);

      this.model.setInitialColWidth(widths.length > 0
        ? computeInitialColWidth(widths)
        : undefined);
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

  public save(_blockContent: HTMLElement): TableData {
    return this.model.snapshot();
  }

  public validate(savedData: TableData): boolean {
    return savedData.content.length > 0;
  }

  /**
   * Update table with new data in-place (used by undo/redo).
   * Follows the onPaste() pattern: delete old blocks, re-render, reinitialize.
   */
  public setData(newData: Partial<TableData>): void {
    const normalized = normalizeTableData(
      {
        ...this.model.snapshot(),
        ...newData,
      } as TableData,
      this.config
    );

    this.initialContent = normalized.content;
    this.model.replaceAll(normalized);

    // Only delete cell blocks during normal updates, not Yjs undo/redo.
    // During Yjs sync, the child cell blocks are managed by Yjs and will be
    // reattached via mountBlocksInCell(). Deleting them here would destroy
    // the block data that Yjs is restoring, causing empty cells after undo.
    if (!this.api.blocks.isSyncingFromYjs) {
      this.cellBlocks?.deleteAllBlocks();
    }

    this.cellBlocks?.destroy();

    const oldElement = this.element;

    if (!oldElement?.parentNode) {
      return;
    }

    this.resize?.destroy();
    this.resize = null;
    this.addControls?.destroy();
    this.addControls = null;
    this.rowColControls?.destroy();
    this.rowColControls = null;
    this.cellSelection?.destroy();
    this.cellSelection = null;

    const newElement = this.render();

    oldElement.parentNode.replaceChild(newElement, oldElement);

    const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

    if (!this.readOnly && gridEl) {
      const setDataContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

      this.model.replaceAll({
        ...this.model.snapshot(),
        content: setDataContent,
      });
      this.initialContent = null;
      this.initResize(gridEl);
      this.initAddControls(gridEl);
      this.initRowColControls(gridEl);
      this.initCellSelection(gridEl);
      this.initGridPasteListener(gridEl);
    }
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

    this.initialContent = tableContent;
    this.model.setWithHeadings(withHeadings);

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
      const pasteContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

      this.model.replaceAll({
        ...this.model.snapshot(),
        content: pasteContent,
      });
      this.initialContent = null;
      this.initResize(gridEl);
      this.initAddControls(gridEl);
      this.initRowColControls(gridEl);
      this.initCellSelection(gridEl);
      this.initGridPasteListener(gridEl);
    }
  }

  public destroy(): void {
    // Only delete cell blocks during normal removal, not Yjs undo.
    // When the table is removed via Yjs undo, its child cell blocks are managed
    // by Yjs and will be restored during redo. Deleting them here would make
    // redo create empty paragraphs instead of restoring the original content.
    if (!this.api.blocks.isSyncingFromYjs) {
      this.cellBlocks?.deleteAllBlocks();
    }

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

    if (!gridEl) {
      return;
    }

    const { blocksToDelete } = this.model.deleteRow(rowIndex);

    this.cellBlocks?.deleteBlocks(blocksToDelete);
    this.grid.deleteRow(gridEl, rowIndex);
  }

  public deleteColumnWithCleanup(colIndex: number): void {
    const gridEl = this.element?.firstElementChild as HTMLElement | undefined;

    if (!gridEl) {
      return;
    }

    const { blocksToDelete } = this.model.deleteColumn(colIndex);

    this.cellBlocks?.deleteBlocks(blocksToDelete);
    this.grid.deleteColumn(gridEl, colIndex);
    this.model.setColWidths(syncColWidthsAfterDeleteColumn(this.model.colWidths, colIndex));
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
        const colWidths = this.model.colWidths ?? readPixelWidths(gridEl);

        return this.model.initialColWidth !== undefined
          ? Math.round((this.model.initialColWidth / 2) * 100) / 100
          : computeHalfAvgWidth(colWidths);
      },
      onAddRow: () => {
        this.grid.addRow(gridEl);
        this.model.addRow();
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingStyles(this.element, this.model.withHeadings);
        updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
        this.initResize(gridEl);
        this.addControls?.syncRowButtonWidth();
        this.rowColControls?.refresh();
      },
      onAddColumn: () => {
        const colWidths = this.model.colWidths ?? readPixelWidths(gridEl);
        const halfWidth = this.model.initialColWidth !== undefined
          ? Math.round((this.model.initialColWidth / 2) * 100) / 100
          : computeHalfAvgWidth(colWidths);

        this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
        this.model.addColumn(undefined, halfWidth);
        this.model.setColWidths([...colWidths, halfWidth]);
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
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
        this.model.addRow();
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingStyles(this.element, this.model.withHeadings);
        updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
      },
      onDragRemoveRow: () => {
        const rowCount = this.grid.getRowCount(gridEl);

        if (rowCount > 1 && isRowEmpty(gridEl, rowCount - 1)) {
          const { blocksToDelete } = this.model.deleteRow(rowCount - 1);

          this.cellBlocks?.deleteBlocks(blocksToDelete);
          this.grid.deleteRow(gridEl, rowCount - 1);
        }
      },
      onDragAddCol: () => {
        const colWidths = this.model.colWidths ?? readPixelWidths(gridEl);
        const halfWidth = this.model.initialColWidth !== undefined
          ? Math.round((this.model.initialColWidth / 2) * 100) / 100
          : computeHalfAvgWidth(colWidths);

        const newWidths = [...colWidths, halfWidth];

        this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
        this.model.addColumn(undefined, halfWidth);
        this.model.setColWidths(newWidths);
        applyPixelWidths(gridEl, newWidths);
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
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

        const { blocksToDelete } = this.model.deleteColumn(colCount - 1);

        this.cellBlocks?.deleteBlocks(blocksToDelete);
        this.grid.deleteColumn(gridEl, colCount - 1);
        const updatedWidths = syncColWidthsAfterDeleteColumn(this.model.colWidths, colCount - 1);

        this.model.setColWidths(updatedWidths);

        if (updatedWidths) {
          applyPixelWidths(gridEl, updatedWidths);
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
      isHeadingRow: () => this.model.withHeadings,
      isHeadingColumn: () => this.model.withHeadingColumn,
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
    // Sync model structural operation before DOM changes
    const { blocksToDelete } = this.syncModelForAction(action);

    const result = executeRowColAction(
      gridEl,
      action,
      {
        grid: this.grid,
        data: {
          colWidths: this.model.colWidths,
          withHeadings: this.model.withHeadings,
          withHeadingColumn: this.model.withHeadingColumn,
          initialColWidth: this.model.initialColWidth,
        },
        cellBlocks: this.cellBlocks,
        blocksToDelete,
      },
    );

    this.model.setColWidths(result.colWidths);
    this.model.setWithHeadings(result.withHeadings);
    this.model.setWithHeadingColumn(result.withHeadingColumn);
    this.pendingHighlight = result.pendingHighlight;

    updateHeadingStyles(this.element, this.model.withHeadings);
    updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
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

  private syncModelForAction(action: RowColAction): { blocksToDelete?: string[] } {
    switch (action.type) {
      case 'insert-row-above':
        this.model.addRow(action.index);
        break;
      case 'insert-row-below':
        this.model.addRow(action.index + 1);
        break;
      case 'insert-col-left':
        this.model.addColumn(action.index);
        break;
      case 'insert-col-right':
        this.model.addColumn(action.index + 1);
        break;
      case 'move-row':
        this.model.moveRow(action.fromIndex, action.toIndex);
        break;
      case 'move-col':
        this.model.moveColumn(action.fromIndex, action.toIndex);
        break;
      case 'delete-row':
        return this.model.deleteRow(action.index);
      case 'delete-col':
        return this.model.deleteColumn(action.index);
      case 'toggle-heading':
      case 'toggle-heading-column':
        // Metadata only — handled after executeRowColAction
        break;
    }

    return {};
  }

  private initResize(gridEl: HTMLElement): void {
    this.resize?.destroy();

    const isPercentMode = this.model.colWidths === undefined;
    const widths = this.model.colWidths ?? readPixelWidths(gridEl);

    if (!isPercentMode) {
      enableScrollOverflow(this.element);
    }

    this.resize = new TableResize(
      gridEl,
      widths,
      (newWidths: number[]) => {
        this.model.setColWidths(newWidths);
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
      model: this.model,
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
    if (this.readOnly || !e.clipboardData || e.defaultPrevented) {
      return;
    }

    const html = e.clipboardData.getData('text/html');
    const blokPayload = parseClipboardHtml(html);
    const externalPayload = blokPayload === null ? parseGenericHtmlTable(html) : null;
    const payload = blokPayload ?? externalPayload;

    if (!payload) {
      return;
    }

    /**
     * If the pasted HTML contains multiple tables (e.g. from Google Docs),
     * don't intercept — let the Paste module handle it as a document-level paste
     * so each table becomes a separate block without overwriting existing cells.
     */
    if (
      externalPayload !== null &&
      new DOMParser().parseFromString(html, 'text/html').querySelectorAll('table').length > 1
    ) {
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

          // Sync pasted block IDs to model
          const blockIds = this.cellBlocks?.getBlockIdsFromCells([cell]) ?? [];

          this.model.setCellBlocks(startRow + r, startCol + c, blockIds);
        }
      });
    });

    // Update table state after paste
    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();

    // Place caret at the end of the last pasted cell
    const lastRow = updatedRows[startRow + payload.rows - 1];
    const lastCell = lastRow?.querySelectorAll(`[${CELL_ATTR}]`)[startCol + payload.cols - 1] as HTMLElement | undefined;

    if (!lastCell || !this.cellBlocks || !this.api.caret) {
      return;
    }

    const blockIds = this.cellBlocks.getBlockIdsFromCells([lastCell]);
    const lastBlockId = blockIds[blockIds.length - 1];

    if (lastBlockId === undefined) {
      return;
    }

    this.api.caret.setToBlock(lastBlockId, 'end');
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
      this.model.addRow();
      populateNewCells(gridEl, this.cellBlocks);
      updateHeadingStyles(this.element, this.model.withHeadings);
      updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
    });

    // Auto-expand columns
    Array.from({ length: Math.max(0, neededCols - currentColCount) }).forEach(() => {
      const colWidths = this.model.colWidths ?? readPixelWidths(gridEl);
      const halfWidth = this.model.initialColWidth !== undefined
        ? Math.round((this.model.initialColWidth / 2) * 100) / 100
        : computeHalfAvgWidth(colWidths);

      this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
      this.model.addColumn(undefined, halfWidth);
      this.model.setColWidths([...colWidths, halfWidth]);
      populateNewCells(gridEl, this.cellBlocks);
      updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
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
