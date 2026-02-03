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

import { TableGrid } from './table-core';
import { TableKeyboard } from './table-keyboard';
import type { TableData, TableConfig } from './types';

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

const WRAPPER_CLASSES = [
  'overflow-x-auto',
  'my-2',
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
  private keyboard: TableKeyboard | null = null;
  private element: HTMLDivElement | null = null;

  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions<TableData, TableConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config ?? {};
    this.data = this.normalizeData(data);
    this.grid = new TableGrid({ readOnly });
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
      },
    };
  }

  /**
   * Render the table
   */
  public render(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge(WRAPPER_CLASSES);
    wrapper.setAttribute(DATA_ATTR.tool, 'table');

    const rows = this.data.content.length || this.config.rows || DEFAULT_ROWS;
    const cols = this.data.content[0]?.length || this.config.cols || DEFAULT_COLS;

    const gridEl = this.grid.createGrid(rows, cols, this.data.colWidths);

    if (this.data.content.length > 0) {
      this.grid.fillGrid(gridEl, this.data.content);
    }

    wrapper.appendChild(gridEl);
    this.element = wrapper;

    if (this.data.withHeadings) {
      this.updateHeadingStyles();
    }

    if (!this.readOnly) {
      this.setupKeyboardNavigation(gridEl);
    }

    return wrapper;
  }

  /**
   * Extract data from the rendered table
   */
  public save(blockContent: HTMLElement): TableData {
    const gridEl = blockContent.firstElementChild as HTMLElement;
    const colWidths = this.grid.getColWidths(gridEl);
    const cols = colWidths.length;
    const isEqual = cols > 0 && colWidths.every(w => Math.abs(w - colWidths[0]) < 0.1);

    return {
      withHeadings: this.data.withHeadings,
      stretched: this.data.stretched,
      content: this.grid.getData(gridEl),
      ...(isEqual ? {} : { colWidths }),
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
    if (this.element?.parentNode) {
      const newElement = this.render();

      this.element.parentNode.replaceChild(newElement, this.element);
      this.element = newElement;
    }
  }

  /**
   * Clean up
   */
  public destroy(): void {
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

  private setupKeyboardNavigation(gridEl: HTMLElement): void {
    this.keyboard = new TableKeyboard(this.grid, gridEl);

    gridEl.addEventListener('keydown', (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;

      if (!target.hasAttribute('data-blok-table-cell')) {
        return;
      }

      const position = this.getCellPosition(gridEl, target);

      if (position) {
        this.keyboard?.handleKeyDown(event, position);
      }
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
}
