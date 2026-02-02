import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  PasteConfig,
  SanitizerConfig,
  ToolboxConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { DATA_ATTR } from '../../components/constants';
import { IconTable } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import { TableGrid } from './table-core';
import type { TableData, TableConfig } from './types';

const DEFAULT_ROWS = 2;
const DEFAULT_COLS = 2;

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

  public static get sanitize(): SanitizerConfig {
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

    const gridEl = this.grid.createGrid(rows, cols);

    if (this.data.content.length > 0) {
      this.grid.fillGrid(gridEl, this.data.content);
    }

    wrapper.appendChild(gridEl);
    this.element = wrapper;

    return wrapper;
  }

  /**
   * Extract data from the rendered table
   */
  public save(blockContent: HTMLElement): TableData {
    const gridEl = blockContent.firstElementChild as HTMLElement;

    return {
      withHeadings: this.data.withHeadings,
      stretched: this.data.stretched,
      content: this.grid.getData(gridEl),
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

    return {
      withHeadings: (data as TableData).withHeadings ?? this.config.withHeadings ?? false,
      stretched: (data as TableData).stretched ?? this.config.stretched ?? false,
      content: (data as TableData).content ?? [],
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
}
