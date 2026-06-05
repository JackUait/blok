import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
} from '../../../types';
import {
  COLUMNS_ATTR,
  COLUMN_TOOL,
  buildColumnResizers,
} from '../columns-shared';
import { mountChildBlocks } from '../nested-blocks';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { twMerge } from '../../components/utils/tw';
import type { ColumnListData } from './types';

/**
 * Build a toolbox icon for a column preset: one rounded frame split by
 * `count - 1` evenly spaced dividers, so it reads as a container holding
 * exactly `count` columns and keeps a constant stroke weight at any count
 * (avoids the cramped barcode look of N separate bars).
 */
function columnsIcon(count: number): string {
  const x = 3;
  const y = 4;
  const w = 18;
  const h = 16;
  const step = w / count;
  const dividers = Array.from({ length: count - 1 }, (_, i) => {
    const dx = +(x + step * (i + 1)).toFixed(2);
    return `<line x1="${dx}" y1="${y}" x2="${dx}" y2="${y + h}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>${dividers}</svg>`;
}

/**
 * ColumnList block — horizontal container that hosts column children.
 * Created via slash-menu presets carrying a transient `columnCount` seed.
 */
export class ColumnList implements BlockTool {
  private readonly api: API;
  private _data: ColumnListData;
  private readonly blockId: string;
  private readonly readOnly: boolean;
  private container: HTMLElement | null = null;

  constructor({ data, api, block, readOnly }: BlockToolConstructorOptions<ColumnListData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
    this.readOnly = readOnly;
  }

  public render(): HTMLElement {
    const container = document.createElement('div');

    // Horizontal gutter comes from the resizer elements, not flex gap, so a
    // separator can live in the space between columns. Keep a vertical gap for
    // the responsive stacked layout.
    container.className = twMerge('flex', 'flex-row', 'flex-wrap', 'gap-y-4', 'w-full');
    container.setAttribute(COLUMNS_ATTR, '');
    container.setAttribute('data-blok-testid', 'column-list');
    container.setAttribute(DATA_ATTR.nestedBlocks, '');

    this.container = container;

    return container;
  }

  public rendered(): void {
    if (this.container === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      // Drag-beside inserts the list and then fills it with explicit columns,
      // so it opts out of the default auto-seed via the transient noSeed flag.
      if (this._data.noSeed !== true) {
        this.seedColumns();
      }

      return;
    }

    mountChildBlocks(this.container, children);
    buildColumnResizers(this.container, children.map(child => child.holder), this.readOnly, this.api, this.blockId);
  }

  private seedColumns(): void {
    const container = this.container;

    if (container === null) {
      return;
    }

    const count = this._data.columnCount ?? 2;
    const baseIndex = this.api.blocks.getBlockIndex(this.blockId);

    if (baseIndex === undefined) {
      return;
    }

    // Clear the transient seed so a later re-render never re-seeds.
    this._data = { ...this._data, columnCount: undefined };

    const columns = Array.from({ length: count }).map((_, i) => {
      // Columns render asynchronously, so each column's rendered() hook seeds
      // and focuses its paragraph after this loop returns — the LAST one would
      // win the focus race. Tag every column except the first with noFocus so
      // only the first column claims the caret, deterministically.
      const column = this.api.blocks.insert(
        COLUMN_TOOL,
        { noFocus: i !== 0 },
        {},
        baseIndex + 1 + i,
        false,
        false
      );

      this.api.blocks.setBlockParent(column.id, this.blockId);
      container.appendChild(column.holder);

      return column;
    });

    buildColumnResizers(container, columns.map(column => column.holder), this.readOnly, this.api, this.blockId);
  }

  public save(): ColumnListData {
    return {};
  }

  public validate(_data: ColumnListData): boolean {
    return true;
  }

  public static get toolbox(): ToolboxConfig {
    const base = {
      searchTerms: ['columns', 'cols', 'layout', 'grid'],
      searchTermKeys: ['columns', 'layout'],
    };

    return [2, 3, 4, 5].map(count => ({
      ...base,
      icon: columnsIcon(count),
      titleKey: `tools.columns.col${count}`,
      name: `column_list-${count}`,
      data: { columnCount: count },
      searchTerms: [...base.searchTerms, `${count}c`, `c${count}`],
    }));
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnListData };
