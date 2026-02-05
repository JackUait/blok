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
import { CELL_BLOCKS_ATTR, TableCellBlocks } from './table-cell-blocks';
import { BORDER_WIDTH, ROW_ATTR, CELL_ATTR, TableGrid } from './table-core';
import { TableResize } from './table-resize';
import { TableRowColControls } from './table-row-col-controls';
import type { RowColAction } from './table-row-col-controls';
import type { TableData, TableConfig } from './types';

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

const WRAPPER_CLASSES = [
  'overflow-x-auto',
  'my-2',
];

const WRAPPER_EDIT_CLASSES = [
  'relative',
  'pr-9',
  'pb-9',
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
  private element: HTMLDivElement | null = null;
  private blockId: string | undefined;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<TableData, TableConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config ?? {};
    this.data = this.normalizeData(data);
    this.grid = new TableGrid({ readOnly });
    this.blockId = block?.id;
  }

  /**
   * Toolbox configuration
   */
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
        ul: true,
        ol: true,
        li: true,
        input: { type: true, checked: true },
      },
    };
  }

  /**
   * Render the table
   */
  public render(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge(WRAPPER_CLASSES, !this.readOnly && WRAPPER_EDIT_CLASSES);
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
      this.applyPixelWidths(gridEl, this.data.colWidths);
    }

    wrapper.appendChild(gridEl);
    this.element = wrapper;

    if (this.data.withHeadings) {
      this.updateHeadingStyles();
    }

    if (!this.readOnly) {
      this.setupKeyboardNavigation(gridEl);
      this.initCellBlocks(gridEl);

      const normalizedContent = this.cellBlocks?.initializeCells(this.data.content);

      if (normalizedContent) {
        this.data.content = normalizedContent;
      }
    }

    return wrapper;
  }

  /**
   * Called after block element is added to the DOM.
   * Initializes resize handles now that pixel widths can be measured.
   */
  public rendered(): void {
    if (this.readOnly || !this.element) {
      return;
    }

    const gridEl = this.element.firstElementChild as HTMLElement;

    if (!gridEl) {
      return;
    }

    this.initResize(gridEl);
    this.initAddControls(gridEl);
    this.initRowColControls(gridEl);
  }

  /**
   * Extract data from the rendered table
   */
  public save(blockContent: HTMLElement): TableData {
    const gridEl = blockContent.firstElementChild as HTMLElement;
    const colWidths = this.data.colWidths;

    return {
      withHeadings: this.data.withHeadings,
      stretched: this.data.stretched,
      content: this.grid.getData(gridEl),
      ...(colWidths ? { colWidths } : {}),
    };
  }

  /**
   * Validate saved data
   */
  public validate(savedData: TableData): boolean {
    return savedData.content.length > 0;
  }

  /**
   * Render block settings
   */
  public renderSettings(): MenuConfig {
    return [
      {
        icon: IconTable,
        title: this.api.i18n.t(this.data.withHeadings
          ? 'tools.table.withoutHeadings'
          : 'tools.table.withHeadings'),
        onActivate: (): void => {
          this.data.withHeadings = !this.data.withHeadings;
          this.updateHeadingStyles();
        },
        closeOnActivate: true,
        isActive: this.data.withHeadings,
      },
    ];
  }

  /**
   * Handle paste of HTML table
   */
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

    // Detect headings from thead or th elements in first row
    const hasTheadHeadings = content.querySelector('thead') !== null;
    const hasThHeadings = rows[0]?.querySelector('th') !== null;
    const withHeadings = hasTheadHeadings || hasThHeadings;

    this.data = {
      withHeadings,
      stretched: this.data.stretched,
      content: tableContent,
    };

    // Re-render with new data
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

  /**
   * Clean up
   */
  public destroy(): void {
    this.resize?.destroy();
    this.resize = null;
    this.addControls?.destroy();
    this.addControls = null;
    this.rowColControls?.destroy();
    this.rowColControls = null;
    this.cellBlocks?.destroy();
    this.cellBlocks = null;
    this.element = null;
  }

  private normalizeData(data: TableData | Record<string, never>): TableData {
    const isTableData = typeof data === 'object' && data !== null && 'content' in data;

    if (!isTableData) {
      return {
        withHeadings: this.config.withHeadings ?? false,
        stretched: this.config.stretched ?? false,
        content: [],
      };
    }

    const tableData = data as TableData;
    const cols = tableData.content?.[0]?.length;
    const colWidths = tableData.colWidths;
    const validWidths = colWidths && cols && colWidths.length === cols ? colWidths : undefined;

    return {
      withHeadings: tableData.withHeadings ?? this.config.withHeadings ?? false,
      stretched: tableData.stretched ?? this.config.stretched ?? false,
      content: tableData.content ?? [],
      colWidths: validWidths,
    };
  }

  private updateHeadingStyles(): void {
    if (!this.element) {
      return;
    }

    const gridEl = this.element.firstElementChild as HTMLElement;

    if (!gridEl) {
      return;
    }

    const firstRow = gridEl.querySelector('[data-blok-table-row]');

    if (!firstRow) {
      return;
    }

    if (this.data.withHeadings) {
      firstRow.setAttribute('data-blok-table-heading', '');
    } else {
      firstRow.removeAttribute('data-blok-table-heading');
    }
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
        this.populateNewCells(gridEl);
      },
      onAddColumn: () => {
        const colWidths = this.data.colWidths ?? this.readPixelWidths(gridEl);
        const halfAvgWidth = Math.round(
          (colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length / 2) * 100
        ) / 100;

        this.grid.addColumn(gridEl, undefined, colWidths);
        this.data.colWidths = [...colWidths, halfAvgWidth];
        this.populateNewCells(gridEl);
        this.initResize(gridEl);
        this.addControls?.syncRowButtonWidth();
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
      onAction: (action: RowColAction) => this.handleRowColAction(gridEl, action),
      onDragStateChange: (isDragging: boolean) => {
        if (!this.resize) {
          return;
        }

        this.resize.enabled = !isDragging;
      },
    });
  }

  private handleRowColAction(gridEl: HTMLElement, action: RowColAction): void {
    switch (action.type) {
      case 'insert-row-above':
        this.grid.addRow(gridEl, action.index);
        this.populateNewCells(gridEl);
        break;
      case 'insert-row-below':
        this.grid.addRow(gridEl, action.index + 1);
        this.populateNewCells(gridEl);
        break;
      case 'insert-col-left':
        this.handleInsertColumn(gridEl, action.index);
        this.populateNewCells(gridEl);
        break;
      case 'insert-col-right':
        this.handleInsertColumn(gridEl, action.index + 1);
        this.populateNewCells(gridEl);
        break;
      case 'move-row':
        this.grid.moveRow(gridEl, action.fromIndex, action.toIndex);
        break;
      case 'move-col':
        this.grid.moveColumn(gridEl, action.fromIndex, action.toIndex);
        this.syncColWidthsAfterMove(action.fromIndex, action.toIndex);
        break;
      case 'delete-row':
        this.deleteRowWithBlockCleanup(gridEl, action.index);
        break;
      case 'delete-col':
        this.deleteColumnWithBlockCleanup(gridEl, action.index);
        break;
      case 'toggle-heading':
        this.data.withHeadings = !this.data.withHeadings;
        this.updateHeadingStyles();
        break;
    }

    this.initResize(gridEl);
    this.addControls?.syncRowButtonWidth();
    this.rowColControls?.refresh();
  }

  private handleInsertColumn(gridEl: HTMLElement, index: number): void {
    const colWidths = this.data.colWidths ?? this.readPixelWidths(gridEl);

    this.grid.addColumn(gridEl, index, colWidths);

    const halfAvgWidth = Math.round(
      (colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length / 2) * 100
    ) / 100;
    const newWidths = [...colWidths];

    newWidths.splice(index, 0, halfAvgWidth);
    this.data.colWidths = newWidths;
  }

  private syncColWidthsAfterMove(fromIndex: number, toIndex: number): void {
    if (!this.data.colWidths) {
      return;
    }

    const widths = [...this.data.colWidths];
    const [moved] = widths.splice(fromIndex, 1);

    widths.splice(toIndex, 0, moved);
    this.data.colWidths = widths;
  }

  private syncColWidthsAfterDeleteColumn(index: number): void {
    if (!this.data.colWidths) {
      return;
    }

    const widths = [...this.data.colWidths];

    widths.splice(index, 1);
    this.data.colWidths = widths.length > 0 ? widths : undefined;
  }

  private initResize(gridEl: HTMLElement): void {
    this.resize?.destroy();

    const widths = this.data.colWidths ?? this.readPixelWidths(gridEl);

    this.resize = new TableResize(gridEl, widths, (newWidths: number[]) => {
      this.data.colWidths = newWidths;
    });
  }

  private readPixelWidths(gridEl: HTMLElement): number[] {
    const firstRow = gridEl.querySelector('[data-blok-table-row]');

    if (!firstRow) {
      return [];
    }

    const cells = firstRow.querySelectorAll('[data-blok-table-cell]');

    return Array.from(cells).map(cell =>
      (cell as HTMLElement).getBoundingClientRect().width
    );
  }

  private applyPixelWidths(grid: HTMLElement, widths: number[]): void {
    const totalWidth = widths.reduce((sum, w) => sum + w, 0);
    const gridStyle: HTMLElement = grid;

    gridStyle.style.width = `${totalWidth + BORDER_WIDTH}px`;

    const rowEls = grid.querySelectorAll('[data-blok-table-row]');

    rowEls.forEach(row => {
      const cells = row.querySelectorAll('[data-blok-table-cell]');

      cells.forEach((node, i) => {
        if (i < widths.length) {
          const cellEl = node as HTMLElement;

          cellEl.style.width = `${widths[i]}px`;
        }
      });
    });
  }

  private setupKeyboardNavigation(gridEl: HTMLElement): void {
    gridEl.addEventListener('keydown', (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const cell = target.closest<HTMLElement>('[data-blok-table-cell]');

      if (!cell) {
        return;
      }

      const position = this.getCellPosition(gridEl, cell);

      if (position) {
        this.cellBlocks?.handleKeyDown(event, position);
      }
    });
  }

  /**
   * Ensure every cell in the grid has at least one block.
   * Called after addRow / addColumn so new empty cells get an initial paragraph.
   * Cells that already contain blocks are left untouched.
   */
  private populateNewCells(gridEl: HTMLElement): void {
    const cells = gridEl.querySelectorAll(`[${CELL_ATTR}]`);

    cells.forEach(cell => {
      this.cellBlocks?.ensureCellHasBlock(cell as HTMLElement);
    });
  }

  private initCellBlocks(gridEl: HTMLElement): void {
    this.cellBlocks = new TableCellBlocks({
      api: this.api,
      gridElement: gridEl,
      tableBlockId: this.blockId ?? '',
    });
  }

  private getCellPosition(gridEl: HTMLElement, cell: HTMLElement): { row: number; col: number } | null {
    const rows = Array.from(gridEl.querySelectorAll('[data-blok-table-row]'));

    const rowIndex = rows.findIndex(row => {
      const cells = Array.from(row.querySelectorAll('[data-blok-table-cell]'));

      return cells.includes(cell);
    });

    if (rowIndex === -1) {
      return null;
    }

    const cells = Array.from(rows[rowIndex].querySelectorAll('[data-blok-table-cell]'));
    const colIndex = cells.indexOf(cell);

    return { row: rowIndex, col: colIndex };
  }

  /**
   * Delete a row and clean up any nested blocks within its cells
   */
  public deleteRowWithCleanup(rowIndex: number): void {
    if (!this.element) {
      return;
    }

    const gridEl = this.element.firstElementChild as HTMLElement;

    if (gridEl) {
      this.deleteRowWithBlockCleanup(gridEl, rowIndex);
    }
  }

  /**
   * Delete a column and clean up any nested blocks within its cells
   */
  public deleteColumnWithCleanup(colIndex: number): void {
    if (!this.element) {
      return;
    }

    const gridEl = this.element.firstElementChild as HTMLElement;

    if (gridEl) {
      this.deleteColumnWithBlockCleanup(gridEl, colIndex);
    }
  }

  /**
   * Internal helper to delete a row with block cleanup
   */
  private deleteRowWithBlockCleanup(gridEl: HTMLElement, rowIndex: number): void {
    // Collect and delete nested blocks before removing the row
    const blockIds = this.getBlockIdsInRow(rowIndex);

    this.deleteBlocksByIds(blockIds);

    this.grid.deleteRow(gridEl, rowIndex);
  }

  /**
   * Internal helper to delete a column with block cleanup
   */
  private deleteColumnWithBlockCleanup(gridEl: HTMLElement, colIndex: number): void {
    // Collect and delete nested blocks before removing the column
    const blockIds = this.getBlockIdsInColumn(colIndex);

    this.deleteBlocksByIds(blockIds);

    this.grid.deleteColumn(gridEl, colIndex);
    this.syncColWidthsAfterDeleteColumn(colIndex);
  }

  /**
   * Delete blocks by their IDs
   */
  private deleteBlocksByIds(blockIds: string[]): void {
    // Get block indices in reverse order to avoid index shifting issues during deletion
    const blockIndices = blockIds
      .map(id => this.api.blocks.getBlockIndex(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => b - a); // Sort descending to delete from end first

    blockIndices.forEach(index => {
      void this.api.blocks.delete(index);
    });
  }

  /**
   * Get all block IDs from cells in a specific row
   */
  public getBlockIdsInRow(rowIndex: number): string[] {
    if (!this.element) {
      return [];
    }

    const rows = this.element.querySelectorAll(`[${ROW_ATTR}]`);

    if (rowIndex >= rows.length) {
      return [];
    }

    const row = rows[rowIndex];
    const blockIds: string[] = [];

    row.querySelectorAll(`[${CELL_BLOCKS_ATTR}]`).forEach(container => {
      container.querySelectorAll('[data-blok-id]').forEach(block => {
        const id = block.getAttribute('data-blok-id');

        if (id) {
          blockIds.push(id);
        }
      });
    });

    return blockIds;
  }

  /**
   * Get all block IDs from cells in a specific column
   */
  public getBlockIdsInColumn(colIndex: number): string[] {
    if (!this.element) {
      return [];
    }

    const rows = this.element.querySelectorAll(`[${ROW_ATTR}]`);
    const blockIds: string[] = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (colIndex >= cells.length) {
        return;
      }

      const cell = cells[colIndex];
      const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

      if (!container) {
        return;
      }

      container.querySelectorAll('[data-blok-id]').forEach(block => {
        const id = block.getAttribute('data-blok-id');

        if (id) {
          blockIds.push(id);
        }
      });
    });

    return blockIds;
  }
}
